frappe.ui.form.on("Supplier", {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.sendsure_invite) return;
		frm.add_custom_button(
			__("Check with SendSure"),
			() =>
				frappe.call({
					method: "sendsure_erpnext.supplier.check",
					args: { supplier: frm.doc.name },
					freeze: true,
					callback: () => frm.reload_doc(),
				}),
			__("SendSure")
		);
		if (frm.doc.sendsure_address && !frm.doc.sendsure_trusted && frappe.user.has_role("Accounts Manager")) {
			frm.add_custom_button(
				__("Approve this payout address"),
				() =>
					frappe.confirm(
						__("SendSure will pay {0} at {1}, the address they proved by signing with it. Approve?", [
							frm.doc.supplier_name,
							frm.doc.sendsure_address,
						]),
						() =>
							frappe.call({
								method: "sendsure_erpnext.supplier.approve",
								args: { supplier: frm.doc.name },
								freeze: true,
								callback: () => frm.reload_doc(),
							})
					),
				__("SendSure")
			);
		}
	},
});
