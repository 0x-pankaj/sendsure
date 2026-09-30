"""The SendSure API, as this site's integration key sees it.

The key is created by the org's owner in SendSure (/org -> "Connect your books") and stored in SendSure
Settings as a Password field. It can send bills, read their status, check addresses and ask the agent to
run. It can never approve, co-sign, add payees or change the org's rules: those stay with the owner's wallet.
"""
import re

import frappe
import requests
from frappe import _
from frappe.utils.password import get_decrypted_password

from sendsure_erpnext import __version__

DEFAULT_URL = "https://sendsure.0xpankaj.workers.dev"
SETTINGS = "SendSure Settings"
TIMEOUT = 25
# An agent run reviews each claim with Claude, then sends settle() and anchors its log on Arc.
AGENT_RUN_TIMEOUT = 150
# The books label SendSure shows the supplier ("sent from the payer's ERPNext"); the external id says which
# site and invoice ("erpnext:<site>:<invoice>").
SYSTEM = "erpnext"
EVM_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
PAYEE_REF = re.compile(r"0x[0-9a-fA-F]{64}")
LOCAL_URL = re.compile(r"^http://(127\.0\.0\.1|localhost|host\.docker\.internal)(:\d+)?$")


def is_evm_address(value):
	return bool(value and EVM_ADDRESS.match(value.strip()))


def same_address(a, b):
	return bool(a and b and a.strip().lower() == b.strip().lower())


class SendSureError(frappe.ValidationError):
	"""SendSure refused or failed. `code` is SendSure's machine code (e.g. PAYEE_NOT_BOUND)."""

	code = None
	status = None


def _fail(message, code=None, status=None):
	try:
		frappe.throw(message, SendSureError, title=_("SendSure"))
	except SendSureError as err:
		err.code = code
		err.status = status
		raise


def handled(err):
	"""An error from SendSure that the caller dealt with: log it, and take its pop-up off the response."""
	frappe.logger("sendsure").warning(f"SendSure: {err}")
	frappe.clear_last_message()


def _config():
	url = (frappe.db.get_single_value(SETTINGS, "url") or DEFAULT_URL).strip().rstrip("/")
	key = get_decrypted_password(SETTINGS, SETTINGS, "api_key", raise_exception=False) or ""
	return url, key.strip()


def is_configured():
	return bool(_config()[1])


def base_url():
	return _config()[0]


def _call(method, path, params=None, payload=None, timeout=TIMEOUT):
	url, key = _config()
	if not key:
		_fail(_("SendSure is not connected. Add your key in SendSure Settings."), code="NOT_CONFIGURED")
	if not (url.startswith("https://") or LOCAL_URL.match(url)):
		_fail(_("The SendSure server address must start with https://."), code="BAD_URL")
	try:
		res = requests.request(
			method,
			url + path,
			params=params,
			json=payload,
			timeout=timeout,
			headers={"Authorization": f"Bearer {key}", "User-Agent": f"sendsure-erpnext/{__version__}"},
		)
	except requests.RequestException as err:
		# The error text can carry the URL, never the key (it travels in a header).
		frappe.logger("sendsure").warning(f"SendSure {method} {path} failed: {type(err).__name__}")
		_fail(_("Could not reach SendSure. Please try again in a minute."), code="UNREACHABLE")
	try:
		data = res.json()
	except ValueError:
		data = {}
	if res.status_code >= 400:
		_fail(
			data.get("error") or _("SendSure answered {0}.").format(res.status_code),
			code=data.get("code"),
			status=res.status_code,
		)
	return data


# One function per endpoint, so tests can replace them.


def org():
	return _call("GET", "/api/v1/org")


def payees(refs):
	out = []
	refs = list(refs)
	for i in range(0, len(refs), 50):
		out += _call("GET", "/api/v1/payees", params={"refs": ",".join(refs[i : i + 50])})["payees"]
	return out


def verify(address):
	return _call("GET", "/api/v1/verify", params={"address": address})


def send_bill(payload):
	return _call("POST", "/api/v1/bills", payload=payload)


def bills(external_ids):
	out = []
	ids = list(external_ids)
	for i in range(0, len(ids), 100):
		out += _call("GET", "/api/v1/bills", params={"ids": ",".join(ids[i : i + 100])})["bills"]
	return out


def run_agent():
	return _call("POST", "/api/v1/agent/run", timeout=AGENT_RUN_TIMEOUT)
