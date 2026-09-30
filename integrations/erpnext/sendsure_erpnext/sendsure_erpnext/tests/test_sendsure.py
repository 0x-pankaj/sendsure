from decimal import Decimal
from unittest.mock import patch

import frappe
import requests
from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
from frappe.tests.utils import FrappeTestCase

from sendsure_erpnext import client, install, sync
from sendsure_erpnext import purchase_invoice as invoices
from sendsure_erpnext import supplier as suppliers
from sendsure_erpnext.install import INVOICE_STATES, NAME, SUPPLIER_STATES

ORG = "0x8FA4f5ee6f04D3Bf1A1a5113799508C171DD076C"
REF = "0x" + "ab" * 32
PROVEN = "0x7fBe6E582F8D7c0ee4C4855573731BE9dbC98522"
ATTACKER = "0x7fBe000000000000000000000000000000008522"
NEW = "0x1111111111111111111111111111111111111111"
TX = "0x" + "cd" * 32
ITEM = "SendSure Test Design Work"


REAL_RUN_AGENT = client.run_agent


class TestSendSure(FrappeTestCase):
	"""Every test starts from the site as installed and is rolled back afterwards. SendSure's API is replaced
	by the fakes in setUp; ERPNext itself is real."""

	def setUp(self):
		frappe.set_user("Administrator")
		settings = frappe.get_single(client.SETTINGS)
		settings.api_key = "ssk_test"
		settings.save()
		self.company = frappe.db.get_value("Company", {"default_currency": "USD"})
		self.account = install.usdc_account(self.company)
		self.payable, self.cash, self.round_off = frappe.db.get_value(
			"Company", self.company, ["default_payable_account", "default_cash_account", "round_off_account"]
		)
		frappe.get_doc(
			{"doctype": "Item", "item_code": ITEM, "item_group": "Services", "is_stock_item": 0, "stock_uom": "Nos"}
		).insert()
		self.payee = {"payeeRef": REF, "state": "bound", "payout": PROVEN, "payable": True, "pendingChange": None}
		self.bill_status = {}
		self.sent = []
		self.agent_runs = []
		for name, fake in {
			"payees": lambda refs: [dict(self.payee)],
			"send_bill": self._fake_send,
			"bills": lambda ids: [dict(self.bill_status, external_id=i) for i in ids],
			"run_agent": lambda: self.agent_runs.append(1) or {"decisions": []},
		}.items():
			p = patch.object(client, name, fake)
			p.start()
			self.addCleanup(p.stop)
		self.vendor = frappe.get_doc(
			{
				"doctype": "Supplier",
				"supplier_name": "Maria Lopez Design",
				"supplier_group": "Services",
				"sendsure_invite": f"https://sendsure.example/verify?org={ORG}&ref={REF}&name=Acme",
			}
		).insert()

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	# ---------------------------------------------------------------- helpers

	def _fake_send(self, payload):
		self.sent.append(payload)
		return {
			"external_id": payload["external_id"],
			"status": "waiting_for_payee",
			"amount_usdc": payload["amount"],
			"reason": "Waiting for the supplier.",
			"duplicate": False,
		}

	def _bill(self, amount=250.0, bill_no="INV-2026-044", supplier=None, **more):
		bill = frappe.get_doc(
			{
				"doctype": "Purchase Invoice",
				"supplier": supplier or self.vendor.name,
				"company": self.company,
				"set_posting_time": 1,
				"posting_date": "2026-09-25",
				"bill_no": bill_no,
				"bill_date": "2026-09-25",
				"due_date": "2030-01-01",
				"currency": "USD",
				"items": [{"item_code": ITEM, "item_name": "Logo and brand guide", "qty": 1, "rate": amount}],
				**more,
			}
		).insert()
		bill.submit()
		return bill

	def _paid(self, amount_atomic, payout=PROVEN, tx=TX):
		self.bill_status = {
			"status": "paid",
			"reason": "Paid on Arc to the vendor's proven address.",
			"receipt_url": f"https://sendsure.example/receipt?tx={tx}",
			"settlement": {"tx": tx, "amount": str(amount_atomic), "payout": payout, "paidAt": "2026-09-29T10:00:00.000Z"},
		}

	def _approved_bill(self, amount=250.0, **more):
		suppliers.approve(self.vendor.name)
		bill = self._bill(amount, **more)
		invoices.pay_with_sendsure(bill.name)
		bill.reload()
		return bill

	def _payments(self, tx=TX):
		return frappe.get_all("Payment Entry", filters={"sendsure_tx": tx, "docstatus": 1}, pluck="name")

	def _ledger(self, payment):
		"""{account: (debit, credit)} as exact decimals, for one Payment Entry."""
		rows = frappe.db.sql(
			"""select account, cast(debit as char), cast(credit as char) from `tabGL Entry`
			where voucher_type = 'Payment Entry' and voucher_no = %s and is_cancelled = 0""",
			payment,
		)
		return {account: (Decimal(debit), Decimal(credit)) for account, debit, credit in rows}

	def _hand_made(self, bill, **values):
		payment = get_payment_entry("Purchase Invoice", bill.name, bank_account=self.account)
		payment.update({"mode_of_payment": NAME, "reference_no": "by hand", "reference_date": "2026-09-29"})
		payment.update(values)
		return payment

	def _stock_payment(self, bill, amount):
		"""A Payment Entry the way ERPNext makes it from the invoice, in cash, for `amount`. No SendSure code runs."""
		payment = get_payment_entry("Purchase Invoice", bill.name, bank_account=self.cash)
		payment.update({"mode_of_payment": "Cash", "paid_amount": amount, "received_amount": amount,
			"reference_no": "stock", "reference_date": "2026-09-29"})
		payment.references[0].allocated_amount = amount
		payment.submit()
		bill.reload()
		return payment

	def _set_currency_precision(self, precision):
		frappe.db.set_single_value("System Settings", "currency_precision", precision)
		frappe.db.set_default("currency_precision", precision)
		frappe.clear_cache()
		self.addCleanup(frappe.clear_cache)  # runs after tearDown has rolled the setting back

	# ---------------------------------------------------------------- setup

	def test_usdc_currency_account_and_mode_of_payment(self):
		usdc = frappe.get_doc("Currency", "USDC")
		self.assertEqual((usdc.enabled, usdc.fraction_units), (1, 1000000))
		self.assertEqual(invoices.decimal_of("Currency", "USDC", "smallest_currency_fraction_value"), Decimal("0.000001"))
		account = frappe.get_doc("Account", self.account)
		self.assertEqual((account.account_currency, account.account_type, account.root_type), ("USDC", "Bank", "Asset"))
		mode = frappe.get_doc("Mode of Payment", NAME)
		self.assertIn((self.company, self.account), [(row.company, row.default_account) for row in mode.accounts])
		self.assertEqual(frappe.db.get_value("Currency Exchange", {"from_currency": "USDC", "to_currency": "USD"}, "exchange_rate"), 1)
		# ERPNext has no precision per currency beyond 3 decimals: a currency's own number format stops there.
		formats = frappe.get_meta("Currency").get_field("number_format").options.split("\n")
		self.assertEqual(max(frappe.utils.get_number_format_info(f)[2] for f in formats if f), 3)
		install.setup_usdc()  # again: nothing is added twice
		self.assertEqual(install.usdc_accounts().count(self.account), 1)
		self.assertEqual(len(frappe.get_doc("Mode of Payment", NAME).accounts), len(mode.accounts))

	def test_invite_link_is_parsed(self):
		self.assertEqual(self.vendor.sendsure_invite, REF)
		self.vendor.sendsure_invite = "not a link"
		with self.assertRaisesRegex(frappe.ValidationError, "invite link"):
			self.vendor.save()

	# ---------------------------------------------------------------- the proven address

	def test_check_reads_the_proven_address_unapproved(self):
		out = suppliers.check(self.vendor.name)
		self.vendor.reload()
		self.assertEqual(self.vendor.sendsure_state, SUPPLIER_STATES["bound"])
		self.assertEqual(self.vendor.sendsure_address, PROVEN)
		self.assertTrue(self.vendor.sendsure_checked_at)
		self.assertFalse(self.vendor.sendsure_trusted, "approving stays a person's decision")
		self.assertEqual(out["sendsure_address"], PROVEN)

	def test_an_address_cannot_be_typed_in(self):
		suppliers.check(self.vendor.name)
		self.vendor.reload()
		self.vendor.sendsure_address = ATTACKER
		with self.assertRaisesRegex(frappe.ValidationError, "cannot be typed in"):
			self.vendor.save()
		self.vendor.reload()
		self.vendor.sendsure_trusted = 1
		with self.assertRaisesRegex(frappe.ValidationError, "Approve this payout address"):
			self.vendor.save()
		# Not on a new supplier either, and not together with a fresh invite.
		with self.assertRaisesRegex(frappe.ValidationError, "cannot be typed in"):
			frappe.get_doc({"doctype": "Supplier", "supplier_name": "Slipped In", "supplier_group": "Services",
				"sendsure_invite": "0x" + "ef" * 32, "sendsure_address": ATTACKER, "sendsure_trusted": 1}).insert()
		self.assertEqual(frappe.db.get_value("Supplier", self.vendor.name, ["sendsure_address", "sendsure_trusted"]), (PROVEN, 0))

	def test_only_an_accounts_manager_approves_and_only_a_proven_address(self):
		clerk = frappe.get_doc({"doctype": "User", "email": "ap-clerk@sendsure.example", "first_name": "AP Clerk",
			"send_welcome_email": 0, "roles": [{"role": "Accounts User"}, {"role": "Purchase Manager"}]}).insert()
		frappe.set_user(clerk.name)
		with self.assertRaisesRegex(frappe.PermissionError, "Accounts Manager"):
			suppliers.approve(self.vendor.name)
		frappe.set_user("Administrator")
		self.payee = dict(self.payee, state="invited", payout=None, payable=False)
		with self.assertRaisesRegex(frappe.ValidationError, "has not proved"):
			suppliers.approve(self.vendor.name)
		self.payee = dict(self.payee, state="bound", payout=PROVEN, payable=True)
		suppliers.approve(self.vendor.name)
		self.assertEqual(frappe.db.get_value("Supplier", self.vendor.name, ["sendsure_address", "sendsure_trusted"]), (PROVEN, 1))

	def test_unlinked_supplier_cannot_be_approved(self):
		other = frappe.get_doc({"doctype": "Supplier", "supplier_name": "Unlinked", "supplier_group": "Services"}).insert()
		with self.assertRaisesRegex(frappe.ValidationError, "not linked"):
			suppliers.approve(other.name)

	def test_address_change_withdraws_the_approval(self):
		self._approved_bill()
		self.payee = dict(self.payee, payout=NEW)
		suppliers.check(self.vendor.name)
		self.assertEqual(frappe.db.get_value("Supplier", self.vendor.name, ["sendsure_address", "sendsure_trusted"]), (NEW, 0))
		comments = frappe.get_all("Comment", filters={"reference_doctype": "Supplier", "reference_name": self.vendor.name}, pluck="content")
		self.assertTrue(any("changed their proven payout address" in c for c in comments))

	def test_another_invite_forgets_the_old_address(self):
		suppliers.approve(self.vendor.name)
		self.vendor.reload()
		self.vendor.sendsure_invite = "0x" + "ef" * 32
		self.vendor.save()
		self.assertEqual(
			frappe.db.get_value("Supplier", self.vendor.name, ["sendsure_state", "sendsure_address", "sendsure_trusted"]),
			(None, None, 0),
		)

	# ---------------------------------------------------------------- send

	def test_send_needs_an_approved_proven_address(self):
		bill = self._bill()
		with self.assertRaisesRegex(frappe.ValidationError, "Approve"):
			invoices.pay_with_sendsure(bill.name)
		self.assertFalse(self.sent)
		suppliers.approve(self.vendor.name)
		bill.currency = "EUR"  # in memory only: SendSure pays USDC at 1:1, so only USD invoices are sent
		with self.assertRaisesRegex(frappe.ValidationError, "must be in USD"):
			invoices.payload(bill)
		bill.reload()
		bill.bill_no = None
		with self.assertRaisesRegex(frappe.ValidationError, "Supplier Invoice No"):
			invoices.payload(bill)

	def test_send_is_exact_complete_and_idempotent(self):
		bill = self._approved_bill(249.99)
		payload = self.sent[-1]
		self.assertEqual(payload["amount"], "249.99", "a decimal string read from the database, never a float")
		self.assertEqual(
			(payload["currency"], payload["invoice_ref"], payload["payee_ref"], payload["invoice_date"], payload["document"]),
			("USD", "INV-2026-044", REF, "2026-09-25", bill.name),
		)
		self.assertRegex(payload["external_id"], r"^erpnext:[0-9a-f]{12}:" + bill.name + "$")
		self.assertRegex(payload["external_id"], r"^[\w.:/-]{1,80}$", "what SendSure accepts as an external id")
		self.assertEqual(bill.sendsure_state, INVOICE_STATES["waiting_for_payee"])
		invoices.pay_with_sendsure(bill.name)
		self.assertEqual(self.sent[-1], payload, "sending again sends the same bill; SendSure answers with its status")
		self.assertEqual(invoices.amount_text(Decimal("0.125000000")), "0.125")
		self.assertEqual(invoices.amount_text(Decimal("250.000000000")), "250.00")
		with self.assertRaisesRegex(frappe.ValidationError, "more than 6 decimals"):
			invoices.amount_text(Decimal("0.0000001"))

	def test_an_invoice_with_sendsure_cannot_be_cancelled_or_copied_as_sent(self):
		bill = self._approved_bill()
		with self.assertRaisesRegex(frappe.ValidationError, "is with SendSure"):
			bill.cancel()
		# Nobody can save or submit an invoice that already says what SendSure thinks of it.
		for docstatus in (0, 1):
			bill.reload()
			copy = frappe.copy_doc(bill)
			copy.update({"docstatus": docstatus, "bill_no": f"INV-2026-05{docstatus}", "sendsure_state": INVOICE_STATES["paid"],
				"sendsure_external_id": bill.sendsure_external_id, "sendsure_tx": TX})
			copy.insert()
			copy.reload()
			self.assertEqual((copy.docstatus, copy.sendsure_state, copy.sendsure_external_id, copy.sendsure_tx), (docstatus, None, None, None))
		copy.sendsure_state = INVOICE_STATES["paid"]
		with self.assertRaisesRegex(frappe.ValidationError, "after submission"):
			copy.save()

	# ---------------------------------------------------------------- only SendSure records on the SendSure mode

	def test_hand_made_payments_on_the_sendsure_mode_are_refused(self):
		suppliers.approve(self.vendor.name)
		bill = self._bill()
		refused = "recorded by SendSure"
		with self.assertRaisesRegex(frappe.ValidationError, refused):
			self._hand_made(bill).insert()
		with self.assertRaisesRegex(frappe.ValidationError, refused):
			self._hand_made(bill, sendsure_tx=TX, sendsure_payout=PROVEN).insert()
		# "flags" is how the recorder hands over a settlement; a document sent over the API cannot carry it.
		settlement = {"tx": TX, "amount": "250000000", "payout": PROVEN, "paidAt": "2026-09-29T10:00:00.000Z"}
		forged = frappe.get_doc(dict(self._hand_made(bill, sendsure_tx=TX).as_dict(), flags={"sendsure_settlement": settlement}))
		with self.assertRaisesRegex(frappe.ValidationError, refused):
			forged.insert()
		# Another mode of payment does not open the USDC account either.
		with self.assertRaisesRegex(frappe.ValidationError, refused):
			self._hand_made(bill, mode_of_payment="Cash").insert()
		self.assertFalse(frappe.get_all("Payment Entry", filters={"paid_from": self.account}))
		# "Is Paid" on the invoice itself posts a payment without a Payment Entry: refused as well.
		with self.assertRaisesRegex(frappe.ValidationError, refused):
			self._bill(bill_no="INV-2026-046", is_paid=1, mode_of_payment=NAME, cash_bank_account=self.account, paid_amount=250.0)
		with self.assertRaisesRegex(frappe.ValidationError, refused):
			self._bill(bill_no="INV-2026-047", is_paid=1, mode_of_payment="Cash", cash_bank_account=self.account, paid_amount=250.0)
		# And a payment that has nothing to do with SendSure cannot claim an Arc transaction.
		cash = self._stock_payment(bill, 250.0)
		cash.reload()
		self.assertEqual((cash.docstatus, cash.sendsure_tx), (1, None))

	# ---------------------------------------------------------------- record

	def test_exact_payment_is_recorded_once(self):
		bill = self._approved_bill(250.0)
		self._paid(250_000_000)
		invoices.sync([bill])
		bill.reload()
		self.assertEqual((bill.sendsure_state, bill.status, bill.outstanding_amount), (INVOICE_STATES["paid"], "Paid", 0))
		self.assertEqual((bill.sendsure_amount_paid, bill.sendsure_tx), ("250.000000", TX))
		self.assertEqual(len(self._payments()), 1)
		payment = frappe.get_doc("Payment Entry", self._payments()[0])
		self.assertEqual(
			(payment.paid_amount, payment.paid_from, payment.paid_from_account_currency, payment.mode_of_payment),
			(250.0, self.account, "USDC", NAME),
		)
		self.assertEqual((payment.reference_no, payment.sendsure_payout, str(payment.posting_date)), (TX, PROVEN, "2026-09-29"))
		self.assertIn("receipt?tx=" + TX, payment.sendsure_receipt_url)
		self.assertEqual(
			self._ledger(payment.name),
			{self.account: (Decimal(0), Decimal(250)), self.payable: (Decimal(250), Decimal(0))},
		)
		# What ERPNext lets a person change after submission can still change; the SendSure fields cannot.
		payment.party_name = "Maria Lopez Design (renamed)"
		payment.save()
		payment.sendsure_tx = "0x" + "ef" * 32
		with self.assertRaisesRegex(frappe.ValidationError, "after submission"):
			payment.save()
		# Even if asked again, the same transaction is never recorded twice.
		frappe.db.set_value("Purchase Invoice", bill.name, "sendsure_state", INVOICE_STATES["paid_unconfirmed"])
		bill.reload()
		invoices.sync([bill])
		self.assertEqual(len(self._payments()), 1)
		self.assertEqual(frappe.db.get_value("Purchase Invoice", bill.name, "sendsure_state"), INVOICE_STATES["paid"])
		# The database itself holds one Payment Entry per Arc transaction.
		self.assertTrue(frappe.db.sql("show index from `tabPayment Entry` where Column_name = 'sendsure_tx' and Non_unique = 0"))

	def test_a_transaction_recorded_for_one_invoice_does_not_pay_another(self):
		first = self._approved_bill(250.0)
		second = self._bill(250.0, bill_no="INV-2026-045")
		invoices.pay_with_sendsure(second.name)
		second.reload()
		self._paid(250_000_000)
		invoices.sync([first, second])
		first.reload()
		second.reload()
		self.assertEqual((first.sendsure_state, first.status), (INVOICE_STATES["paid"], "Paid"))
		self.assertEqual((second.sendsure_state, second.status), (INVOICE_STATES["needs_review"], "Unpaid"))
		self.assertIn("for another invoice", second.sendsure_reason)
		self.assertEqual(len(self._payments()), 1)

	def test_six_decimals_are_kept_when_the_site_allows_them(self):
		# With System Settings > Currency Precision = 6 (and the invoice not rounded to whole cents), an amount
		# below a cent is sent and recorded to the last decimal.
		self._set_currency_precision("6")
		bill = self._approved_bill(0.125001, disable_rounded_total=1)
		self.assertEqual(self.sent[-1]["amount"], "0.125001")
		self._paid(125_000)  # one millionth short
		invoices.sync([bill])
		bill.reload()
		self.assertEqual((bill.sendsure_state, bill.status), (INVOICE_STATES["needs_review"], "Unpaid"))
		frappe.db.set_value("Purchase Invoice", bill.name, {"sendsure_state": INVOICE_STATES["signed"], "sendsure_tx": None})
		bill.reload()
		self._paid(125_001)
		invoices.sync([bill])
		bill.reload()
		self.assertEqual((bill.sendsure_state, bill.status, bill.sendsure_amount_paid), (INVOICE_STATES["paid"], "Paid", "0.125001"))
		self.assertEqual(
			self._ledger(self._payments()[0]),
			{self.account: (Decimal(0), Decimal("0.125001")), self.payable: (Decimal("0.125001"), Decimal(0))},
		)

	def test_half_a_cent_is_not_rounded_away(self):
		# ERPNext alone marks a 250.00 invoice Paid by 249.995 (see the stock test below). SendSure leaves it open.
		bill = self._approved_bill(250.0)
		self._paid(249_995_000)
		invoices.sync([bill])
		bill.reload()
		self.assertEqual(bill.sendsure_state, INVOICE_STATES["needs_review"])
		self.assertIn("249.995", bill.sendsure_reason)
		self.assertEqual((bill.status, bill.outstanding_amount), ("Unpaid", 250.0))
		self.assertFalse(frappe.get_all("Payment Entry", filters={"sendsure_tx": TX}))
		comments = frappe.get_all("Comment", filters={"reference_doctype": "Purchase Invoice", "reference_name": bill.name}, pluck="content")
		self.assertTrue(any("<b>not</b> recorded" in c for c in comments))

	def test_the_ledger_is_read_back_after_posting(self):
		# Take the first check away: ERPNext posts 250.00 for a 249.995 payment. The read-back sees it and undoes it.
		bill = self._approved_bill(250.0)
		self._paid(249_995_000)
		with patch.object(invoices, "exactness_problem", lambda doc, paid: None):
			invoices.sync([bill])
		bill.reload()
		self.assertEqual(bill.sendsure_state, INVOICE_STATES["needs_review"])
		# From the USDC account, ERPNext would have booked 249.995 USDC as 250 USD and closed the invoice.
		self.assertIn("the ledger took 249.995 USDC valued at 250 USD out of the USDC account, in 2 rows, and left 0 open", bill.sendsure_reason)
		self.assertEqual((bill.status, bill.outstanding_amount), ("Unpaid", 250.0))
		self.assertFalse(frappe.get_all("Payment Entry", filters={"sendsure_tx": TX}))
		self.assertFalse(frappe.get_all("GL Entry", filters={"account": self.account, "against_voucher": bill.name}))

	def test_payment_to_another_address_is_not_recorded(self):
		bill = self._approved_bill(250.0)
		self._paid(250_000_000, payout=ATTACKER)
		invoices.sync([bill])
		bill.reload()
		self.assertEqual(bill.sendsure_state, INVOICE_STATES["needs_review"])
		self.assertIn("not the address", bill.sendsure_reason)
		self.assertEqual((bill.status, bill.outstanding_amount), ("Unpaid", 250.0))
		self.assertFalse(frappe.get_all("Payment Entry", filters={"sendsure_tx": TX}))

	def test_payment_is_not_recorded_once_the_approval_is_gone(self):
		bill = self._approved_bill(250.0)
		frappe.db.set_value("Supplier", self.vendor.name, "sendsure_trusted", 0)
		self._paid(250_000_000)
		invoices.sync([bill])
		bill.reload()
		self.assertEqual(bill.sendsure_state, INVOICE_STATES["needs_review"])
		self.assertIn("nobody has approved", bill.sendsure_reason)
		self.assertEqual(bill.status, "Unpaid")

	# ---------------------------------------------------------------- the scheduler

	def test_scheduler_runs_the_agent_for_signed_bills_and_records(self):
		bill = self._approved_bill(250.0)
		sync.run()
		self.assertEqual(self.agent_runs, [], "nothing is signed yet, so the agent is not asked to run")
		self.bill_status = {"status": "signed", "reason": "Signed."}

		def run():
			self.agent_runs.append(1)
			self._paid(250_000_000)
			return {"decisions": []}

		with patch.object(client, "run_agent", run):
			sync.run()
		self.assertEqual(self.agent_runs, [1])
		bill.reload()
		self.assertEqual((bill.sendsure_state, bill.status), (INVOICE_STATES["paid"], "Paid"))
		self.assertEqual(len(self._payments()), 1)
		job = frappe.get_doc("Scheduled Job Type", {"method": "sendsure_erpnext.sync.run"})
		self.assertEqual((job.frequency, job.cron_format, job.stopped), ("Cron", "*/5 * * * *", 0))

	def test_a_slow_agent_run_is_followed_by_a_status_read(self):
		bill = self._approved_bill(250.0)
		self.bill_status = {"status": "signed", "reason": "Signed."}

		def slow():
			# The run paid on Arc, but its answer did not arrive in time.
			self._paid(250_000_000)
			client._fail("Could not reach SendSure. Please try again in a minute.", code="UNREACHABLE")

		with patch.object(client, "run_agent", slow):
			sync.run()
		bill.reload()
		self.assertEqual((bill.sendsure_state, bill.status), (INVOICE_STATES["paid"], "Paid"))
		self.assertEqual(len(self._payments()), 1)

	def test_the_client_refuses_plain_http_and_reports_timeouts(self):
		with patch.object(requests, "request", side_effect=requests.Timeout("slow")) as request:
			with self.assertRaises(client.SendSureError) as caught:
				REAL_RUN_AGENT()
			self.assertEqual(caught.exception.code, "UNREACHABLE")
			self.assertEqual(request.call_args.kwargs["timeout"], client.AGENT_RUN_TIMEOUT)
			self.assertEqual(request.call_args.kwargs["headers"]["Authorization"], "Bearer ssk_test")
			frappe.db.set_single_value(client.SETTINGS, "url", "http://sendsure.example")
			request.reset_mock()
			with self.assertRaises(client.SendSureError) as caught:
				client.org()
			self.assertEqual(caught.exception.code, "BAD_URL")
			request.assert_not_called()

	# ---------------------------------------------------------------- what ERPNext does on its own

	def test_stock_erpnext_marks_a_half_cent_short_payment_paid(self):
		"""ERPNext 15 as installed (amounts at 2 decimals), none of this app's code involved: a 250.00 invoice
		paid with 249.995 in cash."""
		bill = self._bill(250.0, supplier=frappe.get_doc({"doctype": "Supplier", "supplier_name": "Stock Check", "supplier_group": "Services"}).insert().name)
		payment = self._stock_payment(bill, 249.995)
		# The Payment Entry keeps 249.995 ...
		self.assertEqual(invoices.decimal_of("Payment Entry", payment.name, "paid_amount"), Decimal("249.995"))
		# ... both ledger rows say 250.00, so debits equal credits and no Round Off row is posted ...
		self.assertEqual(self._ledger(payment.name), {self.cash: (Decimal(0), Decimal(250)), self.payable: (Decimal(250), Decimal(0))})
		self.assertNotIn(self.round_off, self._ledger(payment.name))
		self.assertFalse(payment.deductions)
		self.assertEqual(payment.difference_amount, 0)
		# ... and the invoice is Paid with nothing left open. Half a cent is gone without a trace.
		self.assertEqual((bill.status, invoices.decimal_of("Purchase Invoice", bill.name, "outstanding_amount")), ("Paid", Decimal(0)))
		# 249.994 rounds the other way: the ledger says 249.99 and a whole cent stays open.
		other = self._bill(250.0, bill_no="INV-2026-045", supplier=bill.supplier)
		payment = self._stock_payment(other, 249.994)
		self.assertEqual(self._ledger(payment.name)[self.cash], (Decimal(0), Decimal("249.99")))
		self.assertEqual((other.status, invoices.decimal_of("Purchase Invoice", other.name, "outstanding_amount")), ("Partly Paid", Decimal("0.01")))

	def test_stock_erpnext_keeps_the_half_cent_at_six_decimals(self):
		"""The same payment after System Settings > Currency Precision is set to 6 (a site-wide setting):
		ERPNext keeps the half cent open. ERPNext is exact when the whole site is told to be."""
		self._set_currency_precision("6")
		bill = self._bill(250.0, supplier=frappe.get_doc({"doctype": "Supplier", "supplier_name": "Stock Check", "supplier_group": "Services"}).insert().name)
		payment = self._stock_payment(bill, 249.995)
		self.assertEqual(self._ledger(payment.name), {self.cash: (Decimal(0), Decimal("249.995")), self.payable: (Decimal("249.995"), Decimal(0))})
		self.assertEqual((bill.status, invoices.decimal_of("Purchase Invoice", bill.name, "outstanding_amount")), ("Partly Paid", Decimal("0.005")))

	def test_stock_erpnext_has_no_field_that_holds_a_wallet(self):
		"""ERPNext alone: the only place for a supplier's account number is Bank Account, and its number field
		holds 30 characters. An address has 42."""
		other = frappe.get_doc({"doctype": "Supplier", "supplier_name": "Stock Check", "supplier_group": "Services"}).insert()
		frappe.get_doc({"doctype": "Bank", "bank_name": "SendSure Test Bank"}).insert()
		with self.assertRaises(frappe.CharacterLengthExceededError):
			frappe.get_doc({"doctype": "Bank Account", "account_name": "Wallet", "bank": "SendSure Test Bank",
				"party_type": "Supplier", "party": other.name, "bank_account_no": PROVEN}).insert()
