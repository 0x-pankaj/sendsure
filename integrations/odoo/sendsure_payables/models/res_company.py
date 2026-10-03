import logging

from odoo import _, fields, models

from .account_payment import METHOD

_logger = logging.getLogger(__name__)


class ResCompany(models.Model):
    _inherit = 'res.company'

    sendsure_journal_id = fields.Many2one(
        'account.journal', string="SendSure journal", copy=False,
        help="The USDC journal SendSure records its payments in.")

    def _sendsure_currency(self):
        """USDC as a currency. Odoo's currency code holds 3 characters ("USDC" becomes "USD", which exists),
        so the code is USC and the symbol USDC. Six decimals, like the token: nothing is rounded away."""
        currency = self.env.ref('sendsure_payables.currency_usc', raise_if_not_found=False)
        if currency:
            return currency
        Currency = self.env['res.currency'].sudo().with_context(active_test=False)
        currency = Currency.search([('name', '=', 'USC')], limit=1)
        if currency:
            currency.write({'active': True, 'symbol': 'USDC', 'rounding': 0.000001})
        else:
            currency = Currency.create({
                'name': 'USC', 'symbol': 'USDC', 'full_name': 'USD Coin (USDC)',
                'rounding': 0.000001, 'position': 'after', 'active': True,
            })
        self.env['ir.model.data'].sudo()._update_xmlids([{
            'xml_id': 'sendsure_payables.currency_usc', 'record': currency, 'noupdate': True,
        }])
        return currency

    def _sendsure_setup(self):
        """Idempotent: the USDC currency, a 1:1 rate to USD, and a journal whose only way out is SendSure."""
        usc = self._sendsure_currency()
        usd = self.env.ref('base.USD')
        method = self.env.ref('sendsure_payables.payment_method_sendsure_usdc')
        for company in self:
            if not self.env['account.account'].search_count([('company_ids', 'in', company.id)], limit=1):
                _logger.info("SendSure: company %s has no chart of accounts yet; set up later.", company.name)
                continue
            Rate = self.env['res.currency.rate'].sudo()
            if not Rate.search_count([('currency_id', '=', usc.id), ('company_id', '=', company.id)]):
                # 1 USDC = 1 USD. In a company kept in another currency, USC follows USD's rate.
                usd_rate = usd._get_rates(company, fields.Date.today()).get(usd.id, 1.0)
                Rate.create({'currency_id': usc.id, 'company_id': company.id, 'name': '2020-01-01',
                             'rate': usd_rate if company.currency_id != usd else 1.0})
            journal = company.sendsure_journal_id
            if not journal:
                Journal = self.env['account.journal'].sudo().with_company(company)
                code = next(c for c in ('SSU', 'SSU2', 'SSU3', 'SSU4', 'SSU5')
                            if not Journal.search_count([('code', '=', c), ('company_id', '=', company.id)]))
                journal = Journal.create({
                    'name': _("USDC on Arc (SendSure)"), 'code': code, 'type': 'bank',
                    'currency_id': usc.id, 'company_id': company.id,
                })
                company.sudo().sendsure_journal_id = journal
            lines = journal.outbound_payment_method_line_ids
            if not lines.filtered(lambda l: l.payment_method_id == method):
                self.env['account.payment.method.line'].sudo().create({
                    'journal_id': journal.id, 'payment_method_id': method.id, 'name': _("USDC on Arc (SendSure)"),
                })
        self._sendsure_maintain()

    def _sendsure_maintain(self):
        """Run at setup and by the cron: the journal's only way out is SendSure, and USDC stays at 1:1 to USD."""
        usc = self.env.ref('sendsure_payables.currency_usc', raise_if_not_found=False)
        usd = self.env.ref('base.USD')
        for company in self.filtered('sendsure_journal_id'):
            # Community's "Manual" (or any other method) never checks that the recipient is trusted, so this
            # journal has none of them: money leaves it only through SendSure.
            others = company.sendsure_journal_id.outbound_payment_method_line_ids.filtered(lambda l: l.code != METHOD)
            if others:
                others.sudo().unlink()
            # In a company kept in another currency, USC follows USD's rate day by day (one USDC is one dollar).
            if usc and company.currency_id != usd:
                today = fields.Date.context_today(self.with_company(company))
                Rate = self.env['res.currency.rate'].sudo()
                if not Rate.search_count([('currency_id', '=', usc.id), ('company_id', '=', company.id), ('name', '=', today)]):
                    usd_rate = usd.with_company(company)._get_rates(company, today).get(usd.id)
                    if usd_rate:
                        Rate.create({'currency_id': usc.id, 'company_id': company.id, 'name': today, 'rate': usd_rate})
