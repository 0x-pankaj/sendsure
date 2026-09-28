from odoo import api, models


class AccountPaymentMethod(models.Model):
    _inherit = 'account.payment.method'

    @api.model
    def _get_payment_method_information(self):
        res = super()._get_payment_method_information()
        res['usdc_arc'] = {'mode': 'multi', 'type': ('bank',)}
        return res


class AccountPayment(models.Model):
    _inherit = 'account.payment'

    @api.model
    def _get_method_codes_using_bank_account(self):
        return super()._get_method_codes_using_bank_account() + ['usdc_arc']

    @api.model
    def _get_method_codes_needing_bank_account(self):
        # Community returns [] here, so core never checks `allow_out_payment`.
        # Adding our code turns Odoo's own "recipient must be trusted" check on for USDC payouts.
        return super()._get_method_codes_needing_bank_account() + ['usdc_arc']
