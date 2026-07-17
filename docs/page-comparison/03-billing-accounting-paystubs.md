# Billing + Accounting + Paystubs — Legacy vs New App

## Summary

Across Billing, Accounting (Sales/Payroll/Contractors/JE/GL/Employees/Tax Rates/COA/Check Settings), and Paystubs, **193 legacy items** were inventoried: **54 Match**, **23 Partial**, **113 Missing**, and **2 New** (features in the new app with no legacy equivalent). The high Missing count is driven mostly by field-level detail (bank/payment fields, filing-status selects, deduction fields, table columns) rather than whole pages being absent — but a few whole features are gone outright. The single biggest gap is the **employee-facing Paystubs page, which the new app's own UI labels "isn't built yet — coming soon"** (data exists on the backend, screen not wired up). Other significant gaps: no per-invoice **Edit/Send/Delete Invoice**, no **Firm Invoice Payments** or **Client Tax Payment Tracking** tables on the Billing page, a much thinner **Payroll paycheck-creation form** (no deductions, bank/payment-method fields, overtime/bonus/commission pay, or withholding overrides), no dedicated **Contractor profile table** (W-9/TIN/service category/YTD paid all gone from the UI), no **Year-End Forms Review** (W-3/1096/Maryland summary, readiness/issue checks), and no **Manual JE history list** (only the entry form; nothing shows previously posted entries).

## Billing (Invoices List + Detail)

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Page banner/description | "Billing Workspace" eyebrow + explanatory copy about firm invoices vs. client tax tracking | Missing | InvoicesListPage.tsx | New page is just an `<h1>Billing</h1>` with no descriptive banner |
| Create Invoice button | Opens create-invoice modal | Match | InvoicesListPage.tsx | "New Invoice" button, inline form instead of modal |
| Sales Receipt button | Opens sales-receipt modal | Match | InvoicesListPage.tsx | Inline form instead of modal |
| Record Payment (shortcut) | Header button opens a picker to record a payment against any invoice without navigating to it | Missing | — | New app requires opening a specific invoice's detail page first |
| Add Recurring button | Opens add-recurring-billing modal | Match | InvoicesListPage.tsx (Recurring Billing tab) | Inline form instead of modal |
| Run Due Billing button | Runs recurring billing engine, reports created/skipped/errors | Match | InvoicesListPage.tsx (Recurring Billing tab) | Same result summary text pattern |
| Firm Invoices table — Invoice # column | | Match | InvoicesListPage.tsx | |
| Firm Invoices table — Client column | | Match | InvoicesListPage.tsx | |
| Firm Invoices table — Invoice Date column | | Missing | InvoicesListPage.tsx | Not shown in the list table (only on detail page) |
| Firm Invoices table — Due Date column | | Missing | InvoicesListPage.tsx | Not shown in the list table (only on detail page) |
| Firm Invoices table — Description column | | Missing | InvoicesListPage.tsx | Not shown in the list table (only on detail page) |
| Firm Invoices table — Amount column | | Match | InvoicesListPage.tsx | |
| Firm Invoices table — Balance column | | Match | InvoicesListPage.tsx | |
| Firm Invoices table — Status column | | Match | InvoicesListPage.tsx / StatusBadge | |
| Status filter (dropdown) on Billing list | | Missing | InvoicesListPage.tsx | No filter/search UI at all on the list |
| Search box on Billing list | | Missing | InvoicesListPage.tsx | |
| Period date-range filter | Global date picker scopes which invoices display | Missing | InvoicesListPage.tsx | New list always shows all invoices |
| Row action: View Invoice | | Match | InvoiceDetailPage.tsx | Row click navigates to detail page instead of opening a modal |
| Row action: Print Invoice (PDF) | | Match | InvoiceDetailPage.tsx | "Print PDF" button, direct download |
| Row action: View Statement | Inline HTML preview modal | Partial | InvoicesListPage.tsx | Statement is generated as a PDF download only; no in-page preview |
| Row action: Print Statement | | Partial | InvoicesListPage.tsx | Folded into "Print Statement" PDF download; no print-preview-then-print modal flow |
| Row action: Generate PDF (statement) | | Match | InvoicesListPage.tsx | Statement-of-account section with client + date-range picker |
| Row action: Send Invoice (email to client) | | Missing | — | No send/email action anywhere in the new app |
| Row action: Edit Invoice | Edit date, due date, description, total, paid, status, PDF link | Missing | — | No edit route or modal exists |
| Row action: Record Payment | | Match | InvoiceDetailPage.tsx | Present on detail page, not as a row action |
| Row action: Void Invoice | | Match | InvoiceDetailPage.tsx | |
| Row action: Delete Invoice | | Missing | — | No delete capability anywhere |
| Create Invoice modal — Invoice Date field | | Missing | InvoicesListPage.tsx | New form only has Client, Description, Total Amount, Due Date |
| Create Invoice modal — Amount Paid field | | Missing | InvoicesListPage.tsx | |
| Create Invoice modal — Status dropdown | | Missing | InvoicesListPage.tsx | Always defaults; can't set on create |
| Create Invoice modal — PDF Link field | | Missing | InvoicesListPage.tsx | |
| Sales Receipt modal — Payment Profile select | | Missing | InvoicesListPage.tsx | |
| Sales Receipt modal — Bank Name/Account Type/Routing/Account/Last4 fields | | Missing | InvoicesListPage.tsx | |
| Sales Receipt modal — Confirmation # field | | Missing | InvoicesListPage.tsx | |
| Sales Receipt modal — Notes field | | Missing | InvoicesListPage.tsx | |
| Sales Receipt modal — Client/Date/Amount/Description/Method | | Match | InvoicesListPage.tsx | Method list is shorter (Manual/Check/ACH/Credit Card/Cash vs. legacy Cash/Check/Zelle/Card/ACH/Wire/Other) |
| Record Payment modal — Payment Date field | | Missing | InvoiceDetailPage.tsx | New form has Amount + Method only |
| Record Payment modal — Payment Profile select | | Missing | InvoiceDetailPage.tsx | |
| Record Payment modal — Bank Name/Account Type/Routing/Account/Last4 fields | | Missing | InvoiceDetailPage.tsx | |
| Record Payment modal — Confirmation # field | | Missing | InvoiceDetailPage.tsx | |
| Record Payment modal — Notes field | | Missing | InvoiceDetailPage.tsx | |
| Reverse Payment | | New | InvoiceDetailPage.tsx | Not present as a UI action in legacy; new app adds a "Reverse" button with reason prompt |
| Recurring Billing table — Client/Description/Amount/Frequency/Next Run/Status | | Match | InvoicesListPage.tsx (Recurring Billing tab) | |
| Recurring Billing table — Due (status pill / days countdown) column | | Missing | InvoicesListPage.tsx | |
| Recurring Billing table — Due Days column | | Missing | InvoicesListPage.tsx | Field exists in create form but not shown in list |
| Recurring Billing table — Auto (Invoice/Email flags) column | | Missing | InvoicesListPage.tsx | |
| Recurring Billing — Edit Schedule action | | Missing | InvoicesListPage.tsx | Only "Archive" action exists; no edit |
| Recurring Billing — Archive Schedule action | | Match | InvoicesListPage.tsx | |
| Recurring Billing create form — End Date field | | Missing | InvoicesListPage.tsx | |
| Recurring Billing create form — Payment Profile select | | Missing | InvoicesListPage.tsx | |
| Recurring Billing create form — Auto Create/Auto Send selects | | Missing | InvoicesListPage.tsx | |
| Recurring Billing create form — Notes field | | Missing | InvoicesListPage.tsx | |
| Firm Invoice Payments table (recent payments across all invoices: Payment/Invoice/Client/Date/Amount/Method/Status) | | Missing | — | No equivalent list anywhere in new app |
| Client Tax Payment Tracking table (separate tax-payment rows: Payment/Due, Client, Related Task, Due/Paid, Expected, Paid, Method, Status) | | Missing | — | No equivalent list anywhere in new app |
| Invoice preview document (firm letterhead, Bill To box, line items, totals, payment instructions) | | Partial | InvoiceDetailPage.tsx (Print PDF) | Exists only as a generated PDF; no in-app HTML preview/modal before printing |
| Statement of Account document (client info, statement summary cards, invoice activity table) | | Partial | InvoicesListPage.tsx | PDF-only, no in-app preview |

## Accounting — Sales Tax Input

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Date field | | Match | AccountingPage.tsx (Sales tab) | |
| Gross Sales field | | Match | AccountingPage.tsx (Sales tab) | |
| Taxable @ 6% field | | Match | AccountingPage.tsx (Sales tab) | |
| Special @ 12% field | | Match | AccountingPage.tsx (Sales tab) | |
| Vape @ 20% field | | Match | AccountingPage.tsx (Sales tab) | |
| 60% Rate Sales field | | Match | AccountingPage.tsx (Sales tab) | |
| Adjustments field | | Match | AccountingPage.tsx (Sales tab) | |
| Payment Date field | | Match | AccountingPage.tsx (Sales tab) | |
| Notes field | | Match | AccountingPage.tsx (Sales tab) | |
| Live calculation strip (Estimated Tax, Rows This Period, Period Sales, Period Tax) | | Missing | AccountingPage.tsx (Sales tab) | No live preview totals shown before/after save |
| Save Sales Input button | | Match | AccountingPage.tsx (Sales tab) | |
| Recent Sales table (Date/Gross/Tax Due/Payment/Notes) | | Match | AccountingPage.tsx (Sales tab) | |
| Recent Sales — Edit action | | Match | AccountingPage.tsx (Sales tab) | Inline edit card instead of modal |
| Recent Sales — Delete action | | Missing | AccountingPage.tsx (Sales tab) | No delete button, only Edit |
| Period date-range filter on sales rows | Global period picker limits which rows show | Missing | AccountingPage.tsx (Sales tab) | Shows all rows for the client, unfiltered by period |

## Accounting — Payroll / Paychecks

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Pay Date field | | Match | AccountingPage.tsx (Payroll tab) | |
| Period Start / Period End fields | | Missing | AccountingPage.tsx (Payroll tab) | |
| Employee select | | Match | AccountingPage.tsx (Payroll tab) | |
| Check Number field | | Missing | AccountingPage.tsx (Payroll tab) | |
| Payment Profile select | | Missing | AccountingPage.tsx (Payroll tab) | |
| Pay Type select (Hourly/Salary/Other) | | Missing | AccountingPage.tsx (Payroll tab) | |
| Regular Hours / Regular Rate fields | | Match | AccountingPage.tsx (Payroll tab) | |
| Overtime Hours / Overtime Rate fields | | Missing | AccountingPage.tsx (Payroll tab) | |
| Bonus Pay field | | Missing | AccountingPage.tsx (Payroll tab) | |
| Commission Pay field | | Missing | AccountingPage.tsx (Payroll tab) | |
| Other Taxable Pay field | | Missing | AccountingPage.tsx (Payroll tab) | |
| Non-taxable Reimbursement field | | Missing | AccountingPage.tsx (Payroll tab) | |
| Gross Wages Override field | | Match | AccountingPage.tsx (Payroll tab) | Labeled "Or Gross Wages (overrides hours × rate)" |
| Payment Method select + Bank Name/Account Type/Routing/Account/Last4 | | Missing | AccountingPage.tsx (Payroll tab) | No bank/payment-method fields on paycheck creation |
| Pre-tax Retirement / Pre-tax Health / HSA-FSA fields | | Missing | AccountingPage.tsx (Payroll tab) | |
| Post-tax Deduction / Garnishment / Other Deduction fields | | Missing | AccountingPage.tsx (Payroll tab) | |
| Federal Withholding override field | | Missing | AccountingPage.tsx (Payroll tab) | |
| MD Withholding / State Tax override field | | Missing | AccountingPage.tsx (Payroll tab) | |
| Notes field | | Missing | AccountingPage.tsx (Payroll tab) | |
| Live calculation strip (Gross/Taxable Wages/Deductions/Employee Taxes/Net Pay/Total Cost) | | Partial | AccountingPage.tsx (Payroll tab) | Only shown as a post-save result card (Gross/Employee taxes/Net), not a live pre-save preview, and missing Taxable Wages/Total Cost |
| Create Paycheck button | | Match | AccountingPage.tsx (Payroll tab) | |
| Add Employee (inline) button | | Missing | AccountingPage.tsx (Payroll tab) | Must switch to Employees tab |
| Payroll Period summary strip (Gross Wages/Net Pay/Employee Taxes/Deductions/Checks) | | Missing | AccountingPage.tsx (Payroll tab) | |
| Paychecks table — Period column | | Missing | AccountingPage.tsx (Payroll/Paychecks tabs) | |
| Paychecks table — Check # column | | Missing | AccountingPage.tsx (Payroll/Paychecks tabs) | |
| Paychecks table — Status column | | Missing | AccountingPage.tsx (Paychecks tab) | |
| Paychecks table — Printed (timestamp) column | | Missing | AccountingPage.tsx (Paychecks tab) | |
| Paychecks table — Employee Taxes / Employer Taxes / Total Cost columns | | Match | AccountingPage.tsx (Paychecks tab) | Present on the separate Paychecks tab table |
| Paycheck action: Edit Paycheck | | Match | AccountingPage.tsx (Paychecks tab) | Inline edit card (Pay Date, Hours, Rate, Gross override) |
| Paycheck action: View Paystub (preview) | | Missing | AccountingPage.tsx (Paychecks tab) | No separate paystub-preview action |
| Paycheck action: Print Paystub | | Partial | AccountingPage.tsx (Paychecks tab) | Single generic "Print" button; unclear if it's a paystub or a check |
| Paycheck action: Print Check Only | | Missing | AccountingPage.tsx (Paychecks tab) | No separate check-only print |
| Paycheck action: Print Check + Stub | | Missing | AccountingPage.tsx (Paychecks tab) | No separate check+stub print |
| Paycheck action: Delete Paycheck | | Missing | AccountingPage.tsx (Paychecks tab) | |
| Separate raw "Payroll Input" table (Input ID/Date/Check#/Employee/Gross) with Edit/Delete | | Missing | — | New app has no distinct payroll-input-vs-paycheck record view |

## Accounting — Contractor Payments / 1099

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Contractor profile table (Contractor/Tax Form/Tax ID masked/W-9/TIN Check/Service/Payment Type/Default Amount/YTD Paid/Pay Method/Email/Status) | | Missing | — | No dedicated contractors profile table; Employees tab list shows only Name/Type/Pay Type/Rate/Status for both worker types combined |
| Contractor action: Pay Contractor | | Match | AccountingPage.tsx (Contractors tab) | "Record Contractor Payment" form |
| Contractor action: Create 1099 | | Partial | AccountingPage.tsx (Contractors tab) | Direct "Print 1099-NEC" PDF download; no preview modal, no readiness/issue check |
| Contractor action: Edit Contractor | | Missing | AccountingPage.tsx (Employees tab) | No dedicated edit; only "Archive" |
| Contractor action: Archive Contractor | | Match | AccountingPage.tsx (Employees tab) | Generic Archive shared with employees |
| Contractor action: Delete Contractor | | Missing | — | |
| Pay Contractor modal — Payment Date / Amount | | Match | AccountingPage.tsx (Contractors tab) | |
| Pay Contractor modal — Payment Profile select | | Missing | AccountingPage.tsx (Contractors tab) | |
| Pay Contractor modal — Method (full list: Check/ACH/Zelle/Cash/Card/Other) | | Partial | AccountingPage.tsx (Contractors tab) | New has only Check/ACH/Cash |
| Pay Contractor modal — Expense Category (dropdown of COA accounts + presets) | | Partial | AccountingPage.tsx (Contractors tab) | Free-text field instead of a dropdown |
| Pay Contractor modal — 1099 Eligible select | | Missing | AccountingPage.tsx (Contractors tab) | |
| Pay Contractor modal — Check # field | | Missing | AccountingPage.tsx (Contractors tab) | |
| Pay Contractor modal — Confirmation # field | | Missing | AccountingPage.tsx (Contractors tab) | |
| Pay Contractor modal — Bank Name/Account Type/Routing/Account/Last4 | | Missing | AccountingPage.tsx (Contractors tab) | |
| Pay Contractor modal — Memo field | | Match | AccountingPage.tsx (Contractors tab) | |
| Recent Payments table — Date/Contractor/Amount/Method | | Match | AccountingPage.tsx (Contractors tab) | |
| Recent Payments table — Category/1099-eligible/Memo columns | | Missing | AccountingPage.tsx (Contractors tab) | Not shown in the list (Category/Memo only visible via Edit) |
| Recent Payments — View Payment (read-only) modal | | Missing | AccountingPage.tsx (Contractors tab) | |
| Recent Payments — Edit Payment | | Match | AccountingPage.tsx (Contractors tab) | Inline edit card |
| Recent Payments — Delete Payment | | Missing | AccountingPage.tsx (Contractors tab) | |
| Employee profile fields specific to contractors (W-9 Status, TIN Verification, Vendor Classification, Service Category, 1099 Eligible, Contractor Payment Type, Default Amount/Rate) | | Partial | AccountingPage.tsx (Employees tab, Add form) | Only Service Category present; W-9/TIN/Vendor Classification/1099 Eligible/Payment Type all missing |

## Accounting — Manual JE / GL

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Entry Date field | | Match | AccountingPage.tsx (Manual JE tab) | |
| Reference field | | Missing | AccountingPage.tsx (Manual JE tab) | |
| Description field | | Match | AccountingPage.tsx (Manual JE tab) | |
| JE line — Account (dropdown of COA account names) | | Partial | AccountingPage.tsx (Manual JE tab) | Free-text input instead of a COA-driven dropdown |
| JE line — Debit / Credit / Memo | | Match | AccountingPage.tsx (Manual JE tab) | |
| Add Line button | | Match | AccountingPage.tsx (Manual JE tab) | |
| Remove any individual line (✕ per row) | | Partial | AccountingPage.tsx (Manual JE tab) | Only "Remove Last Line" is available, not per-row removal |
| Live Debit/Credit/Difference totals | | Match | AccountingPage.tsx (Manual JE tab) | Shown as Debits/Credits + Balanced/Out-of-balance indicator |
| Notes field | | Missing | AccountingPage.tsx (Manual JE tab) | |
| Save Journal Entry button | | Match | AccountingPage.tsx (Manual JE tab) | "Post Journal Entry"; disabled until balanced (legacy allows save attempt and validates server-side) |
| Recent Manual Entries table (Date/Ref/Account/Debit/Credit) | | Missing | AccountingPage.tsx (Manual JE tab) | No history list of previously posted entries at all — only a one-time post-submit success message |
| GL — Debits/Credits/Difference/Period calculation strip | | Missing | AccountingPage.tsx (GL tab) | |
| GL table — Date/Ref/Description/Account/Debit/Credit/Source | | Partial | AccountingPage.tsx (GL tab) | Missing the Ref column |
| GL — period date-range filter | | Missing | AccountingPage.tsx (GL tab) | Shows all entries (up to 60), not period-scoped |
| GL — row limit/behavior | Shows last 50, most recent first | Partial | AccountingPage.tsx (GL tab) | Shows first 60 rows returned (not clearly most-recent-first), with a "Showing 60 of N" note |

## Accounting — Employees/Contractors, Tax Rates, COA, Check Settings

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Employees table — Employee/Pay Type/Frequency/Rate/Hours/Pay Method/Email/Status | | Partial | AccountingPage.tsx (Employees tab) | New table only has Name/Type/Pay Type/Rate/Status — missing Frequency, Hours, Pay Method, Email columns |
| Employees table — Edit Employee action | | Missing | AccountingPage.tsx (Employees tab) | No edit; only Archive |
| Employees table — Archive Employee action | | Match | AccountingPage.tsx (Employees tab) | |
| Employees table — Delete Employee action | | Missing | AccountingPage.tsx (Employees tab) | |
| Add/Edit Employee modal — Client (readonly), Name, Email, Phone | | Match | AccountingPage.tsx (Employees tab, Add form) | |
| Add/Edit Employee modal — Address field | | Missing | AccountingPage.tsx (Employees tab) | |
| Add/Edit Employee modal — Worker Type select | | Match | AccountingPage.tsx (Employees tab) | |
| Add/Edit Employee modal — Tax Form select (W-2/1099-NEC/Other) | | Missing | AccountingPage.tsx (Employees tab) | |
| Add/Edit Employee modal — SSN/TIN and EIN fields | | Missing | AccountingPage.tsx (Employees tab) | |
| Add/Edit Employee modal — Pay Type/Hourly Rate/Default Hours/Default Gross Wages/Pay Frequency | | Match | AccountingPage.tsx (Employees tab) | Pay Frequency is free text instead of a fixed dropdown |
| Add/Edit Employee modal — Federal/State Filing Status selects | | Missing | AccountingPage.tsx (Employees tab) | |
| Add/Edit Employee modal — Payment Method select | | Missing | AccountingPage.tsx (Employees tab) | |
| Add/Edit Employee modal — Direct Deposit Y/N | | Missing | AccountingPage.tsx (Employees tab) | |
| Add/Edit Employee modal — Bank Name/Account Type/Routing/Account/Confirm Account/Last4 | | Missing | AccountingPage.tsx (Employees tab) | |
| Add/Edit Employee modal — Status select (Active/Inactive) | | Missing | AccountingPage.tsx (Employees tab) | Status only changes via the Archive action |
| Add/Edit Employee modal — Notes field | | Missing | AccountingPage.tsx (Employees tab) | |
| Employee portal invite (auto-generated on save, shown in result modal) | | Partial | AccountingPage.tsx (Employees tab) | New requires an opt-in "Grant portal access" checkbox rather than being automatic; invite link shown inline instead of a separate modal |
| Print W-2 (individual) | | Partial | AccountingPage.tsx (Employees tab) | Direct PDF download by tax year; legacy offers this via the consolidated Year-End Forms Review with a preview and readiness/issue check first |
| Tax Rates table — Rate ID, Scope, Client, Rate Type, Rate, Side, Wage Cap, State, Active, Notes | | Partial | AccountingPage.tsx (Tax Rates tab) | New table only shows Rate Type/Scope/Rate/Active — missing Rate ID, Client, Side, Wage Cap, State, Notes columns |
| Tax Rates — Add Tax Rate | | Partial | AccountingPage.tsx (Tax Rates tab) | Form only has Rate Type (free text), Rate, Scope (Global/Client) — no actual client picker when "Client" scope is chosen, no Side/Wage Cap/State/Notes/Rate ID fields |
| Tax Rates — Edit Rate | | Missing | AccountingPage.tsx (Tax Rates tab) | |
| Tax Rates — Assign to Client | | Missing | AccountingPage.tsx (Tax Rates tab) | |
| Tax Rates — Copy as Global | | Missing | AccountingPage.tsx (Tax Rates tab) | |
| Tax Rates — Activate/Deactivate Rate | | Partial | AccountingPage.tsx (Tax Rates tab) | Only Deactivate exists, no Activate for a deactivated rate |
| Tax Rates — Delete Rate | | Missing | AccountingPage.tsx (Tax Rates tab) | |
| COA table — Account #, Account Name, Type, Detail Type, Normal Balance, current Balance, Active | | Partial | AccountingPage.tsx (COA tab) | New table only shows Account/Type/Normal Balance/Active — missing Account #, Detail Type, and the calculated running Balance column |
| COA — Add Account form (Account #, Name, Type, Detail Type, Normal Balance, Opening Balance, Sub-account Of, Tax Line, Active, Description) | | Partial | AccountingPage.tsx (COA tab) | New form only has Account Name, Account Type, Normal Balance |
| COA — Edit Account | | Missing | AccountingPage.tsx (COA tab) | |
| Check Settings — Check Position, Paper Stock, MICR X/Y, Date X/Y, Payee X/Y, Amount X/Y, Memo X/Y, Signature X/Y, Notes | | Match | AccountingPage.tsx (Check Settings tab) | All fields present (Check Position gains a "Middle" option not in legacy) |
| Check Settings — Save Check Settings | | Match | AccountingPage.tsx (Check Settings tab) | |
| MICR Calibration tool (printable alignment sample sheet) | | Missing | — | No print-sample/calibration tool in new app |
| Check Designer tool (live bottom-check layout preview) | | Missing | — | No check preview/design tool |
| Payment Methods management (per-client ACH/check bank profiles) | | Partial | ClientDetailPage.tsx | Relocated from Accounting/Financial to the Client Detail page; missing Account Type, Use For Payroll/Invoices flags, Default flags, Status, Notes fields, and there is no Edit (only Add/Delete) |
| Year-End Forms Review panel (Tax Year selector, Refresh, W-2/1099-NEC form & wage-total calculation strip, standards table for IRS/SSA/Maryland) | | Missing | — | No consolidated year-end review screen |
| Year-End — W-3 Summary / 1096 Summary / Maryland Summary buttons | | Missing | — | No equivalent summary reports |
| Year-End — W-2 Review table (Employee/SSN/Wages/Fed Tax/MD Tax/Source/Status/Review issues/Preview) | | Missing | — | Replaced by a simple per-employee "Print W-2" button with no readiness/issue detection |
| Year-End — 1099-NEC Review table (Contractor/TIN/NEC/Fed Tax/MD Tax/Source/Status/Review issues/Preview) | | Missing | — | Replaced by a simple per-contractor "Print 1099-NEC" button with no readiness/issue detection |
| Month-End Close Checklist | | New | AccountingPage.tsx (Month-End tab) | No legacy equivalent found anywhere in renderAccounting or elsewhere in Index.html; appears to be a new feature |

## Paystubs

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| "My Paystubs" page/header with paystub count | | Missing | — | New app's Employee Portal command view literally states: "Employee paystub view isn't built yet — coming soon." |
| Paystubs table — Pay Date column | | Missing | — | |
| Paystubs table — Period (start–end) column | | Missing | — | |
| Paystubs table — Check # column | | Missing | — | |
| Paystubs table — Employer column | | Missing | — | |
| Paystubs table — Gross column | | Missing | — | |
| Paystubs table — Taxes column | | Missing | — | |
| Paystubs table — Net column | | Missing | — | |
| Action: View Paystub | | Missing | — | |
| Action: Print Paystub | | Missing | — | |
| Employee detail sidebar — Profile (Email, Employer, Employee ID) | | Missing | — | New app's Employee Portal shows only a name and a generic "Messages" link |
| Employee detail sidebar — Pay summary (Paystub count, Latest date, Net Pay) | | Missing | — | |
| Explicit backend readiness note | The new app's own placeholder text confirms: "The backend has your paycheck data ready; this screen just isn't wired up to it yet." | — | DashboardPage.tsx (EmployeeCommand) | Confirms this is a known, acknowledged gap rather than an oversight |
