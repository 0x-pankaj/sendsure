frappe.ui.form.on("Purchase Invoice", {
	refresh(frm) {
		const doc = frm.doc;
		if (doc.docstatus !== 1 || doc.is_return) return;
		const call = (method) =>
			frappe.call({
				method: `sendsure_erpnext.purchase_invoice.${method}`,
				args: { invoice: doc.name },
				freeze: true,
				callback: () => frm.reload_doc(),
			});
		if (!doc.sendsure_state && ["Unpaid", "Overdue"].includes(doc.status)) {
			frm.add_custom_button(__("Pay with SendSure"), () => call("pay_with_sendsure")).addClass("btn-primary");
		}
		if (!doc.sendsure_state) return;
		if (doc.sendsure_state === "Paid on Arc") {
			frm.dashboard.set_headline(
				__("Paid on Arc with SendSure: {0} USDC, transaction {1}.", [doc.sendsure_amount_paid, doc.sendsure_tx]) +
					(doc.sendsure_receipt_url ? ` <a href="${doc.sendsure_receipt_url}" target="_blank">${__("Receipt")}</a>` : ""),
				"green"
			);
		} else if (doc.sendsure_state === "Paid on Arc, needs review") {
			frm.dashboard.set_headline(
				__("SendSure paid this on Arc, but it needs review: {0}", [doc.sendsure_reason || ""]),
				"orange"
			);
		} else {
			frm.dashboard.set_headline(__("SendSure: {0}. {1}", [doc.sendsure_state, doc.sendsure_reason || ""]), "blue");
			frm.add_custom_button(__("Refresh SendSure"), () => call("refresh"));
		}
	},
});
