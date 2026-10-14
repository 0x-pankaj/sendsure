from unittest.mock import patch

from odoo import Command, fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged
from odoo.tools import float_repr

from odoo.addons.account.tests.common import AccountTestInvoicingCommon
from odoo.addons.sendsure_payables.models.compat import ODOO
from odoo.addons.sendsure_payables.models.sendsure_client import SendSureError

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
        self.withdrawn = []
        self.withdraw_error = None
        self.sent = []
        self.funds = {'balance': '1000', 'budget': '1000', 'claim_max': '500', 'cosign_above': '25'}
        patches = [
            patch.object(Client, 'withdraw', lambda self, ext: test._fake_withdraw(ext)),
            patch.object(Client, 'payees', lambda self, refs: [dict(test.payee)]),
            patch.object(Client, 'send_bill', lambda self, payload: test._fake_send(payload)),
            patch.object(Client, 'bills', lambda self, ids: [dict(test.bill_status, external_id=i) for i in ids]),
            patch.object(Client, 'run_agent', lambda self: {'decisions': []}),
            patch.object(Client, 'org', lambda self: test._fake_org()),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _fake_org(self):
        if self.funds == 'unreachable':
            raise SendSureError("Could not reach SendSure.", code='UNREACHABLE')
        return {'org': ORG, 'tier': 'sandbox', 'chain': {'name': 'Arc Testnet'}, 'funds': self.funds}

    def _fake_send(self, payload):
        self.sent.append(payload)
        return {'external_id': payload['external_id'], 'status': 'waiting_for_payee', 'amount_usdc': payload['amount'],
                'reason': 'Waiting for the vendor.', 'duplicate': False}

    def _fake_withdraw(self, external_id):
        if self.withdraw_error:
            raise SendSureError("refused", code=self.withdraw_error)
        self.withdrawn.append(external_id)
        return {'external_id': external_id, 'status': 'withdrawn'}

    def _composer(self, action):
        """The email composer the button opens, filled in as the user sees it."""
        composer = self.env['mail.compose.message'].with_context(action['context']).create({})
        if ODOO < 17:  # Odoo 16 fills it from the template in the form's onchange
            composer._onchange_template_id_wrapper()
        return composer

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
        # Odoo 18 calls the payment's memo `memo`; before, it was `ref`.
        self.assertIn(TX, payment.memo if 'memo' in payment._fields else payment.ref)
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

    def test_run_the_agent_now_pays_a_signed_bill_without_waiting_for_the_cron(self):
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
            bill.action_sendsure_run_agent()
        self.assertEqual(ran, [1])
        self.assertEqual(bill.sendsure_state, 'paid')
        self.assertEqual(self.env['account.payment'].search([('sendsure_tx', '=', TX)]).reconciled_bill_ids, bill)

    def test_run_the_agent_now_does_nothing_until_the_vendor_signed(self):
        bill = self._trusted_bill(250.0)
        self.bill_status = {'status': 'waiting_for_payee', 'reason': 'Waiting for the vendor.'}
        ran = []
        Client = type(self.env['sendsure.client'])
        with patch.object(Client, 'run_agent', lambda _self: ran.append(1)):
            bill.action_sendsure_run_agent()
        self.assertEqual(ran, [])
        self.assertEqual(bill.sendsure_state, 'waiting_for_payee')

    def test_a_bill_over_the_per_bill_cap_is_refused_before_the_vendor_signs(self):
        self.funds = dict(self.funds, claim_max='50')
        with self.assertRaisesRegex(UserError, 'at most 50 USDC per bill'):
            self._trusted_bill(250.0)
        self.assertFalse(self.sent)

    def test_a_bill_the_wallet_cannot_cover_is_refused_before_the_vendor_signs(self):
        self.funds = dict(self.funds, balance='2', budget='10')
        with self.assertRaisesRegex(UserError, 'can spend only 2 USDC'):
            self._trusted_bill(250.0)
        self.assertFalse(self.sent)

    def test_bills_still_go_when_sendsure_cannot_say_what_the_org_can_pay(self):
        self.funds = 'unreachable'
        bill = self._trusted_bill(250.0)
        self.assertEqual(bill.sendsure_state, 'waiting_for_payee')

    def test_the_list_action_is_for_accounting_users_only(self):
        action = self.env.ref('sendsure_payables.action_sendsure_send_bills')
        groups = action.group_ids if 'group_ids' in action._fields else action.groups_id
        self.assertEqual(groups, self.env.ref('account.group_account_invoice'))

    # ---------------------------------------------------------------- the bill changes after it was sent

    def test_cancel_or_reset_withdraws_the_bill_from_sendsure(self):
        bill = self._trusted_bill(250.0)
        ext = bill.sendsure_external_id
        bill.button_draft()
        self.assertEqual(self.withdrawn, [ext])
        self.assertEqual((bill.sendsure_state, bill.sendsure_external_id), ('withdrawn', False))
        # Edited and posted again, it can be sent again.
        bill.invoice_line_ids[0].price_unit = 240.0
        bill.action_post()
        bill.action_sendsure_send()
        self.assertEqual((self.sent[-1]['amount'], bill.sendsure_state), ('240.00', 'waiting_for_payee'))
        bill.button_draft()
        bill.button_cancel()
        self.assertEqual(bill.state, 'cancel')

    def test_a_bill_already_paid_on_arc_cannot_be_cancelled(self):
        bill = self._trusted_bill(250.0)
        self.withdraw_error = 'ALREADY_PAID'
        with self.assertRaisesRegex(UserError, 'already paid'):
            bill.button_draft()
        self.withdraw_error = 'UNREACHABLE'
        with self.assertRaisesRegex(UserError, 'could not confirm'):
            bill.button_cancel()

    def test_no_hand_payment_while_sendsure_is_paying(self):
        bill = self._trusted_bill(250.0)
        with self.assertRaisesRegex(UserError, 'being paid with SendSure'):
            bill.action_register_payment()

    def test_a_payment_for_a_bill_that_is_no_longer_posted_waits_for_a_person(self):
        bill = self._trusted_bill(250.0)
        bill.with_context(skip_sendsure=True).write({'state': 'draft'})
        self._paid(250_000_000)
        bill._sendsure_sync()
        self.assertEqual(bill.sendsure_state, 'needs_review')
        self.assertFalse(self.env['account.payment'].search([('sendsure_tx', '=', TX)]))

    def test_a_tx_recorded_for_another_bill_is_not_reused(self):
        first = self._trusted_bill(250.0)
        self._paid(250_000_000)
        first._sendsure_sync()
        second = self._bill(250.0, ref='INV-2026-045')
        second.action_sendsure_send()
        second._sendsure_sync()
        self.assertEqual(second.sendsure_state, 'needs_review')
        self.assertIn('another bill', second.sendsure_reason)
        self.assertEqual(second.payment_state, 'not_paid')

    def test_one_bad_bill_does_not_stop_the_others(self):
        good = self._trusted_bill(250.0)
        bad = self._bill(250.0, ref='INV-2026-046')
        bad.action_sendsure_send()
        self._paid(250_000_000)
        Move = type(self.env['account.move'])
        original = Move._sendsure_record_payment

        def flaky(move, info, accept_difference=False):
            if move == bad:
                raise RuntimeError("lock date")
            return original(move, info, accept_difference)

        with patch.object(Move, '_sendsure_record_payment', flaky):
            (good | bad)._sendsure_sync()
        self.assertEqual(good.sendsure_state, 'paid')
        self.assertEqual(bad.sendsure_state, 'needs_review')
        self.assertIn('lock date', bad.sendsure_reason)

    def test_a_manager_can_record_a_payment_that_needs_review(self):
        bill = self._trusted_bill(250.0)
        self._paid(249_995_000)
        bill._sendsure_sync()
        self.assertEqual(bill.sendsure_state, 'needs_review')
        bill.action_sendsure_record_review()
        self.assertEqual(bill.sendsure_state, 'paid')
        # Exact at USDC's 6 decimals (Odoo 17 keeps 249.99499999999998 in the float it stores).
        self.assertEqual(float_repr(self.env['account.payment'].search([('sendsure_tx', '=', TX)]).amount, 6), '249.995000')
        # A USD bill is kept in cents, so Odoo absorbs the half cent; SendSure says so instead of hiding it.
        self.assertIn('absorbed the 0.005 difference', bill.sendsure_reason)

    def test_sending_several_bills_keeps_going_past_one_refusal(self):
        self._trusted_bill(250.0)  # trusts the wallet
        a = self._bill(10.0, ref='INV-A')
        b = self._bill(20.0, ref='INV-B')
        test = self

        def send(_self, payload):
            if payload['invoice_ref'] == 'INV-A':
                raise SendSureError("The vendor already claimed INV-A for another amount.", code='AMOUNT_MISMATCH')
            return test._fake_send(payload)

        with patch.object(type(self.env['sendsure.client']), 'send_bill', send):
            (a | b).action_sendsure_send()
        self.assertFalse(a.sendsure_external_id)
        self.assertIn('another amount', a.sendsure_reason)
        self.assertEqual(b.sendsure_state, 'waiting_for_payee')

    # ---------------------------------------------------------------- nobody can fake it

    def test_nobody_can_type_an_arc_transaction(self):
        self.vendor._sendsure_refresh()
        wallet = self.vendor.bank_ids.filtered(lambda b: b.acc_number == PROVEN)
        wallet.allow_out_payment = True
        line = self.journal.outbound_payment_method_line_ids.filtered(lambda l: l.code == 'sendsure_usdc')
        vals = {'payment_type': 'outbound', 'partner_type': 'supplier', 'partner_id': self.vendor.id, 'amount': 10,
                'journal_id': self.journal.id, 'payment_method_line_id': line.id, 'partner_bank_id': wallet.id}
        with self.assertRaises(AccessError):
            self.env['account.payment'].create(dict(vals, sendsure_tx='0x' + '11' * 32))
        # Nor through the Register Payment wizard's context.
        bill = self._bill(10.0, ref='INV-W')
        wizard = self.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=bill.ids, sendsure_tx='0x' + '22' * 32).create({
                'journal_id': self.journal.id, 'payment_method_line_id': line.id, 'partner_bank_id': wallet.id})
        with self.assertRaisesRegex(UserError, 'recorded by SendSure'):
            wizard._create_payments()

    def test_a_recorded_arc_payment_cannot_be_reset(self):
        bill = self._trusted_bill(250.0)
        self._paid(250_000_000)
        bill._sendsure_sync()
        payment = self.env['account.payment'].search([('sendsure_tx', '=', TX)])
        with self.assertRaisesRegex(UserError, 'cannot be reset'):
            payment.action_draft()

    def test_a_wallet_created_trusted_must_be_the_proven_one(self):
        with self.assertRaisesRegex(UserError, 'not the address'):
            self.env['res.partner.bank'].create({'partner_id': self.vendor.id, 'acc_number': ATTACKER,
                                                 'allow_out_payment': True})

    def test_a_stray_trusted_wallet_loses_its_trust(self):
        stray = self.env['res.partner.bank'].sudo().with_context(skip_check=True).create(
            {'partner_id': self.vendor.id, 'acc_number': ATTACKER})
        stray.sudo().env.cr.execute("UPDATE res_partner_bank SET allow_out_payment = true WHERE id = %s", (stray.id,))
        stray.invalidate_recordset()
        self.vendor._sendsure_refresh()
        self.assertFalse(stray.allow_out_payment)

    def test_moving_back_to_an_old_address_needs_trust_again(self):
        self._trusted_bill()
        self.payee = dict(self.payee, payout=NEW)
        self.vendor._sendsure_refresh()
        self.payee = dict(self.payee, payout=PROVEN)
        self.vendor._sendsure_refresh()
        back = self.vendor.bank_ids.filtered(lambda b: b.acc_number == PROVEN)
        self.assertTrue(back and not back.allow_out_payment)

    def test_relinking_a_vendor_untrusts_its_wallets(self):
        self._trusted_bill()
        self.vendor.sendsure_payee_ref = '0x' + 'ef' * 32
        self.assertFalse(self.vendor.bank_ids.filtered('allow_out_payment'))

    def test_the_invite_link_can_be_emailed_from_the_vendor(self):
        self.env['ir.config_parameter'].sudo().set_param('sendsure.org', ORG)
        self.vendor.invalidate_recordset(['sendsure_invite_url'])
        url = self.vendor.sendsure_invite_url
        self.assertTrue(url.startswith(self.env['sendsure.client'].base_url() + '/verify?org=%s&ref=%s&name=' % (ORG, REF)))
        self.vendor.email = False
        with self.assertRaises(UserError):
            self.vendor.action_sendsure_email_invite()
        self.vendor.email = 'maria@lopez.design'
        action = self.vendor.action_sendsure_email_invite()
        self.assertEqual(action['res_model'], 'mail.compose.message')
        composer = self._composer(action)
        # A person reads and sends it; the link in it is the vendor's own invite.
        self.assertIn(REF, composer.body)
        self.assertIn(ORG, composer.body)
        self.assertIn(self.vendor, composer.partner_ids)

    def test_a_bill_waiting_for_the_vendor_can_be_emailed_to_them(self):
        self.env['ir.config_parameter'].sudo().set_param('sendsure.org', ORG)
        self.vendor.invalidate_recordset(['sendsure_invite_url'])
        bill = self._trusted_bill()
        self.vendor.email = False
        with self.assertRaises(UserError):
            bill.action_sendsure_email_vendor()
        self.vendor.email = 'maria@lopez.design'
        action = bill.action_sendsure_email_vendor()
        composer = self._composer(action)
        # SendSure cannot tell the vendor; a person sends this, with the vendor's own link and the exact invoice.
        self.assertIn(REF, composer.body)
        self.assertIn(ORG, composer.body)
        self.assertIn('INV-2026-044', composer.body)
        self.assertIn('INV-2026-044', composer.subject)
        self.assertIn(self.vendor, composer.partner_ids)

    def test_a_bill_waiting_for_a_cosign_links_to_sendsure(self):
        action = self._bill().action_sendsure_open()
        self.assertEqual(action['url'], self.env['sendsure.client'].base_url() + '/org')
