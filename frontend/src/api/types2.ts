/** Mirrors GET /system/options (legacy alTaxV3WebOptions) — every shared dropdown list in one call. */
export interface WebOptions {
  clients: { clientId: string; clientName: string; status: string }[];
  staff: string[];
  taskTypes: string[];
  immigrationFormTypes: string[];
  requestTypes: string[];
  requestedItems: string[];
  months: string[];
  priorities: string[];
  taskStatuses: string[];
  invoiceStatuses: string[];
  documentStatuses: string[];
  paymentMethods: string[];
  communicationChannels: string[];
  coaAccounts: string[];
}

export interface PortalUser {
  user_id: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  assigned_client_id: string | null;
  assigned_employee_id: string | null;
  reminder_preference: string | null;
  active: boolean;
  last_login: string | null;
  must_reset_password: boolean;
  invite_expires: string | null;
  has_pending_invite: boolean;
  assignment_label?: string;
  open_count?: number;
  overdue_count?: number;
  [key: string]: unknown;
}

export interface EmployeeOption {
  employee_id: string;
  employee_name: string;
  client_id: string;
  client_name: string;
}

export interface InvoiceLineItem {
  line_item_id: string;
  invoice_id: string;
  line_no: number;
  service_date: string | null;
  product_id: string | null;
  product_name: string | null;
  description: string | null;
  quantity: string | number;
  rate: string | number;
  amount: string | number;
  taxable: boolean;
  [key: string]: unknown;
}

export interface Invoice {
  invoice_id: string;
  client_id: string;
  invoice_date: string | null;
  due_date: string | null;
  description: string | null;
  total_amount: string | number;
  amount_paid: string | number;
  balance_due: string | number;
  status: string;
  pdf_link: string | null;
  terms?: string | null;
  customer_type?: string | null;
  bill_to?: string | null;
  ship_to?: string | null;
  ship_from?: string | null;
  payment_instructions?: string | null;
  client_note?: string | null;
  internal_note?: string | null;
  subtotal_amount?: string | number | null;
  discount_percent?: string | number | null;
  discount_amount?: string | number | null;
  taxable_subtotal?: string | number | null;
  sales_tax_rate?: string | number | null;
  sales_tax_amount?: string | number | null;
  shipping_amount?: string | number | null;
  deposit_amount?: string | number | null;
  ship_via?: string | null;
  shipping_date?: string | null;
  tracking_number?: string | null;
  lineItems?: InvoiceLineItem[];
  [key: string]: unknown;
}

export interface ProductService {
  product_id: string;
  name: string;
  category: string | null;
  description: string | null;
  rate: string | number;
  taxable: boolean;
  active: boolean;
  [key: string]: unknown;
}

export interface Payment {
  payment_id: string;
  invoice_id: string;
  payment_date: string | null;
  actual_amount: string | number;
  method: string | null;
  status: string;
  reversal_reason: string | null;
  [key: string]: unknown;
}

export interface DocumentRequest {
  request_id: string;
  task_id: string | null;
  client_id: string;
  client_name: string;
  requested_item: string;
  request_date: string | null;
  due_from_client: string | null;
  status: string;
  priority: string | null;
  request_type: string | null;
  direction: string | null;
  attachment_link: string | null;
  assigned_to: string | null;
  file_count?: number;
  first_file_name?: string | null;
  first_file_url?: string | null;
  [key: string]: unknown;
}

export interface DocumentUpload {
  upload_id: string;
  request_id: string | null;
  client_id: string;
  file_name: string;
  file_url: string;
  direction: string | null;
  status: string;
  uploaded_at: string | null;
  [key: string]: unknown;
}

export interface Communication {
  communication_id: string;
  client_id: string;
  client_name: string;
  related_task_id: string | null;
  direction: string;
  channel: string;
  subject: string;
  message_english: string | null;
  message_arabic: string | null;
  sent_to: string | null;
  sent_by: string;
  sent_at: string | null;
  status: string;
  [key: string]: unknown;
}

export interface TaxRate {
  tax_rate_row_id: string | number;
  rate_id: string;
  scope: string | null;
  client_id: string | null;
  client_name: string | null;
  rate_type: string;
  rate: string | number;
  employee_employer: string | null;
  wage_cap: string | number | null;
  state: string | null;
  active: boolean;
  notes: string | null;
  [key: string]: unknown;
}

export interface CoaAccount {
  account_id: string;
  account_name: string;
  account_type: string;
  detail_type: string | null;
  normal_balance: string | null;
  active: boolean;
  notes: string | null;
  opening_balance: string | number | null;
  current_balance: string | number | null;
  sub_account_of: string | null;
  tax_line: string | null;
  [key: string]: unknown;
}

export interface TaskRule {
  rule_id: string;
  task_type: string;
  trigger_column: string | null;
  trigger_value: string | null;
  frequency: string | null;
  active: boolean;
  [key: string]: unknown;
}

export interface TaskBatch {
  batch_id: string;
  rule_id: string;
  task_type: string;
  period_label: string;
  task_count: number;
  skipped_count: number;
  created_at: string | null;
  created_by: string | null;
  [key: string]: unknown;
}

export interface RecurringBilling {
  recurring_billing_id: string;
  client_id: string;
  client_name: string;
  description: string;
  amount: string | number;
  frequency: string;
  next_run_date: string | null;
  status: string;
  interval_count?: number | null;
  repeat_on_day?: number | null;
  [key: string]: unknown;
}

export interface VaultSecret {
  secret_id: string;
  category: string;
  jurisdiction: string | null;
  agency_name: string | null;
  label: string;
  portal_url: string | null;
  last4_hint: string | null;
  status: string;
  [key: string]: unknown;
}

export interface Employee {
  employee_id: string;
  employee_name: string;
  email: string | null;
  phone: string | null;
  pay_type: string | null;
  worker_type: string | null;
  form_type: string | null;
  status: string;
  default_gross_wages: string | number | null;
  pay_rate: string | number | null;
  default_hours: number | null;
  pay_frequency: string | null;
  service_category: string | null;
  address: string | null;
  street_address: string | null;
  city: string | null;
  zip_code: string | null;
  state: string | null;
  [key: string]: unknown;
}

export interface PaymentMethod {
  payment_method_id: string;
  method_name: string;
  method_type: string;
  bank_name: string | null;
  bank_last4: string | null;
  account_type: string | null;
  phone: string | null;
  card_brand: string | null;
  cardholder_name: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  status: string;
  default_for_payroll: boolean;
  default_for_invoices: boolean;
  [key: string]: unknown;
}
