from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError

METHOD = 'sendsure_usdc'


class AccountPaymentMethod(models.Model):
    _inherit = 'account.payment.method'

    @api.model
    def _get_payment_method_information(self):
        res = super()._get_payment_method_information()
        # 'unique': one journal per company (the SendSure journal), so it never shows up on other bank journals.
        res[METHOD] = {'mode': 'unique', 'type': ('bank',)}
        return res


class AccountPayment(models.Model):
    _inherit = 'account.payment'

    sendsure_tx = fields.Char("Arc transaction", readonly=True, copy=False, index=True,
                              help="The Arc transaction that paid this, read from the chain by SendSure.")

    _sendsure_tx_unique = models.Constraint(
        'UNIQUE(sendsure_tx)', "This Arc transaction is already recorded as a payment.")

    @api.model
    def _get_method_codes_using_bank_account(self):
        return super()._get_method_codes_using_bank_account() + [METHOD]

    @api.model
    def _get_method_codes_needing_bank_account(self):
        # Community returns [] here, so Odoo never checks that the recipient is trusted. Adding this
        # method turns Odoo's own "recipient must be trusted" check on for USDC payouts.
        return super()._get_method_codes_needing_bank_account() + [METHOD]

    @api.model_create_multi
    def create(self, vals_list):
        # The Arc transaction is a fact read from the chain by SendSure's own recording (which runs as sudo).
        # Nobody may type one in, over the UI or RPC.
        if not self.env.su and any(vals.get('sendsure_tx') for vals in vals_list):
            raise AccessError(_("Only SendSure records an Arc transaction on a payment."))
        return super().create(vals_list)

    def write(self, vals):
        if 'sendsure_tx' in vals and not self.env.su:
            raise AccessError(_("Only SendSure records an Arc transaction on a payment."))
        return super().write(vals)

    def action_draft(self):
        if not self.env.su and self.filtered('sendsure_tx'):
            raise UserError(_("This payment was recorded from a transaction on Arc. It cannot be reset: the money moved. "
                              "Book any correction as a separate entry."))
        return super().action_draft()

    def action_cancel(self):
        if not self.env.su and self.filtered('sendsure_tx'):
            raise UserError(_("This payment was recorded from a transaction on Arc. It cannot be cancelled: the money moved."))
        return super().action_cancel()

    def action_post(self):
        for payment in self:
            if payment.payment_method_code == METHOD and payment.payment_type == 'outbound' and not payment.sendsure_tx:
                raise UserError(_(
                    "Payments with USDC on Arc (SendSure) are recorded by SendSure from the chain, with their transaction. "
                    "To pay this vendor, use \"Pay with SendSure\" on the bill."))
        return super().action_post()


class AccountPaymentRegister(models.TransientModel):
    _inherit = 'account.payment.register'

    def _create_payment_vals_from_wizard(self, batch_result):
        vals = super()._create_payment_vals_from_wizard(batch_result)
        if self.env.su and self.env.context.get('sendsure_tx'):
            vals['sendsure_tx'] = self.env.context['sendsure_tx']
        return vals
