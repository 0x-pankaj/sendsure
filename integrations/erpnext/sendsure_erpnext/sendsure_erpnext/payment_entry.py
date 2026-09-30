"""The SendSure mode of payment: a Payment Entry on it must be a settlement SendSure read from Arc, to the
address the supplier proved, for exactly the amount Arc paid. Everything else is refused, for every user
and over every route (form, API, import), because the check is in Payment Entry's validate."""
from decimal import Decimal

import frappe
from frappe import _
from frappe.utils import flt

from sendsure_erpnext import client, install
from sendsure_erpnext import supplier as suppliers
from sendsure_erpnext.install import NAME

USDC_DECIMALS = 6
BY_HAND = _(
	"Payments with USDC on Arc (SendSure) are recorded by SendSure from the chain, with their transaction. "
	"To pay this supplier, use \"Pay with SendSure\" on the purchase invoice."
)


def is_sendsure(doc):
	"""On the SendSure mode of payment, or paying out of a company's USDC account by any mode."""
	return doc.mode_of_payment == NAME or (doc.payment_type == "Pay" and doc.paid_from in install.usdc_accounts())


def validate(doc, method=None):
	if not is_sendsure(doc):
		# No other payment may carry an Arc transaction it was not given by SendSure.
		for fieldname in ("sendsure_tx", "sendsure_payout", "sendsure_amount_paid", "sendsure_receipt_url"):
			doc.set(fieldname, None)
		return
	if doc.get("_action") == "update_after_submit":
		# A cost center or project, say. ERPNext itself refuses changes to the SendSure fields after submission.
		return
	# Set in purchase_invoice.record_payment only. "flags" is not a field: the API and imports cannot set it.
	settlement = doc.flags.get("sendsure_settlement")
	if not (settlement and doc.sendsure_tx and client.same_address(settlement.get("tx"), doc.sendsure_tx)):
		frappe.throw(BY_HAND)
	if doc.payment_type != "Pay" or doc.party_type != "Supplier" or doc.mode_of_payment != NAME:
		frappe.throw(_("A SendSure payment pays a supplier, with the mode of payment {0}.").format(NAME))
	if doc.paid_from != install.usdc_account(doc.company):
		frappe.throw(_("A SendSure payment is paid from the company's {0} account.").format(NAME))

	paid = Decimal(settlement["amount"]).scaleb(-USDC_DECIMALS)
	invoices = {(row.reference_doctype, row.reference_name) for row in doc.references}
	allocated = sum((Decimal(str(row.allocated_amount)) for row in doc.references), Decimal(0))
	amounts = (Decimal(str(doc.paid_amount)), Decimal(str(doc.received_amount)), allocated)
	if len(invoices) != 1 or next(iter(invoices))[0] != "Purchase Invoice" or any(a != paid for a in amounts):
		frappe.throw(
			_("Arc paid {0} USDC. A SendSure payment records exactly that, against one purchase invoice, not {1}.").format(
				paid, " / ".join(str(a) for a in amounts)
			)
		)
	if doc.deductions or doc.taxes or flt(doc.difference_amount) or flt(doc.unallocated_amount):
		frappe.throw(_("A SendSure payment has no deductions, taxes, write-offs or unallocated amount."))
	if flt(doc.source_exchange_rate) != 1 or flt(doc.target_exchange_rate) != 1:
		frappe.throw(_("1 USDC is 1 USD in the books: a SendSure payment has no exchange rate other than 1."))

	# The address the supplier proved, read from SendSure (which reads Arc) now, not the stored copy.
	supplier = frappe.get_doc("Supplier", doc.party)
	proven = suppliers.proven_address(supplier)
	if not client.same_address(settlement.get("payout"), proven):
		frappe.throw(
			_("Arc paid {0}, which is not the address {1} proved in SendSure ({2}).").format(
				settlement.get("payout"), supplier.supplier_name, proven or _("none")
			)
		)
	if not supplier.sendsure_trusted:
		frappe.throw(
			_("Arc paid {0}, but nobody has approved that address for {1} in ERPNext.").format(proven, supplier.supplier_name)
		)
	doc.sendsure_payout = settlement["payout"]
	doc.sendsure_amount_paid = str(paid)
	doc.reference_no = settlement["tx"]
