from odoo import _, fields, models

from .sendsure_client import DEFAULT_URL


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    sendsure_url = fields.Char("SendSure server", config_parameter='sendsure.url', default=DEFAULT_URL)
    sendsure_api_key = fields.Char("SendSure key", config_parameter='sendsure.api_key',
                                   help="Created by the org's owner in SendSure: /org -> Connect your books.")
    sendsure_manual_only = fields.Boolean(
        "Pay only when someone runs the agent in SendSure", config_parameter='sendsure.manual_only',
        help="Off (the default): every few minutes, Odoo asks SendSure's agent to pay bills the vendor signed. It pays "
             "only what passes your Arc contract's rules; first payments and large amounts still wait for a person's "
             "co-sign in SendSure. On: only a person runs it, in SendSure or with \"Run the agent now\" on a bill.")
    sendsure_org = fields.Char("SendSure org", config_parameter='sendsure.org', readonly=True)
    sendsure_org_tier = fields.Char("SendSure org type", config_parameter='sendsure.org_tier', readonly=True)

    def action_sendsure_test(self):
        self.ensure_one()
        self.set_values()
        info = self.env['sendsure.client'].org()
        funds = info.get('funds')
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('sendsure.org', info['org'])
        params.set_param('sendsure.org_tier', info.get('tier', ''))
        self.env.company._sendsure_setup()
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'type': 'success',
                'title': _("Connected to SendSure"),
                'message': _("Org %(org)s (%(tier)s) on %(chain)s. The USDC journal is ready.",
                             org=info['org'], tier=info.get('tier', ''), chain=info.get('chain', {}).get('name', 'Arc'))
                           + (_(" Your wallet holds %(balance)s USDC and SendSure may spend %(budget)s. One bill can be up "
                                "to %(max)s USDC; a person co-signs above %(cosign)s.",
                                balance=funds['balance'], budget=funds['budget'], max=funds['claim_max'],
                                cosign=funds['cosign_above']) if funds else ''),
                'next': {'type': 'ir.actions.client', 'tag': 'soft_reload'},
            },
        }
