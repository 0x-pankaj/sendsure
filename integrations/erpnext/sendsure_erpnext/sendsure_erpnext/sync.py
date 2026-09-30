"""Every 5 minutes: read each supplier's proven address and each sent invoice's status, ask SendSure's
agent to pay what the suppliers signed, and record what Arc says was paid."""
import frappe
from frappe import _

from sendsure_erpnext import client
from sendsure_erpnext import purchase_invoice as invoices
from sendsure_erpnext import supplier as suppliers


def run():
	if not client.is_configured():
		return _("SendSure is not connected.")
	suppliers.refresh_all()
	names = frappe.get_all(
		"Purchase Invoice", filters={"docstatus": 1, "sendsure_state": ["in", invoices.IN_FLIGHT]}, pluck="name"
	)
	bills = [frappe.get_doc("Purchase Invoice", name) for name in names]
	try:
		invoices.sync(bills)
	except client.SendSureError as err:
		client.handled(err)
		return _("Could not read the invoices' status from SendSure.")
	signed = [b for b in bills if b.sendsure_state == invoices.SIGNED]
	if frappe.db.get_single_value(client.SETTINGS, "manual_only") or not signed:
		return _summary(bills)
	try:
		client.run_agent()
	except client.SendSureError as err:
		# A slow answer does not mean the run failed: the chain has the truth, so read it either way.
		client.handled(err)
	try:
		invoices.sync(bills)
	except client.SendSureError as err:
		client.handled(err)
		return _("The agent ran, but the invoices' status could not be read from SendSure.")
	return _summary(bills)


def _summary(bills):
	if not bills:
		return _("Nothing is waiting in SendSure.")
	return "; ".join(f"{b.name}: {b.sendsure_state}" for b in bills)


@frappe.whitelist()
def run_now():
	"""The "Sync with SendSure now" button: the same run the scheduler makes."""
	frappe.only_for(("System Manager", "Accounts Manager"))
	return run()
