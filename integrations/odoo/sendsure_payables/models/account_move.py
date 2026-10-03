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
# Ended without a payment: the bill may be sent again (after it is withdrawn from SendSure).
RESENDABLE = ('withdrawn', 'rejected_by_payee', 'refused')
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
                "Trust %(vendor)s's proven wallet %(address)s first (Invoicing > Vendors > the vendor > Invoicing tab > bank accounts; "
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
        """Every bill is checked first; only then is anything sent. A bill SendSure refuses gets the reason on it
        and the others are still sent, so no bill exists in SendSure without Odoo knowing its id."""
        client = self.env['sendsure.client']
        bills = self.filtered(lambda m: not m.sendsure_state or m.sendsure_state in RESENDABLE)
        for bill in bills.filtered(lambda m: m.sendsure_external_id):
            bill._sendsure_withdraw_quietly()
        payloads = [(bill, bill._sendsure_payload()) for bill in bills]
        for bill, payload in payloads:
            try:
                out = client.send_bill(payload)
            except SendSureError as err:
                if len(payloads) == 1:
                    raise
                bill.write({'sendsure_reason': ("SendSure refused it: %s" % err)[:250]})
                bill._message_log(body=_("SendSure did not take this bill: %(err)s", err=str(err)))
                continue
            bill.sendsure_external_id = out['external_id']
            bill._sendsure_apply(out)
            if not out.get('duplicate'):
                bill._message_log(body=Markup(_(
                    "Sent to SendSure: %(amount)s USDC to the vendor's proven address. The vendor confirms this bill by "
                    "signing it; then SendSure's agent pays it on Arc and the payment is recorded here."))
                    % {'amount': escape(out.get('amount_usdc', ''))})
        return True

    # ------------------------------------------------------------------ withdraw (cancel, reset, delete)

    def _sendsure_withdraw_quietly(self):
        """For a bill that ended without a payment: free its id in SendSure so it can be sent again."""
        for bill in self.filtered('sendsure_external_id'):
            try:
                self.env['sendsure.client'].withdraw(bill.sendsure_external_id)
            except SendSureError as err:
                if err.code == 'ALREADY_PAID':
                    raise UserError(_("SendSure already paid %(bill)s on Arc; it will be recorded here.", bill=bill.name)) from err
                raise
            bill.sendsure_external_id = False

    def _sendsure_withdraw(self, what):
        """Called after Odoo cancelled, reset or is deleting bills: SendSure must not pay them. If SendSure cannot
        confirm that, the whole action is undone (an error rolls back the transaction)."""
        for bill in self.filtered(lambda m: m.sendsure_external_id and m.sendsure_state in IN_FLIGHT):
            try:
                self.env['sendsure.client'].withdraw(bill.sendsure_external_id)
            except SendSureError as err:
                if err.code == 'ALREADY_PAID':
                    raise UserError(_(
                        "SendSure already paid %(bill)s on Arc, so it cannot be %(what)s. The payment is recorded here at the "
                        "next sync (or click Refresh SendSure).", bill=bill.name, what=what)) from err
                raise UserError(_(
                    "%(bill)s was not %(what)s: SendSure could not confirm it will not pay it (%(err)s). Try again in a minute.",
                    bill=bill.name, what=what, err=str(err))) from err
            if bill.exists():
                bill.write({'sendsure_state': 'withdrawn', 'sendsure_external_id': False,
                            'sendsure_reason': _("Withdrawn from SendSure when the bill was %(what)s.", what=what)})
                bill._message_log(body=_("Withdrawn from SendSure (the bill was %(what)s): the agent will not pay it.", what=what))

    def button_draft(self):
        res = super().button_draft()
        self._sendsure_withdraw(_("reset to draft"))
        return res

    def button_cancel(self):
        res = super().button_cancel()
        self._sendsure_withdraw(_("cancelled"))
        return res

    def unlink(self):
        in_flight = self.filtered(lambda m: m.sendsure_external_id and m.sendsure_state in IN_FLIGHT)
        if in_flight:
            in_flight._sendsure_withdraw(_("deleted"))
        return super().unlink()

    def action_register_payment(self):
        if not self.env.context.get('sendsure_tx'):
            busy = self.filtered(lambda m: m.sendsure_state in IN_FLIGHT)
            if busy:
                raise UserError(_(
                    "%(bill)s is being paid with SendSure. Paying it another way could pay the vendor twice. Reset it to "
                    "draft or cancel it first (that withdraws it from SendSure), or wait for the payment to be recorded.",
                    bill=busy[0].name))
        return super().action_register_payment()

    # ------------------------------------------------------------------ sync

    def action_sendsure_refresh(self):
        self._sendsure_sync()
        return True

    def _sendsure_sync(self):
        """Each bill on its own: one bill that cannot be recorded never blocks the others."""
        bills = self.filtered('sendsure_external_id')
        if not bills:
            return
        by_id = {b['external_id']: b for b in self.env['sendsure.client'].bills(bills.mapped('sendsure_external_id'))}
        for bill in bills:
            info = by_id.get(bill.sendsure_external_id)
            if not info:
                if bill.sendsure_state in IN_FLIGHT:
                    bill.write({'sendsure_state': 'withdrawn', 'sendsure_external_id': False,
                                'sendsure_reason': _("Not found in SendSure any more (withdrawn).")})
                continue
            try:
                with self.env.cr.savepoint():
                    bill._sendsure_apply(info)
            except SendSureError as err:
                _logger.warning("SendSure: %s: %s", bill.name, err)
            except Exception as err:  # noqa: BLE001 - a person must look at this bill; the others go on
                _logger.exception("SendSure: could not apply the status of %s", bill.name)
                if info.get('status') == 'paid':
                    bill.write({'sendsure_state': 'needs_review',
                                'sendsure_reason': (_("Paid on Arc, but Odoo could not record it: %s") % err)[:250]})

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

    def _sendsure_record_payment(self, info, accept_difference=False):
        """Record what Arc says was paid, through Odoo's own Register Payment, only if it is exact.
        `accept_difference`: a manager decided to record the exact Arc amount and book the rest by hand."""
        self.ensure_one()
        s = info['settlement']
        tx = s['tx']
        paid = Decimal(s['amount']).scaleb(-USDC_DECIMALS)  # exact: atomic units / 10^6
        base = {'sendsure_tx': tx, 'sendsure_amount_paid': str(paid), 'sendsure_receipt_url': info.get('receipt_url')}
        recorded = self.env['account.payment'].sudo().search([('sendsure_tx', '=', tx)])
        if recorded:
            if self in recorded.reconciled_bill_ids:
                self.write(dict(base, sendsure_state='paid', sendsure_reason=info.get('reason')))
            else:
                self.write(dict(base, sendsure_state='needs_review', sendsure_reason=_(
                    "This Arc transaction is already recorded as %(payment)s for another bill. Check which bill it paid.",
                    payment=', '.join(recorded.mapped('name')))))
            return
        vendor = self.partner_id.commercial_partner_id
        problem = self._sendsure_exactness_problem(paid, s['payout'], accept_difference)
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
        # sudo: only SendSure's own recording may put an Arc transaction on a payment (see account_payment.py).
        wizard = self.env['account.payment.register'].sudo().with_company(company).with_context(
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
        open_before = Decimal(float_repr(self.amount_residual, self.currency_id.decimal_places))
        payments = wizard._create_payments()
        self.write(dict(base, sendsure_state='paid', sendsure_reason=info.get('reason')))
        if accept_difference and paid != open_before and self.currency_id.is_zero(self.amount_residual):
            # Odoo keeps the bill's currency at its own precision (cents for USD) and absorbs what is below it,
            # without a write-off. Say exactly how much, so nobody thinks the amounts matched.
            note = _("Recorded %(paid)s USDC against %(open)s %(cur)s. Odoo absorbed the %(diff)s difference at %(cur)s's "
                     "precision, with no write-off: book it explicitly if it matters.",
                     paid=paid, open=open_before, cur=self.currency_id.name, diff=format(abs(open_before - paid).normalize(), 'f'))
            self.write({'sendsure_reason': note[:250]})
            self._message_log(body=note)
        if not self.currency_id.is_zero(self.amount_residual):
            self.write({'sendsure_state': 'paid' if accept_difference else 'needs_review',
                        'sendsure_reason': _("Recorded the exact Arc amount; %(left)s is still open on the bill. Book that "
                                             "difference explicitly.",
                                             left=float_repr(self.amount_residual, self.currency_id.decimal_places))})
        self._message_log(body=Markup(_(
            "Paid on Arc: %(amount)s USDC to %(vendor)s's proven address <code>%(payout)s</code>. "
            "<a href='%(url)s'>Transaction</a> · <a href='%(receipt)s'>SendSure receipt</a> (the vendor's proof of address, "
            "their signed claim and the agent's decision). Recorded as %(payment)s.")) % {
                'amount': escape(str(paid)), 'vendor': escape(vendor.name), 'payout': escape(s['payout']),
                'url': EXPLORER_TX % tx, 'receipt': escape(info.get('receipt_url') or ''),
                'payment': escape(', '.join(payments.mapped('name')))})

    def _sendsure_exactness_problem(self, paid, payout, accept_difference=False):
        """Why this settlement cannot be recorded as-is, or None. Odoo marks a $250.00 bill paid by 249.995
        USDC with no write-off at all, so anything but an exact match is left for a person."""
        self.ensure_one()
        if self.state != 'posted':
            return _("SendSure paid this bill on Arc, but in Odoo it is %(state)s. Post it again to record the payment.",
                     state=dict(self._fields['state'].selection).get(self.state, self.state))
        open_amount = Decimal(float_repr(self.amount_residual, self.currency_id.decimal_places))
        if paid != open_amount and not accept_difference:
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

    def action_sendsure_record_review(self):
        """Accounting managers: record a payment SendSure made on Arc that could not be recorded automatically.
        The exact Arc amount is recorded; any difference stays open on the bill, to be booked explicitly."""
        if not self.env.user.has_group('account.group_account_manager'):
            raise UserError(_("Only an accounting manager can record a payment that needs review."))
        bills = self.filtered(lambda m: m.sendsure_state == 'needs_review' and m.sendsure_tx)
        if not bills:
            return True
        ids = self.env['sendsure.client'].bills(bills.mapped(lambda b: b.sendsure_external_id or ''))
        by_tx = {b.get('settlement', {}).get('tx'): b for b in ids if b.get('status') == 'paid'}
        for bill in bills:
            info = by_tx.get(bill.sendsure_tx)
            if not info:
                raise UserError(_("SendSure no longer reports %(bill)s as paid. Click Refresh SendSure first.", bill=bill.name))
            bill.sendsure_state = 'paid_unconfirmed'
            bill._sendsure_record_payment(info, accept_difference=True)
            if bill.sendsure_state == 'needs_review':
                raise UserError(bill.sendsure_reason)
            bill._message_log(body=_("%(user)s recorded this SendSure payment after review.", user=self.env.user.name))
        return True

    def _sendsure_wallet_for(self, vendor, payout):
        return self.env['res.partner.bank'].sudo().search([
            ('partner_id', '=', vendor.id), ('sanitized_acc_number', '=', sanitize_account_number(payout))], limit=1)

    # ------------------------------------------------------------------ cron

    @api.model
    def _cron_sendsure_sync(self):
        client = self.env['sendsure.client']
        if not client.is_configured():
            return
        self.env['res.company'].search([('sendsure_journal_id', '!=', False)])._sendsure_maintain()
        self.env['res.partner']._cron_sendsure_refresh_vendors()
        bills = self.search([('sendsure_state', 'in', IN_FLIGHT)])
        try:
            bills._sendsure_sync()
        except SendSureError as err:
            _logger.warning("SendSure: bill sync failed: %s", err)
            return
        params = self.env['ir.config_parameter'].sudo()
        if params.get_param('sendsure.manual_only') or not bills.filtered(lambda b: b.sendsure_state == 'signed'):
            return
        try:
            client.run_agent()
        except SendSureError as err:
            # A slow answer does not mean the run failed: the chain has the truth, so read it either way.
            _logger.warning("SendSure: agent run: %s", err)
        try:
            bills._sendsure_sync()
        except SendSureError as err:
            _logger.warning("SendSure: bill sync after the agent run failed: %s", err)
