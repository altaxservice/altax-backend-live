import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { NexusPlaybookGuide } from "../components/NexusPlaybookGuide";

// labelKey/titleKey/bodyKeys are only set on client/employee sections — those are
// the only roles that can ever see Arabic (useLanguage()'s canUseArabic gate), so
// admin/staff sections are left as plain English-only label/title/body/topics with
// no translation keys.
//
// Two content shapes coexist here:
// - `body`: a flat numbered list of one-line facts (the original, still used by
//   every client/employee section — short enough that a richer shape isn't needed).
// - `topics`: a self-paced-manual shape for admin/staff sections — each topic is a
//   named feature with its own numbered steps and an optional "use it when" note,
//   mirroring how a real training document reads. A section may mix both; topics
//   render first when present.
/**
 * UX-014 (Hard Audit, 2026-08-13) — route/routeLabel turn a topic's "Go to X"
 * instruction into a real, clickable link instead of just describing where to
 * go. Populated on the one topic per distinct destination whose steps
 * actually say "Go to X" — not every topic, since most describe a sub-view
 * of a page already linked elsewhere in the same section.
 */
interface GuideTopic { heading: string; steps: string[]; useWhen?: string; route?: string; routeLabel?: string }
interface Section {
  key: string; label: string; title: string; roles: string[];
  intro?: string; topics?: GuideTopic[]; body: string[];
  group?: string; labelKey?: string; titleKey?: string; bodyKeys?: string[];
}

const ADMIN_STAFF_ROLES = ["admin", "staff"];

const SECTIONS: Section[] = [
  {
    key: "getting-started",
    label: "Getting Started",
    title: "Getting started",
    roles: ADMIN_STAFF_ROLES,
    intro: "Read this section first — everything else in this manual assumes you know how to sign in, read the sidebar, and find your way back to this page.",
    topics: [
      {
        heading: "Signing in",
        steps: [
          "Go to the login page and pick the portal that matches your role: Admin or Staff.",
          "Enter the email on file and your password.",
          "If your account has no password yet, ask an Admin to set a temporary one or send you an invite link.",
          "Five incorrect password attempts locks the account for 15 minutes — wait it out or ask an Admin to review Security if it wasn't you.",
          "Admin and staff accounts require a 6-digit authenticator code (TOTP) on top of the password. The first time you sign in, you'll be walked through scanning a QR code with an authenticator app (Google Authenticator, Authy, etc.) — save the one-time recovery codes shown at that step somewhere safe, they're the only way back in if you lose your phone.",
        ],
      },
      {
        heading: "Reading the sidebar",
        steps: [
          "The sidebar is grouped the same way this manual is: Clients, Work, Tools, Money, Client Communication, and Firm — each group header in the sidebar matches a group of sections below.",
          "Command Center (top of the sidebar) is your home screen — open tasks, unpaid balance, priority work queue, and anything overdue, all in one view.",
          "The search box at the top of every page searches across clients, tasks, and invoices at once — type at least 3 characters.",
          "\"+ Create\" at the top of the sidebar is a shortcut to start a new client, task, estimate, or invoice without navigating to that page first.",
        ],
        useWhen: "Use Command Center as your default landing page every morning — it's built to answer \"what needs my attention today\" in one glance.",
      },
      {
        heading: "Coming back to this manual",
        steps: [
          "Guide is always in the sidebar, below Client Communication.",
          "Each topic in this manual has a short numbered how-to and, where it's not obvious, a note on when you'd actually use it.",
          "This manual only covers the Admin/Staff side. Client and Employee portal users see a shorter, separate guide when they sign in.",
        ],
      },
    ],
    body: [],
  },

  {
    key: "nexus-playbook",
    label: "The Nexus Playbook",
    title: "The Nexus Playbook",
    roles: ADMIN_STAFF_ROLES,
    body: [],
  },

  // ---------------- Clients ----------------
  {
    key: "clients",
    label: "Clients",
    title: "Clients",
    roles: ADMIN_STAFF_ROLES,
    group: "Clients",
    topics: [
      {
        heading: "Finding a client",
        route: "/clients", routeLabel: "Clients",
        steps: [
          "Go to Clients in the sidebar — every client the firm has ever added shows up here (Active by default; switch the Status filter to see Inactive/Archived too).",
          "Use the search box, or the Status / Owner / Type / Service filters, to narrow the list.",
          "The quick tabs (All / Active / Business / Individual / Payroll / Sales Tax / Portal) are one-click shortcuts to the filters people use most.",
          "Click a row to open that client's full profile.",
        ],
      },
      {
        heading: "Adding a new client",
        steps: [
          "Click Add Client (top right of the Clients page).",
          "Fill in Client Identity (name, type, entity type, state), then check every box under Services Provided that this client is actually engaged for — the profile's Documents tab will auto-generate a matching contract template for each one.",
          "If Payroll or Sales Tax is checked, matching detail fields appear (frequency, provider, EFTPS, MD UI, etc.) — fill in what applies.",
          "Fill in Contact & Assignment (who owns this client internally, email, phone) and Tax IDs & Responsible Party.",
          "Check \"Create portal user now\" if you want the client to get portal access immediately — this requires an email address and sends them an invite.",
          "Click Create Client.",
        ],
      },
      {
        heading: "The Client Profile page",
        steps: [
          "Profile tab: every service setting from the Add Client form, editable any time — click Edit, change what's needed, Save.",
          "Referral Source (Profile tab, in Edit mode): type or pick from the suggested list (Referral, Google, Website, Social Media, Walk-in, Other) to record how this client found you.",
          "Documents tab: contracts, uploaded files, document requests, and (if the client's type/services match one) an automatic Document Checklist.",
          "Billing tab: every invoice for this client, plus a \"Create Invoice from Unbilled Time\" button when there's approved, billable time waiting.",
          "Communications tab: every message sent to/from this client.",
          "Compliance, Responsible Party, and Account are always-editable tabs carrying fields first captured at Add Client — Tax IDs/EIN/SSN and agency settings, the responsible party's own info, and account summary counts, respectively.",
        ],
        useWhen: "Use Referral Source consistently so you can eventually answer \"where do our clients actually come from\" — pull it up when deciding where to spend marketing effort.",
      },
      {
        heading: "At a Glance tab — the client's financial dashboard",
        steps: [
          "Open any client, click the At a Glance tab (it's the default tab when you open a client).",
          "Operations tiles (Open Tasks, Document Requests, Invoices, Balance Due, Employees) are visible to staff and admin alike.",
          "Everything below that — Health Score, This Period, Financial Position, Ratios, Budget vs Actual, Upcoming Deadlines — is admin-only, same restriction as Reports → Financial Overview.",
          "The Business Health Score (0-100, Green/Yellow/Red) is never just a number — the breakdown underneath it always shows exactly which of the 6 factors (profitability, revenue trend, AR aging, tax liability, task backlog, MD filing status) cost or earned points, so you can explain it to a client.",
          "The red banner at the top only appears when something genuinely needs attention (Red health score, an invoice over 90 days past due, or a deadline inside 7 days) — no banner means nothing urgent right now.",
          "Cash Balance and Accounts Payable are labeled \"estimate\" on purpose — they're derived from recorded ledger activity, not a live bank feed or a vendor-bill system, so treat them as a strong approximation, not a bank statement.",
        ],
        useWhen: "Open this tab before any client call — it's the fastest way to walk in already knowing where the client stands.",
      },
      {
        heading: "SWOT Analysis & Business Advisory tab",
        steps: [
          "Open a client, click the SWOT Analysis tab.",
          "\"Auto-Fill from Business Data\" drafts the Overview/Strengths/Weaknesses/Opportunities/Threats/Tax Strategy/Growth Plan text fields from real numbers already in the system — it only fills fields that are still blank, so it can never overwrite something you already wrote.",
          "Staffing and Marketing recommendations stay manual — nothing in this system tracks staffing adequacy or marketing performance, so use the Business Intake answers and your own judgment there.",
          "Business Intake (Target Market, Competitors, Business Goals, Known Challenges) is for context no transaction can tell you — fill it in from the actual client conversation; it informs the Staffing/Marketing fields.",
          "\"View Report\" / \"Download PDF\" generates the actual client-facing document — a printable Business Advisory Report with the firm's letterhead, built specifically to hand to or email a client, unlike the internal Financial Overview report.",
        ],
      },
      {
        heading: "Structured Findings & Action Items (on the SWOT Analysis tab)",
        steps: [
          "This is the table at the top of the SWOT Analysis tab, above the narrative text fields — it's a trackable list, not prose: every row has a Finding, Priority, Owner, Due Date, and Status.",
          "Click \"Generate Findings Now\" to run the same rule-based engine as Auto-Fill, but it creates individual trackable rows instead of one paragraph — it never creates a duplicate for a condition that's already tracked as an open finding.",
          "Rows tagged \"Auto\" came from the engine; anything you create with \"+ Add Finding\" is tagged Manual. Editing any field on an Auto row locks it from future automated changes — the system will never silently overwrite something you touched.",
          "Priority and Status can be changed inline (the colored dropdown); Owner and Due Date are editable inline text/date fields that save when you click away.",
          "Resolve closes a finding as done (kept for history, not deleted); Dismiss closes it as not applicable, with an optional reason.",
          "Check \"Show resolved/dismissed\" to see the full history instead of just what's still open.",
          "A nightly automated sweep also runs this same engine for every client — it creates new findings for conditions that just appeared, and automatically resolves any Auto finding whose underlying condition has cleared (e.g., an overdue invoice that got paid). It never touches anything you've edited.",
          "If Dashboard Alerts are turned on (ask an admin), the most urgent new findings (negative cash balance, an invoice newly over 90 days late, a filing deadline inside 7 days) also trigger an email/SMS to the client's assigned staff automatically.",
        ],
        useWhen: "Use this table, not the narrative fields, when you need to actually assign and track follow-up work rather than just describe the situation.",
      },
      {
        heading: "Activity Timeline & Task Notes (staying on top of client interactions)",
        steps: [
          "Open a client, click the Activity Timeline tab, then \"+ Log Activity\" any time you call, meet with, or talk to a client outside the app — pick a type (Phone Call, In-Person Meeting, Video Call, Voicemail, Other), write a one-line note, Save.",
          "Every real email/text sent through the app shows up on the same timeline automatically, marked \"(sent)\" — so this one tab is the whole interaction history, not just what you logged by hand.",
          "The Task Notes tab is a separate, cross-task inbox: every note left on any of this client's open tasks lands here in one list, so you don't have to open each task to check for one. Click a row to jump into that task's own Activity Timeline, where the note actually lives.",
          "Both tabs track read/unread per staff member — a new note stays unread until you personally open the tab it lives in. The Client Note / Task Note counters on the client's side panel drop the moment you do.",
        ],
        useWhen: "Log it right after any client interaction so nothing gets lost — \"he asked for a payment extension,\" \"she confirmed the W-2 count,\" etc. Check Task Notes first thing after time away — it's the fastest way to see what changed across every open task at once.",
      },
      {
        heading: "Client Flags — Balance/Agency Past Due, Credit, Custom",
        steps: [
          "Balance Past Due and Agency Past Due flags are computed automatically — they appear the moment an invoice or a tracked agency obligation (EFTPS, MD Withholding, MD UI, MD Sales Tax, etc.) goes past due unpaid, and clear the moment it's paid. Nothing to set up.",
          "Credit and Custom are the two kinds staff enters by hand — Credit records money owed to the client (an overpayment); Custom is for anything else worth flagging (e.g. \"Not in Good Standing\"), with an optional category, note, and due date.",
          "From the client's side panel, click + Flag to add a Credit or Custom flag; Resolve closes it (kept for history, not deleted). Every flag has a Share checkbox — check it, then use Notify Client to send that specific flag to the client by email/SMS.",
          "The Command Center's At-Risk Clients panel is this same signal rolled up firm-wide — check it there before opening clients one at a time.",
        ],
        useWhen: "Use a Custom flag for anything a client needs to know that the system can't compute on its own — a lapsed license, a state notice, anything that isn't a number already in the ledger.",
      },
      {
        heading: "Gov Forms tab — POA, government filing forms & maker-checker review",
        steps: [
          "Open a client, click the Gov Forms tab. It covers two families of documents: Authorization to Act / Release of Information (POA — IRS 2848, IRS 8821, MD 548), and the filing forms themselves (SS-4, 2553, W-9, 8832, CRA registration, 8822-B).",
          "Click New [form], fill in the fields (most pre-fill from the client's own profile), then Sign Now (In Person) — these are physical-signature-only forms; there is no client e-sign step on this tab.",
          "Once signed, click Mark Submitted to record it as filed — or, if your firm wants a second set of eyes first, Send for Review instead. An admin then sees it on the Command Center's Filing Reviews panel and clicks Approve & Submit (or Reject, which sends it back to Signed so it can be corrected and resent).",
          "Admin can Void a filing at any point, or Delete one that's still an unsigned Draft.",
        ],
        useWhen: "Use Send for Review whenever a filing should be checked before it goes out — the reviewing admin sees exactly who requested it and when, right on their own Command Center.",
      },
      {
        heading: "Permits & Compliance tab",
        steps: [
          "Open a client, click Permits & Compliance to track this client's health permits/licenses — expiration dates, renewal status, and notes per permit.",
          "This is distinct from the standalone HACCP plan generator (Health Permits in the sidebar): that page drafts the actual HACCP/food-safety plan document; this tab tracks the permits and licenses themselves.",
        ],
      },
      {
        heading: "Vault & Payment Methods tab (admin only)",
        steps: [
          "Open a client, click Vault & Payment Methods (admin only) to store this client's own portal/agency login credentials (encrypted at rest) and any saved payment methods on file.",
          "This is separate from the firm's own Portal Credentials vault (Firm section) — that one holds the firm's own logins to EFTPS/MD Tax Connect/etc.; this one holds each individual client's.",
        ],
      },
      {
        heading: "Tax Forms tab — sending W-4/W-9 to an employee to e-sign",
        steps: [
          "Open a client, click Tax Forms, then Send W-4 or Send W-9 for the employee who needs to fill one out.",
          "The employee gets it on their own portal (My Tax Forms) to fill in and electronically sign themselves — nothing for staff to fill in by hand.",
          "Once they submit it, it shows back up here, signed, ready to download or print.",
        ],
        useWhen: "Use this any time a new hire needs to submit a W-4, or an existing employee needs to update their withholding — no paper, no manual PDF stamping.",
      },
      {
        heading: "Sending a portal invite",
        steps: [
          "From the Clients list, open the row's Actions menu → Send Portal Invitation. Or from inside the client's profile.",
          "This creates a login for the client portal and gives you a one-time invite link to send them yourself (there is no automatic email for this step).",
        ],
      },
      {
        heading: "Archiving a client",
        steps: [
          "Open the client's Actions menu → Archive Client (admin only).",
          "This disables their portal and deactivates their portal users — it does not delete any records. An archived client can be found again by setting the Status filter to Archived.",
        ],
      },
    ],
    body: [],
  },

  // ---------------- Work: Tasks ----------------
  {
    key: "tasks",
    label: "Tasks",
    title: "Tasks",
    roles: ADMIN_STAFF_ROLES,
    group: "Work",
    topics: [
      {
        heading: "Reading the Tasks list",
        route: "/tasks", routeLabel: "Tasks",
        steps: [
          "Go to Tasks. The quick tabs split into two groups: live work (Active, Overdue, Due Today, Due Week, Waiting, All Active) and history (Completed, Archived, All History).",
          "Each row shows Client + Service, Task + Priority, Due date + how overdue/soon it is, and Owner + who last touched it, all stacked to keep the table narrow.",
          "Click the Status cell to change a task's status inline without opening it.",
        ],
      },
      {
        heading: "Creating a task or work item",
        steps: [
          "Click New Work Item (top right).",
          "Pick the client, the task type/service, and a due date. Assign it to a staff member.",
          "Save — the task appears in the list immediately.",
        ],
        useWhen: "Most tasks are created automatically by Rules (see the Rules topic) — use New Work Item for one-off requests that don't fit an existing recurring rule.",
      },
      {
        heading: "Working a task",
        steps: [
          "Click a row to open the full Task Detail page — status history, notes, messages, files, and an edit form all live there.",
          "From the row's Action menu you can jump straight to: Send Message, Add Note, Edit Task, Attach a File, or Request a Document from the client without leaving the list.",
          "Void a task (with a reason) if it no longer applies. Void is different from Delete — voided tasks stay in the record with a reason attached; deleted tasks are gone permanently and require typing a confirmation phrase.",
        ],
      },
      {
        heading: "Bulk actions",
        steps: [
          "Check the box on multiple rows (or the header checkbox to select every visible row).",
          "A bar appears with Mark Complete / Void / Delete (Delete is admin-only) — pick one to apply it to every selected task at once.",
        ],
        useWhen: "Use this when a whole batch of tasks needs the same status change, e.g. closing out everything from a filing period that's now done.",
      },
      {
        heading: "Requesting a document tied to a task",
        steps: [
          "From a task row's Action menu, choose Request Document.",
          "Describe what's needed and Save — it appears on the client's Documents tab (and their portal) as an open request, linked back to this task.",
        ],
      },
      {
        heading: "Status glossary",
        steps: [
          "Not Started — work hasn't begun yet. Open.",
          "In Progress / In Process — actively being worked (two labels, same meaning — In Process is an older parallel value). Open.",
          "Waiting Docs — blocked on paperwork from the client. Open, and counted in the dashboard's Waiting bucket.",
          "Waiting on Client — blocked on any client action (docs, a decision, a payment). Open, counted in Waiting.",
          "Pending — a general \"on hold\" state. Open, counted in Waiting.",
          "Preparation — paperwork is being drafted before it's filed. Open.",
          "Submitted — filed with the agency, waiting on their response. Open.",
          "In Review — an agency or internal review is in progress. Open.",
          "Inspection Phase — a physical inspection stage (permits/licenses). Open.",
          "Additional Information Required — the agency asked for more before it can proceed. Open, needs action.",
          "Fee Due — approved, just waiting on a payment. Open.",
          "Approved — the agency has approved it; still open until someone closes it out.",
          "Completed — finished. Excluded from every open/overdue/waiting count.",
          "Closed — administratively closed. Excluded from open counts.",
          "Archived — moved out of active view. Excluded from open counts.",
          "Void — cancelled; doesn't apply (requires a reason when set). Excluded from open counts.",
        ],
        useWhen: "This is the full status list a task can be set to — the exact same 17 values used to compute every Overdue/Due Soon/Waiting count on the dashboard and Tasks list. Picking a status outside this glossary isn't possible from the dropdown, but if a status ever looks unfamiliar (e.g. imported from elsewhere), this is what each one means and how it's treated.",
      },
    ],
    body: [],
  },

  // ---------------- Work: Calendar & Appointments ----------------
  {
    key: "calendar",
    label: "Calendar",
    title: "Calendar, capacity & appointments",
    roles: ADMIN_STAFF_ROLES,
    group: "Work",
    topics: [
      {
        heading: "Calendar view — deadlines by day",
        route: "/calendar", routeLabel: "Calendar",
        steps: [
          "Go to Calendar in the sidebar. It's a month grid — any day with an open task due shows a badge, and turns red if something on it is overdue.",
          "Click a day to see exactly which tasks (and any appointments) are due that day, for which client, assigned to whom.",
        ],
        useWhen: "Use this instead of scrolling the Tasks list when you're planning a week or checking \"what's due this Friday.\"",
      },
      {
        heading: "Capacity view — who's overloaded",
        steps: [
          "On the Calendar page, click the Capacity toggle.",
          "It's a table: one row per staff member, showing Open Tasks / Overdue / Due This Week.",
        ],
        useWhen: "Use it when assigning new work — if one person already has 70 open tasks and someone else has 5, that's who the next batch should go to.",
      },
      {
        heading: "Booking a client appointment",
        steps: [
          "From the Calendar view, click \"+ New Appointment\".",
          "Pick an existing client or enter a brand-new contact's name/email/phone, choose a date, time, and Assigned Staff, and save — a confirmation email and text go out automatically, and a reminder is sent the day before.",
          "Clients can also self-book through the public \"Book a Consultation\" link on the marketing site — those show up here the same way.",
        ],
      },
      {
        heading: "Editing, reassigning, or cancelling an appointment",
        steps: [
          "Click any existing appointment on the calendar to open the same New Appointment form pre-filled — change the date/time, or change Assigned Staff to reassign it; the newly assigned staff member gets notified.",
          "The client can cancel or reschedule it themselves from the link in their own confirmation email (no login needed) — a reschedule shows the old and new time together in the notice everyone gets; a cancellation notifies assigned staff immediately.",
          "The system also sends a confirmation-request reminder ahead of the appointment and asks the client to confirm they're still coming — no separate step for staff to trigger this.",
        ],
      },
      {
        heading: "Calendar Settings (admin only)",
        steps: [
          "On the Calendar page, click the Settings toggle (only visible to admins).",
          "Set bookable hours per weekday (not one blanket schedule — Monday can close earlier than Wednesday, for example), appointment length options, Gap Between Appointments (buffer time so back-to-back bookings aren't scheduled with zero travel/prep time), the office location/directions shown in confirmation emails, and the policy text sent with every booking.",
          "Reminder Lead Times and the staff/admin reminder channel are configured here too — set how many hours or days ahead a reminder goes out, and whether staff get theirs by email, SMS, or both.",
        ],
        useWhen: "Update this whenever office hours change — the public booking page and every confirmation email pull live from these settings, so there's nothing else to update by hand.",
      },
    ],
    body: [],
  },

  // ---------------- Work: Time Tracking ----------------
  {
    key: "time-tracking",
    label: "Time Tracking",
    title: "Time Tracking",
    roles: ADMIN_STAFF_ROLES,
    group: "Work",
    topics: [
      {
        heading: "Logging hours",
        route: "/time-tracking", routeLabel: "Time Tracking",
        steps: [
          "Go to Time Tracking. Pick a date, optionally a client (leave it blank for internal, non-billable time), and enter hours worked.",
          "If this time should be billed to the client, check Billable and enter an hourly rate.",
          "Save.",
        ],
      },
      {
        heading: "Approving time (admin)",
        steps: [
          "Open Time Tracking and review entries marked Billable.",
          "Click Approve on each one — only approved entries can be turned into an invoice, which keeps a mistaken hour count from getting billed before it's checked.",
        ],
      },
      {
        heading: "Billing unbilled time",
        steps: [
          "Once time is approved, go to that client's profile → Billing tab.",
          "A button appears: \"Create Invoice from Unbilled Time (count, $amount).\" Click it and it builds a real invoice with one line item per time entry, already posted to the books.",
        ],
        useWhen: "Use this for any engagement billed hourly instead of by flat fee — consulting, cleanup work, ad-hoc projects.",
      },
    ],
    body: [],
  },

  // ---------------- Work: Rules ----------------
  {
    key: "rules",
    label: "Task Rules",
    title: "Task Rules & batch tasks",
    roles: ADMIN_STAFF_ROLES,
    group: "Work",
    intro: "Rules are how almost every recurring task in the system actually gets created — most staff will never need to build one, but everyone should understand how they work so a task's origin makes sense.",
    topics: [
      {
        heading: "How a rule works",
        steps: [
          "A rule matches clients by a trigger condition (e.g. \"Sales Tax Frequency = Monthly\") and, when run, creates one task per matching client on the configured cadence.",
          "Each rule has warning windows (e.g. 30/14/7 days before due) that control when a task shows as Due Soon instead of just Not Started.",
        ],
      },
      {
        heading: "Running a batch",
        route: "/rules", routeLabel: "Task Rules",
        steps: [
          "Go to Task Rules in the sidebar. Click Create Batch Tasks (or Run Batch on a specific rule's row).",
          "The batch preview shows exactly which clients would get a new task before anything is created — review it, then confirm.",
        ],
        useWhen: "Use Create Batch Tasks at the start of a filing period (e.g. \"create every Sales Tax Filing task for this quarter\") instead of adding each client's task by hand.",
      },
      {
        heading: "Adding a new rule (admin)",
        steps: [
          "Click Add Rule. Pick the task type it creates, the trigger condition, the frequency, and the warning windows.",
          "Save — the rule is now available to run as a batch any time it applies. Click a rule's row any time afterward to open its detail page — edit or permanently delete it from there.",
        ],
      },
      {
        heading: "Task Rules Agent — auto-drafted batches, reviewed before they post",
        steps: [
          "The Task Rules Agent panel (top of the Task Rules page) runs every rule automatically overnight and drops the result here as a draft batch, instead of someone having to remember to click Create Batch Tasks — nothing it drafts becomes a real task until a person approves it.",
          "Each pending batch shows which rule it's from and how many clients would get a task. Reassign lets you change who a batch's tasks go to before approving; Dismiss throws the whole batch away.",
          "Select multiple batches with their checkboxes, then Approve Selected — or approve one at a time. Approving is what actually creates the tasks.",
          "\"Turn off automatic nightly drafting\" only pauses the automatic overnight run — Run Agent Now (manual, on demand) and the plain Create Batch Tasks flow above still work regardless of that setting.",
        ],
        useWhen: "Check this panel first thing in the morning during a busy filing period — most of the quarter's tasks are usually already drafted and just need a review, not a from-scratch batch run.",
      },
    ],
    body: [],
  },

  // ---------------- Work: Health Permits ----------------
  {
    key: "haccp",
    label: "Health Permits",
    title: "Health Permits (HACCP plans)",
    roles: ADMIN_STAFF_ROLES,
    group: "Work",
    topics: [
      {
        heading: "Generating a HACCP plan",
        route: "/haccp", routeLabel: "Health Permits",
        steps: [
          "Go to Health Permits in the sidebar.",
          "Fill in the business details and select the applicable menu categories.",
          "Generate the plan — it produces a business-specific, Maryland-COMAR-compliant food-safety document ready to submit with a health permit application.",
        ],
        useWhen: "This doesn't require an existing client record — use it for a brand-new business's permit application or an existing business's renewal.",
      },
    ],
    body: [],
  },

  // ---------------- Tools: Estimates & Pipeline ----------------
  {
    key: "estimates",
    label: "Estimates & Pipeline",
    title: "Estimates & Pipeline",
    roles: ADMIN_STAFF_ROLES,
    group: "Tools",
    topics: [
      {
        heading: "Creating and sending an estimate",
        route: "/estimates", routeLabel: "Estimates",
        steps: [
          "Go to Estimates → New Estimate. Pick a client (or enter a new prospect's info), then add line items — or click \"Rebuild from Fee Schedule\" to pull real pricing instead of typing amounts by hand.",
          "Click Preview PDF to check it, then Send to Client to email it.",
        ],
      },
      {
        heading: "Approving and converting from the Estimate page",
        steps: [
          "When the client says yes, open the estimate and click Mark Approved.",
          "Approving does not create a client by itself — click Convert to Client to actually turn it into a real client + invoice + starter task list in one step.",
        ],
        useWhen: "Use this when you're already on a specific estimate. Working a prospect from the board instead? The Pipeline topic below does the same two steps in one click.",
      },
      {
        heading: "Pipeline — four steps from prospect to client",
        route: "/pipeline", routeLabel: "Pipeline",
        steps: [
          "Step 1 — Add Prospect: click New Prospect on the Pipeline board and fill in just the business name, contact info, and what they're interested in. No entity type or pricing needed yet — that's added later on the estimate itself.",
          "Step 2 — Work the Deal: each card shows one button for its next stage. Click it to move New → Contacted once you've reached out, then Contacted → Proposal Sent once you've sent them a quote. If they say no at any point, click the small \"Mark Lost\" link instead.",
          "Step 3 — Mark Won: once they accept, click Mark Won on the card. This is the same as clicking Mark Approved on the estimate — the card moves into the \"Won — Ready to Convert\" column.",
          "Step 4 — Convert to Client: on the Won card, click Convert to Client and confirm. One click creates the real client record, an invoice for the quoted work, and a task for each government filing sold — and takes you straight to the new client's page.",
          "The top of the page shows your conversion rate (Won ÷ Won+Lost) for the selected period, and a Lost list at the bottom lets you Reopen a card if it was marked lost by mistake.",
        ],
        useWhen: "Use the conversion-rate number to see whether you're closing more or fewer prospects over time — check it monthly alongside Referral Source to see which lead sources actually convert.",
      },
    ],
    body: [],
  },

  // ---------------- Tools: Fee Schedule & Calculators ----------------
  {
    key: "fee-schedule",
    label: "Fee Schedule & Calculators",
    title: "Fee Schedule & Calculators",
    roles: ADMIN_STAFF_ROLES,
    group: "Tools",
    topics: [
      {
        heading: "Maintaining the Fee Schedule",
        route: "/fee-schedule", routeLabel: "Fee Schedule",
        steps: [
          "Go to Fee Schedule. Click Add Fee to add a new priced service, or click an existing row to edit its amount.",
          "Changing a fee here only affects future estimates — estimates already sent keep the amounts they were built with.",
        ],
        useWhen: "Keep this current so every new estimate built with \"Rebuild from Fee Schedule\" reflects real, up-to-date pricing instead of stale numbers copied from an old quote.",
      },
      {
        heading: "Sales Tax Calculator",
        route: "/calculators", routeLabel: "Calculators",
        steps: [
          "Go to Calculators. Enter gross sales and click + Add Category for each taxable category, or just enter one blended amount.",
          "It computes the tax due per the selected state's rate — nothing here is saved, it's scratch math for the counter.",
        ],
      },
      {
        heading: "Safe Harbor (estimated tax) Calculator",
        steps: [
          "On the same Calculators page, enter last year's tax and this year's projected tax.",
          "It shows the quarterly estimated payment that satisfies the IRS safe-harbor rule, avoiding an underpayment penalty.",
        ],
      },
    ],
    body: [],
  },

  // ---------------- Money: Billing ----------------
  {
    key: "billing",
    label: "Billing & Invoices",
    title: "Billing & invoices",
    roles: ADMIN_STAFF_ROLES,
    group: "Money",
    topics: [
      {
        heading: "Creating and sending an invoice",
        route: "/billing", routeLabel: "Billing",
        steps: [
          "Go to Billing → New Invoice (or from a client's profile → Billing tab).",
          "Add line items, set a due date, and Save.",
          "Open the invoice and click Send — pick email, SMS, and/or WhatsApp. The client gets a link to view and pay it online (once card payments are connected) with no login required.",
        ],
      },
      {
        heading: "Recording a payment",
        steps: [
          "Open the invoice and click Record Payment.",
          "Enter the amount and method — it updates the balance due and posts to the client's General Ledger automatically.",
        ],
      },
      {
        heading: "Recurring billing",
        steps: [
          "From the Billing page, click Add Recurring. Pick the client, amount, frequency, and (optionally) turn on auto-send so the invoice emails itself when created.",
          "Recurring invoices generate automatically on a schedule — nothing to click each cycle. You can still force one to run early from that schedule's Actions menu if needed.",
        ],
        useWhen: "Use this for any client on a flat monthly/quarterly retainer instead of building the same invoice by hand every period.",
      },
      {
        heading: "Invoice status rules",
        steps: [
          "Paid and Void invoices are locked — line items can no longer be edited, which keeps the books from drifting after money has actually moved.",
          "To fix a mistake on a Paid invoice, void it and create a corrected one instead of editing history.",
        ],
      },
    ],
    body: [],
  },

  // ---------------- Money: Accounting ----------------
  {
    key: "accounting",
    label: "Accounting",
    title: "Accounting workspace",
    roles: ADMIN_STAFF_ROLES,
    group: "Money",
    intro: "Everything under Accounting works the same way: pick a client at the top, then a date range, and every tab below reads/writes that client's own books. Nothing here is shared across clients.",
    topics: [
      {
        heading: "Sales Input & Payroll",
        steps: [
          "Sales tab: enter a date, gross sales breaks into taxable categories with \"+ Add Category\", Save Sales Input — this posts to that client's GL and feeds the Sales Tax report.",
          "Employees tab: the employee records themselves — pay rate, filing status, county/state exemptions, pay frequency. Add or edit an employee here before they can be paid.",
          "Payroll tab: create paychecks (single or Batch Create Paychecks for several employees at once), with real IRS-bracket federal + state withholding calculated automatically per employee — and, from the same tab, enroll this client into the Payroll Agent for automatic recurring drafts (see the Payroll Agent section).",
          "Paychecks tab: the running paycheck history/ledger for this client — every paycheck ever created, filterable by period.",
        ],
      },
      {
        heading: "Contractors & Manual JE",
        steps: [
          "Contractors tab: track 1099 contractor payments the same way payroll tracks employees.",
          "Manual JE tab: for anything that doesn't fit Sales/Payroll/Contractors — a straight debit/credit journal entry directly to the General Ledger.",
        ],
      },
      {
        heading: "GL & Chart of Accounts",
        steps: [
          "GL tab: every posted transaction for this client, in one running ledger.",
          "COA tab: the client's Chart of Accounts — add or rename accounts here; every other tab's dropdowns pull from this list.",
        ],
      },
      {
        heading: "Import",
        steps: [
          "Import tab: upload a spreadsheet (sales, payroll, employees, or contractor data) exported from another system.",
          "Click Preview first — it shows exactly what will be created/changed before anything is committed. Review it, select the rows you want, then Commit.",
        ],
        useWhen: "Use this once when first bringing a client's historical records into the system, instead of retyping every row by hand.",
      },
      {
        heading: "Budget",
        steps: [
          "Budget tab: pick a year, then type a dollar target into any account/month cell (e.g. \"$2,500\" for Rent Expense in June). Click Save Budget.",
          "Click the Variance toggle to see actual — pulled live from that client's real GL activity — next to what was budgeted, with the difference in $ and %, colored teal (favorable) or red (unfavorable).",
        ],
        useWhen: "Use it for a client on ongoing bookkeeping who wants to stay on plan, or to catch a category that's blown past what was expected.",
      },
      {
        heading: "Bank Rec — uploading a statement and matching by hand",
        steps: [
          "Bank Rec tab: pick which bank/cash account you're reconciling.",
          "Upload the client's own bank statement export (.csv/.xls/.xlsx/.pdf — needs a Date column and either an Amount column or separate Debit/Credit columns).",
          "Unmatched bank lines appear on one side, unmatched GL entries on the other. Click one of each that represent the same transaction, then click Match — or click Auto-Match to have the system match by exact amount + nearest date (within 10 days) across everything unmatched at once.",
          "If a bank line has nothing in the books yet (a bank fee, an unrecorded charge), click New Entry on that line instead, pick which account to charge it to, and it creates the missing GL entry and matches it in one step.",
          "The top of the page shows Book Balance vs. Cleared Balance vs. Difference — when Difference hits $0.00, that account is fully reconciled for the period uploaded.",
        ],
      },
      {
        heading: "Bank Rec Agent — suggested journal entries for unmatched lines",
        steps: [
          "After a statement upload, any bank line the system can't already match shows up in Suggested Journal Entries with a guessed category — from a remembered rule when one matches (\"suggested from rule ...\"), or blank if nothing matched yet.",
          "Pick or confirm the Category, then Approve — this creates and posts the actual journal entry. Dismiss instead if a line genuinely needs no entry (already accounted for elsewhere).",
          "Check \"Remember this categorization\" before approving to turn that vendor/description into a rule — the next matching bank line from the same source gets the same category suggested automatically, so the list gets shorter to review over time.",
          "Approved entries move down to Ready to Reconcile — click Confirm Match (or Confirm All) once you've checked each one actually clears against its bank line. This is the same final reconciliation step as manual matching, just for entries the Agent helped create.",
        ],
        useWhen: "Use \"Remember this categorization\" for anything recurring (a monthly software subscription, a regular vendor) — a few minutes spent teaching it now means those lines stop needing review every future statement.",
      },
      {
        heading: "Month-End, Year-End, Check Settings & Tax Rates",
        steps: [
          "Month-End / Year-End tabs: closing checklists and period-lock tools for that client's books.",
          "Check Settings tab: calibrate MICR check printing (line positions, font) if this firm prints physical paychecks.",
          "Tax Rates tab: the sales-tax rate table by state/category used across Sales Input and the calculator — keep it current when a jurisdiction changes its rate.",
        ],
      },
    ],
    body: [],
  },

  // ---------------- Money: Payroll Agent ----------------
  {
    key: "payroll-agent",
    label: "Payroll Agent",
    title: "Payroll Agent",
    roles: ADMIN_STAFF_ROLES,
    group: "Money",
    intro: "The Payroll Agent drafts upcoming paychecks ahead of time on a recurring schedule, so no one has to remember pay day — every draft still needs a human Approve before it becomes a real, posted paycheck.",
    topics: [
      {
        heading: "Enrolling an employee",
        steps: [
          "From Accounting → Payroll tab (pick the client first), enroll an employee in Auto Payroll and set their pay frequency, next pay date, and how many lead days ahead of pay day a draft should be created.",
          "Or from the Payroll Agent page itself, click \"Enroll More →\" — it takes you to that same Accounting → Payroll tab.",
        ],
      },
      {
        heading: "Reviewing and approving drafts",
        route: "/payroll-agent", routeLabel: "Payroll Agent",
        steps: [
          "Go to Payroll Agent. Every enrolled employee whose lead-days window has opened shows up under Pending Drafts.",
          "Click Edit on a draft to override hours, rate, or gross wages before approving — otherwise it uses the employee's normal pay rate.",
          "Approve turns the draft into a real, posted paycheck — the exact same action as manually creating one on Accounting → Payroll. Dismiss skips that pay date instead (with an optional reason) without touching the employee's ongoing schedule.",
        ],
        useWhen: "Check this page a day or two before each pay run — drafts are usually already sitting there ready for a quick review instead of building every paycheck from scratch.",
      },
      {
        heading: "Turning Auto Payroll on or off",
        steps: [
          "\"Turn off automatic nightly drafting\" (top of the Payroll Agent page) only pauses the overnight sweep that creates new drafts — it doesn't touch drafts already pending, and manual paycheck creation on Accounting → Payroll keeps working regardless.",
          "Enrolled Employees lists every schedule; toggle Show off to see paused schedules without deleting them.",
        ],
      },
    ],
    body: [],
  },

  // ---------------- Money: Reports ----------------
  {
    key: "reports",
    label: "Reports",
    title: "Reports",
    roles: ADMIN_STAFF_ROLES,
    group: "Money",
    topics: [
      {
        heading: "Financial reports (P&L, account snapshot)",
        route: "/reports", routeLabel: "Reports",
        steps: [
          "Go to Reports, pick a client and a period.",
          "The P&L and account-balance tabs pull straight from that client's GL data — the same numbers you'd see in the Accounting workspace, just formatted for review or printing.",
        ],
      },
      {
        heading: "AR Aging",
        route: "/firm-report", routeLabel: "Firm Report",
        steps: [
          "Go to Firm Report → AR Aging. It's firm-wide (no client picker) — every client with an open invoice balance shows up, bucketed by how overdue it is: Current, 1-30, 31-60, 61-90, 90+ days.",
          "Download PDF or Export CSV if you want to hand it to someone or archive it.",
        ],
        useWhen: "Use it monthly (or whenever doing collections) to see who to follow up with first — anything in the 61-90 or 90+ buckets needs attention soonest.",
      },
      {
        heading: "Sales, Tax & Payroll Report and Client Message Report",
        steps: [
          "The Sales, Tax & Payroll tab gives a bilingual (English/Arabic) summary of a client's sales tax and payroll activity for a period — built for handing directly to a client.",
          "The Client Message tab formats the same kind of period summary as a bilingual table, ready to send as an actual message.",
          "Every report tab has Email Report / Text Report buttons to send it directly instead of exporting and attaching it by hand.",
        ],
      },
      {
        heading: "Employee report",
        steps: [
          "The Employee tab pulls pay history for one employee across a period — useful when an employee or their lender asks for proof of income.",
        ],
      },
    ],
    body: [],
  },

  // ---------------- Client Communication: Documents ----------------
  {
    key: "documents",
    label: "Documents",
    title: "Documents",
    roles: ADMIN_STAFF_ROLES,
    group: "Client Communication",
    topics: [
      {
        heading: "Firm-wide Documents triage",
        route: "/documents", routeLabel: "Documents",
        steps: [
          "Go to Documents in the sidebar for a firm-wide view of every open document request across all clients — use it to see what's still outstanding without opening each client one by one.",
          "For a specific client's documents (contracts, uploads, checklist), open that client's profile → Documents tab instead.",
        ],
      },
      {
        heading: "Requesting a document from a client",
        steps: [
          "From a client's Documents tab (or a task's Action menu), click Request Document.",
          "Describe what's needed, optionally set a due date and priority, Save — it appears on the client's portal for them to upload against directly.",
        ],
      },
      {
        heading: "Uploading or sharing a file with a client",
        steps: [
          "From a client's Documents tab, click Upload / Send File to Client.",
          "Drag a file in (or click to browse), add a note if useful, and choose whether it's visible in the client's portal or staff-only.",
        ],
      },
      {
        heading: "Document Checklists (admin sets up, then automatic)",
        route: "/document-checklists", routeLabel: "Document Checklists",
        steps: [
          "An admin sets up templates once: go to Document Checklists (Firm section), click New Checklist, name it (e.g. \"Business Formation Checklist\"), optionally restrict it to a Client Type and/or Service, then add the required documents (e.g. \"Articles of Organization,\" \"EIN Letter\").",
          "After that, it's automatic: open any client whose type/services match a template, go to their Documents tab, and a checklist card appears with checkboxes for each required item.",
          "Check items off as they're actually received from the client.",
        ],
        useWhen: "This is separate from Document Requests (which asks the client to upload something) — it's an internal \"did we get everything we need\" tracker for the firm's own use.",
      },
      {
        heading: "Status glossary",
        steps: [
          "Requested — just asked for; nothing received from the client yet. Open.",
          "Open — being actively tracked. Open.",
          "Waiting on Client — the client still needs to send something. Open.",
          "Received — the file is in; nothing more needed from the client. Open until closed out.",
          "Completed — fully resolved. Excluded from the overdue count.",
          "Closed — administratively closed. Excluded from the overdue count.",
          "Void — no longer needed / cancelled. Excluded from the overdue count.",
        ],
        useWhen: "The full status list a document request can be set to — the same 7 values used to compute the overdue-request highlighting on the Documents list.",
      },
    ],
    body: [],
  },

  // ---------------- Client Communication: Communications ----------------
  {
    key: "communications",
    label: "Communications",
    title: "Communications",
    roles: ADMIN_STAFF_ROLES,
    group: "Client Communication",
    topics: [
      {
        heading: "Messaging a client",
        steps: [
          "From a client's Communications tab (or the Communications page), write a message and pick a channel: Email, SMS, or WhatsApp — or several at once.",
          "Pick a saved Template to start from, or write it from scratch. Attach a file if needed.",
          "Send — it's logged to that client's history immediately, whether it succeeds or fails, so you always know what was attempted.",
        ],
      },
      {
        heading: "Bulk client messages",
        route: "/communications", routeLabel: "Communications",
        steps: [
          "Go to Communications → Bulk Client Message.",
          "Select clients (checked clients bubble to the top of the list), pick a Template and period dates if the template uses them, and review the per-client preview — placeholders like client name and period fill in automatically for each recipient.",
          "Send once to reach every selected client.",
        ],
        useWhen: "Use this for anything that goes to many clients at once with the same message shape — a filing-deadline reminder, a holiday-hours notice.",
      },
      {
        heading: "Staff messages",
        steps: [
          "Staff messages (a separate composer) are internal, firm-to-firm — not tied to any client record.",
        ],
      },
      {
        heading: "Templates",
        route: "/templates", routeLabel: "Templates",
        steps: [
          "Go to Templates (Client Communication section) to manage the reusable message and contract templates used everywhere above.",
          "Message templates support placeholders (client name, period dates, etc.) that fill in automatically when used.",
          "Contract templates are what auto-generates a client's engagement letter based on their checked Services on the Profile tab.",
        ],
      },
      {
        heading: "Reminder Center (automatic digests)",
        steps: [
          "There's nothing to click day-to-day — Task Rules generate work automatically based on each client's service settings, and warning windows (e.g. 14/7/3 days) control when a task is flagged Due Soon.",
          "Staff and the firm each get one consolidated digest email per day (not one email per task) summarizing what's overdue, due soon, and waiting.",
        ],
      },
    ],
    body: [],
  },

  // ---------------- Firm ----------------
  {
    key: "firm-admin",
    label: "Firm Administration",
    title: "Firm administration",
    roles: ADMIN_STAFF_ROLES,
    group: "Firm",
    intro: "Everything in this section is admin-only, except where noted.",
    topics: [
      {
        heading: "Users & Access",
        route: "/users", routeLabel: "Users & Access",
        steps: [
          "Go to Users & Access. Click Add User to create a new Admin, Staff, Client, or Employee login.",
          "From an existing user's row: Edit their details, Deactivate their access (keeps the record, blocks login), Set Temporary Password (for when someone's locked out and can't use the self-service reset), or Delete permanently (requires typed confirmation).",
        ],
      },
      {
        heading: "Security Center",
        route: "/security", routeLabel: "Security",
        steps: [
          "Go to Security to review the firm-wide lockout policy, every portal user's password status (Not Set / Must Reset / Ready and Current / Legacy hash strength), and failed-login counts.",
          "Recent Login / Security Events shows a live audit trail of sign-ins and sensitive actions across the firm.",
          "Backup & Restore: download an encrypted backup of the database, or restore from one — restoring is destructive and should only be used to recover from a real data-loss event.",
        ],
      },
      {
        heading: "Portal Credentials (the firm's own vault)",
        route: "/firm-portals", routeLabel: "Portal Credentials",
        steps: [
          "Go to Portal Credentials. This stores the firm's own agency logins — EFTPS, MD Tax Connect, state unemployment portals, anything the office signs into — not client passwords.",
          "Click Add Portal to save a new one. Passwords are encrypted on the server and only decrypted when you click Reveal; every reveal is written to the access log.",
        ],
      },
      {
        heading: "Firm Settings",
        route: "/firm-settings", routeLabel: "Firm Settings",
        steps: [
          "Go to Firm Settings to edit the firm's name, address, phone, and logo — these feed every PDF, email, and the login screen automatically, so there's nothing else to update by hand when branding changes.",
        ],
      },
      {
        heading: "List Settings",
        route: "/list-settings", routeLabel: "List Settings",
        steps: [
          "Go to List Settings to manage the option lists used in dropdowns across the app (task types, service categories, etc.) without needing a code change for every new option.",
        ],
      },
      {
        heading: "Fix Center",
        route: "/fix-center", routeLabel: "Fix Center",
        steps: [
          "Go to Fix Center for system-health self-diagnostics: a database connectivity check, table row counts (useful when comparing before/after a data change), and tools to seed default setup data on a fresh environment.",
        ],
        useWhen: "Use this first when something looks broken and you're not sure if it's a data problem or a real bug — it's built to answer that quickly.",
      },
      {
        heading: "Labels",
        route: "/labels", routeLabel: "Labels",
        steps: [
          "Go to Labels. Pick a name and a color, click Add — this is a firm-wide palette, not per-client.",
          "On the Clients or Tasks list, click the + on any row to attach one or more labels; click the × on a chip to remove one. Every staff member sees the same labels on the same records immediately.",
        ],
        useWhen: "Use labels for anything that doesn't fit a status field — \"VIP,\" \"Needs Attention,\" \"New This Year\" — a quick visual cue on the list view, not a workflow state.",
      },
    ],
    body: [],
  },

  // Client + employee — how to put the portal on a phone home screen (the install
  // banner is dismissible, so these steps need a permanent, findable home too).
  {
    key: "install-app",
    label: "Install App",
    title: "Put the portal on your phone",
    roles: ["client", "employee"],
    labelKey: "guide.install.label", titleKey: "guide.install.title",
    bodyKeys: ["guide.install.body.0", "guide.install.body.1", "guide.install.body.2"],
    body: [
      "iPhone (Safari): tap the Share button (the square with an arrow), scroll down, tap \"Add to Home Screen\", then tap \"Add\".",
      "Android (Chrome): tap the ⋮ menu in the corner, then tap \"Add to Home screen\" or \"Install app\".",
      "The AL TAX icon appears on your home screen — from then on, open your portal with one tap, full screen like any app.",
    ],
  },

  // Client role — 4 topics, client-specific wording (legacy: Client Portal, Messages, Task Process, Billing)
  {
    key: "client-portal",
    label: "Client Portal",
    title: "Client Portal basics",
    roles: ["client"],
    labelKey: "guide.client-portal.label", titleKey: "guide.client-portal.title",
    bodyKeys: [
      "guide.client-portal.body.0", "guide.client-portal.body.1", "guide.client-portal.body.2",
      "guide.client-portal.body.3", "guide.client-portal.body.4", "guide.client-portal.body.5",
    ],
    body: [
      "You only see records for your own company.",
      "Use Documents to review what AL TAX has requested and upload files directly.",
      "Use Communications to message AL TAX and see replies in one history.",
      "Use My Business to fill in your own business profile details AL TAX uses for advisory work — update it any time something changes.",
      "Agreements shows every contract you've signed or have pending; Government Filings shows the filings AL TAX has submitted on your behalf — both are read-only references.",
      "Any account notice AL TAX flags for you (a balance issue, a compliance concern) shows on your Command Center under Account Notices.",
    ],
  },
  {
    key: "client-messages",
    label: "Messages",
    title: "Messages",
    roles: ["client"],
    labelKey: "guide.client-messages.label", titleKey: "guide.client-messages.title",
    bodyKeys: ["guide.client-messages.body.0", "guide.client-messages.body.1", "guide.client-messages.body.2"],
    body: [
      "Send a message to AL TAX any time from Communications.",
      "Every message is saved for staff to review and reply to.",
      "Replies and updates from AL TAX show up in the same message history.",
    ],
  },
  {
    key: "client-task-process",
    label: "Task Process",
    title: "How your work gets done",
    roles: ["client"],
    labelKey: "guide.client-task-process.label", titleKey: "guide.client-task-process.title",
    bodyKeys: ["guide.client-task-process.body.0", "guide.client-task-process.body.1"],
    body: [
      "AL TAX sets up recurring work — filings, payments, renewals — automatically based on your service settings.",
      "If something is needed from you (a document, a signature, information), you'll see a request appear on your Documents page.",
    ],
  },
  {
    key: "client-billing",
    label: "Billing",
    title: "Billing",
    roles: ["client"],
    labelKey: "guide.client-billing.label", titleKey: "guide.client-billing.title",
    bodyKeys: ["guide.client-billing.body.0", "guide.client-billing.body.1", "guide.client-billing.body.2"],
    body: [
      "Review your open and paid invoices, payment history, and statements from Billing.",
      "Your Tax Payments — what you owe agencies directly, separate from AL TAX's invoices — also appears on the Billing page.",
      "Contact AL TAX through Messages if anything on an invoice looks incorrect before a payment is processed.",
    ],
  },

  // Employee role — 4 topics, employee-specific wording (legacy: Employee, Login, Messages, Data Storage)
  {
    key: "employee-portal",
    label: "Employee",
    title: "Employee portal",
    roles: ["employee"],
    labelKey: "guide.employee-portal.label", titleKey: "guide.employee-portal.title",
    bodyKeys: ["guide.employee-portal.body.0", "guide.employee-portal.body.1", "guide.employee-portal.body.2"],
    body: [
      "View your paystubs shared by payroll, including gross pay, taxes, and net pay for each period.",
      "Contact the firm through Messages if something on a paystub needs review.",
      "Under My Tax Forms, fill in and electronically sign a W-4 or W-9 whenever staff sends you one — no printing, no scanning.",
    ],
  },
  {
    key: "employee-login",
    label: "Login",
    title: "Signing in",
    roles: ["employee"],
    labelKey: "guide.employee-login.label", titleKey: "guide.employee-login.title",
    bodyKeys: ["guide.employee-login.body.0", "guide.employee-login.body.1", "guide.employee-login.body.2"],
    body: [
      "Enter the email on file and your password.",
      "If your account has no password yet, ask an Admin to set a temporary one or send an invite.",
      "Five incorrect attempts locks the account for 15 minutes.",
    ],
  },
  {
    key: "employee-messages",
    label: "Messages",
    title: "Messages",
    roles: ["employee"],
    labelKey: "guide.employee-messages.label", titleKey: "guide.employee-messages.title",
    bodyKeys: ["guide.employee-messages.body.0", "guide.employee-messages.body.1"],
    body: [
      "Contact AL TAX through Messages about your paystub, direct deposit, or account questions.",
      "Replies show up in the same message history.",
    ],
  },
  {
    key: "employee-data",
    label: "Data Storage",
    title: "Where your data lives",
    roles: ["employee"],
    labelKey: "guide.employee-data.label", titleKey: "guide.employee-data.title",
    bodyKeys: ["guide.employee-data.body.0", "guide.employee-data.body.1"],
    body: [
      "Your pay records are stored in PostgreSQL (Neon), not spreadsheets.",
      "Bank account numbers on file are encrypted at rest and only decrypted on individually-audited access.",
    ],
  },
];

export function GuidePage() {
  const { user } = useAuth();
  const { t, dir } = useLanguage();
  const role = user?.role || "client";
  const visibleSections = SECTIONS.filter((s) => s.roles.includes(role));
  const fallback = visibleSections[0] || SECTIONS[0];
  const [active, setActive] = useState(fallback.key);
  const section = visibleSections.find((s) => s.key === active) || fallback;
  const sectionBody = section.bodyKeys ? section.bodyKeys.map((k) => t(k)) : section.body;

  // Group the TOC the same way the sidebar groups nav items, so the manual's own
  // navigation feels like the app it's documenting. Sections with no `group`
  // (Getting Started) render ungrouped at the top, same as Command Center does.
  let lastGroup: string | undefined;

  return (
    <div className="command-panel" dir={dir}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">{role === "client" || role === "employee" ? t("guide.pageTitle") : "Instruction Manual"}</h2>
          <div className="command-panel-note">{role === "client" || role === "employee" ? t("guide.pageNote") : "A self-paced walkthrough of every area of the app — pick a topic on the left."}</div>
        </div>
      </div>
      <div className="guide-layout">
        <div className="guide-toc">
          {visibleSections.map((s) => {
            const showGroupHeader = s.group && s.group !== lastGroup;
            lastGroup = s.group;
            return (
              <div key={s.key}>
                {showGroupHeader && <div className="nav-group-label">{s.group}</div>}
                <button
                  type="button"
                  className={`nav-item ${active === s.key ? "active" : ""}`}
                  style={{ width: "100%", color: active === s.key ? "var(--teal)" : "var(--ink)", background: active === s.key ? "var(--teal-soft)" : "var(--surface)", border: "1px solid var(--line)" }}
                  onClick={() => setActive(s.key)}
                >
                  {s.labelKey ? t(s.labelKey) : s.label}
                </button>
              </div>
            );
          })}
        </div>
        <div className="card">
          <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>{section.titleKey ? t(section.titleKey) : section.title}</h3>
          {section.intro && <p className="muted" style={{ margin: "0 0 16px", fontSize: 13 }}>{section.intro}</p>}

          {section.key === "nexus-playbook" ? (
            <NexusPlaybookGuide />
          ) : section.topics ? (
            <div style={{ display: "grid", gap: 18 }}>
              {section.topics.map((topic, i) => (
                <div key={i}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontWeight: 800, fontSize: 13.5 }}>{i + 1}. {topic.heading}</div>
                    {topic.route && (
                      <Link to={topic.route} style={{ fontSize: 12, fontWeight: 700, color: "var(--teal)", whiteSpace: "nowrap" }}>
                        Go to {topic.routeLabel} →
                      </Link>
                    )}
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5, fontSize: 13, color: "var(--ink)" }}>
                    {topic.steps.map((line, j) => <li key={j}>{line}</li>)}
                  </ol>
                  {topic.useWhen && (
                    <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5, fontStyle: "italic" }}>{topic.useWhen}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 13, color: "var(--ink)" }}>
              {sectionBody.map((line, i) => <li key={i}>{line}</li>)}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
