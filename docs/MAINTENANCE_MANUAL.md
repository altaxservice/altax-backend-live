# AL TAX NEXT — Maintenance Manual

Written for someone with **no programming background** who needs to understand, run, and troubleshoot this application. If a term needs a computer science degree to understand, this document either explains it in plain English or tells you exactly who/what to ask.

---

## 1. What this app actually is

AL TAX NEXT is the software AL TAX SERVICE uses to run the firm day-to-day: client records, tasks, payroll, invoices, documents, tax forms, and messaging. It has two halves that work together:

- **The backend** — a program that talks to the database, does calculations, generates PDFs, and sends email/SMS. Nobody looks at this directly; it just needs to be *running*.
- **The frontend** — the actual website you click around in (the sidebar, the tables, the buttons). This is what "the app" means to everyone except a developer.

Both halves live in one folder on this computer:

```
/Users/abdulsamadalmabari/Library/CloudStorage/OneDrive-AlTaxserviceLLC/Traker/altax-backend-live
```

Everything in this manual assumes you're looking at that folder.

---

## 2. Where the code lives (the folder map)

You don't need to read code to use this manual, but here's the map so that when I say "the file that generates invoices," you know where that idea lives:

```
altax-backend-live/
├── .env                    ← the app's secrets & settings (see Section 4 — never share this file)
├── src/                    ← THE BACKEND — all server-side code
│   ├── server.ts           ← the file that starts everything
│   ├── config/db.ts        ← how the backend connects to the database
│   ├── common/             ← shared building blocks (encryption, email/SMS, PDF helpers)
│   └── modules/            ← one folder per feature area:
│       ├── accounting/     ← payroll, paychecks, W-2/1099/W-3/940/941/1096 tax forms
│       ├── billing/        ← invoices, recurring billing, statements
│       ├── clients/        ← client records
│       ├── communications/ ← messages, reminders
│       ├── documents/      ← document requests & uploads
│       ├── reports/        ← the Reports page's numbers
│       ├── reminders/      ← the "Run Reminders" self-serve digest system
│       ├── system/         ← Fix Center, system health checks
│       ├── tasks/          ← the task pipeline
│       ├── templates/      ← message templates (English/Arabic)
│       └── users/          ← portal accounts, login, invites
├── frontend/                ← THE WEBSITE — everything you see in the browser
│   └── src/
│       ├── pages/           ← one file per page (e.g. ClientsListPage.tsx = the Clients screen)
│       ├── components/      ← reusable pieces (buttons, modals, the sidebar)
│       └── api/client.ts    ← how the website talks to the backend
├── sql/001_init_schema.sql  ← the full database structure, in one file
└── docs/                    ← this manual, the user manual, and internal audit notes
```

**Rule of thumb:** if something is *wrong on a page*, the fix is almost always in `frontend/src/pages/`. If something is *wrong with a number, a PDF, or an email*, the fix is in `src/modules/`.

---

## 3. Running the app

Right now, this app runs on this one Mac, not on the internet. Two things need to be running at the same time:

1. **The backend** (port 4000) — `npm run dev` from the project's root folder.
2. **The frontend** (port 5173) — `npm run dev` from inside the `frontend/` folder.

Once both are running, the app is reachable at **http://localhost:5173** in a web browser, on this computer only. If you close the terminal windows running these, the app stops working until they're started again.

**This is a development setup, not a real deployment.** Nobody outside this Mac can reach it. Getting this onto the real internet (so clients/staff can log in from anywhere) is a separate, one-time project — ask your developer (me) when you're ready for that step. It involves: putting the code on a real hosting service, pointing a domain name at it, and moving all the secrets in `.env` to that hosting service's secret storage instead of a plain file.

---

## 4. The `.env` file — the app's secrets

`.env` (in the root folder) is a plain text file holding every password/key the app needs to function. **Treat it like a physical key to the office — never email it, never post it anywhere, never commit it to a public place.**

Here's what's in it and why it matters, in plain English:

| Setting | What it's for | If it's missing/wrong |
|---|---|---|
| `DATABASE_URL` | The address + password for the database (where every client, task, invoice, and paycheck actually lives) | The **entire app stops working** |
| `JWT_SECRET` | The secret the app uses to know a logged-in session is genuine | If this is weak or guessable, someone could fake being logged in as an admin without a password. **Fix Center checks this automatically.** |
| `VAULT_MASTER_KEY` | Encrypts SSNs, EINs, and bank account numbers before they're saved | Without it, sensitive fields can't be saved or read at all. **If you ever lose this key, every SSN/bank number already saved becomes permanently unreadable — back this up somewhere safe outside this folder (a password manager), separately from the code.** |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Lets the app send real emails | Without it, the app still *logs* that it tried to send an email, but nothing actually arrives |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Lets the app send real SMS/WhatsApp messages | Same as above, but for text messages |
| `PORTAL_BASE_URL` / `FRONTEND_BASE_URL` | The web address used inside invite emails/links | If wrong, invite links in emails will point to the wrong place |

**Fix Center (see Section 6) automatically checks the important ones and tells you in plain English if something's missing.**

---

## 5. The database — where the actual data lives

The database is hosted by a company called **Neon** (a cloud database provider), not on this Mac. That's actually good — it means your data isn't lost if this laptop breaks, and Neon keeps its own backups automatically.

- You do not need to "back up the database" yourself day-to-day — Neon handles that.
- If you ever need to look at raw data directly (not through the app), that requires a database tool and the `DATABASE_URL` from `.env` — this is a developer task, not something to attempt casually, since a wrong command can delete real data with no undo button.
- The full structure of every table (what a "client," "task," "invoice," etc. actually looks like inside the database) is documented in `sql/001_init_schema.sql`, if a developer ever needs it.

---

## 6. Fix Center — the app's own self-checkup

Inside the app, as an Admin, there's a **Fix Center** page in the left sidebar. This is the first place to look whenever something seems wrong. It runs a plain-English checklist and tells you:

- **OK** (green) — that part of the system is fine.
- **Needs attention** (yellow) — not broken, but worth knowing about (e.g., a client is missing a value a tax form needs).
- **Critical** (red) — something that actually needs fixing soon, with a plain explanation of the real-world impact.

Some issues have a **"Fix Now"** button that repairs them immediately from the browser — no code, no terminal. Anything without a Fix Now button needs a person to make a judgment call (e.g., "which of these two spellings of this employee's name is correct?") and is explained clearly enough that you can either fix it yourself in the relevant page, or hand the exact sentence to a developer.

Current checks (this list will grow over time as new things are learned):

1. **Database connection** — is the app actually able to reach its data right now?
2. **Login security key** — is the sign-in system using a real secret, or the sample placeholder? (Has a one-click fix.)
3. **Sensitive-data encryption** — is the key that protects SSNs/bank numbers set?
4. **Email sending** — is a real email account connected?
5. **SMS / WhatsApp sending** — is a real Twilio account connected?
6. **Portal users who can log in** — is anyone stuck with an account they can never access?
7. **Paycheck ↔ employee name matching** — does every paycheck's name exactly match a real employee record? (A mismatch silently drops that paycheck from tax forms and reports — this exact bug was found and fixed once already; this check catches it happening again.)
8. **Employer EINs on file** — does every client running payroll have the EIN their tax forms need?

**When to check Fix Center:** any time something on the app looks wrong, before assuming it's "broken" — most of the time it'll tell you exactly what's missing and how urgent it is.

---

## 7. Common problems and what to do

### "The website won't load at all"
The backend and/or frontend server isn't running. This almost always means the terminal window(s) running `npm run dev` were closed. Restart them (Section 3), or ask your developer.

### "I sent an email/text and the client never got it"
1. Open Fix Center — check the "Email sending" and "SMS / WhatsApp sending" rows.
2. If those say OK, the issue is usually that the sending domain isn't verified yet with the email provider (Resend) — this is a one-time setup step, not a bug. Ask your developer for the current status.
3. Every message the app tries to send is logged (visible on the Communications page) with the exact reason it failed, in plain English — check there first.

### "A tax form (W-2, 1099, W-3, 940, 941, 1096) is missing numbers"
1. Check Fix Center for the "Paycheck ↔ employee name matching" and "Employer EINs on file" checks — these are the two most common causes.
2. If both are OK, the client/employee genuinely may not have had any paychecks/payments in that period.

### "I forgot my password / a staff member is locked out"
- As an Admin, go to **Portal Access**, find the person, and use **Set Temporary Password** or **Resend Invite**.
- Five wrong password attempts locks an account for 15 minutes automatically — this is a safety feature, not a bug. Just wait, or use Set Temporary Password to skip the wait.

### "Something looks visually broken (overlapping text, a button that doesn't do anything)"
Take a screenshot and describe exactly what page and what you clicked — this is the fastest way for a developer to find and fix it. These are almost always small, quick fixes.

### "I'm not sure if changing something will break real client data"
**Stop and ask first.** Nothing in this app is designed to let you casually destroy real data by accident — every delete action requires typing a confirmation phrase — but if you're ever unsure, it costs nothing to ask before clicking.

---

## 8. Who to ask, and what to tell them

When something needs a developer, the fastest path to a fix is describing:
1. **What page you were on** (the exact name in the sidebar).
2. **What you clicked or typed.**
3. **What you expected to happen vs. what actually happened.**
4. **Whether Fix Center shows anything red or yellow.**

That's almost always enough to find and fix the issue quickly — you never need to understand the code yourself to report a problem well.

---

## 9. A note on what "professional" means here

This app was built to real accounting-software standards: every dollar amount is calculated from the same underlying numbers everywhere it appears (a paycheck, a report, and a tax form for the same period will always agree), every financial PDF looks like a real business document, and every destructive action (deleting a client, a paycheck, an employee) requires deliberately typing a confirmation phrase — there's no "click and it's gone" anywhere in this app. That was a deliberate choice so you can trust the numbers without having to double-check them by hand.
