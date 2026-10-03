import logging

from markupsafe import Markup, escape

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError
from odoo.addons.base.models.res_bank import sanitize_account_number

from .sendsure_client import PAYEE_REF, SendSureError, is_evm_address

_logger = logging.getLogger(__name__)

STATES = [
    ('not_invited', "Invite not opened"),
    ('invited', "Invited, waiting for the vendor"),
    ('bound', "Proved their address"),
    ('change_pending', "Changing address (waiting period)"),
    ('frozen', "Frozen"),
    ('revoked', "Revoked"),
]


class ResPartner(models.Model):
    _inherit = 'res.partner'

    sendsure_payee_ref = fields.Char(
        "SendSure invite", copy=False, tracking=True,
        help="Paste the vendor's SendSure invite link (or its ref). The vendor opens it and proves their payout "
             "address by signing with it.")
    sendsure_state = fields.Selection(STATES, "SendSure", readonly=True, copy=False)
    sendsure_address = fields.Char("Proven payout address", readonly=True, copy=False,
                                   help="The address the vendor proved in SendSure, read from Arc.")
    sendsure_checked_at = fields.Datetime("Checked with SendSure", readonly=True, copy=False)

    @api.model
    def _sendsure_parse_ref(self, value):
        if not value:
            return False
        found = PAYEE_REF.findall(value.strip())
        # An invite link carries the org (20 bytes) and the ref (32 bytes); the ref is the 32-byte value.
        if len(found) != 1:
            raise ValidationError(_("Paste the vendor's SendSure invite link, or its ref (0x followed by 64 hex characters)."))
        return found[0].lower()

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('sendsure_payee_ref'):
                vals['sendsure_payee_ref'] = self._sendsure_parse_ref(vals['sendsure_payee_ref'])
        return super().create(vals_list)

    def write(self, vals):
        if 'sendsure_payee_ref' in vals:
            vals = dict(vals, sendsure_payee_ref=self._sendsure_parse_ref(vals['sendsure_payee_ref']),
                        sendsure_state=False, sendsure_address=False, sendsure_checked_at=False)
            relinked = self.filtered(lambda p: p.sendsure_payee_ref and p.sendsure_payee_ref != vals['sendsure_payee_ref'])
            res = super().write(vals)
            # A vendor linked to another invite starts again: no wallet stays trusted until a person trusts the new one.
            for partner in relinked:
                partner._sendsure_untrust_wallets(_("the vendor was linked to another SendSure invite"))
            return res
        return super().write(vals)

    def _sendsure_untrust_wallets(self, why, keep=None):
        """Archive and untrust this vendor's wallets (except `keep`), and say so on the vendor."""
        self.ensure_one()
        wallets = self.env['res.partner.bank'].sudo().search([('partner_id', '=', self.id)]).filtered(
            lambda b: is_evm_address(b.acc_number)
            and (not keep or sanitize_account_number(b.acc_number) != sanitize_account_number(keep)))
        if not wallets:
            return
        wallets.write({'allow_out_payment': False, 'active': False})
        self._message_log(body=_("SendSure: %(n)s wallet(s) archived and no longer trusted because %(why)s.",
                                 n=len(wallets), why=why))

    def action_sendsure_refresh(self):
        self._sendsure_refresh()
        return True

    def _sendsure_refresh(self):
        """Read each linked vendor's state and proven address from SendSure (which reads Arc)."""
        linked = self.filtered('sendsure_payee_ref')
        if not linked:
            return
        by_ref = {p['payeeRef'].lower(): p for p in self.env['sendsure.client'].payees(linked.mapped('sendsure_payee_ref'))}
        now = fields.Datetime.now()
        for partner in linked:
            p = by_ref.get(partner.sendsure_payee_ref.lower())
            if not p:
                continue
            state = 'change_pending' if p.get('pendingChange') else p['state']
            new = p.get('payout')
            old = partner.sendsure_address
            if new and old and sanitize_account_number(new) != sanitize_account_number(old):
                partner._sendsure_address_changed(old, new)
            if new:
                partner._sendsure_wallet(new)
                # A wallet trusted before SendSure was linked (or by any other route) that is not the proven address
                # must not stay trusted.
                stray = self.env['res.partner.bank'].sudo().search([
                    ('partner_id', '=', partner.id), ('allow_out_payment', '=', True)]).filtered(
                    lambda b: is_evm_address(b.acc_number)
                    and sanitize_account_number(b.acc_number) != sanitize_account_number(new))
                if stray:
                    stray.write({'allow_out_payment': False})
                    partner._message_log(body=_(
                        "SendSure: %(addr)s is not the address %(vendor)s proved, so it is no longer trusted.",
                        addr=', '.join(stray.mapped('acc_number')), vendor=partner.name))
            partner.write({'sendsure_state': state, 'sendsure_address': new or False, 'sendsure_checked_at': now})

    def _sendsure_wallet(self, address):
        """The vendor's bank account for their proven address; created untrusted if missing.
        Trusting it stays a person's decision (Odoo's "Validate bank account" right)."""
        self.ensure_one()
        Bank = self.env['res.partner.bank'].sudo().with_context(active_test=False)
        bank = Bank.search([('partner_id', '=', self.id), ('sanitized_acc_number', '=', sanitize_account_number(address))], limit=1)
        if bank and not bank.active:
            bank.active = True
        if not bank:
            bank = Bank.create({'partner_id': self.id, 'acc_number': address, 'acc_holder_name': self.name})
            self._message_log(body=Markup(_(
                "SendSure: %(vendor)s proved the payout address <code>%(address)s</code> by signing with it. "
                "A person with the right to validate bank accounts can now trust it."))
                % {'vendor': escape(self.name), 'address': escape(address)})
        return bank

    def _sendsure_address_changed(self, old, new):
        """The vendor moved to a new proven address (both keys signed, after the waiting period).
        The old wallet is archived so nothing can be paid to it from Odoo."""
        self.ensure_one()
        old_banks = self.env['res.partner.bank'].sudo().search([
            ('partner_id', '=', self.id), ('sanitized_acc_number', '=', sanitize_account_number(old))])
        # Untrusted as well as archived: if the vendor ever moves back to it, a person trusts it again.
        old_banks.write({'active': False, 'allow_out_payment': False})
        self._message_log(body=Markup(_(
            "SendSure: %(vendor)s changed their proven payout address from <code>%(old)s</code> to <code>%(new)s</code>. "
            "SendSure accepts a change only when both the old and the new wallet sign it, after a waiting period the payer "
            "can cancel. The old wallet was archived here; trust the new one after you confirm it."))
            % {'vendor': escape(self.name), 'old': escape(old), 'new': escape(new)})

    @api.model
    def _cron_sendsure_refresh_vendors(self):
        vendors = self.search([('sendsure_payee_ref', '!=', False)])
        try:
            vendors._sendsure_refresh()
        except SendSureError as err:
            _logger.warning("SendSure: vendor refresh failed: %s", err)
