-- =====================================================================
-- AL TAX SERVICE — PostgreSQL schema generated from AL_TAX_V3_SCHEMA
-- Phase 0 foundation. Table/column names preserved (snake_case) 1:1
-- from the existing Google Sheets 'v3_' tabs. See migration plan Section 2.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS altax;
SET search_path TO altax;

-- ---- v3_Clients ----
CREATE TABLE IF NOT EXISTS v3_clients (
    client_id VARCHAR(64) PRIMARY KEY,
    client_name VARCHAR(255),
    entity_type VARCHAR(255),
    status VARCHAR(255),
    state VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(255),
    assigned_to VARCHAR(255),
    sales_tax_frequency VARCHAR(255),
    payroll_enabled BOOLEAN DEFAULT FALSE,
    payroll_frequency VARCHAR(255),
    payroll_system VARCHAR(255),
    eftps_enabled BOOLEAN DEFAULT FALSE,
    md_withholding_frequency VARCHAR(255),
    mdui_enabled BOOLEAN DEFAULT FALSE,
    md_annual_report_enabled BOOLEAN DEFAULT FALSE,
    business_return_type VARCHAR(255),
    sms_allowed BOOLEAN DEFAULT FALSE,
    email_allowed BOOLEAN DEFAULT FALSE,
    portal_enabled BOOLEAN DEFAULT FALSE,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    -- `address` stays as a single free-text field, auto-composed server-side from
    -- street_address/city/state/zip_code whenever any of those change — every
    -- existing reader (W-2/1099 PDFs, invoice ship-to defaults, client mailings)
    -- keeps working unchanged. street_address/city/zip_code are the editable,
    -- individually-verifiable fields; state was already its own column.
    address TEXT,
    street_address VARCHAR(255),
    city VARCHAR(100),
    zip_code VARCHAR(20),
    fas_record_id VARCHAR(64),
    preferred_contact VARCHAR(255),
    notes TEXT,
    ein VARCHAR(64),
    individual_ssn VARCHAR(255),
    state_tax_id VARCHAR(64),
    secretary_of_state_id VARCHAR(64),
    company_contact_name VARCHAR(255),
    company_contact_title VARCHAR(255),
    company_contact_ssn VARCHAR(255),
    client_type VARCHAR(255),
    service_type VARCHAR(255),
    w21099_enabled BOOLEAN DEFAULT FALSE,
    preferred_language VARCHAR(255),
    -- Advisory only, never a hard restriction — used to suggest/pre-select relevant
    -- sales-tax categories on this client's Sales Input form. A client can (and often
    -- does, e.g. a grocery+tobacco store) sell across multiple categories regardless
    -- of this label; the real multi-category truth lives in v3_sales_input_lines.
    industry_category VARCHAR(255),
    -- Firm-wide service lines this client is engaged for (tax_prep, bookkeeping,
    -- payroll, sales_tax, formation, immigration, consulting) — drives which
    -- contract templates get suggested on the client's profile. Independent of
    -- service_type above (kept as-is for backward compatibility).
    services TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_Users ----
CREATE TABLE IF NOT EXISTS v3_users (
    user_id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255),
    name VARCHAR(255),
    role VARCHAR(255),
    phone VARCHAR(255),
    assigned_client_id VARCHAR(64),
    reminder_preference VARCHAR(255),
    sms_gateway_email VARCHAR(255),
    active BOOLEAN DEFAULT FALSE,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    password_hash VARCHAR(255),
    password_salt VARCHAR(255),
    password_hash_version INTEGER,
    invite_token VARCHAR(255),
    invite_expires TIMESTAMPTZ,
    last_login TIMESTAMPTZ,
    failed_login_count INTEGER,
    locked_until TIMESTAMPTZ,
    last_password_change_at TIMESTAMPTZ,
    must_reset_password BOOLEAN DEFAULT FALSE,
    assigned_employee_id VARCHAR(64),
    totp_secret VARCHAR(255),
    totp_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_users_assigned_client_id FOREIGN KEY (assigned_client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_users_assigned_employee_id FOREIGN KEY (assigned_employee_id) REFERENCES v3_employees(employee_id) ON DELETE SET NULL
);

-- ---- v3_Employees ----
CREATE TABLE IF NOT EXISTS v3_employees (
    employee_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    employee_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(255),
    pay_type VARCHAR(255),
    default_gross_wages NUMERIC(14,2),
    pay_frequency VARCHAR(255),
    status VARCHAR(255),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    ssn VARCHAR(255),
    ein VARCHAR(255),
    tin VARCHAR(255),
    worker_type VARCHAR(255),
    form_type VARCHAR(255),
    -- `address` stays as a single free-text field, auto-composed server-side from
    -- street_address/city/state/zip_code whenever any of those change — every
    -- existing reader (W-2/1099 PDFs) keeps working unchanged.
    address TEXT,
    street_address VARCHAR(255),
    city VARCHAR(100),
    zip_code VARCHAR(20),
    -- The employee's own work-state — drives STATE/SUTA payroll tax lookups (see
    -- calculatePaycheck in accounting.routes.ts), taking precedence over the
    -- employer client's state. Usually the same as the client's state (most
    -- employees work at their employer's location), but can differ.
    state VARCHAR(255),
    pay_rate NUMERIC(14,2),
    default_hours INTEGER,
    payment_method VARCHAR(255),
    direct_deposit BOOLEAN DEFAULT FALSE,
    bank_last4 VARCHAR(255),
    payment_bank_name VARCHAR(255),
    payment_routing_number VARCHAR(255),
    payment_account_number VARCHAR(255),
    payment_account_type VARCHAR(255),
    payment_bank_last4 VARCHAR(255),
    federal_filing_status VARCHAR(255),
    state_filing_status VARCHAR(255),
    w9_status VARCHAR(255),
    tin_verification_status VARCHAR(255),
    vendor_classification VARCHAR(255),
    service_category VARCHAR(255),
    contractor_payment_type VARCHAR(255),
    fixed_project_amount NUMERIC(14,2),
    is_1099_eligible BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_employees_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Payment_Methods ----
CREATE TABLE IF NOT EXISTS v3_payment_methods (
    payment_method_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    method_name VARCHAR(255),
    method_type VARCHAR(255),
    bank_name VARCHAR(255),
    routing_number VARCHAR(255),
    account_number VARCHAR(255),
    account_type VARCHAR(255),
    bank_last4 VARCHAR(255),
    phone VARCHAR(255),
    card_brand VARCHAR(50),
    cardholder_name VARCHAR(255),
    card_last4 VARCHAR(4),
    card_exp_month INTEGER,
    card_exp_year INTEGER,
    use_for_payroll BOOLEAN DEFAULT FALSE,
    use_for_invoices BOOLEAN DEFAULT FALSE,
    default_for_payroll BOOLEAN DEFAULT FALSE,
    default_for_invoices BOOLEAN DEFAULT FALSE,
    status VARCHAR(255),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_payment_methods_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Tasks ----
CREATE TABLE IF NOT EXISTS v3_tasks (
    task_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    service_line VARCHAR(255),
    task_name VARCHAR(255),
    period VARCHAR(255),
    frequency VARCHAR(255),
    agency_due_date TIMESTAMPTZ,
    staff_due_date TIMESTAMPTZ,
    status VARCHAR(255),
    assigned_to VARCHAR(255),
    payment_required BOOLEAN DEFAULT FALSE,
    payment_amount NUMERIC(14,2),
    filed_date TIMESTAMPTZ,
    paid_date TIMESTAMPTZ,
    confirmation_number VARCHAR(255),
    portal_name VARCHAR(255),
    portal_url VARCHAR(255),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_tasks_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Task_Rules ----
CREATE TABLE IF NOT EXISTS v3_task_rules (
    rule_id VARCHAR(64) PRIMARY KEY,
    task_type VARCHAR(255),
    trigger_column VARCHAR(255),
    trigger_value VARCHAR(255),
    frequency VARCHAR(255),
    period_type VARCHAR(255),
    due_month VARCHAR(255),
    due_day VARCHAR(255),
    payment_required BOOLEAN DEFAULT FALSE,
    requires_filing BOOLEAN DEFAULT FALSE,
    portal_name VARCHAR(255),
    warning_days VARCHAR(255),
    active BOOLEAN DEFAULT FALSE,
    notes TEXT,
    depends_on VARCHAR(255),
    portal_url VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_Invoices ----
CREATE TABLE IF NOT EXISTS v3_invoices (
    invoice_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    invoice_date TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    description TEXT,
    total_amount NUMERIC(14,2),
    amount_paid NUMERIC(14,2),
    balance_due NUMERIC(14,2),
    status VARCHAR(255),
    pdf_link VARCHAR(255),
    terms VARCHAR(255),
    customer_type VARCHAR(255),
    bill_to TEXT,
    -- `ship_to` stays as the single free-text field invoicePdf.ts renders, auto-composed
    -- server-side from ship_to_street/city/state/zip whenever those are provided —
    -- keeps the PDF renderer unchanged. Falls back to manual free-text ship_to (or the
    -- client's own composed address) when the structured fields aren't used.
    ship_to TEXT,
    ship_to_street VARCHAR(255),
    ship_to_city VARCHAR(100),
    ship_to_state VARCHAR(10),
    ship_to_zip VARCHAR(20),
    ship_from TEXT,
    payment_instructions TEXT,
    client_note TEXT,
    internal_note TEXT,
    subtotal_amount NUMERIC(14,2),
    discount_percent NUMERIC(6,3),
    discount_amount NUMERIC(14,2),
    taxable_subtotal NUMERIC(14,2),
    sales_tax_rate NUMERIC(9,6),
    sales_tax_amount NUMERIC(14,2),
    shipping_amount NUMERIC(14,2),
    deposit_amount NUMERIC(14,2),
    ship_via VARCHAR(255),
    shipping_date TIMESTAMPTZ,
    tracking_number VARCHAR(255),
    share_token VARCHAR(64) UNIQUE,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_invoices_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Products_Services (catalog for line-item invoicing) ----
CREATE TABLE IF NOT EXISTS v3_products_services (
    product_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(255),
    description TEXT,
    rate NUMERIC(14,2),
    taxable BOOLEAN DEFAULT TRUE,
    active BOOLEAN DEFAULT TRUE,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_Invoice_Line_Items ----
CREATE TABLE IF NOT EXISTS v3_invoice_line_items (
    line_item_id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64) NOT NULL,
    line_no INTEGER,
    service_date TIMESTAMPTZ,
    product_id VARCHAR(64),
    product_name VARCHAR(255),
    description TEXT,
    quantity NUMERIC(14,2) DEFAULT 1,
    rate NUMERIC(14,2) DEFAULT 0,
    amount NUMERIC(14,2) DEFAULT 0,
    taxable BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_invoice_line_items_invoice_id FOREIGN KEY (invoice_id) REFERENCES v3_invoices(invoice_id) ON DELETE CASCADE,
    CONSTRAINT fk_v3_invoice_line_items_product_id FOREIGN KEY (product_id) REFERENCES v3_products_services(product_id) ON DELETE SET NULL
);

-- ---- v3_Payments ----
CREATE TABLE IF NOT EXISTS v3_payments (
    payment_id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64),
    task_id VARCHAR(64),
    client_id VARCHAR(64),
    payment_date TIMESTAMPTZ,
    expected_amount NUMERIC(14,2),
    actual_amount NUMERIC(14,2),
    method VARCHAR(255),
    payment_method_id VARCHAR(64),
    payment_bank_name VARCHAR(255),
    payment_routing_number VARCHAR(255),
    payment_account_number VARCHAR(255),
    payment_account_type VARCHAR(255),
    payment_bank_last4 VARCHAR(255),
    confirmation_number VARCHAR(255),
    notes TEXT,
    status VARCHAR(255),
    reversal_reason VARCHAR(255),
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_payments_invoice_id FOREIGN KEY (invoice_id) REFERENCES v3_invoices(invoice_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_payments_task_id FOREIGN KEY (task_id) REFERENCES v3_tasks(task_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_payments_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_payments_payment_method_id FOREIGN KEY (payment_method_id) REFERENCES v3_payment_methods(payment_method_id) ON DELETE SET NULL
);

-- ---- v3_Recurring_Billing ----
CREATE TABLE IF NOT EXISTS v3_recurring_billing (
    recurring_billing_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    description TEXT,
    amount NUMERIC(14,2),
    frequency VARCHAR(255),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    next_run_date TIMESTAMPTZ,
    due_days INTEGER,
    interval_count INTEGER DEFAULT 1,
    repeat_on_day INTEGER,
    payment_method_id VARCHAR(64),
    auto_create_invoice BOOLEAN DEFAULT FALSE,
    auto_send_invoice BOOLEAN DEFAULT FALSE,
    auto_collect_payment BOOLEAN DEFAULT FALSE,
    status VARCHAR(255),
    last_run_date TIMESTAMPTZ,
    last_invoice_id VARCHAR(64),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_recurring_billing_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_recurring_billing_payment_method_id FOREIGN KEY (payment_method_id) REFERENCES v3_payment_methods(payment_method_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_recurring_billing_last_invoice_id FOREIGN KEY (last_invoice_id) REFERENCES v3_invoices(invoice_id) ON DELETE SET NULL
);

-- ---- v3_Document_Requests ----
CREATE TABLE IF NOT EXISTS v3_document_requests (
    request_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(64),
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    requested_item VARCHAR(255),
    request_date TIMESTAMPTZ,
    due_from_client VARCHAR(255),
    status VARCHAR(255),
    received_date TIMESTAMPTZ,
    assigned_to VARCHAR(255),
    priority VARCHAR(255),
    request_type VARCHAR(255),
    direction VARCHAR(255),
    attachment_link VARCHAR(255),
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_document_requests_task_id FOREIGN KEY (task_id) REFERENCES v3_tasks(task_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_document_requests_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Audit_Log ----
CREATE TABLE IF NOT EXISTS v3_audit_log (
    id BIGSERIAL PRIMARY KEY,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_email VARCHAR(255),
    module VARCHAR(255),
    action VARCHAR(255),
    record_id VARCHAR(64),
    field VARCHAR(255),
    old_value TEXT,
    new_value TEXT,
    note VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_Client_Secrets ----
CREATE TABLE IF NOT EXISTS v3_client_secrets (
    secret_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    category VARCHAR(255),
    jurisdiction VARCHAR(255),
    agency_name VARCHAR(255),
    label VARCHAR(255),
    portal_url VARCHAR(255),
    encrypted_payload TEXT,
    salt VARCHAR(255),
    iv VARCHAR(255),
    last4_hint VARCHAR(255),
    status VARCHAR(255),
    created_at TIMESTAMPTZ,
    created_by VARCHAR(255),
    updated_at TIMESTAMPTZ,
    updated_by VARCHAR(255),
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(255),
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    CONSTRAINT fk_v3_client_secrets_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Secret_Access_Log ----
CREATE TABLE IF NOT EXISTS v3_secret_access_log (
    id BIGSERIAL PRIMARY KEY,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_email VARCHAR(255),
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    secret_id VARCHAR(64),
    category VARCHAR(255),
    action VARCHAR(255),
    field VARCHAR(255),
    result VARCHAR(255),
    note VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_secret_access_log_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_secret_access_log_secret_id FOREIGN KEY (secret_id) REFERENCES v3_client_secrets(secret_id) ON DELETE SET NULL
);

-- ---- v3_Archived_Tasks ----
CREATE TABLE IF NOT EXISTS v3_archived_tasks (
    task_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    service_line VARCHAR(255),
    task_name VARCHAR(255),
    period VARCHAR(255),
    frequency VARCHAR(255),
    agency_due_date TIMESTAMPTZ,
    staff_due_date TIMESTAMPTZ,
    status VARCHAR(255),
    assigned_to VARCHAR(255),
    payment_required BOOLEAN DEFAULT FALSE,
    payment_amount NUMERIC(14,2),
    filed_date TIMESTAMPTZ,
    paid_date TIMESTAMPTZ,
    confirmation_number VARCHAR(255),
    portal_name VARCHAR(255),
    portal_url VARCHAR(255),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    archived_at TIMESTAMPTZ,
    archived_by VARCHAR(255),
    archive_reason VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_archived_tasks_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Task_Batches ----
CREATE TABLE IF NOT EXISTS v3_task_batches (
    batch_id VARCHAR(64) PRIMARY KEY,
    created_at TIMESTAMPTZ,
    created_by VARCHAR(255),
    rule_id VARCHAR(64),
    task_type VARCHAR(255),
    frequency VARCHAR(255),
    period_label VARCHAR(255),
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    staff_due_date TIMESTAMPTZ,
    assigned_to VARCHAR(255),
    task_count INTEGER,
    skipped_count INTEGER,
    status VARCHAR(255),
    notes TEXT,
    selected_client_i_ds TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_task_batches_rule_id FOREIGN KEY (rule_id) REFERENCES v3_task_rules(rule_id) ON DELETE SET NULL
);

-- ---- v3_Sales_Input ----
-- taxable6_sales/special12_sales/vape20_sales/sixty_rate_sales are Maryland's own
-- fixed sales-tax categories, hardcoded as columns — kept here read-only as a
-- historical/audit trail after the 2026-07-14 migration to v3_sales_input_lines
-- (below), which replaced them as the real per-category, multi-state storage.
-- New rows should populate v3_sales_input_lines instead of these 4 columns.
CREATE TABLE IF NOT EXISTS v3_sales_input (
    sale_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    sale_date TIMESTAMPTZ,
    gross_sales NUMERIC(14,2),
    taxable6_sales NUMERIC(14,2),
    special12_sales NUMERIC(14,2),
    vape20_sales NUMERIC(14,2),
    sixty_rate_sales NUMERIC(14,2),
    adjustments NUMERIC(14,2),
    payment_date TIMESTAMPTZ,
    total_tax_due NUMERIC(14,2),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_sales_input_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Sales_Tax_Categories ----
-- Global reference data (not per-client) — a category can be state-specific (e.g.
-- "Restaurant/prepared food" in DC) or reused across states. default_rate_id points
-- at v3_tax_rates.rate_id (soft reference, not a DB-enforced FK, since rate_id is no
-- longer unique on its own — see v3_tax_rates's own comment).
CREATE TABLE IF NOT EXISTS v3_sales_tax_categories (
    category_id VARCHAR(64) PRIMARY KEY,
    category_name VARCHAR(255) NOT NULL,
    state VARCHAR(255),
    default_rate_id VARCHAR(64),
    filing_box_label VARCHAR(255),
    display_order INTEGER DEFAULT 100,
    active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_Sales_Input_Lines ----
-- Child of v3_sales_input — replaces the 4 fixed MD columns above. A sale with
-- activity in multiple categories (e.g. a client selling groceries AND tobacco)
-- gets one line row per category instead of being forced into fixed columns.
CREATE TABLE IF NOT EXISTS v3_sales_input_lines (
    line_id VARCHAR(64) PRIMARY KEY,
    sale_id VARCHAR(64) NOT NULL,
    category_id VARCHAR(64) NOT NULL,
    taxable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_rate_used NUMERIC(9,6),
    tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_sales_input_lines_sale_id FOREIGN KEY (sale_id) REFERENCES v3_sales_input(sale_id) ON DELETE CASCADE,
    CONSTRAINT fk_v3_sales_input_lines_category_id FOREIGN KEY (category_id) REFERENCES v3_sales_tax_categories(category_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_v3_sales_input_lines_sale_id ON v3_sales_input_lines (sale_id);

-- ---- v3_Payroll_Input ----
CREATE TABLE IF NOT EXISTS v3_payroll_input (
    payroll_input_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    pay_date TIMESTAMPTZ,
    employee VARCHAR(255),
    gross_wages NUMERIC(14,2),
    federal_withholding NUMERIC(14,2),
    state_tax NUMERIC(14,2),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    pay_period_start TIMESTAMPTZ,
    pay_period_end TIMESTAMPTZ,
    check_number VARCHAR(255),
    hours INTEGER,
    rate NUMERIC(14,2),
    pay_type VARCHAR(255),
    regular_hours INTEGER,
    regular_rate NUMERIC(14,2),
    regular_pay NUMERIC(14,2),
    overtime_hours INTEGER,
    overtime_rate NUMERIC(14,2),
    overtime_pay NUMERIC(14,2),
    bonus_pay NUMERIC(14,2),
    commission_pay NUMERIC(14,2),
    other_taxable_pay NUMERIC(14,2),
    non_taxable_reimbursement NUMERIC(14,2),
    pre_tax_retirement NUMERIC(14,2),
    pre_tax_health NUMERIC(14,2),
    pre_tax_hsa_fsa NUMERIC(14,2),
    post_tax_deduction NUMERIC(14,2),
    garnishment NUMERIC(14,2),
    other_deduction NUMERIC(14,2),
    total_pre_tax_deductions NUMERIC(14,2),
    total_post_tax_deductions NUMERIC(14,2),
    total_deductions NUMERIC(14,2),
    federal_taxable_wages NUMERIC(14,2),
    social_security_wages NUMERIC(14,2),
    medicare_wages NUMERIC(14,2),
    state_taxable_wages NUMERIC(14,2),
    payment_method_id VARCHAR(64),
    payment_method VARCHAR(255),
    payment_bank_name VARCHAR(255),
    payment_routing_number VARCHAR(255),
    payment_account_number VARCHAR(255),
    payment_account_type VARCHAR(255),
    payment_bank_last4 VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_payroll_input_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_payroll_input_payment_method_id FOREIGN KEY (payment_method_id) REFERENCES v3_payment_methods(payment_method_id) ON DELETE SET NULL
);

-- ---- v3_Paychecks ----
CREATE TABLE IF NOT EXISTS v3_paychecks (
    paycheck_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    pay_date TIMESTAMPTZ,
    employee VARCHAR(255),
    gross_wages NUMERIC(14,2),
    social_security_ee NUMERIC(14,2),
    medicare_ee NUMERIC(14,2),
    federal_withholding NUMERIC(14,2),
    state_tax NUMERIC(14,2),
    employee_taxes NUMERIC(14,2),
    net_pay NUMERIC(14,2),
    social_security_er NUMERIC(14,2),
    medicare_er NUMERIC(14,2),
    futa NUMERIC(14,2),
    suta NUMERIC(14,2),
    employer_taxes NUMERIC(14,2),
    total_cost NUMERIC(14,2),
    status VARCHAR(255),
    printed_at TIMESTAMPTZ,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    pay_period_start TIMESTAMPTZ,
    pay_period_end TIMESTAMPTZ,
    check_number VARCHAR(255),
    hours INTEGER,
    rate NUMERIC(14,2),
    pay_type VARCHAR(255),
    regular_hours INTEGER,
    regular_rate NUMERIC(14,2),
    regular_pay NUMERIC(14,2),
    overtime_hours INTEGER,
    overtime_rate NUMERIC(14,2),
    overtime_pay NUMERIC(14,2),
    bonus_pay NUMERIC(14,2),
    commission_pay NUMERIC(14,2),
    other_taxable_pay NUMERIC(14,2),
    non_taxable_reimbursement NUMERIC(14,2),
    pre_tax_retirement NUMERIC(14,2),
    pre_tax_health NUMERIC(14,2),
    pre_tax_hsa_fsa NUMERIC(14,2),
    post_tax_deduction NUMERIC(14,2),
    garnishment NUMERIC(14,2),
    other_deduction NUMERIC(14,2),
    total_pre_tax_deductions NUMERIC(14,2),
    total_post_tax_deductions NUMERIC(14,2),
    total_deductions NUMERIC(14,2),
    federal_taxable_wages NUMERIC(14,2),
    social_security_wages NUMERIC(14,2),
    medicare_wages NUMERIC(14,2),
    state_taxable_wages NUMERIC(14,2),
    payment_method_id VARCHAR(64),
    payment_method VARCHAR(255),
    payment_bank_name VARCHAR(255),
    payment_routing_number VARCHAR(255),
    payment_account_number VARCHAR(255),
    payment_account_type VARCHAR(255),
    payment_bank_last4 VARCHAR(255),
    employee_ssn VARCHAR(255),
    employee_address VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_paychecks_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_paychecks_payment_method_id FOREIGN KEY (payment_method_id) REFERENCES v3_payment_methods(payment_method_id) ON DELETE SET NULL
);

-- ---- v3_Contractor_Payments ----
CREATE TABLE IF NOT EXISTS v3_contractor_payments (
    contractor_payment_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    contractor_id VARCHAR(64),
    contractor_name VARCHAR(255),
    payment_date TIMESTAMPTZ,
    amount NUMERIC(14,2),
    method VARCHAR(255),
    payment_method_id VARCHAR(64),
    check_number VARCHAR(255),
    payment_bank_name VARCHAR(255),
    payment_routing_number VARCHAR(255),
    payment_account_number VARCHAR(255),
    payment_account_type VARCHAR(255),
    payment_bank_last4 VARCHAR(255),
    confirmation_number VARCHAR(255),
    expense_category VARCHAR(255),
    memo VARCHAR(255),
    is_1099_eligible BOOLEAN DEFAULT FALSE,
    status VARCHAR(255),
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_contractor_payments_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_contractor_payments_contractor_id FOREIGN KEY (contractor_id) REFERENCES v3_employees(employee_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_contractor_payments_payment_method_id FOREIGN KEY (payment_method_id) REFERENCES v3_payment_methods(payment_method_id) ON DELETE SET NULL
);

-- ---- v3_Document_Uploads ----
CREATE TABLE IF NOT EXISTS v3_document_uploads (
    upload_id VARCHAR(64) PRIMARY KEY,
    request_id VARCHAR(64),
    task_id VARCHAR(64),
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    file_name VARCHAR(255),
    file_url VARCHAR(255),
    file_data TEXT,
    mime_type VARCHAR(255),
    file_size INTEGER,
    uploaded_by VARCHAR(255),
    uploaded_at TIMESTAMPTZ,
    direction VARCHAR(255),
    status VARCHAR(255),
    notes TEXT,
    hidden_from_client BOOLEAN DEFAULT FALSE,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_document_uploads_request_id FOREIGN KEY (request_id) REFERENCES v3_document_requests(request_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_document_uploads_task_id FOREIGN KEY (task_id) REFERENCES v3_tasks(task_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_document_uploads_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Manual_JE ----
CREATE TABLE IF NOT EXISTS v3_manual_je (
    jeid VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    entry_date TIMESTAMPTZ,
    ref VARCHAR(255),
    description TEXT,
    account VARCHAR(255),
    debit NUMERIC(14,2),
    credit NUMERIC(14,2),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    journal_entry_id VARCHAR(64),
    line_no INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_manual_je_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_GL_Entries ----
CREATE TABLE IF NOT EXISTS v3_gl_entries (
    gl_entry_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    entry_date TIMESTAMPTZ,
    ref VARCHAR(255),
    description TEXT,
    account VARCHAR(255),
    debit NUMERIC(14,2),
    credit NUMERIC(14,2),
    source VARCHAR(255),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_gl_entries_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Tax_Rates ----
-- rate_id is the logical tax code (STATE, SUTA, ST6, ...) and is NOT unique on its own —
-- multiple rows can share a rate_id (one Global, one per state, one per client override).
-- The real primary key is the surrogate tax_rate_row_id; uniqueness across the meaningful
-- combination is enforced by uq_v3_tax_rates_rate_scope_client_state below. This was
-- originally a single-column PK on rate_id, which made it impossible to ever save a
-- client- or state-specific override for a rate_id that already had a seeded Global row
-- (every seeded default) — the INSERT would collide with the existing PK. Fixed 2026-07-14.
CREATE TABLE IF NOT EXISTS v3_tax_rates (
    tax_rate_row_id BIGSERIAL PRIMARY KEY,
    rate_id VARCHAR(64) NOT NULL,
    scope VARCHAR(255),
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    rate_type VARCHAR(255),
    rate NUMERIC(9,6),
    employee_employer VARCHAR(255),
    wage_cap NUMERIC(14,2),
    state VARCHAR(255),
    active BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_tax_rates_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_v3_tax_rates_rate_scope_client_state
    ON v3_tax_rates (rate_id, scope, COALESCE(client_id, ''), COALESCE(state, ''));

-- ---- v3_Communications ----
CREATE TABLE IF NOT EXISTS v3_communications (
    communication_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    related_task_id VARCHAR(64),
    direction VARCHAR(255),
    channel VARCHAR(255),
    subject VARCHAR(255),
    message_english TEXT,
    message_arabic TEXT,
    sent_to VARCHAR(255),
    sent_by VARCHAR(255),
    sent_at TIMESTAMPTZ,
    status VARCHAR(255),
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_communications_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_communications_related_task_id FOREIGN KEY (related_task_id) REFERENCES v3_tasks(task_id) ON DELETE SET NULL
);

-- ---- v3_Templates ----
CREATE TABLE IF NOT EXISTS v3_templates (
    template_id VARCHAR(64) PRIMARY KEY,
    template_name VARCHAR(255),
    category VARCHAR(255),
    subject VARCHAR(255),
    message_english TEXT,
    message_arabic TEXT,
    active BOOLEAN DEFAULT FALSE,
    notes TEXT,
    updated_at TIMESTAMPTZ,
    updated_by VARCHAR(255),
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_Contract_Templates ----
-- Admin-editable contract template overrides, keyed by service_key — mirrors the
-- v3_templates "built-in default + optional override" pattern above. Built-in
-- legal language lives in code (contractContent.ts); saving here overrides it
-- without a deploy.
CREATE TABLE IF NOT EXISTS v3_contract_templates (
    template_id VARCHAR(64) PRIMARY KEY,
    service_key VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    updated_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_Client_Contracts ----
-- A generated, client-specific contract instance. rendered_body is the fully
-- merged, immutable text snapshot at generation time — even if the source
-- template is edited later, a previously generated/signed contract keeps the
-- exact text the client saw and agreed to.
CREATE TABLE IF NOT EXISTS v3_client_contracts (
    contract_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL,
    template_id VARCHAR(64),
    service_key VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    rendered_body TEXT NOT NULL,
    fee_amount NUMERIC(14,2),
    fee_description VARCHAR(255),
    effective_date TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'Draft',
    share_token VARCHAR(64) UNIQUE,
    signer_name VARCHAR(255),
    signer_title VARCHAR(255),
    agreed BOOLEAN DEFAULT FALSE,
    signed_at TIMESTAMPTZ,
    signer_ip VARCHAR(64),
    signer_user_agent TEXT,
    voided_at TIMESTAMPTZ,
    voided_reason TEXT,
    created_by VARCHAR(255),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_client_contracts_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v3_client_contracts_client_id ON v3_client_contracts(client_id);

-- ---- v3_Check_Settings ----
CREATE TABLE IF NOT EXISTS v3_check_settings (
    setting_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    check_position VARCHAR(255),
    paper_stock VARCHAR(255),
    micrx_offset NUMERIC(8,2),
    micry_offset NUMERIC(8,2),
    date_x NUMERIC(8,2),
    date_y NUMERIC(8,2),
    payee_x NUMERIC(8,2),
    payee_y NUMERIC(8,2),
    amount_x NUMERIC(8,2),
    amount_y NUMERIC(8,2),
    memo_x NUMERIC(8,2),
    memo_y NUMERIC(8,2),
    signature_x NUMERIC(8,2),
    signature_y NUMERIC(8,2),
    updated_at TIMESTAMPTZ,
    updated_by VARCHAR(255),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_check_settings_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Dropdown_Options ----
CREATE TABLE IF NOT EXISTS v3_dropdown_options (
    option_id VARCHAR(64) PRIMARY KEY,
    category VARCHAR(255),
    value VARCHAR(255),
    active BOOLEAN DEFAULT FALSE,
    sort_order INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_COA ----
CREATE TABLE IF NOT EXISTS v3_coa (
    account_id VARCHAR(64) PRIMARY KEY,
    account_name VARCHAR(255),
    account_type VARCHAR(255),
    detail_type VARCHAR(255),
    normal_balance VARCHAR(255),
    active BOOLEAN DEFAULT FALSE,
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    description TEXT,
    opening_balance NUMERIC(14,2),
    current_balance NUMERIC(14,2),
    sub_account_of VARCHAR(255),
    tax_line VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_Month_End_Items ----
CREATE TABLE IF NOT EXISTS v3_month_end_items (
    checklist_item_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    period VARCHAR(255),
    item_name VARCHAR(255),
    category VARCHAR(255),
    status VARCHAR(255),
    completed_at TIMESTAMPTZ,
    completed_by VARCHAR(255),
    notes TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_month_end_items_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Time_Entries ----
-- Firm-internal staff time tracking (not client payroll — v3_Employees/v3_Paychecks
-- cover paying a client's own workers). client_id is optional: which client's work
-- the hours were for, for utilization visibility, not a payroll input.
CREATE TABLE IF NOT EXISTS v3_time_entries (
    time_entry_id VARCHAR(64) PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    entry_date DATE NOT NULL,
    client_id VARCHAR(64),
    client_name VARCHAR(255),
    hours NUMERIC(6,2) NOT NULL,
    description TEXT,
    status VARCHAR(255) NOT NULL DEFAULT 'Submitted',
    approved_by VARCHAR(255),
    approved_at TIMESTAMPTZ,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_time_entries_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL
);

-- ---- v3_Leave_Requests ----
CREATE TABLE IF NOT EXISTS v3_leave_requests (
    leave_request_id VARCHAR(64) PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    leave_type VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(255) NOT NULL DEFAULT 'Pending',
    approved_by VARCHAR(255),
    approved_at TIMESTAMPTZ,
    decision_note TEXT,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v3_Firm_Settings ----
-- Single-row table: the firm's own editable identity (name/address/phone/email/logo),
-- shown on generated PDFs, the reminder email header, and the app's own branding
-- (sidebar, login screen). Previously hardcoded in src/common/firmProfile.ts with no
-- UI to change it — this table is now the single source of truth; getFirmProfile()
-- falls back to those original hardcoded values if this table has no row yet.
CREATE TABLE IF NOT EXISTS v3_firm_settings (
    id VARCHAR(16) PRIMARY KEY DEFAULT 'FIRM-1',
    firm_name VARCHAR(255),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    street_address VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(255),
    zip_code VARCHAR(20),
    phone VARCHAR(255),
    email VARCHAR(255),
    logo_data TEXT,
    logo_content_type VARCHAR(100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by VARCHAR(255)
);

-- ---- Indexes ----
CREATE INDEX IF NOT EXISTS idx_tasks_client ON v3_tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON v3_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON v3_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON v3_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_client ON v3_payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON v3_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_document_requests_client ON v3_document_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_document_requests_status ON v3_document_requests(status);
CREATE INDEX IF NOT EXISTS idx_communications_client ON v3_communications(client_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON v3_users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON v3_users(role);
CREATE INDEX IF NOT EXISTS idx_employees_client ON v3_employees(client_id);
CREATE INDEX IF NOT EXISTS idx_payroll_input_client ON v3_payroll_input(client_id);
CREATE INDEX IF NOT EXISTS idx_paychecks_client ON v3_paychecks(client_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON v3_time_entries(user_email);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON v3_time_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON v3_leave_requests(user_email);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON v3_leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_client_secrets_client ON v3_client_secrets(client_id);
CREATE INDEX IF NOT EXISTS idx_secret_access_log_client ON v3_secret_access_log(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_module_record ON v3_audit_log(module, record_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_role ON v3_users(email, role);  -- duplicate portal users blocked per-role only (matches v16 rule)
