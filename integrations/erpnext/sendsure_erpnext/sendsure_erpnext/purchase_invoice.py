""""Pay with SendSure" on a submitted purchase invoice, its status in SendSure, and the exact recording
of each settlement as a Payment Entry."""
from decimal import Decimal

import frappe
from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
from frappe import _
from frappe.utils import convert_utc_to_system_timezone, escape_html, get_datetime, getdate
from pypika.functions import Cast

from sendsure_erpnext import client, install
from sendsure_erpnext import supplier as suppliers
from sendsure_erpnext.install import INVOICE_STATES, NAME, USD
from sendsure_erpnext.payment_entry import BY_HAND

PAID = INVOICE_STATES["paid"]
NEEDS_REVIEW = INVOICE_STATES["needs_review"]
SIGNED = INVOICE_STATES["signed"]
# States that can still change on SendSure's side.
IN_FLIGHT = [INVOICE_STATES[s] for s in ("waiting_for_payee", "signed", "needs_cosign", "held", "paid_unconfirmed")]
FIELDS = ("sendsure_state", "sendsure_reason", "sendsure_external_id", "sendsure_tx", "sendsure_amount_paid", "sendsure_receipt_url")
USDC_DECIMALS = 6
MICRO = Decimal("0.000001")
EXPLORER_TX = "https://explorer.testnet.arc.io/tx/{0}"


def validate(doc, method=None):
	"""Purchase Invoice.validate: nothing a person saves or submits carries anything from SendSure. These
	fields are written only after the invoice is submitted, straight to the database, from what SendSure
	answered. (Once submitted, ERPNext itself refuses changes to them.)"""
	# "Is Paid" posts the payment straight from the invoice, with no Payment Entry: not from the USDC account.
	if doc.is_paid and (doc.mode_of_payment == NAME or doc.cash_bank_account in install.usdc_accounts()):
		frappe.throw(BY_HAND)
	if doc.get("_action") != "update_after_submit":
		for fieldname in FIELDS:
			doc.set(fieldname, None)


def before_cancel(doc, method=None):
	"""An invoice the supplier can still sign and the agent can still pay must not disappear from the books."""
	if doc.sendsure_state in IN_FLIGHT:
		frappe.throw(
			_(
				"{0} is with SendSure ({1}): the supplier can still sign it and the agent can still pay it. "
				"Cancel it in SendSure first (the org's payee page), then refresh."
			).format(doc.name, doc.sendsure_state)
		)


# ---------------------------------------------------------------- exact amounts


def decimal_of(doctype, name, fieldname):
	"""A stored amount as a Decimal, read from the database as text. ERPNext hands amounts to Python as
	floats; the column itself is an exact decimal(21,9)."""
	table = frappe.qb.DocType(doctype)
	rows = frappe.qb.from_(table).select(Cast(table[fieldname], "char")).where(table.name == name).run()
	return Decimal(rows[0][0] or "0")


def amount_text(amount):
	"""A Decimal as SendSure takes it: a plain decimal string, at least 2 and at most 6 decimals."""
	if amount != amount.quantize(MICRO):
		frappe.throw(_("{0} has more than 6 decimals, so it cannot be paid exactly in USDC.").format(amount))
	text = format(amount.quantize(MICRO), "f").rstrip("0")
	whole, _dot, decimals = text.partition(".")
	return f"{whole}.{decimals.ljust(2, '0')}"


def usdc_amount(atomic):
	"""Atomic USDC units (an integer string from the Settled event) as an exact Decimal."""
	return Decimal(atomic).scaleb(-USDC_DECIMALS)


# ---------------------------------------------------------------- send


def bill_id(doc):
	site = frappe.db.get_single_value(client.SETTINGS, "site_id")
	if not site:
		settings = frappe.get_single(client.SETTINGS)
		settings.save(ignore_permissions=True)  # gives the site its id
		site = settings.site_id
	return f"erpnext:{site}:{doc.name}"


def payload(doc):
	if doc.docstatus != 1 or doc.is_return:
		frappe.throw(_("Only submitted purchase invoices can be paid with SendSure."))
	open_amount = decimal_of("Purchase Invoice", doc.name, "outstanding_amount")
	if doc.status not in ("Unpaid", "Overdue") or open_amount <= 0:
		frappe.throw(_("{0} is already (partly) paid. SendSure pays whole invoices only.").format(doc.name))
	if doc.currency != USD or doc.party_account_currency != USD:
		frappe.throw(
			_("SendSure pays in USDC at 1 USDC = 1 USD, so the invoice and its payable account must be in USD, not {0}.").format(
				doc.currency if doc.currency != USD else doc.party_account_currency
			)
		)
	if not install.usdc_account(doc.company):
		frappe.throw(_("{0} has no USDC account yet. Run \"Test connection\" in SendSure Settings.").format(doc.company))
	if not doc.bill_no:
		frappe.throw(
			_("Add the supplier's invoice number (Supplier Invoice No) first: the supplier signs for exactly that invoice.")
		)
	supplier = frappe.get_doc("Supplier", doc.supplier)
	if not supplier.sendsure_invite:
		frappe.throw(
			_("{0} is not linked to SendSure. Paste their SendSure invite link on the supplier.").format(supplier.supplier_name)
		)
	address = suppliers.proven_address(supplier)
	if not address:
		frappe.throw(
			_("{0} has not proved a payout address in SendSure yet ({1}).").format(
				supplier.supplier_name, supplier.sendsure_state or "-"
			)
		)
	if not supplier.sendsure_trusted:
		frappe.throw(
			_(
				"Approve {0}'s proven payout address {1} first (the supplier's SendSure tab, \"Approve this payout address\"; "
				"needs an Accounts Manager)."
			).format(supplier.supplier_name, address)
		)
	lines = [row.item_name or row.description or "" for row in doc.items]
	return {
		"system": client.SYSTEM,
		"external_id": bill_id(doc),
		"payee_ref": supplier.sendsure_invite,
		"invoice_ref": doc.bill_no,
		# A decimal string read from the database column, never a float.
		"amount": amount_text(open_amount),
		"currency": USD,
		"invoice_date": str(getdate(doc.bill_date or doc.posting_date)),
		"description": "; ".join(n for n in lines if n)[:200],
		"document": doc.name,
	}


@frappe.whitelist()
def pay_with_sendsure(invoice):
	"""The "Pay with SendSure" button. Sending the same invoice again only returns its status."""
	doc = frappe.get_doc("Purchase Invoice", invoice)
	doc.check_permission("write")
	if doc.sendsure_state in (PAID, NEEDS_REVIEW):
		return status(doc)
	first = not doc.sendsure_external_id
	out = client.send_bill(payload(doc))
	doc.db_set("sendsure_external_id", out["external_id"])
	apply(doc, out)
	if first and not out.get("duplicate"):
		doc.add_comment(
			"Info",
			_(
				"Sent to SendSure: {0} USDC to the supplier's proven address. The supplier confirms this invoice by "
				"signing it; then SendSure's agent pays it on Arc and the payment is recorded here."
			).format(escape_html(out.get("amount_usdc", ""))),
		)
	return status(doc)


def status(doc):
	return {f: doc.get(f) for f in FIELDS} | {"status": doc.status, "outstanding_amount": doc.outstanding_amount}


# ---------------------------------------------------------------- sync


@frappe.whitelist()
def refresh(invoice):
	"""The "Refresh SendSure" button."""
	doc = frappe.get_doc("Purchase Invoice", invoice)
	doc.check_permission("write")
	sync([doc])
	return status(doc)


def sync(invoices):
	sent = [doc for doc in invoices if doc.sendsure_external_id]
	if not sent:
		return
	by_id = {b["external_id"]: b for b in client.bills([doc.sendsure_external_id for doc in sent])}
	for doc in sent:
		info = by_id.get(doc.sendsure_external_id)
		if info:
			apply(doc, info)


def apply(doc, info):
	if doc.sendsure_state in (PAID, NEEDS_REVIEW):
		return
	if info.get("status") == "paid":
		record_payment(doc, info)
		return
	state = INVOICE_STATES.get(info.get("status"), INVOICE_STATES["held"])
	reason = (info.get("reason") or "")[:250]
	if (state, reason) != (doc.sendsure_state, doc.sendsure_reason or ""):
		doc.db_set({"sendsure_state": state, "sendsure_reason": reason})


def record_payment(doc, info):
	"""Record what Arc says was paid, as a Payment Entry made the way ERPNext's own "Create > Payment"
	makes it, only if it is exact."""
	s = info["settlement"]
	tx = s["tx"]
	paid = usdc_amount(s["amount"])
	base = {"sendsure_tx": tx, "sendsure_amount_paid": str(paid), "sendsure_receipt_url": info.get("receipt_url")}
	recorded = frappe.db.get_value("Payment Entry", {"sendsure_tx": tx})
	if recorded and frappe.db.exists("Payment Entry Reference", {"parent": recorded, "reference_name": doc.name}):
		# Already recorded for this invoice: the same transaction is never recorded twice.
		doc.db_set(dict(base, sendsure_state=PAID, sendsure_reason=info.get("reason")))
		return
	if recorded:
		problem = _("This Arc transaction is already recorded as {0}, for another invoice.").format(recorded)
	else:
		problem = exactness_problem(doc, paid)
	payment = None
	if not problem:
		frappe.db.savepoint("sendsure_record")
		try:
			payment = _payment_entry(doc, info, paid)
			payment.submit()
			_check_ledger(payment, doc, paid)
		except frappe.UniqueValidationError:
			# Another run recorded this transaction a moment ago.
			frappe.db.rollback(save_point="sendsure_record")
			frappe.clear_last_message()
			doc.db_set(dict(base, sendsure_state=PAID, sendsure_reason=info.get("reason")))
			return
		except frappe.ValidationError as err:
			# Whatever ERPNext or the checks in payment_entry.py refused: nothing stays half-recorded.
			frappe.db.rollback(save_point="sendsure_record")
			frappe.clear_last_message()
			payment, problem = None, str(err)
	if problem:
		doc.reload()
		doc.db_set(dict(base, sendsure_state=NEEDS_REVIEW, sendsure_reason=problem[:250]))
		doc.add_comment(
			"Info",
			_(
				"SendSure paid this invoice on Arc (<a href='{0}'>transaction</a>), but it was <b>not</b> recorded "
				"automatically: {1}"
			).format(EXPLORER_TX.format(tx), escape_html(problem)),
		)
		return
	doc.reload()
	doc.db_set(dict(base, sendsure_state=PAID, sendsure_reason=info.get("reason")))
	doc.add_comment(
		"Info",
		_(
			"Paid on Arc: {0} USDC to {1}'s proven address <code>{2}</code>. <a href='{3}'>Transaction</a> · "
			"<a href='{4}'>SendSure receipt</a> (the supplier's proof of address, their signed claim and the agent's "
			"decision). Recorded as {5}."
		).format(
			escape_html(str(paid)),
			escape_html(doc.supplier_name),
			escape_html(s["payout"]),
			EXPLORER_TX.format(tx),
			escape_html(info.get("receipt_url") or ""),
			escape_html(payment.name),
		),
	)


def exactness_problem(doc, paid):
	"""Why this settlement cannot be recorded as-is, or None. At ERPNext's default precision a 250.00 invoice
	paid with 249.995 is marked Paid and both ledger rows say 250.00, so anything but an exact match is left
	for a person."""
	open_amount = decimal_of("Purchase Invoice", doc.name, "outstanding_amount")
	if paid != open_amount:
		return _(
			"Arc paid {0} USDC but the invoice's open amount is {1} {2}. ERPNext would round the difference away "
			"or post it without saying so, so record it by hand and book the difference explicitly."
		).format(paid, amount_text(open_amount) if open_amount == open_amount.quantize(MICRO) else open_amount, doc.currency)
	if not install.usdc_account(doc.company):
		return _("The USDC account is missing. Run \"Test connection\" in SendSure Settings.")
	return None


def _payment_entry(doc, info, paid):
	s = info["settlement"]
	# The day Arc says it was paid (UTC), as a date on this site.
	paid_on = convert_utc_to_system_timezone(get_datetime(s["paidAt"][:19].replace("T", " "))).date()
	payment = get_payment_entry("Purchase Invoice", doc.name, bank_account=install.usdc_account(doc.company))
	payment.update(
		{
			"mode_of_payment": NAME,
			"posting_date": paid_on,
			"reference_no": s["tx"],
			"reference_date": paid_on,
			"paid_amount": float(paid),
			"received_amount": float(paid),
			"source_exchange_rate": 1,
			"target_exchange_rate": 1,
			# The supplier is paid at their proven address, not at a bank account from the supplier's record.
			"party_bank_account": None,
			"bank_account": None,
			"sendsure_tx": s["tx"],
			"sendsure_payout": s["payout"],
			"sendsure_amount_paid": str(paid),
			"sendsure_receipt_url": info.get("receipt_url"),
			"custom_remarks": 1,
			"remarks": f"SendSure {s['tx']}",
		}
	)
	if len(payment.references) == 1:
		payment.references[0].allocated_amount = float(paid)
	# Only this module can hand a settlement to the Payment Entry checks: "flags" cannot be set over the API.
	payment.flags.sendsure_settlement = s
	return payment


def _check_ledger(payment, doc, paid):
	"""Read back what ERPNext posted, as decimals: the settled amount out of the USDC account (in USDC and
	in USD), the same amount off the payable account, nothing anywhere else, and nothing left open."""
	gl = frappe.qb.DocType("GL Entry")
	rows = (
		frappe.qb.from_(gl)
		.select(gl.account, Cast(gl.debit, "char"), Cast(gl.credit, "char"), Cast(gl.credit_in_account_currency, "char"))
		.where((gl.voucher_type == "Payment Entry") & (gl.voucher_no == payment.name) & (gl.is_cancelled == 0))
		.run()
	)
	posted = {account: (Decimal(debit), Decimal(credit), Decimal(credit_usdc)) for account, debit, credit, credit_usdc in rows}
	expected = {payment.paid_from: (Decimal(0), paid, paid), payment.paid_to: (paid, Decimal(0), Decimal(0))}
	left = decimal_of("Purchase Invoice", doc.name, "outstanding_amount")
	if len(rows) != 2 or posted != expected or left != 0:
		plain = lambda d: format(d.normalize(), "f")  # noqa: E731
		usdc_row = posted.get(payment.paid_from, (Decimal(0),) * 3)
		frappe.throw(
			_(
				"ERPNext did not post this payment exactly: Arc paid {0} USDC, but the ledger took {1} USDC valued at "
				"{2} USD out of the USDC account, in {3} rows, and left {4} open. Nothing was recorded."
			).format(paid, plain(usdc_row[2]), plain(usdc_row[1]), len(rows), plain(left))
		)
