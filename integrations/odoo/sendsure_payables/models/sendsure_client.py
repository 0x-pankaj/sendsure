"""The SendSure API, as this database's integration key sees it.

The key is created by the org's owner in SendSure (/org -> "Connect your books") and stored here as a
system parameter. It can send bills, read their status, check addresses and ask the agent to run. It
can never approve, co-sign, add payees or change the org's rules: those stay with the owner's wallet.
"""
import logging
import re

import requests

from odoo import _, api, models
from odoo.exceptions import AccessError, UserError

_logger = logging.getLogger(__name__)

DEFAULT_URL = 'https://sendsure.0xpankaj.workers.dev'
TIMEOUT = 25
# An agent run reviews each claim with Claude, then sends settle() and anchors its log on Arc.
AGENT_RUN_TIMEOUT = 150
EVM_ADDRESS = re.compile(r'^0x[0-9a-fA-F]{40}$')
PAYEE_REF = re.compile(r'0x[0-9a-fA-F]{64}')
LOCAL_URL = re.compile(r'^http://(127\.0\.0\.1|localhost|host\.docker\.internal)(:\d+)?$')


def is_evm_address(value):
    return bool(value and EVM_ADDRESS.match(value.strip()))


def same_address(a, b):
    return bool(a and b and a.strip().lower() == b.strip().lower())


class SendSureError(UserError):
    """SendSure refused or failed. `code` is SendSure's machine code (e.g. PAYEE_NOT_BOUND)."""

    def __init__(self, message, code=None, status=None):
        super().__init__(message)
        self.code = code
        self.status = status


class SendSureClient(models.AbstractModel):
    _name = 'sendsure.client'
    _description = 'SendSure API client'

    @api.model
    def _config(self):
        params = self.env['ir.config_parameter'].sudo()
        url = (params.get_param('sendsure.url') or DEFAULT_URL).strip().rstrip('/')
        return url, (params.get_param('sendsure.api_key') or '').strip()

    @api.model
    def is_configured(self):
        return bool(self._config()[1])

    @api.model
    def _call(self, method, path, params=None, payload=None, timeout=TIMEOUT):
        # The org's key is used for whoever triggers the call, so only accounting users (and the cron) may.
        if not (self.env.su or self.env.is_superuser() or self.env.user.has_group('account.group_account_invoice')):
            raise AccessError(_("Only accounting users can use SendSure."))
        url, key = self._config()
        if not key:
            raise SendSureError(_("SendSure is not connected. Add your key in Invoicing > Configuration > Settings."),
                                code='NOT_CONFIGURED')
        if not (url.startswith('https://') or LOCAL_URL.match(url)):
            raise SendSureError(_("The SendSure server address must start with https://."), code='BAD_URL')
        try:
            res = requests.request(
                method, url + path, params=params, json=payload, timeout=timeout,
                headers={'Authorization': 'Bearer %s' % key, 'User-Agent': 'sendsure-odoo/19.0.1.0.0'},
            )
        except requests.RequestException as err:
            _logger.warning("SendSure %s %s failed: %s", method, path, err)
            raise SendSureError(_("Could not reach SendSure. Please try again in a minute."), code='UNREACHABLE') from err
        try:
            data = res.json()
        except ValueError:
            data = {}
        if res.status_code >= 400:
            raise SendSureError(data.get('error') or _("SendSure answered %s.", res.status_code),
                                code=data.get('code'), status=res.status_code)
        return data

    # One method per endpoint, so tests can replace them.

    @api.private
    @api.model
    def org(self):
        return self._call('GET', '/api/v1/org')

    @api.private
    @api.model
    def payees(self, refs):
        out = []
        refs = list(refs)
        for i in range(0, len(refs), 50):
            out += self._call('GET', '/api/v1/payees', params={'refs': ','.join(refs[i:i + 50])})['payees']
        return out

    @api.private
    @api.model
    def verify(self, address):
        return self._call('GET', '/api/v1/verify', params={'address': address})

    @api.private
    @api.model
    def send_bill(self, payload):
        return self._call('POST', '/api/v1/bills', payload=payload)

    @api.private
    @api.model
    def bills(self, external_ids):
        out = []
        ids = list(external_ids)
        for i in range(0, len(ids), 100):
            out += self._call('GET', '/api/v1/bills', params={'ids': ','.join(ids[i:i + 100])})['bills']
        return out

    @api.private
    @api.model
    def withdraw(self, external_id):
        return self._call('POST', '/api/v1/bills/withdraw', payload={'external_id': external_id})

    @api.private
    @api.model
    def run_agent(self):
        return self._call('POST', '/api/v1/agent/run', timeout=AGENT_RUN_TIMEOUT)

    @api.model
    def base_url(self):
        return self._config()[0]
