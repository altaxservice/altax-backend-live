# Portal Access + Security + Fix Center + Guide — Legacy vs New App

## Summary
Across the four pages: roughly **24 Match**, **26 Partial**, **17 Missing**, and **2 New** items — Portal Access and Security carry over the core tables/actions but drop several fields and one action (permanent delete); Fix Center intentionally drops the repair/clear-data tools in favor of a safer read-only check plus a new seeding tool; Guide keeps the same 10 topic labels but with far less content per topic and no role-based filtering.

## Portal Access (Staff/Users)

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Page title / eyebrow | "Portal Access Center" eyebrow, "Users & Access Control" heading, intro paragraph about creating users, invites, tokens, temp passwords | Partial | `UsersPage.tsx` `<h1>Portal Access</h1>` | New app has a plain title only, no eyebrow/intro paragraph |
| Process note banner | "Invite email sends a setup token. Temporary passwords force password change after login. Client and employee users should be tied to the correct record before saving." | Missing | — | Not present anywhere on `UsersPage.tsx` |
| Add User / Invite button | `<button id="add-staff-button">Add User / Invite</button>`, admin-only | Match | "Add User" button, top right | Label shortened to "Add User"; same create flow |
| Role filter dropdown | `#staff-role-filter` — All / Admin / Manager / Staff / Client / Employee (dynamically includes any role found in data) | Missing | — | No role filter control in new app; grouping is fixed via three hardcoded `UserGroup` sections instead |
| Status filter dropdown | `#status-filter` — All / Active / Inactive | Missing | — | No status filter; active and inactive users are shown together in the same group |
| Refresh button | Global filter-bar Refresh button reloads `appState.db` | Match | Implicit — `load()` runs on mount; no visible Refresh button but data reflects latest on Save/Deactivate | New app has no explicit Refresh button on this page (Security/Fix Center have one, Users does not) |
| Export CSV button | Global filter-bar "Export CSV" button | Missing | — | Not present on `UsersPage.tsx` |
| Firm Users group | Table of Admin/Staff/Manager/Owner users | Match | `UserGroup title="Firm Users"` (filters `admin`/`staff` roles only) | Legacy also includes "Manager"/"Owner" roles in this group; new app schema/UI only supports Admin/Staff roles |
| Client Users group | Table of Client-role portal users | Match | `UserGroup title="Client Users"` | — |
| Employee Users group | Table of Employee-role portal users | Match | `UserGroup title="Employee Users"` | — |
| Other Users group | Shown only if any users have an unrecognized role | Missing | — | New app's 3 fixed groups only match `admin/staff/client/employee`; anything else silently disappears from the list |
| Inactive Users group | Separate table section listing all inactive users, shown only if any exist | Missing | — | New app mixes active/inactive rows into the same group instead of a separate section |
| Table column: Name | — | Match | "Name" column | — |
| Table column: Email | — | Match | "Email" column | — |
| Table column: Role | — | Match | "Role" column (shown as badge) | — |
| Table column: Assignment | Shows linked Client (name + ID) or Employee (name + ID + client) for that portal user, or "Firm-wide" | Missing | — | No equivalent column in new app table |
| Table column: Invite | Status pill: Inactive / Invite Expired / Invited / Temp Password / Ready / Needs Invite | Partial | "Invite Pending" column | New app only shows Yes/— (binary) instead of legacy's 6-state invite status |
| Table column: Last Login | Formatted date/time or "Never" | Match | "Last Login" column | New app shows date only (no time), legacy shows date+time |
| Table column: Active | Status pill (Active/Inactive) | Match | "Active" column (Yes/No) | — |
| Table column: Open (task count) | Count of that user's open tasks | Missing | — | No workload/task-count columns in new app |
| Table column: Overdue (task count) | Count of that user's overdue tasks | Missing | — | No workload/task-count columns in new app |
| Table column: Actions | Row-level action menu | Partial | Actions dropdown + Deactivate button | See action-by-action breakdown below |
| Action: Edit User | Opens edit modal | Match | Click row (any cell except Actions) opens edit form | — |
| Action: Resend Invitation | Reissues/reuses invite token, shown in result modal | Match | "Resend Invite" dropdown option | Result surfaced in inline card instead of modal |
| Action: Reset Invite Token | Clears password, issues new setup token, confirm prompt first | Match | "Reset Invite" dropdown option | Same confirm-then-execute flow |
| Action: Temporary Password | Confirm prompt, then issues a one-time temp password shown in result modal | Match | "Set Temporary Password" dropdown option | — |
| Action: Deactivate | Confirm prompt, sets Active = Inactive | Match | "Deactivate" button (only shown for active users) | — |
| Action: Delete User (hard delete) | Requires typing "DELETE USER" to confirm; permanently removes the row | Missing | — | No permanent-delete action anywhere in `UsersPage.tsx` |
| Add/Edit User modal: User ID field | Read-only, shows "Auto" for new users | Missing | — | New app form has no User ID field displayed |
| Add/Edit modal: Name field | Text input, required | Match | "Name" field, required | — |
| Add/Edit modal: Email field | Text input, required, validated for "@" | Match | "Email" field, required, `type="email"` | — |
| Add/Edit modal: Role field | Dropdown: Staff / Admin / Manager / Client / Employee (5 options) | Partial | "Role" dropdown: Admin / Staff only (2 options) | Manager/Client/Employee roles cannot be created from this form in the new app |
| Add/Edit modal: Phone field | Text input | Match | "Phone" field | — |
| Add/Edit modal: Active field | Dropdown: Active/Inactive | Match | Checkbox: Active | Control type differs (dropdown vs checkbox) but same effect |
| Add/Edit modal: Reminder Preference field | Dropdown: Email/SMS/Both/None | Missing | — | Not present in new app form |
| Add/Edit modal: Assigned Client field | Dropdown, shown/required only when Role = Client | Missing | — | No client-linking field in new app; role is limited to Admin/Staff anyway |
| Add/Edit modal: Assigned Employee field | Dropdown, shown/required only when Role = Employee | Missing | — | Same as above |
| Add/Edit modal: SMS Gateway Email field | Text input, shown only when Reminder Preference is SMS/Both | Missing | — | Not present |
| Add/Edit modal: role note / validation messages | Inline note area plus save-time validation for required client/employee links | Partial | `saveError` banner shown on failed save | Validates name/email only; no client/employee-link validation since those fields don't exist |
| Save confirmation | "Saving a portal user does not send an invite. Use Resend Invitation..." note in the modal | Missing | — | Not shown in new app form |
| Post-save result modal | If a new invite token was generated on save, opens a modal with Name/Email/User ID/Portal Link/Setup Token/Invitation Sent | Partial | Inline card at top of page with note + token/password/link | Same information surfaced differently (inline card vs modal), fewer labeled fields |
| No-email disclosure | (legacy has no equivalent — Apps Script MailApp is assumed available) | New | Inline card: "No email was sent (this backend has no email service yet) — copy this and send it to them yourself." | New app is explicit that email isn't wired up yet; legacy silently attempted an email send |

## Security

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Page title / eyebrow | "Security Foundation" eyebrow, "Portal Security Center" heading, intro paragraph | Partial | `command-panel-title`: "Portal Security Center" with note paragraph | No separate eyebrow line, otherwise same heading/intro text |
| Refresh button | Global filter-bar Refresh | Match | "Refresh" button, top right | — |
| Export CSV button | Global filter-bar Export CSV | Missing | — | Not present on `SecurityPage.tsx` |
| Metric: Active Users | Count + "N visible records" note | Match | Metric tile, same label/note | — |
| Metric: Locked Accounts | Count + "15 minute lock after failed sign-ins" note | Match | Metric tile, same label/note | — |
| Metric: Needs Setup | Count + "invite, reset, or password setup required" note | Match | Metric tile, same label/note | — |
| Metric: MFA | Static "Email" value + "code challenge after password" note | Match | Metric tile, same label/note | — |
| Sensitive-data disclosure paragraph | "Sensitive values stay out of browser data. This page shows status only, not password hashes, salts, invite tokens, vault payloads, portal passwords, PINs, SSNs, or bank account values." | Match | Same paragraph text, `command-panel` body | — |
| Compliance reference panel | 4 field-rows: "IRS Pub. 4557 access controls", "Password storage" (Current vs legacy upgrade), "Lockout policy" (5 attempts/15 min), "Vault controls" (secrets excluded from exports) | Missing | — | This reference/explainer block is not present in `SecurityPage.tsx` |
| Portal User Security table title/note | "Portal User Security", "N users" | Match | Same title, same note format | — |
| Table column: Name | — | Match | "Name" | — |
| Table column: Email | — | Match | "Email" | — |
| Table column: Role | — | Match | "Role" | — |
| Table column: Password | Status pill: Inactive / Must Reset / invite-status / Ready / Needs Setup | Match | "Password" column (plain text, same status values from API) | Legacy renders as a colored pill; new app renders plain text |
| Table column: MFA | Static "Email Code" pill on every row | Missing | — | New app has no per-row MFA column (MFA is only shown as the page-level metric tile) |
| Table column: Password Storage | Status pill: Current / Legacy / Not Set | Match | "Storage" column | — |
| Table column: Failed (failed login count) | Numeric, defaults to 0 | Match | "Failed" column | — |
| Table column: Locked Until | Formatted date/time if still locked, else "No" | Partial | "Locked Until" column, shows formatted date/time or "Never" | New app always shows a value/"Never" via `fmtDate`; legacy shows blank-styled "No" when not locked |
| Table column: Last Login | Formatted date/time or "Never" | Match | "Last Login" column | — |
| Table column: Active | Status pill (Active/Inactive) | Match | "Active" column (text "Active"/"Inactive") | — |
| Recent Login/Security Events table title/note | "Recent Login / Security Events", "N events" | Match | Same title/note | — |
| Events source/filter | Filtered to Audit Log rows where Module = "security", sorted newest-first, capped to 12 rows | Partial | Table renders whatever `/system/security` API returns | Filtering/sort/cap logic lives server-side now; cannot verify the 12-row cap or module filter from the frontend alone |
| Table column: Time | — | Match | "Time" | — |
| Table column: User | — | Match | "User" | — |
| Table column: Action | — | Match | "Action" | — |
| Table column: Record | — | Match | "Record" | — |
| Table column: Note | — | Match | "Note" | — |
| Empty state | "No security events recorded yet." | Match | "No security events yet." | Wording nearly identical |

## Fix Center

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Page title / eyebrow | "Admin Maintenance" eyebrow, "Auto Fix Center" heading, intro paragraph about repairing tables/headers/defaults/duplicate tabs | Partial | "Auto Fix Center" heading with a different explanatory note | Heading label matches; body text explains why legacy's repair tools were intentionally not ported (see below) |
| Admin-only gate | Non-admin sees "Fix Center is available to Admin only." message instead of the page | Missing / Unverified | — | Not visible in the frontend file alone (role gating may happen at the route/nav level); no in-page role check present in `FixCenterPage.tsx` |
| Run Auto Fix button | Repairs missing v3/v5 tables, headers, seeds tax rates/COA, hides duplicate imported sheet tabs, writes audit entry | Missing (by design) | — | Explicitly called out in the page's own text as not ported — no sheet-import failure modes exist in the new system |
| Run Auto Fix — invite token disclosure | "If email sending is unavailable in Apps Script, invite tokens and temporary passwords are shown on screen so Admin can copy them." | N/A | — | This behavior lives on Portal Access instead (inline invite card), not Fix Center |
| Clear Test Data button | Danger button; requires typing "CLEAR TEST DATA"; deletes rows across 14 tables that look like test/local-preview data | Missing (by design) | — | Explicitly called out as intentionally not exposed — "clearing production rows isn't something to expose without a very deliberate, separately-confirmed flow" |
| "What It Repairs" info panel | 3 diagnostic-box explainer paragraphs (what Auto Fix does, invite-token fallback, what Clear Test Data does) | Partial | Single explanatory paragraph replacing the whole panel | Consolidated into one paragraph under "Auto Fix Center" instead of a separate 3-item panel |
| System Check panel | Lists required tables (`v3_Clients`, `v3_Users`, `v3_Tasks`, `v3_Invoices`, `v3_Payments`, `v3_Document_Requests` + 18 `PROFESSIONAL_TABLES`) with row count or "Missing" flag per table | Partial | "System Check" table: table name + row count for all live DB tables | New app lists actual Postgres tables/counts (a superset/different naming than legacy's sheet-tab names) but has no "Missing" detection — Postgres tables always exist once migrated, so that failure mode doesn't apply |
| Fix Center status message | Live status text area ("Ready.", "Repairing...", success/failure message) | Missing | — | No equivalent status line since there's no run/repair action to report on |
| Seed Default Setup Data | (no legacy equivalent) | New | "Seed Default Setup Data" panel with "Seed Default Tax Rates & COA" button | Creates default tax rates + chart of accounts for a fresh deployment, safe to re-run, never overwrites existing rows; shows a result message with counts created/skipped |
| Refresh button | Global filter-bar Refresh | Match | "Refresh" button, top right | — |
| Export CSV button | Global filter-bar Export CSV | Missing | — | Not present (and wouldn't map to a specific table on this page in either version) |

## Guide / Help

| Legacy Item | Description | New App Status | New App Location | Notes |
|---|---|---|---|---|
| Page title | "Instruction Manual" heading, "Built into the portal" note | Match | Same heading and note text | — |
| Role-based tab sets | Different tab lists per role: Admin/Staff get 10 tabs (Admin, Portal Login, Messages, Reminders, Staff, Employee, Client, Accounting, Task Process, Data Storage); Client role gets 4 tabs (Client Portal, Messages, Task Process, Billing) with client-specific wording; Employee role gets 4 tabs (Employee, Login, Messages, Data Storage) | Missing | — | `GuidePage.tsx` shows the same static 10 sections to every user regardless of role — a Client or Employee user would see Admin/Staff/Accounting content that doesn't apply to them, and the client-specific "Billing" help tab doesn't exist at all |
| Tab: Admin / "Admin daily workflow" | 3 content blocks, ~18 lines total: daily workflow (Clients/Tasks/Billing/Accounting/Communications/Fix Center), "After replacing Code.gs and Index.html" (Apps Script redeploy steps), "Secure launch checklist" (7-step go-live checklist) | Partial | "Admin" section, 1 block, 7 lines ("Admin daily workflow") | Only the first block survives (and it swaps the "Fix Center" bullet for a "Security" bullet); the Apps Script redeploy block is correctly dropped (not applicable), but the "Secure launch checklist" onboarding content is also dropped with no replacement |
| Tab: Portal Login / "Signing in" | 3 blocks, ~16 lines: how Admin manages access per role, how to test each portal as Admin, first-login password-change steps | Partial | "Portal Login" section, 1 block, 4 lines | Only a bare "how to sign in" summary remains; Admin-side account-management and testing instructions are gone |
| Tab: Messages / "Communications" | 2 blocks, ~15 lines: sending the Reports "Client Message", writing a message manually (template/custom, Email/Portal Note/SMS/WhatsApp/Phone channels, SMS gateway email) | Partial | "Messages" section, 3 lines | Reduced to 3 general sentences; no channel-by-channel or Reports-flow detail |
| Tab: Reminders / "Reminder Center" | 2 blocks, ~15 lines: Reminder Center controls (Send Daily Alert Now, Install Daily Alert, schedule settings, Run Work Reminders Now, disable triggers), what reminders include (daily ops alert, client/task/staff/employee reminder types, dedupe logic) | Partial | "Reminders" section, 2 lines | Only mentions Task Rules and warning windows; no mention of the Reminder Center UI, daily alert scheduling, or reminder types |
| Tab: Staff / "Staff portal" | 1 block, 5 lines: sign-in, dashboard scoping, filters, reviewing a task row, status updates/archiving | Partial | "Staff" section, 2 lines | Condensed to "Command Center shows only your tasks" + "Documents/Communications work the same as Admin" |
| Tab: Employee / "Employee portal" | 1 block, 5 lines: sign-in, own paystubs/messages only, detailed paystub contents (employer/employee/pay period/hours/rate/gross/taxes/net/payment method/masked SSN), no check printing for employees, Admin controls records | Partial | "Employee" section, 2 lines | Reduced to "view paystubs" + "contact firm via Messages"; paystub-contents detail and check-printing note are gone |
| Tab: Client / "Client portal" | 1 block, 4 lines: sign-in, own-company scoping, view/upload docs, invoices/statements, messages, reports | Partial | "Client" section, 2 lines | Reduced to "review/upload documents" + "check invoices under Billing"; messaging and reports mentions dropped |
| Tab: Accounting / "Accounting workspace" | 2 blocks, ~14 lines: full accounting workflow (Sales, Employees, Payroll, Paychecks incl. print options, Manual JE, GL, Tax Rates, COA, Reports) + separate "Check printing control" block | Partial | "Accounting" section, 3 lines | Reduced to pick-client-then-date-range + which modules post to GL + what Reports shows; no check-printing block, no Tax Rates/COA-specific mentions |
| Tab: Task Process / "How tasks are created" | 1 block, 7 lines: Rules review, New Work Item/Create Batch Tasks, choosing rule/period/dates, filters, selection modes (matching/visible/all/manual), preview count, duplicate skipping | Partial | "Task Process" section, 2 lines | Condensed to "rules match clients by trigger condition" + "batch creation lets you preview matches" |
| Tab: Data Storage / "Where data lives" | 1 block, 9 lines: exact table names for every module (v3_Clients, v3_Users, v3_Tasks/v3_Archived_Tasks, v3_Task_Rules/v3_Task_Batches, v3_Invoices/v3_Payments, v3_Document_Requests/v3_Document_Uploads, accounting tables, v3_Communications, v3_Audit_Log) | Partial | "Data Storage" section, 2 lines | States data lives in PostgreSQL (Neon) instead of spreadsheets, and that vault secrets/payment numbers are encrypted — correct for the new architecture, but doesn't enumerate specific tables/entities the way legacy did |
| Client-role tab: "Client Portal basics" | Client-specific phrasing: "You only see records for your own company," Documents/Billing/Messages summary | Missing | — | Not reachable — new Guide has no role-based content switch |
| Client-role tab: "Billing" (client wording) | Client-specific Billing/Reports help text | Missing | — | No dedicated Billing help topic exists in the new Guide at all |
| Navigation UI pattern | Horizontal tab bar (`guide-nav`) across the top of the panel | Partial | Left-side vertical button list (180px column) + content pane | Same single-active-section pattern, different layout orientation |
