#!/usr/bin/env python3
"""Reproduce three Odoo 19 Community behaviours that matter when an agent pays vendor bills in USDC.

  1. "USDC" as a currency code is silently cut to "USD".
  2. Odoo's trusted-account gate (`allow_out_payment`) exists, but no Community payment method uses it.
     A payment method that opts in makes Odoo's own Register Payment wizard refuse an untrusted wallet.
  3. A $250.00 bill paid with 249.995 USDC is marked paid, with no write-off and no exchange difference.

Every payment goes through the same wizard as the "Register Payment" button, called over XML-RPC by a
limited user who only has the Invoicing role (the "agent").

Usage: `docker compose up -d`, then `python3 repro.py`. Standard library only.
"""
import sys
import time
import xmlrpc.client

URL = "http://127.0.0.1:18069"
DB = "usdc_repro"
ADMIN = ("admin", "admin")
AGENT = ("ap-agent", "agent-pass-123")
UNTRUSTED_WALLET = "0x1111111111111111111111111111111111111111"
REPLACEMENT_WALLET = "0x9a30000000000000000000000000000000000af1"

results = []


def say(text=""):
    print(text, flush=True)


def record(claim, outcome, detail):
    results.append((claim, outcome, detail))
    say(f"  {outcome:<14} {claim}")
    say(f"                 {detail}")


def fault_text(fault):
    lines = [line.strip() for line in fault.faultString.strip().splitlines() if line.strip()]
    return (lines[-1] if lines else str(fault))[:260]


def wait_for_odoo(timeout=900):
    """Wait until the database answers and both modules are installed."""
    deadline = time.time() + timeout
    last = "no answer yet"
    while time.time() < deadline:
        try:
            uid = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/common").authenticate(DB, *ADMIN, {})
            if uid:
                obj = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/object", allow_none=True)
                mods = obj.execute_kw(DB, uid, ADMIN[1], "ir.module.module", "search_read",
                                      [[("name", "in", ["account", "usdc_arc_gate"])]], {"fields": ["name", "state"]})
                states = {m["name"]: m["state"] for m in mods}
                if states.get("account") == "installed" and states.get("usdc_arc_gate") == "installed":
                    return
                last = f"modules {states}"
        except Exception as exc:  # still starting up
            last = type(exc).__name__
        time.sleep(5)
    sys.exit(f"Odoo was not ready after {timeout}s ({last}). Check `docker compose logs odoo`.")


class Session:
    """One logged-in Odoo user over XML-RPC."""

    def __init__(self, login, password):
        self.password = password
        self.uid = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/common").authenticate(DB, login, password, {})
        if not self.uid:
            sys.exit(f"Login failed for {login}.")
        self.obj = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/object", allow_none=True)

    def __call__(self, model, method, *args, **kwargs):
        return self.obj.execute_kw(DB, self.uid, self.password, model, method, list(args), kwargs)


def main():
    say(f"Waiting for Odoo at {URL}. The first start installs Invoicing and takes a few minutes.")
    wait_for_odoo()
    admin = Session(*ADMIN)
    if admin("res.currency", "search_count", [("name", "=", "USC"), ("active", "in", [True, False])]):
        sys.exit("This database was already used by an earlier run. Start fresh with:\n"
                 "  ./run.sh down && ./run.sh up && python3 repro.py")
    version = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/common").version()["server_version"]
    company_id = admin("res.users", "read", [admin.uid], ["company_id"])[0]["company_id"][0]
    company = admin("res.company", "read", [company_id], ["name", "currency_id", "currency_exchange_journal_id"])[0]
    say(f"Odoo {version} Community · company '{company['name']}' · company currency {company['currency_id'][1]}")

    # ------------------------------------------------------------------ 1
    say("\n[1] Currency code 'USDC'")
    size = admin("res.currency", "fields_get", ["name"], attributes=["size"])["name"].get("size")
    try:
        created = admin("res.currency", "create", {"name": "USDC", "symbol": "USDC", "rounding": 0.000001})
        stored = admin("res.currency", "read", [created], ["name"])[0]["name"]
        outcome = "CONFIRMED" if stored != "USDC" else "NOT REPRODUCED"
        record("'USDC' as a currency code is cut to 'USD'", outcome,
               f"created, but stored as '{stored}' (currency code field size = {size})")
    except xmlrpc.client.Fault as fault:
        message = fault_text(fault)
        outcome = "CONFIRMED" if "unique" in message.lower() else "DIFFERENT"
        record("'USDC' as a currency code is cut to 'USD'", outcome,
               f"refused with '{message}': 'USDC' is truncated to 'USD', which already exists (size = {size})")

    # ------------------------------------------------------------------ setup
    say("\nSetup: USDC as a 6-decimal currency (code USC), a USDC wallet journal, a vendor with an")
    say("untrusted wallet address, an agent user with only the Invoicing role, and four vendor bills.")
    usc = admin("res.currency", "create", {"name": "USC", "symbol": "USDC", "full_name": "USD Coin",
                                           "rounding": 0.000001, "active": True})
    admin("res.currency.rate", "create", {"currency_id": usc, "name": "2026-01-01", "rate": 1.0})
    journal = admin("account.journal", "create", {"name": "USDC Arc Wallet", "code": "USDC", "type": "bank",
                                                  "currency_id": usc})
    method = admin("account.payment.method", "search", [("code", "=", "usdc_arc")])[0]
    usdc_line = admin("account.payment.method.line", "search",
                      [("journal_id", "=", journal), ("payment_method_id", "=", method)])
    usdc_line = usdc_line[0] if usdc_line else admin("account.payment.method.line", "create", {
        "journal_id": journal, "payment_method_id": method, "name": "USDC on Arc"})
    manual_line = admin("account.payment.method.line", "search", [
        ("journal_id", "=", journal), ("code", "=", "manual"), ("payment_type", "=", "outbound")])[0]

    vendor = admin("res.partner", "create", {"name": "Acme Supplies", "supplier_rank": 1})
    wallet = admin("res.partner.bank", "create", {"partner_id": vendor, "acc_number": UNTRUSTED_WALLET})

    group_user = admin("ir.model.data", "check_object_reference", "base", "group_user")[1]
    group_invoice = admin("ir.model.data", "check_object_reference", "account", "group_account_invoice")[1]
    user_fields = admin("res.users", "fields_get", [], attributes=["type"])
    group_field = "group_ids" if "group_ids" in user_fields else "groups_id"
    admin("res.users", "create", {"name": "AP Agent", "login": AGENT[0], "password": AGENT[1],
                                  group_field: [(6, 0, [group_user, group_invoice])]})
    agent = Session(*AGENT)

    def bill(amount, ref):
        move = admin("account.move", "create", {
            "move_type": "in_invoice", "partner_id": vendor, "invoice_date": "2026-09-25", "ref": ref,
            "invoice_line_ids": [(0, 0, {"name": "Design work", "quantity": 1, "price_unit": amount,
                                         "tax_ids": [(6, 0, [])]})],
        })
        admin("account.move", "action_post", [move])
        return move

    bill_manual = bill(100.00, "INV-101")
    bill_gate = bill(100.00, "INV-102")
    bill_half_cent = bill(250.00, "INV-103")
    bill_contrast = bill(250.00, "INV-104")

    def pay(session, move, line, amount=None):
        """Register a payment exactly like the UI button: wizard create, then action_create_payments."""
        vals = {"journal_id": journal, "payment_method_line_id": line}
        if amount is not None:
            vals["amount"] = amount
        context = {"active_model": "account.move", "active_ids": [move]}
        wizard = session("account.payment.register", "create", vals, context=context)
        action = session("account.payment.register", "action_create_payments", [wizard], context=context)
        if isinstance(action, dict) and action.get("res_id"):
            return action["res_id"]
        return admin("account.payment", "search", [("partner_id", "=", vendor)], order="id desc", limit=1)[0]

    def bill_state(move):
        return admin("account.move", "read", [move], ["payment_state", "amount_residual"])[0]

    # ------------------------------------------------------------------ 2
    say("\n[2] The trusted-account gate")
    try:
        payment = pay(agent, bill_manual, manual_line)
        paid_to = admin("account.payment", "read", [payment], ["partner_bank_id"])[0]["partner_bank_id"]
        state = bill_state(bill_manual)["payment_state"]
        record("Community's built-in 'Manual' method never checks trust", "CONFIRMED",
               f"agent paid INV-101 to the untrusted wallet {paid_to[1] if paid_to else '(none)'}; bill is '{state}'")
    except xmlrpc.client.Fault as fault:
        record("Community's built-in 'Manual' method never checks trust", "DIFFERENT",
               f"refused: {fault_text(fault)}")

    try:
        pay(agent, bill_gate, usdc_line)
        record("'USDC on Arc' (opted in) refuses an untrusted wallet", "NOT REPRODUCED", "the payment went through")
    except xmlrpc.client.Fault as fault:
        record("'USDC on Arc' (opted in) refuses an untrusted wallet", "CONFIRMED", f"refused: {fault_text(fault)}")

    try:
        agent("res.partner.bank", "write", [wallet], {"allow_out_payment": True})
        record("The agent cannot mark a wallet as trusted", "NOT REPRODUCED", "the agent set allow_out_payment")
    except xmlrpc.client.Fault as fault:
        record("The agent cannot mark a wallet as trusted", "CONFIRMED", f"refused: {fault_text(fault)}")

    admin("res.partner.bank", "write", [wallet], {"allow_out_payment": True})
    try:
        pay(agent, bill_gate, usdc_line)
        record("After a human trusts it, the same agent payment goes through", "CONFIRMED",
               f"INV-102 is now '{bill_state(bill_gate)['payment_state']}'")
    except xmlrpc.client.Fault as fault:
        record("After a human trusts it, the same agent payment goes through", "DIFFERENT",
               f"refused: {fault_text(fault)}")

    try:
        admin("res.partner.bank", "write", [wallet], {"acc_number": REPLACEMENT_WALLET})
        record("A trusted wallet's address can't be edited, even by an admin", "NOT REPRODUCED", "the edit went through")
    except xmlrpc.client.Fault as fault:
        record("A trusted wallet's address can't be edited, even by an admin", "CONFIRMED",
               f"refused: {fault_text(fault)}")

    # ------------------------------------------------------------------ 3
    say("\n[3] A six-decimal USDC payment against a two-decimal USD bill")
    fx_journal = company["currency_exchange_journal_id"]

    def fx_entries():
        return admin("account.move", "search_count", [("journal_id", "=", fx_journal[0])]) if fx_journal else 0

    for move, amount, ref in ((bill_half_cent, 249.995, "INV-103"), (bill_contrast, 249.994999, "INV-104")):
        fx_before = fx_entries()
        payment = pay(agent, move, usdc_line, amount)
        pay_read = admin("account.payment", "read", [payment], ["amount", "currency_id", "move_id"])[0]
        lines = admin("account.move.line", "search_read", [("move_id", "=", pay_read["move_id"][0])],
                      ["account_id", "debit", "credit", "amount_currency"])
        state = bill_state(move)
        fx_new = fx_entries() - fx_before
        detail = (f"{ref} ($250.00) paid with {pay_read['amount']:.6f} {pay_read['currency_id'][1]}: "
                  f"bill '{state['payment_state']}', open balance {state['amount_residual']:.2f}, "
                  f"{len(lines)} lines in the payment entry, {fx_new} exchange-difference entries")
        if amount == 249.995:
            silent = state["amount_residual"] == 0 and fx_new == 0 and len(lines) == 2
            record("249.995 USDC marks a $250.00 bill paid, with no write-off",
                   "CONFIRMED" if silent else "DIFFERENT", detail)
        else:
            record("Contrast: 249.994999 USDC leaves a 0.01 balance open",
                   "CONFIRMED" if abs(state["amount_residual"] - 0.01) < 1e-9 else "DIFFERENT", detail)

    say("\nSummary")
    width = max(len(claim) for claim, _, _ in results)
    for claim, outcome, _ in results:
        say(f"  {claim:<{width}}  {outcome}")
    say(f"\nOdoo {version} Community. To throw everything away: `docker compose down` or `./run.sh down`")


if __name__ == "__main__":
    main()
