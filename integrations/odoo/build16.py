#!/usr/bin/env python3
"""Builds the Odoo 16 copy of the add-on in 16.0/sendsure_payables from sendsure_payables (the one source).

The Python is the same on 16 to 19 (models/compat.py holds the differences). Odoo 16's views are older: it has
attrs="{'invisible': domain}" instead of invisible="python expression", and an older settings page. So this
copies the add-on, turns each invisible="..." into the matching attrs domain, and uses compat16/'s settings view.
A condition it has no domain for stops the build: add it to DOMAINS. Run it after changing the add-on:
    ./build16.py            (./run.sh does it for ODOO_VERSION=16)
"""
import pathlib
import re
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / 'sendsure_payables'
OUT = HERE / '16.0' / 'sendsure_payables'

DOMAINS = {
    "move_type != 'in_invoice' or state != 'posted' or payment_state != 'not_paid' or sendsure_state not in (False, 'withdrawn', 'rejected_by_payee', 'refused')":
        "['|', '|', '|', ('move_type', '!=', 'in_invoice'), ('state', '!=', 'posted'), ('payment_state', '!=', 'not_paid'), ('sendsure_state', 'not in', [False, 'withdrawn', 'rejected_by_payee', 'refused'])]",
    "sendsure_state != 'waiting_for_payee'": "[('sendsure_state', '!=', 'waiting_for_payee')]",
    "sendsure_state not in ('signed', 'needs_cosign')": "[('sendsure_state', 'not in', ['signed', 'needs_cosign'])]",
    "not sendsure_external_id or sendsure_state in ('paid', 'needs_review')":
        "['|', ('sendsure_external_id', '=', False), ('sendsure_state', 'in', ['paid', 'needs_review'])]",
    "sendsure_state != 'needs_cosign'": "[('sendsure_state', '!=', 'needs_cosign')]",
    "sendsure_state != 'held'": "[('sendsure_state', '!=', 'held')]",
    "sendsure_state != 'needs_review'": "[('sendsure_state', '!=', 'needs_review')]",
    "not sendsure_state or sendsure_state in ('paid', 'needs_review')":
        "['|', ('sendsure_state', '=', False), ('sendsure_state', 'in', ['paid', 'needs_review'])]",
    "sendsure_state != 'paid'": "[('sendsure_state', '!=', 'paid')]",
    "not sendsure_external_id": "[('sendsure_external_id', '=', False)]",
    "not sendsure_payee_ref": "[('sendsure_payee_ref', '=', False)]",
    "not sendsure_address": "[('sendsure_address', '=', False)]",
    "not sendsure_checked_at": "[('sendsure_checked_at', '=', False)]",
    "not sendsure_invite_url or sendsure_state not in (False, 'not_invited', 'invited')":
        "['|', ('sendsure_invite_url', '=', False), ('sendsure_state', 'not in', [False, 'not_invited', 'invited'])]",
}


def to_attrs(match):
    expr = match.group(1)
    if expr not in DOMAINS:
        sys.exit('build16.py: no Odoo 16 domain for invisible="%s"; add it to DOMAINS' % expr)
    return '''attrs="{'invisible': %s}"''' % DOMAINS[expr]


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.copytree(SRC, OUT, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for view in (OUT / 'views').glob('*.xml'):
        if view.name == 'res_config_settings_views.xml':
            shutil.copy(HERE / 'compat16' / view.name, view)
            continue
        view.write_text(re.sub(r'invisible="([^"]+)"', to_attrs, view.read_text()))
    (OUT.parent / 'README.md').write_text(
        "# SendSure for Odoo 16\n\nBuilt by `../build16.py` from `../sendsure_payables`: do not edit here. "
        "Add this folder (`16.0`) to Odoo 16's addons path. Odoo 17, 18 and 19 use `../sendsure_payables` directly.\n")
    print(OUT)


if __name__ == '__main__':
    main()
