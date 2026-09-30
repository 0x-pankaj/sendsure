"""What the app adds to an ERPNext site: fields on Supplier, Purchase Invoice and Payment Entry, the USDC
currency, and for each company that keeps its books in USD a "USDC on Arc (SendSure)" account and mode of
payment. Everything here can run again without changing what is already there."""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

USDC = "USDC"
USD = "USD"
NAME = "USDC on Arc (SendSure)"  # the account's name and the mode of payment

SUPPLIER_STATES = {
	"not_invited": "Invite not opened",
	"invited": "Invited, waiting for the supplier",
	"bound": "Proved their address",
	"change_pending": "Changing address (waiting period)",
	"frozen": "Frozen",
	"revoked": "Revoked",
}
INVOICE_STATES = {
	"waiting_for_payee": "Waiting for the supplier to sign",
	"rejected_by_payee": "Rejected by the supplier",
	"signed": "Signed by the supplier",
	"needs_cosign": "Needs a co-sign in SendSure",
	"held": "Held by the agent",
	"refused": "Refused by the contract",
	"withdrawn": "Withdrawn",
	"paid_unconfirmed": "Paid, confirming on Arc",
	"paid": "Paid on Arc",
	"needs_review": "Paid on Arc, needs review",
}


def _field(fieldname, label, fieldtype="Data", **more):
	return dict(fieldname=fieldname, label=label, fieldtype=fieldtype, no_copy=1, **more)


def _read_only(fieldname, label, fieldtype="Data", **more):
	return _field(fieldname, label, fieldtype, read_only=1, **more)


CUSTOM_FIELDS = {
	"Supplier": [
		dict(fieldname="sendsure_tab", label="SendSure", fieldtype="Tab Break", insert_after="portal_users"),
		_field(
			"sendsure_invite",
			"SendSure invite",
			insert_after="sendsure_tab",
			description="Paste the supplier's SendSure invite link (or its ref). The supplier opens it and proves "
			"their payout address by signing with it.",
		),
		_read_only(
			"sendsure_state", "SendSure", "Select", insert_after="sendsure_invite",
			options="\n" + "\n".join(SUPPLIER_STATES.values()),
		),
		_read_only("sendsure_checked_at", "Checked with SendSure", "Datetime", insert_after="sendsure_state"),
		dict(fieldname="sendsure_column", fieldtype="Column Break", insert_after="sendsure_checked_at"),
		_read_only(
			"sendsure_address",
			"Proven payout address",
			insert_after="sendsure_column",
			description="The address the supplier proved in SendSure, read from Arc. It cannot be typed in.",
		),
		_read_only(
			"sendsure_trusted",
			"Approved for SendSure payments",
			"Check",
			insert_after="sendsure_address",
			description="Set by an Accounts Manager with \"Approve this payout address\". SendSure checks the "
			"address against Arc again at that moment. A new address needs a new approval.",
		),
	],
	"Purchase Invoice": [
		dict(
			fieldname="sendsure_section", label="SendSure", fieldtype="Section Break",
			insert_after="write_off_cost_center", collapsible=1, depends_on="sendsure_external_id",
		),
		_read_only(
			"sendsure_state", "SendSure", "Select", insert_after="sendsure_section",
			options="\n" + "\n".join(INVOICE_STATES.values()), in_standard_filter=1,
		),
		_read_only("sendsure_reason", "SendSure says", "Small Text", insert_after="sendsure_state"),
		_read_only("sendsure_external_id", "SendSure bill id", insert_after="sendsure_reason", unique=1),
		dict(fieldname="sendsure_column", fieldtype="Column Break", insert_after="sendsure_external_id"),
		_read_only("sendsure_tx", "Arc transaction", insert_after="sendsure_column"),
		_read_only(
			"sendsure_amount_paid",
			"Paid on Arc (USDC)",
			insert_after="sendsure_tx",
			description="The exact amount the Settled event on Arc carries, 6 decimals.",
		),
		_read_only("sendsure_receipt_url", "SendSure receipt", insert_after="sendsure_amount_paid", options="URL"),
	],
	"Payment Entry": [
		dict(
			fieldname="sendsure_section", label="SendSure", fieldtype="Section Break",
			insert_after="clearance_date", depends_on="sendsure_tx",
		),
		_read_only(
			"sendsure_tx",
			"Arc transaction",
			insert_after="sendsure_section",
			unique=1,
			description="The Arc transaction that paid this, read from the chain by SendSure.",
		),
		_read_only("sendsure_payout", "Paid to (proven address)", insert_after="sendsure_tx"),
		dict(fieldname="sendsure_column", fieldtype="Column Break", insert_after="sendsure_payout"),
		_read_only("sendsure_amount_paid", "Paid on Arc (USDC)", insert_after="sendsure_column"),
		_read_only("sendsure_receipt_url", "SendSure receipt", insert_after="sendsure_amount_paid", options="URL"),
	],
}


def make_custom_fields():
	create_custom_fields(CUSTOM_FIELDS, ignore_validate=True)


def after_install():
	make_custom_fields()
	setup_usdc()


def after_migrate():
	make_custom_fields()


# ---------------------------------------------------------------- USDC


def usdc_currency():
	"""USDC as a currency of its own. ERPNext takes the 4-letter code as it is. Six decimals are declared here
	(1 USDC = 1,000,000 units), but ERPNext rounds amounts with one site-wide precision, not per currency, so
	the app never relies on it: a settlement is recorded only when it equals the open amount exactly."""
	if not frappe.db.exists("Currency", USDC):
		frappe.get_doc(
			{
				"doctype": "Currency",
				"currency_name": USDC,
				"enabled": 1,
				"fraction": "micro-USDC",
				"fraction_units": 1000000,
				"smallest_currency_fraction_value": 0.000001,
				"symbol": USDC,
				"symbol_on_right": 1,
			}
		).insert(ignore_permissions=True)
	elif not frappe.db.get_value("Currency", USDC, "enabled"):
		frappe.db.set_value("Currency", USDC, "enabled", 1)
	# 1 USDC = 1 USD in the books. Without a rate of its own, ERPNext would ask an exchange-rate service
	# that has never heard of USDC.
	for pair in ((USDC, USD), (USD, USDC)):
		if not frappe.db.exists("Currency Exchange", {"from_currency": pair[0], "to_currency": pair[1]}):
			frappe.get_doc(
				{
					"doctype": "Currency Exchange",
					"date": "2020-01-01",
					"from_currency": pair[0],
					"to_currency": pair[1],
					"exchange_rate": 1,
					"for_buying": 1,
					"for_selling": 1,
				}
			).insert(ignore_permissions=True)


def usdc_account(company):
	"""The company's "USDC on Arc (SendSure)" account, or None."""
	return frappe.db.get_value(
		"Account", {"company": company, "account_name": NAME, "account_currency": USDC, "is_group": 0}
	)


def usdc_accounts():
	return frappe.get_all("Account", filters={"account_name": NAME, "account_currency": USDC, "is_group": 0}, pluck="name")


def setup_usdc():
	"""The USDC currency, and for every company that keeps its books in USD: an account that holds USDC
	(valued 1:1 in USD) and the mode of payment that pays from it. Returns the accounts."""
	if not frappe.db.exists("Currency", USD):
		return []
	usdc_currency()
	accounts = []
	for company in frappe.get_all("Company", filters={"default_currency": USD}, pluck="name"):
		account = usdc_account(company)
		if not account:
			parent = frappe.db.get_value(
				"Account", {"company": company, "account_type": "Bank", "is_group": 1, "root_type": "Asset"}
			)
			if not parent:
				frappe.logger("sendsure").info(f"SendSure: {company} has no bank accounts group yet; set up later.")
				continue
			account = (
				frappe.get_doc(
					{
						"doctype": "Account",
						"account_name": NAME,
						"parent_account": parent,
						"company": company,
						"account_type": "Bank",
						"account_currency": USDC,
						"is_group": 0,
					}
				)
				.insert(ignore_permissions=True)
				.name
			)
		accounts.append(account)
	if not accounts:
		return []
	if frappe.db.exists("Mode of Payment", NAME):
		mode = frappe.get_doc("Mode of Payment", NAME)
	else:
		mode = frappe.get_doc({"doctype": "Mode of Payment", "mode_of_payment": NAME, "type": "Bank", "enabled": 1})
	by_company = {row.company: row for row in mode.accounts}
	for account in accounts:
		company = frappe.db.get_value("Account", account, "company")
		if company in by_company:
			by_company[company].default_account = account
		else:
			mode.append("accounts", {"company": company, "default_account": account})
	mode.enabled = 1
	mode.save(ignore_permissions=True)
	return accounts


# ---------------------------------------------------------------- tests and the Docker demo


def before_tests():
	"""ERPNext's own test setup (a USD company with the standard chart of accounts), then ours."""
	from erpnext.setup.utils import before_tests as erpnext_before_tests

	erpnext_before_tests()
	make_custom_fields()
	setup_usdc()
	frappe.db.commit()


def demo_company():
	"""For the Docker demo site only: finish ERPNext's setup wizard with a USD company."""
	from frappe.desk.page.setup_wizard.setup_wizard import setup_complete
	from frappe.utils import now_datetime

	if not frappe.db.a_row_exists("Company"):
		year = now_datetime().year
		setup_complete(
			{
				"currency": USD,
				"full_name": "Administrator",
				"company_name": "SendSure Demo",
				"company_abbr": "SSD",
				"timezone": "Etc/UTC",
				"country": "United States",
				"fy_start_date": f"{year}-01-01",
				"fy_end_date": f"{year}-12-31",
				"language": "english",
				"chart_of_accounts": "Standard",
			}
		)
	setup_usdc()
	frappe.db.commit()
