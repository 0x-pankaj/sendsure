from . import models


def post_init_hook(env):
    """USDC currency, a 1:1 rate to USD and the SendSure journal, for every company."""
    env['res.company'].search([])._sendsure_setup()
