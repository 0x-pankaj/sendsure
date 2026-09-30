frappe.ui.form.on("SendSure Settings", {
	test_connection(frm) {
		// Save first, so the key that is tested is the key that is stored.
		const test = () =>
			frappe.call({
				method: "sendsure_erpnext.sendsure.doctype.sendsure_settings.sendsure_settings.test_connection",
				freeze: true,
				freeze_message: __("Asking SendSure..."),
				callback: () => frm.reload_doc(),
			});
		if (frm.is_dirty()) frm.save().then(test);
		else test();
	},
	sync_now(frm) {
		frappe.call({
			method: "sendsure_erpnext.sync.run_now",
			freeze: true,
			freeze_message: __("Syncing with SendSure. An agent run can take two minutes..."),
			callback: (r) => r.message && frappe.show_alert({ message: r.message, indicator: "green" }),
		});
	},
});
