# AL TAX NEXT — User Manual

This is the complete guide to using the app day-to-day. It's organized by **who you are**, since an Admin, a Staff member, a Client, and an Employee each see a different, purpose-built version of the app (a "portal"). Skip to your section.

A shorter, always-available version of this lives inside the app itself under **Guide** in the sidebar — this document goes deeper.

---

## Signing in

Go to the app's web address, enter your email and password, and sign in.

- **First time signing in?** You'll have either a temporary password (given to you by an Admin) or an email invite link. Either way, you'll be asked to set your own password on first login.
- **Forgot your password?** Ask an Admin to issue you a new temporary password from Portal Access.
- **Five wrong attempts** locks your account for 15 minutes, automatically — this is a security feature, not an error.
- **Two-Factor Authentication (2FA)**: click **Enable 2FA** in the top bar for an extra layer of protection on your account (recommended for Admin and Staff accounts especially).

---

## 1. Admin

Admins see everything: every client, every task, every dollar, and every setting. The sidebar has every page listed below.

### Command Center
Your home screen. Shows firm-wide numbers at a glance and a monthly revenue/expense/profit trend.

### Clients
The full client list. Add a client with **+ Create → Client**, filter by status/owner/type/service, and click any client to open their full profile: contact info, compliance settings (sales tax frequency, payroll, EFTPS, annual report), payment methods, and linked employees.

- **Payment Methods**: on a client's profile, you can mark one payment method **Default for Payroll** and one **Default for Invoices** — paychecks and invoices will use that default automatically unless you pick a different one at creation time.

### Tasks
The master task pipeline for the whole firm — every filing, deadline, and deliverable, for every client. Use the quick tabs (Active / Overdue / Due Today / Due Week / Waiting) to triage. Click a task to see its full detail, add notes, attach files, and change its status.

- **Bulk/recurring task creation**: use **+ Create → Batch Tasks** to create the same task across many clients at once, or set up a recurring schedule.

### Billing
Every invoice, across every client. Create an invoice with real line items (QuickBooks-style), record payments, and generate a Statement of Account. Every invoice/statement has a **View** button (opens the PDF to check before committing) separate from **Download**.

- **Recurring Billing**: set up a schedule once, then click **Run Recurring Billing** whenever you're ready to generate that period's invoices — this is not automatic; it only runs when you click it (see Section "Reminders" below for why).

### Documents
Every document request and upload, across every client. Create a request, and the client sees it (and can upload directly) from their own portal.

### Accounting
The full accounting workspace, with tabs:
- **Sales Input** — record sales tax activity per client.
- **Payroll Input / Payroll** — run payroll for an employee; see [Payroll & Paychecks](#payroll--paychecks) below.
- **Employees** — every employee/contractor across all clients; click a name for their full profile (edit, view sensitive info, mark Active/Inactive, or delete).
- **Manual JE** — manual journal entries for anything that doesn't fit the automatic flows.
- **GL** — the full general ledger, filterable by period.
- **Tax Rates** — the rates the whole system calculates from (federal/state withholding, Social Security, Medicare, FUTA, SUTA) — can be overridden per client.
- **COA** (Chart of Accounts) — the account list everything posts to.

### Payroll & Paychecks
From a client's Payroll tab, fill in an employee's hours/rate (or a flat gross amount), pick a payment method (or use the client's default), and create the paycheck. The app calculates withholding automatically from the Tax Rates table.

- **Printing a check**: every paycheck has **View** (preview the PDF before printing) and **Download**. Physical check-stock alignment is calibrated per client under **Check Settings** if the printed check doesn't line up with your pre-printed stock.
- **Editing a paycheck**: only allowed before it's been printed/finalized — once printed, create a corrected paycheck instead of editing, so the paper trail stays accurate.
- **Deleting a paycheck**: admin-only, requires typing "DELETE PAYCHECK" to confirm, and is blocked if the paycheck has already been used on a filed tax form.

### Tax Forms
From an employee or client's profile, generate real IRS forms: **W-2, 1099-NEC** (per employee/contractor), and **W-3, Form 940, Form 941, Form 1096** (per employer, from that client's Accounting page). All are the actual IRS fillable PDFs, filled with your real numbers — always **View** first to check them before printing/filing.

### Reports
Financial statements per client (or firm-wide, as Admin): **P&L, Balance Sheet, Payroll Dashboard, Client Message**. Every report has **Print Report** (view the polished PDF), **Download PDF**, and **Export CSV**.

### Communications
Send messages to clients or staff — Email, SMS, WhatsApp, or a **Portal Note** (visible in the recipient's own portal, no external send). Pick a template (English + Arabic pre-written for common situations) or write your own.

- **Run Reminders**: click this button to send that day's batch of: a digest to each staff member with due/overdue tasks (one message covering everything, not one per task), a document-request reminder to clients with open requests, and a payment reminder to clients with an unpaid balance. This is not automatic — see the note below.

### Templates
Edit the pre-written English/Arabic message templates used across Communications (Payment Reminder, Document Request, Staff Task Reminder, etc.). Editing a built-in template here overrides it going forward.

### Portal Access
Manage every login account: create staff/client/employee accounts, resend invites, set temporary passwords, deactivate, or delete.

### Security
Account lockout status, password health, and a full audit log of who did what and when — every meaningful action in the app (create, edit, delete, send) is logged here permanently.

### Fix Center
The app's self-checkup — see the Maintenance Manual for full detail. Check here first whenever something seems off.

### Rules
Automatic task-generation rules — configure what recurring work should be created for clients based on their service settings.

---

## 2. Staff

Staff see the same pages as Admin (Clients, Tasks, Billing, Documents, Accounting, Reports, Communications, Templates), but every list is automatically filtered to **only the clients you're assigned to** — you won't see other staff members' clients. Portal Access, Security, and Fix Center are Admin-only.

Your **Command Center** shows your own work queue: assigned open tasks, what's due soon, and what's waiting on a client.

---

## 3. Client

Your portal shows only your own company's information — nothing about any other client.

- **Command Center**: quick view of open document requests and open invoices.
- **Documents**: see what AL TAX has requested from you, and upload files directly.
- **Billing**: view and pay your invoices, download statements.
- **Communications**: message AL TAX directly, in English or Arabic, and see the full reply history (including notes AL TAX has logged for your file — these show up here too, not just messages you sent).

---

## 4. Employee

Your portal is for viewing your own pay information.

- **Command Center**: your profile summary (employer, employee ID) and your paystub list.
- **Documents / Communications**: contact AL TAX if something on a paystub needs review.

---

## Frequently asked "how do I…"

**…add a new client?**
Admin/Staff → Clients → **+ Create** → fill in the form. Set their compliance settings (payroll, sales tax frequency, etc.) right away so task rules generate correctly.

**…run payroll for an employee?**
Client's Accounting page → Payroll tab → fill in hours/rate → Create Paycheck → **View** to confirm it looks right → print or download.

**…send a client their W-2?**
Employee's profile → set the tax year → **View W-2** to check it → **Download** to save/print, or send it via Communications with a message.

**…find out why a client didn't get an email?**
Communications page → find that message in the history → the exact failure reason is shown in plain English (e.g., "domain not verified" or "not connected yet").

**…let a client see something without emailing them?**
Communications → compose the message → choose **Portal Note** as the channel instead of Email/SMS — it's saved to their history and visible next time they log in, with no external send attempted.

**…undo a mistake?**
Most edits can simply be corrected again. Deletions require typing a confirmation phrase and are blocked if the record is already relied on elsewhere (e.g., a paycheck used on a filed tax form can't be deleted). If you're ever unsure whether an action can be undone, ask before clicking — see the Maintenance Manual.
