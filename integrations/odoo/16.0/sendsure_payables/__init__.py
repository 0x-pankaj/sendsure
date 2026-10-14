from . import models


def post_init_hook(env, registry=None):
    """USDC currency, a 1:1 rate to USD and the SendSure journal, for every company."""
    if registry is not None:  # Odoo 16 calls post_init_hook(cr, registry)
        from odoo import SUPERUSER_ID, api
        env = api.Environment(env, SUPERUSER_ID, {})
    cron = env.ref('sendsure_payables.ir_cron_sendsure_sync', raise_if_not_found=False)
    if cron and 'numbercall' in cron._fields:  # Odoo 16 and 17: a cron runs once unless told otherwise
        cron.write({'numbercall': -1})
    env['res.company'].search([])._sendsure_setup()
