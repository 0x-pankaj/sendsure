"""A supplier and their SendSure invite.

The supplier proves their payout address by signing with it. ERPNext reads that address from SendSure
(which reads Arc) and keeps it in read-only fields: nobody can type an address in. Paying it still takes a
person: an Accounts Manager approves the address, and SendSure checks it against Arc again at that moment.
"""
import frappe
from frappe import _
from frappe.utils import escape_html, now_datetime

from sendsure_erpnext import client
from sendsure_erpnext.install import SUPPLIER_STATES

BOUND = SUPPLIER_STATES["bound"]
APPROVER_ROLE = "Accounts Manager"
# Written only by this module, straight to the database, from what SendSure answered.
SYNCED = ("sendsure_state", "sendsure_address", "sendsure_checked_at", "sendsure_trusted")


def parse_ref(value):
	"""The invite ref from an invite link, or from the ref itself."""
	if not value or not value.strip():
		return None
	found = client.PAYEE_REF.findall(value.strip())
	# An invite link carries the org (20 bytes) and the ref (32 bytes); the ref is the 32-byte value.
	if len(found) != 1:
		frappe.throw(_("Paste the supplier's SendSure invite link, or its ref (0x followed by 64 hex characters)."))
	return found[0].lower()


def validate(doc, method=None):
	"""Supplier.validate: keep the invite as its ref, and keep what SendSure said out of people's hands."""
	doc.sendsure_invite = parse_ref(doc.sendsure_invite)
	before = doc.get_doc_before_save()
	stored = {f: before.get(f) if before else None for f in SYNCED}
	typed = (doc.sendsure_address or "").strip()
	if typed and not client.same_address(typed, stored["sendsure_address"]):
		frappe.throw(
			_(
				"{0} is not an address {1} proved in SendSure. The proven payout address is read from SendSure "
				"(\"Check with SendSure\"); it cannot be typed in. Someone may be trying to redirect this supplier's payments."
			).format(typed, doc.supplier_name or doc.name)
		)
	if doc.sendsure_trusted and not stored["sendsure_trusted"]:
		frappe.throw(
			_("A payout address is approved with \"Approve this payout address\" (Accounts Manager), not by editing the supplier.")
		)
	if (before.sendsure_invite if before else None) != doc.sendsure_invite:
		# Another invite is another payee: nothing SendSure said about the old one carries over.
		stored = dict.fromkeys(SYNCED)
	for fieldname, value in stored.items():
		doc.set(fieldname, value)


def _write(supplier, values):
	# A form that was open before the state, address or approval changed must not be saved over them.
	changed = any(values[f] != supplier.get(f) for f in values if f != "sendsure_checked_at")
	frappe.db.set_value("Supplier", supplier.name, values, update_modified=changed)
	for fieldname, value in values.items():
		supplier.set(fieldname, value)


def refresh(suppliers):
	"""Read each linked supplier's state and proven address from SendSure (which reads Arc)."""
	linked = [s for s in suppliers if s.sendsure_invite]
	if not linked:
		return
	by_ref = {p["payeeRef"].lower(): p for p in client.payees([s.sendsure_invite for s in linked])}
	now = now_datetime()
	for supplier in linked:
		p = by_ref.get(supplier.sendsure_invite.lower())
		if not p:
			continue
		state = "change_pending" if p.get("pendingChange") else p["state"]
		new = p.get("payout") or None
		old = supplier.sendsure_address
		values = {
			"sendsure_state": SUPPLIER_STATES.get(state, state),
			"sendsure_address": new,
			"sendsure_checked_at": now,
		}
		if not client.same_address(new, old):
			values["sendsure_trusted"] = 0
			if new and old:
				supplier.add_comment(
					"Info",
					_(
						"SendSure: {0} changed their proven payout address from <code>{1}</code> to <code>{2}</code>. "
						"SendSure accepts a change only when both the old and the new wallet sign it, after a waiting "
						"period the payer can cancel. The approval of the old address was withdrawn here; approve the "
						"new one after you confirm it."
					).format(escape_html(supplier.supplier_name), escape_html(old), escape_html(new)),
				)
			elif new:
				supplier.add_comment(
					"Info",
					_(
						"SendSure: {0} proved the payout address <code>{1}</code> by signing with it. "
						"An Accounts Manager can now approve it for payments."
					).format(escape_html(supplier.supplier_name), escape_html(new)),
				)
		_write(supplier, values)


def proven_address(supplier):
	"""The address this supplier proved, read from SendSure now, or None. Never the stored copy."""
	refresh([supplier])
	if supplier.sendsure_state != BOUND:
		return None
	return supplier.sendsure_address


@frappe.whitelist()
def check(supplier):
	"""The "Check with SendSure" button."""
	doc = frappe.get_doc("Supplier", supplier)
	doc.check_permission("read")
	if not doc.sendsure_invite:
		frappe.throw(_("Paste the supplier's SendSure invite link first."))
	refresh([doc])
	return {f: doc.get(f) for f in SYNCED}


@frappe.whitelist()
def approve(supplier):
	"""The "Approve this payout address" button: a person decides, SendSure checks the address against Arc."""
	if APPROVER_ROLE not in frappe.get_roles():
		frappe.throw(
			_("Only an Accounts Manager can approve a supplier's payout address."), frappe.PermissionError
		)
	doc = frappe.get_doc("Supplier", supplier)
	if not doc.sendsure_invite:
		frappe.throw(
			_(
				"{0} is not linked to SendSure. Paste their SendSure invite link on the supplier first: an address "
				"can be approved only after the supplier proves it by signing with it."
			).format(doc.supplier_name)
		)
	# Read the supplier's proven address now, from the chain, not from what this form says.
	address = proven_address(doc)
	if not address:
		frappe.throw(
			_("{0} has not proved a payout address in SendSure yet ({1}), so there is nothing to approve.").format(
				doc.supplier_name, doc.sendsure_state or _("not checked")
			)
		)
	_write(doc, {"sendsure_trusted": 1})
	doc.add_comment(
		"Info",
		_("SendSure: {0} approved the proven payout address <code>{1}</code> for payments.").format(
			escape_html(frappe.session.user), escape_html(address)
		),
	)
	return {f: doc.get(f) for f in SYNCED}


def refresh_all():
	"""For the scheduler: every linked supplier. A failure is logged, never raised."""
	names = frappe.get_all("Supplier", filters={"sendsure_invite": ["is", "set"]}, pluck="name")
	try:
		refresh([frappe.get_doc("Supplier", name) for name in names])
	except client.SendSureError as err:
		client.handled(err)
