import frappe
from frappe import _
from frappe.model.document import Document

from sendsure_erpnext import client, install


class SendSureSettings(Document):
	def validate(self):
		self.url = (self.url or client.DEFAULT_URL).strip().rstrip("/")
		if not self.site_id:
			self.site_id = frappe.generate_hash(length=12)
		# The org is what SendSure says the key belongs to, never what someone typed.
		before = self.get_doc_before_save()
		if not self.flags.sendsure_connected:
			self.org = before.org if before else None
			self.org_tier = before.org_tier if before else None


@frappe.whitelist()
def test_connection():
	"""Ask SendSure which org the saved key belongs to, then set up what paying in USDC needs."""
	frappe.only_for(("System Manager", "Accounts Manager"))
	info = client.org()
	settings = frappe.get_single(client.SETTINGS)
	settings.org = info["org"]
	settings.org_tier = info.get("tier", "")
	settings.flags.sendsure_connected = True
	settings.save(ignore_permissions=True)
	accounts = install.setup_usdc()
	message = _("Org {0} ({1}) on {2}.").format(
		info["org"], info.get("tier", ""), (info.get("chain") or {}).get("name", "Arc")
	)
	if accounts:
		message += " " + _("The USDC account is ready: {0}.").format(", ".join(accounts))
	else:
		message += " " + _("No company keeps its books in USD, so no USDC account was set up.")
	frappe.msgprint(message, title=_("Connected to SendSure"), indicator="green")
	return {"org": info["org"], "tier": info.get("tier"), "accounts": accounts}
