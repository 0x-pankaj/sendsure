"""What differs between the Odoo versions this add-on runs on (16.0 to 19.0), in one place."""
from odoo import release

ODOO = release.version_info[0]


def composer_context(records, **extra):
    """Odoo's email composer, opened on `records`. Odoo 17 changed res_id to res_ids."""
    ctx = {'default_model': records._name, 'default_composition_mode': 'comment',
           'default_email_layout_xmlid': 'mail.mail_notification_light'}
    if ODOO >= 17:
        ctx['default_res_ids'] = records.ids
    else:
        ctx['default_res_id'] = records.id
    ctx.update(extra)
    return ctx


def company_domain(model, company):
    """Odoo 18 shares accounts between companies (company_ids); before, an account had one company_id."""
    field = 'company_ids' if 'company_ids' in model._fields else 'company_id'
    return [(field, 'in', company.ids)]
