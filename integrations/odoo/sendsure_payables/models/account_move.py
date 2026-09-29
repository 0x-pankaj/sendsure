import logging
from decimal import Decimal

from markupsafe import Markup, escape

from odoo import _, api, fields, models
from odoo.exceptions import UserError
from odoo.tools import float_repr
from odoo.addons.base.models.res_bank import sanitize_account_number

from .account_payment import METHOD
from .sendsure_client import SendSureError

_logger = logging.getLogger(__name__)

STATES = [
    ('waiting_for_payee', "Waiting for the vendor to sign"),
    ('rejected_by_payee', "Rejected by the vendor"),
    ('signed', "Signed by the vendor"),
    ('needs_cosign', "Needs a co-sign in SendSure"),
    ('held', "Held by the agent"),
    ('refused', "Refused by the contract"),
    ('withdrawn', "Withdrawn"),
    ('paid_unconfirmed', "Paid, confirming on Arc"),
    ('paid', "Paid on Arc"),
    ('needs_review', "Paid on Arc, needs review"),
]
# States that can still change on SendSure's side.
IN_FLIGHT = ('waiting_for_payee', 'signed', 'needs_cosign', 'held', 'paid_unconfirmed')
USDC_DECIMALS = 6
EXPLORER_TX = 'https://explorer.testnet.arc.io/tx/%s'


class AccountMove(models.Model):
    _inherit = 'account.move'

    sendsure_state = fields.Selection(STATES, "SendSure", readonly=True, copy=False, tracking=True)
    sendsure_reason = fields.Char("SendSure says", readonly=True, copy=False)
    sendsure_external_id = fields.Char("SendSure bill id", readonly=True, copy=False, index=True)
    sendsure_tx = fields.Char("Arc transaction", readonly=True, copy=False)
    sendsure_amount_paid = fields.Char("Paid on Arc (USDC)", readonly=True, copy=False,
                                       help="The exact amount the Settled event on Arc carries, 6 decimals.")
    sendsure_receipt_url = fields.Char("SendSure receipt", readonly=True, copy=False)

    # ------------------------------------------------------------------ send

    def _sendsure_bill_id(self):
        self.ensure_one()
        db = self.env['ir.config_parameter'].sudo().get_param('database.uuid', '')
        return 'odoo:%s:account.move:%s' % (db, self.id)

    def _sendsure_trusted_wallet(self, vendor):
        """The vendor's wallet Odoo trusts, which must be the address they proved in SendSure."""
        return self.env['res.partner.bank'].sudo().search([
            ('partner_id', '=', vendor.id),
            ('sanitized_acc_number', '=', sanitize_account_number(vendor.sendsure_address)),
            ('allow_out_payment', '=', True),
        ], limit=1)

    def _sendsure_payload(self):
        self.ensure_one()
        vendor = self.partner_id.commercial_partner_id
        if self.move_type != 'in_invoice' or self.state != 'posted':
            raise UserError(_("Only posted vendor bills can be paid with SendSure."))
        if self.payment_state != 'not_paid':
            raise UserError(_("%(bill)s is already (partly) paid. SendSure pays whole bills only.", bill=self.name))
        if self.currency_id.name not in ('USD', 'USC'):
            raise UserError(_("SendSure pays in USDC, so the bill must be in USD or USDC, not %(cur)s.", cur=self.currency_id.name))
        if not self.ref:
            raise UserError(_("Add the vendor's invoice number (Bill Reference) first: the vendor signs for exactly that invoice."))
        if not vendor.sendsure_payee_ref:
            raise UserError(_("%(vendor)s is not linked to SendSure. Paste their SendSure invite link on the vendor.",
                              vendor=vendor.display_name))
        vendor._sendsure_refresh()
        if vendor.sendsure_state != 'bound':
            raise UserError(_("%(vendor)s has not proved a payout address in SendSure yet (%(state)s).",
                              vendor=vendor.display_name,
                              state=dict(vendor._fields['sendsure_state'].selection).get(vendor.sendsure_state, '-')))
        if not self._sendsure_trusted_wallet(vendor):
            raise UserError(_(
                "Trust %(vendor)s's proven wallet %(address)s first (Contacts > the vendor > Invoicing > bank accounts; "
                "needs the right to validate bank accounts).", vendor=vendor.display_name, address=vendor.sendsure_address))
        lines = self.invoice_line_ids.filtered(lambda l: l.display_type == 'product').mapped('name')
        return {
            'system': 'odoo',
            'external_id': self._sendsure_bill_id(),
            'payee_ref': vendor.sendsure_payee_ref,
            'invoice_ref': self.ref,
            # A decimal string at the bill currency's own precision, never a float.
            'amount': float_repr(self.amount_residual, self.currency_id.decimal_places),
            'currency': 'USDC' if self.currency_id.name == 'USC' else 'USD',
            'invoice_date': fields.Date.to_string(self.invoice_date or self.date),
            'description': '; '.join(n for n in lines if n)[:200],
            'document': self.name,
        }

    def action_sendsure_send(self):
        client = self.env['sendsure.client']
        for bill in self:
            out = client.send_bill(bill._sendsure_payload())
            bill.sendsure_external_id = out['external_id']
            bill._sendsure_apply(out)
            if not out.get('duplicate'):
                bill._message_log(body=Markup(_(
                    "Sent to SendSure: %(amount)s USDC to the vendor's proven address. The vendor confirms this bill by "
                    "signing it; then SendSure's agent pays it on Arc and the payment is recorded here."))
                    % {'amount': escape(out.get('amount_usdc', ''))})
        return True

    # ------------------------------------------------------------------ sync

    def action_sendsure_refresh(self):
        self._sendsure_sync()
        return True

    def _sendsure_sync(self):
        bills = self.filtered('sendsure_external_id')
        if not bills:
            return
        by_id = {b['external_id']: b for b in self.env['sendsure.client'].bills(bills.mapped('sendsure_external_id'))}
        for bill in bills:
            info = by_id.get(bill.sendsure_external_id)
            if info:
                bill._sendsure_apply(info)

    def _sendsure_apply(self, info):
        self.ensure_one()
        status = info.get('status')
        if self.sendsure_state in ('paid', 'needs_review'):
            return
        if status == 'paid':
            self._sendsure_record_payment(info)
            return
        self.write({'sendsure_state': status if status in dict(STATES) else 'held',
                    'sendsure_reason': (info.get('reason') or '')[:250]})

    def _sendsure_record_payment(self, info):
        """Record what Arc says was paid, through Odoo's own Register Payment, only if it is exact."""
        self.ensure_one()
        s = info['settlement']
        tx = s['tx']
        paid = Decimal(s['amount']).scaleb(-USDC_DECIMALS)  # exact: atomic units / 10^6
        base = {'sendsure_tx': tx, 'sendsure_amount_paid': str(paid), 'sendsure_receipt_url': info.get('receipt_url')}
        if self.env['account.payment'].sudo().search_count([('sendsure_tx', '=', tx)]):
            self.write(dict(base, sendsure_state='paid', sendsure_reason=info.get('reason')))
            return
        vendor = self.partner_id.commercial_partner_id
        problem = self._sendsure_exactness_problem(paid, s['payout'])
        if problem:
            self.write(dict(base, sendsure_state='needs_review', sendsure_reason=problem[:250]))
            self._message_log(body=Markup(_(
                "SendSure paid this bill on Arc (<a href='%(url)s'>transaction</a>), but it was <b>not</b> recorded "
                "automatically: %(problem)s")) % {'url': EXPLORER_TX % tx, 'problem': escape(problem)})
            return
        company = self.company_id
        journal = company.sendsure_journal_id
        line = journal.outbound_payment_method_line_ids.filtered(lambda l: l.code == METHOD)[:1]
        wallet = self._sendsure_wallet_for(vendor, s['payout'])
        wizard = self.env['account.payment.register'].with_company(company).with_context(
            active_model='account.move', active_ids=self.ids, sendsure_tx=tx,
        ).create({
            'journal_id': journal.id,
            'payment_method_line_id': line.id,
            'currency_id': self.env.ref('sendsure_payables.currency_usc').id,
            'amount': float(paid),
            'payment_date': fields.Date.to_date(s['paidAt'][:10]),
            'partner_bank_id': wallet.id,
            'communication': 'SendSure %s' % tx,
            'payment_difference_handling': 'open',
        })
        payments = wizard._create_payments()
        self.write(dict(base, sendsure_state='paid', sendsure_reason=info.get('reason')))
        if not self.currency_id.is_zero(self.amount_residual):
            self.write({'sendsure_state': 'needs_review',
                        'sendsure_reason': _("Recorded, but %(left)s is still open on the bill.",
                                             left=float_repr(self.amount_residual, self.currency_id.decimal_places))})
        self._message_log(body=Markup(_(
            "Paid on Arc: %(amount)s USDC to %(vendor)s's proven address <code>%(payout)s</code>. "
            "<a href='%(url)s'>Transaction</a> · <a href='%(receipt)s'>SendSure receipt</a> (the vendor's proof of address, "
            "their signed claim and the agent's decision). Recorded as %(payment)s.")) % {
                'amount': escape(str(paid)), 'vendor': escape(vendor.name), 'payout': escape(s['payout']),
                'url': EXPLORER_TX % tx, 'receipt': escape(info.get('receipt_url') or ''),
                'payment': escape(', '.join(payments.mapped('name')))})

    def _sendsure_exactness_problem(self, paid, payout):
        """Why this settlement cannot be recorded as-is, or None. Odoo marks a $250.00 bill paid by 249.995
        USDC with no write-off at all, so anything but an exact match is left for a person."""
        self.ensure_one()
        open_amount = Decimal(float_repr(self.amount_residual, self.currency_id.decimal_places))
        if paid != open_amount:
            return _("Arc paid %(paid)s USDC but the bill's open amount is %(open)s %(cur)s. Odoo would round the "
                     "difference away without a write-off, so record it by hand and book the difference explicitly.",
                     paid=paid, open=open_amount, cur=self.currency_id.name)
        vendor = self.partner_id.commercial_partner_id
        if not self._sendsure_wallet_for(vendor, payout).allow_out_payment:
            return _("Arc paid %(payout)s, which is not a wallet Odoo trusts for %(vendor)s.",
                     payout=payout, vendor=vendor.display_name)
        if not self.company_id.sendsure_journal_id:
            return _("The SendSure journal is missing. Run \"Test connection\" in the settings.")
        return None

    def _sendsure_wallet_for(self, vendor, payout):
        return self.env['res.partner.bank'].sudo().search([
            ('partner_id', '=', vendor.id), ('sanitized_acc_number', '=', sanitize_account_number(payout))], limit=1)

    # ------------------------------------------------------------------ cron

    @api.model
    def _cron_sendsure_sync(self):
        client = self.env['sendsure.client']
        if not client.is_configured():
            return
        self.env['res.partner']._cron_sendsure_refresh_vendors()
        bills = self.search([('sendsure_state', 'in', IN_FLIGHT)])
        try:
            bills._sendsure_sync()
            params = self.env['ir.config_parameter'].sudo()
            if not params.get_param('sendsure.manual_only') and bills.filtered(lambda b: b.sendsure_state == 'signed'):
                client.run_agent()
                bills._sendsure_sync()
        except SendSureError as err:
            _logger.warning("SendSure: bill sync failed: %s", err)
