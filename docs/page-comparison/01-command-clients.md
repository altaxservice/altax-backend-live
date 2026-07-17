# Command Center + Clients — Legacy vs New App

## Summary
160 legacy items reviewed: 41 exact match, 24 partial, 94 missing, 1 new-in-app item noted separately (Client Detail Panel field count is large because the legacy "Edit Client" form alone has ~30 fields).

**Legacy source traced:** `renderCommand()` (L7915) → `renderStaffCommand`, `renderClientCommand`, `renderEmployeeCommand` (role variants) → `commandPanel`, `commandTaskList`/`commandTaskCard`, `commandAttentionList`, `commandDocumentList`/`commandDocumentCard`, `commandInvoiceList`/`commandInvoiceCard`, `commandMiniKpis`, `commandTaskActions`, `commandInvoiceActions` (L7745–7985); `renderClients()` (L8097) → `clientRows`, `clientContactHtml`, `clientResponsibleHtml`, `clientTypeLabel`, `clientMatchesFocus`, plus the shared `renderFilters()` (L6549) and `renderSummary()` (L6417) chrome that wraps every view; `renderDetail()` (L11920, the client branch) plus the fuller `openClientProfileModal` (L19110), `openAddClientModal`/`openEditClientModal`/`clientProfileFormHtml` (L18801–19104), and `renderClientSecureVault` + related vault functions (L8695–9109) reached from client actions.

**New app source traced:** `frontend/src/pages/DashboardPage.tsx` (full file), `frontend/src/pages/ClientsListPage.tsx` (full file), `frontend/src/pages/ClientDetailPage.tsx` (full file), plus `frontend/src/api/types.ts` for the `Client`/`Task` shape and `frontend/src/components/CreateModal.tsx` for the global "Create" shortcut menu.

---

## Command Center (Dashboard)

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Active Clients metric | KPI card: count of active clients / total records | Match | `DashboardPage.tsx` `AdminCommand` metric-grid | Same label, value, and sub-note |
| Open Tasks metric | KPI card: open task count / overdue sub-note | Match | `AdminCommand` metric-grid | |
| Unpaid Balance metric | KPI card: total unpaid invoice balance | Match | `AdminCommand` metric-grid | |
| Open Requests metric | KPI card: open document request count | Match | `AdminCommand` metric-grid | |
| Priority Work Queue panel | Panel listing up to 12 open tasks | Match | `AdminCommand` → `CommandPanel`/`TaskRows` | Panel exists; see reduced row fields below |
| Task card — Task Name | Task/service line title | Match | `TaskRows` | |
| Task card — Client Name | Client name | Match | `TaskRows` | |
| Task card — Service Line tag | Secondary meta tag showing service line | Missing | `TaskRows` | Not rendered |
| Task card — Assigned To | Staff assignee shown in card meta | Missing | `TaskRows` | Not rendered |
| Task card — Due date | Formatted agency due date | Match | `TaskRows` | |
| Task card — Overdue/Due Soon pill (`dueLabel`) | Distinct colored pill for overdue vs. due-soon vs. plain day count | Missing | `TaskRows` | Only status badge shown, no due-urgency pill |
| Task card — inline editable Status dropdown | `<select>` to change task status directly from the card | Missing | `TaskRows` | Row instead navigates to task detail on click |
| Task card — file attachment cell | "Open Attachment" link / file name | Missing | `TaskRows` | |
| Task card — action menu | Dropdown: Review Task, Send Message, Add Note, Review Notes/Messages, Edit Task, Files, Void Task, Document Request, Delete Task Row (admin) | Missing | `TaskRows` | No per-row action menu; click navigates to `/tasks/:id` instead |
| Today Snapshot panel | Mini-KPI grid: Overdue / Due Soon / Waiting / Open Tasks | Match | `AdminCommand` → `MiniKpis` | |
| Needs Attention panel | Combined overdue+due-soon list (up to 6) | Partial | `AdminCommand` → `TaskRows` | Same items shown, but reuses the same reduced `TaskRows` (no distinct due-urgency pill, no service line) |
| Document Requests panel | Panel listing up to 6 open document requests | Match | `AdminCommand` → `DocumentRows` | Panel exists; see reduced row fields below |
| Doc card — Requested Item | Title of requested item | Match | `DocumentRows` | |
| Doc card — Client Name | Client name | Match | `DocumentRows` | |
| Doc card — Due From Client date | Due date meta | Missing | `DocumentRows` | |
| Doc card — Assigned To | Staff assignee meta | Missing | `DocumentRows` | |
| Doc card — file count indicator | "N file(s)" / "No files" meta | Missing | `DocumentRows` | |
| Doc card — Status pill | Status badge | Match | `DocumentRows` | |
| Doc card — action menu | Dropdown: Upload/Share File, Edit, View File, Open File | Missing | `DocumentRows` | Click navigates to `/documents/:id` instead |
| Billing Watch panel | Panel listing up to 8 unpaid invoices | Match | `AdminCommand` → `InvoiceRows` | Panel exists; see reduced row fields below |
| Invoice card — Description/title | Invoice description or ID as title | Missing | `InvoiceRows` | Only invoice ID shown |
| Invoice card — Client Name | Client name | Missing | `InvoiceRows` | Not shown in the row at all |
| Invoice card — Invoice ID | Invoice ID | Match | `InvoiceRows` | |
| Invoice card — Due Date | Invoice due date | Missing | `InvoiceRows` | |
| Invoice card — Balance Due | Dollar balance | Match | `InvoiceRows` | |
| Invoice card — Status pill | Status badge | Match | `InvoiceRows` | |
| Invoice card — action menu | Dropdown: View/Print Invoice, View Statement, Send Invoice (admin), Record Payment (admin), Edit Invoice (admin) | Missing | `InvoiceRows` | Click navigates to `/billing/:id` instead |
| Staff Portal banner + description | Eyebrow/heading/paragraph for staff role | Match | `StaffCommand` | Wording near-identical, drops "accounting workbooks" phrase but keeps the link |
| Staff Portal quick actions | Buttons: Documents, Messages, Client Workbooks | Match | `StaffCommand` | |
| Staff My Work Queue / Due Soon / Waiting-Pending panels | Three task panels scoped to staff | Match | `StaffCommand` | |
| Client Portal banner + description | Eyebrow/heading/paragraph for client role | Partial | `ClientCommand` | Legacy text mentions "documents, invoices, reports, and messages"; new text drops "reports" |
| Client Portal quick actions | Buttons: Documents, Billing, Messages | Match | `ClientCommand` | |
| Client Portal Document Requests / Open Invoices panels | Two panels for client role | Match | `ClientCommand` | |
| Employee Portal banner + quick actions | Eyebrow/heading + Open Paystubs/Messages buttons | Partial | `EmployeeCommand` | Banner/buttons render, but "Open Paystubs" link has no working destination |
| Employee Latest Paystub card | Calculation strip (Gross, Employee Taxes, Net Pay, Employer) + "View Paystub" button | Missing | `EmployeeCommand` | Replaced entirely with a "coming soon" placeholder message; no paystub data shown even though backend has it |

---

## Clients List

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Search box | Global search input filters the client list (name, ID, email, phone, etc. via `matchesQuery`) | Partial | `ClientsListPage.tsx` search input | New search only matches `client_name`, `client_id`, `email`, `assigned_to` — narrower field coverage |
| Status filter dropdown | Filter by Active/Inactive/Archived (dynamic from data) | Missing | — | Not present; status only visible as a badge per row |
| Owner filter dropdown | Filter by assigned staff owner | Missing | — | |
| Type filter dropdown | Filter by client type | Missing | — | |
| Service filter dropdown | Filter by service type | Missing | — | |
| Client quick-focus tabs | All / Active / Business / Individual / Payroll / Sales Tax / Portal one-click filters | Missing | — | |
| Refresh button | Manually re-pull data | Missing | — | |
| Export CSV button | Export currently filtered list to CSV | Missing | — | |
| Add Client button | Opens client creation form | Partial | `ClientsListPage.tsx` "Add Client" button | Present, but permission is broadened: legacy restricts to Admin only, new app allows Admin **or** Staff |
| Table title ("Client Master" / "My Client List") | Dynamic table heading by role | Missing | — | New page just shows static "Clients" h1 |
| Result count note | "{n} clients" | Match | `ClientsListPage.tsx` footer text | Shown as "{filtered} of {total} clients" below the table instead of in a table header, same info |
| Column: Client (name + ID subtext) | Two-line cell with name and Client ID | Partial | table `<th>Name</th>` | Only name shown; Client ID is not visible anywhere in the list |
| Column: Type (ClientType + EntityType subtext) | Two-line cell | Partial | `<th>Entity Type</th>` | Only a single Entity Type value shown, not the ClientType/EntityType pair |
| Column: Contact (email + phone) | Two-line cell with mailto link and phone | Missing | — | No contact info column in the new table at all |
| Column: Responsible (company contact/SSN or Individual + masked SSN) | Two-line cell | Missing | — | |
| Column: Owner / Assigned To | Staff owner | Match | `<th>Assigned To</th>` | |
| Column: Service Type | e.g. Full Service | Missing | — | |
| Column: Sales Tax Frequency | e.g. Monthly/Quarterly/N-A | Missing | — | |
| Column: Payroll Frequency | e.g. Bi-weekly/N-A | Missing | — | |
| Column: Status | Status pill | Match | `<th>Status</th>` (`StatusBadge`) | |
| Column: Portal | Portal enabled Yes/No | New | `<th>Portal</th>` | No direct legacy list column (legacy shows Portal status only inside the profile modal); flagged as new-in-app, not a gap |
| Column: Actions (row action menu) | Dropdown of row-level actions (see below) | Missing | — | Entire Actions column absent |
| Sortable column headers | Click column header to sort (`sortableHeader`) | Missing | — | New table headers are static, not sortable |
| Row click behavior | Legacy opens a right-hand quick-view slide panel; row action "Profile" opens a full modal | Partial | row `onClick` → navigate to `/clients/:id` | New app collapses both into one full detail page navigation — functionally similar end result, different interaction pattern |
| Row action: Profile | Opens full client profile modal | Partial | — | Superseded by full-page navigation on row click |
| Row action: Create Task | Opens task-creation modal pre-scoped to this client | Missing | — | |
| Row action: Request Document | Opens document request modal pre-scoped to this client | Missing | — | |
| Row action: Upload Document | Opens upload modal pre-scoped to this client | Missing | — | |
| Row action: Review Documents | Opens document review list for this client | Missing | — | |
| Row action: Secure Vault (admin) | Opens password-gated secure vault for this client | Partial | — | Not available from the list row; exists as a section on the Client Detail page instead |
| Row action: Send Portal Invitation (admin) | Sends/queues client portal invite | Missing | — | No equivalent tied to a client row anywhere in the app (portal invites live only on the separate Users/Security page, not client-scoped) |
| Row action: Edit Client | Opens edit form | Partial | — | Not on the list row; moved to an "Edit" button on the Client Detail page |
| Row action: Archive Client (admin) | Archives client, disables portal | Partial | — | Not on the list row; moved to an "Archive" button on the Client Detail page |
| Row action: Delete Client Row (admin) | Hard-deletes the client row with a typed "DELETE CLIENT" confirmation | Missing | — | No hard-delete capability found anywhere in the new app |
| Add Client form — field completeness | Opens `clientProfileFormHtml` with ~30 fields across 4 sections | Partial | `ClientsListPage.tsx` inline create form | New create form has only 7 fields (Client Name, Entity Type, Status, Email, Phone, State, Assigned To); see Client Detail Panel table below for the full field-by-field breakdown (Add and Edit share the same legacy field set) |

---

## Client Detail Panel

*Legacy client-detail surface combines the slide-over quick panel (`renderDetail`), the full profile modal (`openClientProfileModal`), the Add/Edit form (`clientProfileFormHtml`), and the Secure Vault modal (`renderClientSecureVault`) — all reached from a client record. The new app consolidates all of this into one page, `ClientDetailPage.tsx`.*

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Client ID | Shown as an eyebrow tag / identity field | Missing | `ClientDetailPage.tsx` | Client ID is never displayed on the page (only present in the URL) |
| Client Name (header) | Page/panel title | Match | `<h1>` | |
| Status pill | Status badge | Match | `StatusBadge` | |
| Email | Contact field | Match | Profile card `DetailRow` | |
| Phone | Contact field | Match | Profile card `DetailRow` | |
| Address | Contact field | Missing | — | Not shown anywhere on the detail page |
| Owner / Assigned To | Staff owner | Match | Profile card `DetailRow` | |
| Sales Tax Frequency | Compliance field | Match | Compliance card `DetailRow` | |
| Payroll Frequency | Compliance field (e.g. Bi-weekly, N/A) | Missing | — | Only a boolean "Payroll Enabled: Yes/No" is shown, not the actual frequency |
| EFTPS Enabled | Compliance field | Missing | — | |
| MD Annual Report Enabled | Compliance field | Missing | — | |
| Open Tasks count | Account snapshot metric | Missing | — | Detail page has no task/invoice/document counts at all |
| Open Document Requests count | Account snapshot metric | Missing | — | |
| Invoices count | Account snapshot metric | Missing | — | |
| Balance Due | Account snapshot metric | Missing | — | |
| Employees count | Account snapshot metric | Missing | — | |
| Portal Enabled | Account snapshot field | Match | Profile card `DetailRow` | |
| Client Type | Identity field | Match | Profile card `DetailRow` | |
| Entity Type | Identity field | Match | Profile card `DetailRow` | |
| Service Type | Identity field | Match | Profile card `DetailRow` | |
| State | Identity field | Match | Profile card `DetailRow` | |
| SS No. / EIN (conditional on client type, masked for non-admin) | Legacy shows only the relevant ID (SSN for individuals, EIN for business), masked server-side for non-admin | Partial | Compliance & Tax IDs card | Masking itself is preserved server-side (verified in `clients.routes.ts`), but the new page always shows both EIN and Individual SSN rows regardless of client type instead of switching conditionally |
| State Tax ID | Tax ID field (business only, masked) | Partial | Compliance & Tax IDs card | Shown unconditionally (not gated to business clients only) |
| Preferred Contact | Contact preference field | Missing | — | |
| Preferred Language | Contact preference field | Missing | — | |
| SMS Enabled | Contact preference field | Missing | — | |
| Email Enabled | Contact preference field | Missing | — | |
| Responsible Party / Company Contact Name | Business contact field | Missing | — | |
| Responsible Party SSN (masked) | Business contact field | Missing | — | |
| Payroll System | Compliance field | Missing | — | |
| MD Withholding Frequency | Compliance field | Missing | — | |
| MD UI Enabled | Compliance field | Missing | — | |
| Business Return Type | Compliance field | Missing | — | |
| Notes (free text, linkified) | Freeform notes section | Missing | — | No notes field displayed anywhere on the detail page |
| Action: View Statement | Opens statement modal | Missing | — | |
| Action: Print Statement | Opens print-formatted statement | Missing | — | |
| Action: Generate PDF (statement) | Generates a statement PDF | Missing | — | |
| Action: Edit Client | Opens edit form | Match | "Edit" button | |
| Action: Archive Client (admin) | Archives client | Match | "Archive" button | Same confirm-dialog behavior |
| Action: Secure Vault (admin) | Opens password-gated encrypted vault | Partial | "Secure Vault" section | Present directly on the page instead of a separate modal — see Secure Vault rows below for behavior differences |
| Action: Delete Client Row (hard delete, admin) | Permanently deletes client row with typed confirmation | Missing | — | |
| Action: Send Portal Invitation (admin) | Sends client portal invite | Missing | — | |
| Edit form — Status | Dropdown: Active/Inactive/Archived | Partial | `EDITABLE_FIELDS` free-text input | Present but as a plain text input, not a constrained dropdown |
| Edit form — Client ID (readonly) | Read-only display for reference | Missing | — | Not shown in the edit form |
| Edit form — Client Name | Text input | Match | `EDITABLE_FIELDS` | |
| Edit form — Client Type | Dropdown (Business/Individual/etc.) | Partial | `EDITABLE_FIELDS` free-text input | Present but free-text, not a dropdown |
| Edit form — Entity Type | Dropdown, options change dynamically by Client Type (LLC, Corp, S-Corp, Sole Prop, etc.) | Partial | `EDITABLE_FIELDS` free-text input | Present but free-text, no dynamic option list |
| Edit form — State | Dropdown of all US states | Partial | `EDITABLE_FIELDS` free-text input | Present but free-text, no state picker |
| Edit form — Service Type | Dropdown | Partial | `EDITABLE_FIELDS` free-text input | Present but free-text |
| Edit form — Sales Tax Frequency | Editable dropdown | Missing | — | Displayed read-only elsewhere but not editable |
| Edit form — Payroll Enabled | Editable Yes/No dropdown | Missing | — | |
| Edit form — Payroll Frequency | Editable dropdown | Missing | — | |
| Edit form — Payroll System | Editable dropdown | Missing | — | |
| Edit form — EFTPS Enabled | Editable dropdown | Missing | — | |
| Edit form — MD Withholding Frequency | Editable dropdown | Missing | — | |
| Edit form — MD UI Enabled | Editable dropdown | Missing | — | |
| Edit form — MD Annual Report Enabled | Editable dropdown | Missing | — | |
| Edit form — Business Return Type | Editable dropdown | Missing | — | |
| Edit form — W-2/1099 Enabled | Editable dropdown | Missing | — | |
| Edit form — Assigned To | Dropdown of staff names | Partial | `EDITABLE_FIELDS` free-text input | Present but free-text, no staff picker |
| Edit form — Email | Text input | Match | `EDITABLE_FIELDS` | |
| Edit form — Phone | Text input | Match | `EDITABLE_FIELDS` | |
| Edit form — Address | Textarea | Missing | — | |
| Edit form — Preferred Language | Dropdown | Missing | — | |
| Edit form — SMS Allowed | Dropdown | Missing | — | |
| Edit form — Email Allowed | Dropdown | Missing | — | |
| Edit form — Preferred Contact | Dropdown | Missing | — | |
| Edit form — Individual SSN | Text input | Missing | — | |
| Edit form — EIN | Text input | Missing | — | |
| Edit form — State Tax ID | Text input | Missing | — | |
| Edit form — Secretary of State ID | Text input | Missing | — | |
| Edit form — Company Contact Name | Text input | Missing | — | |
| Edit form — Company Contact Title | Text input | Missing | — | |
| Edit form — Company Contact SSN | Text input | Missing | — | |
| Edit form — Notes | Textarea | Missing | — | |
| Add form — "Create Portal User Now" toggle | Yes/No option shown only when adding a client | Missing | — | No option to auto-create a portal login while creating a client |
| Secure Vault — separate vault password | Client-side, password-derived encryption key independent of admin login (per-client) | Missing | "Secure Vault" section | New vault is gated purely by admin role/session; no separate per-client vault password or client-side encryption key |
| Secure Vault — Change Password action | Re-encrypts all items under a new vault password | Missing | — | |
| Secure Vault — Reset Vault action | Wipes and resets a forgotten vault | Missing | — | |
| Secure Vault — Lock Vault (session-based) | Explicitly locks the unlocked vault session | Missing | — | |
| Secure Vault — multi-field item structure | Each secure item can hold up to 10 named fields (Portal URL, Username, Password, PIN, Account Number, Routing Number, EIN Reference, SSN Reference, Responsible Officer, Notes) | Partial | Vault item form (category/label/agencyName/secret) | New vault item has a single free-text secret value plus category/label/agency metadata, not the 10-field structured record |
| Secure Vault — Category/Jurisdiction/Agency/Last-4 metadata | Item metadata tags | Partial | Vault item form | New has Category + Agency Name only; no Jurisdiction or Last-4 hint field |
| Secure Vault — per-field Copy to clipboard | Copy button next to each revealed field | Missing | — | |
| Secure Vault — Edit existing item | Edit an existing secure item's fields | Missing | — | New vault only supports Add and Delete, no edit |
| Secure Vault — exclusion warning banner | Text explaining vault records are excluded from profiles/notes/exports/PDFs | Missing | — | No equivalent assurance text shown |

**New-in-app item (no legacy Command Center/Clients equivalent):** `ClientDetailPage.tsx` includes a "Payment Methods" section (add/list/delete ACH/Check/Wire/Credit Card profiles with masked account numbers). This is not part of legacy `renderCommand`/`renderClients`/`renderDetail` — the closest legacy equivalent (`paymentMethodRows` and related functions) lives under the separate Accounting/Ledger module, out of scope for this comparison.
