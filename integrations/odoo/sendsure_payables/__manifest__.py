{
    'name': 'SendSure: pay vendors in USDC, only at an address they proved',
    'summary': 'Vendor bills paid in USDC on Arc by the SendSure agent, only to a wallet the vendor proved, '
               'recorded back exactly with the transaction.',
    'description': """
SendSure for Odoo
=================
* USDC as a 6-decimal currency (code USC, symbol USDC) and a "USDC on Arc (SendSure)" journal.
* A vendor wallet can be trusted only if the vendor proved it in SendSure (signed with it).
* "Pay with SendSure" on a posted bill: the vendor confirms it by signing; SendSure's agent pays
  their proven address from your own wallet, inside a budget an Arc contract enforces.
* Each payment is recorded back through Odoo's Register Payment, with the exact on-chain amount and
  the Arc transaction in the memo. An amount that is not exact is left open for review, never rounded.
""",
    'version': '19.0.1.0.0',
    'category': 'Accounting/Accounting',
    'author': 'SendSure',
    'website': 'https://github.com/0x-pankaj/sendsure/tree/main/integrations/odoo',
    'license': 'LGPL-3',
    'depends': ['account'],
    'external_dependencies': {'python': ['requests']},
    'data': [
        'data/payment_method.xml',
        'data/cron.xml',
        'views/res_config_settings_views.xml',
        'views/res_partner_views.xml',
        'views/account_move_views.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
