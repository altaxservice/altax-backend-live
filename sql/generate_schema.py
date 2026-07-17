import json, re

schema = json.load(open("schema_source.json"))

def snake(name):
    s = re.sub(r'(?<!^)(?=[A-Z])', '_', name)
    return s.lower()

def col_snake(name):
    # handle acronyms like ID, SSN, EIN, MD, TIN, W9, YTD, IV cleanly
    s = name
    s = re.sub(r'(?<!^)(?=[A-Z][a-z])', '_', s)   # break before Capital+lower groups
    s = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', s) # break lower/upper boundary
    s = re.sub(r'_+', '_', s)
    s = s.lower()
    if re.match(r'^[0-9]', s):   # Postgres identifiers can't start with a digit (e.g. "1099Eligible")
        s = "is_" + s if "eligible" in s or "enabled" in s else "f_" + s
    return s

TABLE_PK = {
    "v3_Clients": "ClientID", "v3_Users": "UserID", "v3_Tasks": "TaskID",
    "v3_Task_Rules": "RuleID", "v3_Invoices": "InvoiceID", "v3_Payments": "PaymentID",
    "v3_Recurring_Billing": "RecurringBillingID", "v3_Document_Requests": "RequestID",
    "v3_Client_Secrets": "SecretID", "v3_Archived_Tasks": "TaskID",
    "v3_Task_Batches": "BatchID", "v3_Sales_Input": "SaleID",
    "v3_Payroll_Input": "PayrollInputID", "v3_Paychecks": "PaycheckID",
    "v3_Employees": "EmployeeID", "v3_Contractor_Payments": "ContractorPaymentID",
    "v3_Document_Uploads": "UploadID", "v3_Manual_JE": "JEID",
    "v3_GL_Entries": "GLEntryID", "v3_Tax_Rates": "RateID",
    "v3_Communications": "CommunicationID", "v3_Templates": "TemplateID",
    "v3_Payment_Methods": "PaymentMethodID", "v3_Check_Settings": "SettingID",
    "v3_Dropdown_Options": "OptionID", "v3_COA": "AccountID",
    "v3_Month_End_Items": "ChecklistItemID",
}
# tables with no natural single PK column (append surrogate id)
SURROGATE_PK_TABLES = {"v3_Audit_Log", "v3_Secret_Access_Log"}

# Postgres reserved words / awkward names -> explicit column rename + type override
COLUMN_OVERRIDES = {
    ("v3_Audit_Log", "Timestamp"): ("logged_at", "TIMESTAMPTZ NOT NULL DEFAULT now()"),
    ("v3_Audit_Log", "User"): ("user_email", "VARCHAR(255)"),
    ("v3_Secret_Access_Log", "Timestamp"): ("logged_at", "TIMESTAMPTZ NOT NULL DEFAULT now()"),
    ("v3_Secret_Access_Log", "User"): ("user_email", "VARCHAR(255)"),
}

# explicit FK map: table -> { column: (ref_table, ref_column) }
FK_MAP = {
    "v3_Users": {"AssignedClientID": ("v3_clients", "client_id"), "AssignedEmployeeID": ("v3_employees", "employee_id")},
    "v3_Tasks": {"ClientID": ("v3_clients", "client_id")},
    "v3_Archived_Tasks": {"ClientID": ("v3_clients", "client_id")},
    "v3_Invoices": {"ClientID": ("v3_clients", "client_id")},
    "v3_Payments": {"InvoiceID": ("v3_invoices", "invoice_id"), "TaskID": ("v3_tasks", "task_id"),
                    "ClientID": ("v3_clients", "client_id"), "PaymentMethodID": ("v3_payment_methods", "payment_method_id")},
    "v3_Recurring_Billing": {"ClientID": ("v3_clients", "client_id"), "PaymentMethodID": ("v3_payment_methods", "payment_method_id"),
                             "LastInvoiceID": ("v3_invoices", "invoice_id")},
    "v3_Document_Requests": {"TaskID": ("v3_tasks", "task_id"), "ClientID": ("v3_clients", "client_id")},
    "v3_Client_Secrets": {"ClientID": ("v3_clients", "client_id")},
    "v3_Secret_Access_Log": {"ClientID": ("v3_clients", "client_id"), "SecretID": ("v3_client_secrets", "secret_id")},
    "v3_Task_Batches": {"RuleID": ("v3_task_rules", "rule_id")},
    "v3_Sales_Input": {"ClientID": ("v3_clients", "client_id")},
    "v3_Payroll_Input": {"ClientID": ("v3_clients", "client_id"), "PaymentMethodID": ("v3_payment_methods", "payment_method_id")},
    "v3_Paychecks": {"ClientID": ("v3_clients", "client_id"), "PaymentMethodID": ("v3_payment_methods", "payment_method_id")},
    "v3_Employees": {"ClientID": ("v3_clients", "client_id")},
    "v3_Contractor_Payments": {"ClientID": ("v3_clients", "client_id"), "ContractorID": ("v3_employees", "employee_id"),
                               "PaymentMethodID": ("v3_payment_methods", "payment_method_id")},
    "v3_Document_Uploads": {"RequestID": ("v3_document_requests", "request_id"), "TaskID": ("v3_tasks", "task_id"),
                            "ClientID": ("v3_clients", "client_id")},
    "v3_Manual_JE": {"ClientID": ("v3_clients", "client_id")},
    "v3_GL_Entries": {"ClientID": ("v3_clients", "client_id")},
    "v3_Tax_Rates": {"ClientID": ("v3_clients", "client_id")},
    "v3_Communications": {"ClientID": ("v3_clients", "client_id"), "RelatedTaskID": ("v3_tasks", "task_id")},
    "v3_Payment_Methods": {"ClientID": ("v3_clients", "client_id")},
    "v3_Check_Settings": {"ClientID": ("v3_clients", "client_id")},
    "v3_Month_End_Items": {"ClientID": ("v3_clients", "client_id")},
}

MONEY_HINTS = ["Amount", "Wages", "Pay", "Rate", "Balance", "Due", "Cap", "Cost", "Tax", "Deduction",
               "Deductions", "Garnishment", "Sales", "Adjustments", "OpeningBalance", "CurrentBalance",
               "Debit", "Credit", "Fixed", "Withholding", "Reimbursement", "Retirement", "Health", "HsaFsa",
               "Paid", "Taxes",
               # Exact-name dollar fields whose suffix doesn't match any hint above (SocialSecurityEE/ER
               # don't end in "Tax", FUTA/SUTA are bare acronyms) — found live when a W-2 SUM() query
               # needed real numeric columns instead of the varchar these were silently typed as.
               "SocialSecurityEE", "MedicareEE", "SocialSecurityER", "MedicareER", "FUTA", "SUTA"]
DATE_HINTS = ["Date", "At", "Until", "Expires", "LastLogin", "Start", "End", "Printed"]
BOOL_HINTS = ["Enabled", "Active", "Allowed", "Required", "PortalEnabled", "PaymentRequired", "RequiresFiling",
              "AutoCreateInvoice", "AutoSendInvoice", "AutoCollectPayment", "UseForPayroll", "UseForInvoices",
              "DefaultForPayroll", "DefaultForInvoices", "DirectDeposit", "1099Eligible", "HiddenFromClient",
              "W21099Enabled", "MDUIEnabled", "MDAnnualReportEnabled", "EFTPSEnabled", "SMSAllowed", "EmailAllowed",
              "MustResetPassword"]
INT_HINTS = ["Count", "Hours", "SortOrder", "DueDays", "FailedLoginCount", "PasswordHashVersion",
             "LineNo", "TaskCount", "SkippedCount"]

def infer_type(table, col):
    # ID / identifier-like columns always stay string, regardless of other hints
    if col.endswith("ID") or col.endswith("Id") or col in ("EIN", "TIN", "SSN"):
        return "VARCHAR(64)"
    if col in ("MICRXOffset", "MICRYOffset", "DateX", "DateY", "PayeeX", "PayeeY", "AmountX", "AmountY",
               "MemoX", "MemoY", "SignatureX", "SignatureY"):
        return "NUMERIC(8,2)"
    # NormalBalance holds the enum string "Debit"/"Credit" (see alTaxPortalSaveCOAAccount in
    # Code.gs), not a currency figure — it only matches the MONEY_HINTS "Balance" suffix by
    # accident, which would otherwise mistype it as NUMERIC and break every COA write.
    if col == "NormalBalance":
        return "VARCHAR(255)"
    if col in BOOL_HINTS or col.endswith("Enabled") or col.endswith("Allowed") or col.endswith("Required"):
        return "BOOLEAN"
    if any(col == h or col.endswith(h) for h in DATE_HINTS):
        return "TIMESTAMPTZ"
    if any(col == h or col.endswith(h) for h in INT_HINTS):
        return "INTEGER"
    if any(col == h or col.endswith(h) for h in MONEY_HINTS):
        return "NUMERIC(14,2)"
    if col in ("EncryptedPayload", "Notes", "Description", "MessageEnglish", "MessageArabic", "Address",
               "SelectedClientIDs", "OldValue", "NewValue"):
        return "TEXT"
    return "VARCHAR(255)"

ddl = []
ddl.append("-- =====================================================================")
ddl.append("-- AL TAX SERVICE — PostgreSQL schema generated from AL_TAX_V3_SCHEMA")
ddl.append("-- Phase 0 foundation. Table/column names preserved (snake_case) 1:1")
ddl.append("-- from the existing Google Sheets 'v3_' tabs. See migration plan Section 2.")
ddl.append("-- =====================================================================\n")
ddl.append("CREATE SCHEMA IF NOT EXISTS altax;\nSET search_path TO altax;\n")

table_defs = {}

for table, cols in schema.items():
    tname = table.lower()
    pk_field = TABLE_PK.get(table)
    lines = [f"CREATE TABLE IF NOT EXISTS {tname} ("]
    col_lines = []
    fk_lines = []

    if table in SURROGATE_PK_TABLES:
        col_lines.append("    id BIGSERIAL PRIMARY KEY")

    seen_cols = set()
    for col in cols:
        override = COLUMN_OVERRIDES.get((table, col))
        if override:
            cname, coltype_full = override
            if cname in seen_cols:
                continue
            seen_cols.add(cname)
            col_lines.append(f"    {cname} {coltype_full}")
            continue

        cname = col_snake(col)
        if cname in seen_cols:
            continue
        seen_cols.add(cname)
        coltype = infer_type(table, col)
        is_pk = (col == pk_field)
        if is_pk:
            col_lines.append(f"    {cname} VARCHAR(64) PRIMARY KEY")
            continue
        default = ""
        if coltype == "BOOLEAN":
            default = " DEFAULT FALSE"
        col_lines.append(f"    {cname} {coltype}{default}")

        fk = FK_MAP.get(table, {}).get(col)
        if fk:
            ref_table, ref_col = fk
            fk_lines.append(
                f"    CONSTRAINT fk_{tname}_{cname} FOREIGN KEY ({cname}) REFERENCES {ref_table}({ref_col}) ON DELETE SET NULL"
            )

    # always add audit timestamps for new system (additive, non-destructive),
    # unless the source schema already defines that column (avoids duplicate
    # column names in the CREATE TABLE, e.g. v3_Client_Secrets/Templates/Check_Settings).
    if "created_at" not in seen_cols:
        col_lines.append("    created_at TIMESTAMPTZ NOT NULL DEFAULT now()")
    if "updated_at" not in seen_cols:
        col_lines.append("    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()")

    body = ",\n".join(col_lines + fk_lines)
    lines.append(body)
    lines.append(");")
    table_defs[table] = "\n".join(lines)

# Emit in dependency-safe order: clients/users/employees first, then the rest
order = ["v3_Clients", "v3_Users", "v3_Employees", "v3_Payment_Methods"]
order += [t for t in schema.keys() if t not in order]

for t in order:
    ddl.append(f"-- ---- {t} ----")
    ddl.append(table_defs[t])
    ddl.append("")

# Helpful indexes beyond PK
extra_indexes = [
    "CREATE INDEX IF NOT EXISTS idx_tasks_client ON v3_tasks(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_tasks_status ON v3_tasks(status);",
    "CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON v3_tasks(assigned_to);",
    "CREATE INDEX IF NOT EXISTS idx_invoices_client ON v3_invoices(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_payments_client ON v3_payments(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_payments_invoice ON v3_payments(invoice_id);",
    "CREATE INDEX IF NOT EXISTS idx_document_requests_client ON v3_document_requests(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_document_requests_status ON v3_document_requests(status);",
    "CREATE INDEX IF NOT EXISTS idx_communications_client ON v3_communications(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_users_email ON v3_users(email);",
    "CREATE INDEX IF NOT EXISTS idx_users_role ON v3_users(role);",
    "CREATE INDEX IF NOT EXISTS idx_employees_client ON v3_employees(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_payroll_input_client ON v3_payroll_input(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_paychecks_client ON v3_paychecks(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_client_secrets_client ON v3_client_secrets(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_secret_access_log_client ON v3_secret_access_log(client_id);",
    "CREATE INDEX IF NOT EXISTS idx_audit_log_module_record ON v3_audit_log(module, record_id);",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_role ON v3_users(email, role);  -- duplicate portal users blocked per-role only (matches v16 rule)",
]
ddl.append("-- ---- Indexes ----")
ddl.extend(extra_indexes)

open("001_init_schema.sql", "w").write("\n".join(ddl) + "\n")
print("wrote", len("\n".join(ddl)), "chars,", len(schema), "tables")
