from unittest.mock import patch

from odoo import Command, fields
from odoo.exceptions import UserError, ValidationError
from odoo.tests import tagged

from odoo.addons.account.tests.common import AccountTestInvoicingCommon

ORG = '0x8FA4f5ee6f04D3Bf1A1a5113799508C171DD076C'
REF = '0x' + 'ab' * 32
PROVEN = '0x7fBe6E582F8D7c0ee4C4855573731BE9dbC98522'
ATTACKER = '0x7fBe000000000000000000000000000000008522'
NEW = '0x1111111111111111111111111111111111111111'
TX = '0x' + 'cd' * 32


@tagged('post_install', '-at_install')
class TestSendSure(AccountTestInvoicingCommon):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['ir.config_parameter'].sudo().set_param('sendsure.api_key', 'ssk_test')
        cls.env.company._sendsure_setup()
        cls.usc = cls.env.ref('sendsure_payables.currency_usc')
        cls.journal = cls.env.company.sendsure_journal_id
        cls.vendor = cls.env['res.partner'].create({
            'name': 'Maria Lopez Design',
            'is_company': True,
            'sendsure_payee_ref': 'https://sendsure.example/verify?org=%s&ref=%s&name=Acme' % (ORG, REF),
        })
        cls.payee = {'payeeRef': REF, 'state': 'bound', 'payout': PROVEN, 'payable': True, 'pendingChange': None}
        cls.sent = []

    def setUp(self):
        super().setUp()
        Client = type(self.env['sendsure.client'])
        test = self
        self.bill_status = {}
        patches = [
            patch.object(Client, 'payees', lambda self, refs: [dict(test.payee)]),
            patch.object(Client, 'send_bill', lambda self, payload: test._fake_send(payload)),
            patch.object(Client, 'bills', lambda self, ids: [dict(test.bill_status, external_id=i) for i in ids]),
            patch.object(Client, 'run_agent', lambda self: {'decisions': []}),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _fake_send(self, payload):
        self.sent.append(payload)
        return {'external_id': payload['external_id'], 'status': 'waiting_for_payee', 'amount_usdc': payload['amount'],
                'reason': 'Waiting for the vendor.', 'duplicate': False}

    def _wallet(self, address):
        return self.env['res.partner.bank'].create({'partner_id': self.vendor.id, 'acc_number': address})

    def _bill(self, amount=250.0, ref='INV-2026-044'):
        bill = self.env['account.move'].create({
            'move_type': 'in_invoice', 'partner_id': self.vendor.id, 'invoice_date': '2026-09-25', 'ref': ref,
            'currency_id': self.env.ref('base.USD').id,
            'invoice_line_ids': [Command.create({'name': 'Logo and brand guide', 'quantity': 1, 'price_unit': amount,
                                                 'tax_ids': [Command.clear()]})],
        })
        bill.action_post()
        return bill

    def _paid(self, amount_atomic, payout=PROVEN, tx=TX):
        self.bill_status = {
            'status': 'paid', 'reason': 'Paid on Arc to the vendor\'s proven address.',
            'receipt_url': 'https://sendsure.example/receipt?tx=%s' % tx,
            'settlement': {'tx': tx, 'amount': str(amount_atomic), 'payout': payout, 'paidAt': '2026-09-29T10:00:00.000Z'},
        }

    def _trusted_bill(self, amount=250.0):
        self.vendor._sendsure_refresh()
        self.vendor.bank_ids.filtered(lambda b: b.acc_number == PROVEN).allow_out_payment = True
        bill = self._bill(amount)
        bill.action_sendsure_send()
        return bill

    # ---------------------------------------------------------------- setup

    def test_usdc_currency_and_journal(self):
        self.assertEqual((self.usc.name, self.usc.symbol, self.usc.rounding, self.usc.decimal_places),
                         ('USC', 'USDC', 0.000001, 6))
        self.assertEqual(self.journal.currency_id, self.usc)
        codes = self.journal.outbound_payment_method_line_ids.mapped('code')
        self.assertIn('sendsure_usdc', codes)
        self.assertNotIn('manual', codes, "the SendSure journal must have no way out that skips the trust check")

    def test_invite_link_is_parsed(self):
        self.assertEqual(self.vendor.sendsure_payee_ref, REF)
        with self.assertRaises(ValidationError):
            self.vendor.sendsure_payee_ref = 'not a link'

    # ---------------------------------------------------------------- trust

    def test_refresh_creates_the_proven_wallet_untrusted(self):
        self.vendor._sendsure_refresh()
        self.assertEqual(self.vendor.sendsure_state, 'bound')
        wallet = self.vendor.bank_ids.filtered(lambda b: b.acc_number == PROVEN)
        self.assertTrue(wallet)
        self.assertFalse(wallet.allow_out_payment, "trusting stays a person's decision")

    def test_only_the_proven_wallet_can_be_trusted(self):
        attacker = self._wallet(ATTACKER)
        with self.assertRaisesRegex(UserError, 'not the address'):
            attacker.allow_out_payment = True
        self.assertFalse(attacker.allow_out_payment)
        # Checking with SendSure brought in the vendor's proven wallet; that one can be trusted.
        proven = self.vendor.bank_ids.filtered(lambda b: b.acc_number == PROVEN)
        proven.allow_out_payment = True
        self.assertTrue(proven.allow_out_payment)

    def test_unlinked_vendor_wallet_cannot_be_trusted(self):
        other = self.env['res.partner'].create({'name': 'Unlinked', 'is_company': True})
        wallet = self.env['res.partner.bank'].create({'partner_id': other.id, 'acc_number': PROVEN})
        with self.assertRaisesRegex(UserError, 'not linked'):
            wallet.allow_out_payment = True

    def test_bank_accounts_that_are_not_wallets_are_left_alone(self):
        iban = self.env['res.partner.bank'].create({'partner_id': self.vendor.id, 'acc_number': 'BE71096123456769'})
        iban.allow_out_payment = True
        self.assertTrue(iban.allow_out_payment)

    def test_address_change_archives_the_old_wallet(self):
        self._trusted_bill()
        self.payee = dict(self.payee, payout=NEW)
        self.vendor._sendsure_refresh()
        self.assertFalse(self.env['res.partner.bank'].search([('partner_id', '=', self.vendor.id), ('acc_number', '=', PROVEN)]))
        new = self.vendor.bank_ids.filtered(lambda b: b.acc_number == NEW)
        self.assertTrue(new and not new.allow_out_payment)

    # ---------------------------------------------------------------- send

    def test_send_needs_a_trusted_proven_wallet(self):
        bill = self._bill()
        with self.assertRaisesRegex(UserError, 'Trust'):
            bill.action_sendsure_send()

    def test_send_is_exact_and_complete(self):
        bill = self._trusted_bill(249.99)
        payload = self.sent[-1]
        self.assertEqual(payload['amount'], '249.99', "a decimal string at the bill's precision, never a float")
        self.assertEqual((payload['currency'], payload['invoice_ref'], payload['payee_ref'], payload['invoice_date']),
                         ('USD', 'INV-2026-044', REF, '2026-09-25'))
        self.assertTrue(payload['external_id'].endswith('account.move:%s' % bill.id))
        self.assertEqual(bill.sendsure_state, 'waiting_for_payee')

    def test_manual_payments_with_the_sendsure_method_are_refused(self):
        self.vendor._sendsure_refresh()
        wallet = self.vendor.bank_ids.filtered(lambda b: b.acc_number == PROVEN)
        wallet.allow_out_payment = True
        line = self.journal.outbound_payment_method_line_ids.filtered(lambda l: l.code == 'sendsure_usdc')
        payment = self.env['account.payment'].create({
            'payment_type': 'outbound', 'partner_type': 'supplier', 'partner_id': self.vendor.id, 'amount': 10,
            'journal_id': self.journal.id, 'payment_method_line_id': line.id, 'partner_bank_id': wallet.id,
        })
        with self.assertRaisesRegex(UserError, 'recorded by SendSure'):
            payment.action_post()

    # ---------------------------------------------------------------- record

    def test_exact_payment_is_recorded_once(self):
        bill = self._trusted_bill(250.0)
        self._paid(250_000_000)
        bill._sendsure_sync()
        self.assertEqual(bill.sendsure_state, 'paid')
        self.assertIn(bill.payment_state, ('paid', 'in_payment'))
        payment = self.env['account.payment'].search([('sendsure_tx', '=', TX)])
        self.assertEqual(len(payment), 1)
        self.assertEqual((payment.amount, payment.currency_id, payment.journal_id), (250.0, self.usc, self.journal))
        self.assertIn(TX, payment.memo)
        self.assertEqual(payment.partner_bank_id.acc_number, PROVEN)
        self.assertEqual(bill.sendsure_amount_paid, '250.000000')
        bill.sendsure_state = 'paid_unconfirmed'  # even if asked again, the same tx is never recorded twice
        bill._sendsure_sync()
        self.assertEqual(self.env['account.payment'].search_count([('sendsure_tx', '=', TX)]), 1)

    def test_half_a_cent_is_not_rounded_away(self):
        # Odoo alone marks a $250.00 bill paid by 249.995 USDC, with no write-off. SendSure leaves it open.
        bill = self._trusted_bill(250.0)
        self._paid(249_995_000)
        bill._sendsure_sync()
        self.assertEqual(bill.sendsure_state, 'needs_review')
        self.assertIn('249.995', bill.sendsure_reason)
        self.assertEqual(bill.payment_state, 'not_paid')
        self.assertFalse(self.env['account.payment'].search([('sendsure_tx', '=', TX)]))

    def test_payment_to_an_untrusted_address_is_not_recorded(self):
        bill = self._trusted_bill(250.0)
        self._paid(250_000_000, payout=ATTACKER)
        bill._sendsure_sync()
        self.assertEqual(bill.sendsure_state, 'needs_review')
        self.assertEqual(bill.payment_state, 'not_paid')

    def test_cron_runs_the_agent_for_signed_bills_and_records(self):
        bill = self._trusted_bill(250.0)
        self.bill_status = {'status': 'signed', 'reason': 'Signed.'}
        ran = []
        Client = type(self.env['sendsure.client'])
        test = self

        def run(_self):
            ran.append(1)
            test._paid(250_000_000)
            return {'decisions': []}

        with patch.object(Client, 'run_agent', run):
            self.env['account.move']._cron_sendsure_sync()
        self.assertEqual(ran, [1])
        self.assertEqual(bill.sendsure_state, 'paid')
        self.assertEqual(fields.Date.to_string(self.env['account.payment'].search([('sendsure_tx', '=', TX)]).date), '2026-09-29')
