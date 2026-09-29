from odoo import _, models
from odoo.exceptions import UserError
from odoo.addons.base.models.res_bank import sanitize_account_number

from .sendsure_client import is_evm_address


class ResPartnerBank(models.Model):
    _inherit = 'res.partner.bank'

    def write(self, vals):
        # Odoo's own control: only people with the "Validate bank account" right may trust an account.
        # SendSure adds the missing half for wallets: the vendor must have proved the address themselves.
        if vals.get('allow_out_payment'):
            self.filtered(lambda b: not b.allow_out_payment)._sendsure_check_trust()
        return super().write(vals)

    def _sendsure_check_trust(self):
        client = self.env['sendsure.client']
        wallets = self.filtered(lambda b: is_evm_address(b.acc_number))
        if not wallets or not client.is_configured():
            return
        vendors = wallets.mapped('partner_id.commercial_partner_id')
        unlinked = vendors.filtered(lambda p: not p.sendsure_payee_ref)
        if unlinked:
            raise UserError(_(
                "%(vendor)s is not linked to SendSure. Paste their SendSure invite link on the vendor first: a wallet "
                "can be trusted only after the vendor proves it by signing with it.",
                vendor=unlinked[0].display_name))
        # Read the vendor's proven address now, from the chain, not from what this form says.
        vendors._sendsure_refresh()
        for bank in wallets:
            vendor = bank.partner_id.commercial_partner_id
            if vendor.sendsure_state != 'bound' or not vendor.sendsure_address:
                raise UserError(_(
                    "%(vendor)s has not proved a payout address in SendSure yet (%(state)s), so %(address)s cannot be trusted.",
                    vendor=vendor.display_name, address=bank.acc_number,
                    state=dict(vendor._fields['sendsure_state'].selection).get(vendor.sendsure_state, _("not checked"))))
            if sanitize_account_number(bank.acc_number) != sanitize_account_number(vendor.sendsure_address):
                raise UserError(_(
                    "%(address)s is not the address %(vendor)s proved in SendSure (%(proven)s). Someone may have added "
                    "this wallet to the vendor; do not trust it.",
                    address=bank.acc_number, vendor=vendor.display_name, proven=vendor.sendsure_address))
