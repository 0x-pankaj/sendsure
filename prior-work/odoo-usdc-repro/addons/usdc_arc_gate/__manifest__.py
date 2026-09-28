{
    'name': 'USDC on Arc: trusted-wallet gate',
    'summary': 'Adds a "USDC on Arc" payment method that opts into Odoo\'s own trusted-account check.',
    'version': '19.0.1.0.0',
    'depends': ['account'],
    'data': ['data/payment_method.xml'],
    'license': 'LGPL-3',
    'installable': True,
}
