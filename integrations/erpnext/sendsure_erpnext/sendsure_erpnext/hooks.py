app_name = "sendsure_erpnext"
app_title = "SendSure"
app_publisher = "SendSure"
app_description = "Pay suppliers in USDC on Arc with SendSure, only at an address they proved, recorded back exactly."
app_license = "GPL-3.0"
required_apps = ["frappe/erpnext"]

after_install = "sendsure_erpnext.install.after_install"
after_migrate = "sendsure_erpnext.install.after_migrate"
before_tests = "sendsure_erpnext.install.before_tests"

doctype_js = {
	"Supplier": "public/js/supplier.js",
	"Purchase Invoice": "public/js/purchase_invoice.js",
}

doc_events = {
	"Supplier": {"validate": "sendsure_erpnext.supplier.validate"},
	"Purchase Invoice": {
		"validate": "sendsure_erpnext.purchase_invoice.validate",
		"before_cancel": "sendsure_erpnext.purchase_invoice.before_cancel",
	},
	"Payment Entry": {"validate": "sendsure_erpnext.payment_entry.validate"},
}

scheduler_events = {
	"cron": {
		"*/5 * * * *": ["sendsure_erpnext.sync.run"],
	},
}
