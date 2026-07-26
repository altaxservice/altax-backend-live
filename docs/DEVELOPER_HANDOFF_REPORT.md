# AL TAX Nexus & altaxgroup.com — Developer Handoff Report

**Purpose of this document:** a complete picture of what this system is, what's been built, who's involved in running it, and what still needs review — written so you (the firm owner) can hand it to a developer and have them get oriented without re-deriving everything from the code. If you're the developer reading this: welcome, and thank you for taking a look. Corrections, disagreements, and "actually this should be done differently" are all welcome — this document reflects one AI assistant's work over one extended session-based engagement, not a formal spec.

---

## 1. What this system is

AL TAX SERVICE (a Maryland tax/accounting firm) runs its entire business — client records, tasks, payroll, invoices, documents, tax forms, messaging — through a custom-built Node/TypeScript application called **AL TAX Nexus**, which replaced an older Google Sheets + Apps Script system. The same codebase also serves the firm's **public marketing website** (altaxgroup.com) from the same process.

Two things people interact with, one codebase, one deployment:

- **The public site** — marketing pages, a bilingual (English/Arabic) Tax News section, a contact form. Anyone can visit it.
- **AL TAX Nexus** — the actual business application, behind login, with four portals: Admin, Staff, Client, Employee.

---

## 2. Architecture, in plain terms

```
                    ┌─────────────────────────────┐
  Browser  ────────▶│   Railway (one Node service)│
                     │   - Express API              │
                     │   - React app (built, served)│
                     │   - Marketing site (static)   │
                     └──────────────┬────────────────┘
                                     │
                     ┌───────────────┴────────────────┐
                     │                                  │
              ┌──────▼──────┐                  ┌────────▼────────┐
              │  Neon         │                  │ Resend / Twilio │
              │  (Postgres)   │                  │ (email / SMS)   │
              └───────────────┘                  └─────────────────┘
```

- **One process serves everything.** The backend (`src/server.ts`) serves the API, the built React app (`frontend/dist/`), and the static marketing site (`marketing-site/`) all from the same Express server, differentiated by URL path. This was a deliberate design decision to avoid running/paying for/coordinating multiple services.
- **Database:** PostgreSQL on Neon, currently Free tier (16 MB used of 500 MB — plenty of headroom; see the Neon section below).
- **No separate frontend hosting.** The React app is built (`npm run build`) into static files and served by the same backend — there's no Vercel/Netlify involved.
- **Deployment is fully automatic.** Every push to the `main` branch on GitHub triggers Railway to rebuild and redeploy. There is no manual deploy step once code is pushed.

---

## 3. What's been built (high-level, not exhaustive)

The full history is in `git log` — every commit message explains its own reasoning in detail. This is the shape of it:

**Core application (client/staff/admin/employee portals):**
Client records, task pipeline with automation rules, document requests/uploads, billing (invoices, recurring billing, payments), full accounting module (payroll, paychecks, W-2/1099/941/940/1096 tax forms, sales tax, journal entries), a Secure Vault for sensitive client credentials, encrypted payment method storage, time tracking, reporting, templated messaging (English/Arabic), and an internal document e-signature/contract module.

**Security infrastructure:** role-based access control (admin/staff/client/employee, each scoped to what they should see), 2FA (TOTP), self-service password reset, envelope encryption (AES-256-GCM) for the Vault and payment methods, audit logging, and — as of this most recent session — rate limiting, a CORS allow-list, and a fix for a stored-XSS vector in document downloads. See Section 6 for what's *not* yet done here.

**Mobile:** the whole app was made responsive and turned into an installable PWA (add-to-home-screen) for phones/tablets.

**Marketing site (altaxgroup.com):** built as a separate static site, then merged into the same backend process (this merge caused a real, tricky bug — a service worker caching collision that silently hijacked login pages — since fixed). Includes a bilingual Tax News section (6 articles, more added on request), a working contact form (with spam protection and a real database-backed audit trail for SMS opt-in consent), and firm-branded content throughout.

**Launch/production setup (this session):** connected the custom domain (`altaxgroup.com`), fixed the DNS/GoDaddy configuration (including working around a GoDaddy limitation on root-domain CNAMEs), got past a Let's Encrypt certificate rate-limit issue, upgraded Railway off its trial plan, and did a security-hardening pass (details in Section 6).

---

## 4. Third parties involved — what each one does and how to deal with them

| Service | What it actually does here | Where you manage it | Cost model | Notes |
|---|---|---|---|---|
| **Railway** | Hosts and runs the live application 24/7. Auto-deploys on every GitHub push. Manages the custom domain's SSL certificate. | [railway.com](https://railway.com) dashboard | Usage-based (currently Hobby plan, ~$5/month minimum + usage) | Support is community-only at Hobby tier — no dedicated support queue. A Railway community-forum moderator has been the most useful source of help so far (e.g., diagnosing a certificate rate-limit issue). |
| **Neon** | Hosts the Postgres database — every piece of business data lives here. | [neon.tech](https://neon.tech) dashboard | Currently Free tier | See Section 5 below for whether this needs upgrading. |
| **GitHub** | Stores the source code and its full history. Every deploy starts with a push here. | [github.com/altaxservice/altax-backend-live](https://github.com/altaxservice/altax-backend-live), day-to-day via **GitHub Desktop** app | Free (private repo) | This is the actual "master copy" of the code — if you ever change developers, this repo is what you hand over. |
| **GoDaddy** | Owns and manages the `altaxgroup.com` and `almabarigroup.com` domain names; DNS records here point traffic at Railway. | GoDaddy account dashboard | Domain registration fee (annual) | The DNS zone also carries your Microsoft 365 email records (MX, SPF, DKIM) and Teams/Skype records — **do not delete unfamiliar-looking records without checking first**, several of them are your real business email infrastructure, not leftovers. |
| **Twilio** | Will send real SMS and WhatsApp messages (appointment reminders, deadline reminders) once the A2P 10DLC campaign is approved. The sending code is already built and just waiting on approved credentials. | [console.twilio.com](https://console.twilio.com) | Per-message + phone number rental | Campaign registration/compliance is its own process (see the campaign registration notes further down, or ask me — I have context on the specific rejections and fixes already applied). |
| **Resend** | Sends transactional email — admin notifications (like new contact form submissions), reminder emails, password reset links. | [resend.com](https://resend.com) dashboard | Usage-based, generous free tier | Already configured and working in production. |
| **Google (googleapis package)** | Used only by the one-time/legacy tool that migrated data out of the old Google Sheets system. Not part of day-to-day operation. | N/A — historical/migration tooling only | N/A | Flagged in Section 6 as carrying an outdated dependency that needs a (breaking) upgrade eventually. |

---

## 5. Neon plan recommendation

Checked directly against the live database (not estimated): **16 MB used of the Free tier's 500 MB storage limit — about 3%.** 149 client records, 82 tasks, 9 document uploads, 14 paychecks. No table is anywhere close to a limit.

**Recommendation: stay on Free for now.** The one thing Free tier does that a paid plan removes is "scale to zero after 5 minutes of inactivity" — meaning after a few idle minutes, the next request can take an extra second or two while the database wakes back up. If that's ever noticeably annoying to real users, or if the Neon dashboard's own "Monitoring" tab shows you approaching the 100 compute-hour/month allotment, the next tier (Launch, $0.106/CU-hour usage-based) removes that behavior — given how light actual usage is, it would likely cost a few dollars a month, not a big jump.

---

## 6. Open items worth a developer's review

This is the honest "what's not done yet" list — nothing here is a fire, but all of it is real and worth an experienced second opinion.

**Security (a hardening pass was done this session; here's what's still open):**
- **Session tokens are stored in browser `localStorage`, not an httpOnly cookie.** This means any XSS vulnerability anywhere in the frontend could let an attacker steal a logged-in session directly. This is the single most valuable remaining fix, but it's an architectural change touching the whole auth flow (both frontend and backend), not a quick patch.
- **Authorization checks are applied per-route, not structurally guaranteed.** Every current route does have the right access check, but nothing in the framework *forces* a new route to remember one. The code's own comments reference at least two past real bugs of exactly this class (an employee able to reach another client's documents via a guessable ID) — both fixed, but the underlying pattern that allowed them hasn't changed. The Secure Vault module is the one exception with a router-level guarantee.
- **2FA is opt-in, not enforced.** Nothing currently requires admin/staff accounts — the ones with access to SSNs and bank account data — to actually turn on two-factor authentication.
- **Uploaded document files are stored unencrypted** (as base64 text) directly in the Postgres database, meaning database backups contain raw file contents in the clear.
- **Audit logging covers writes, not reads.** Someone viewing a client's SSN field isn't logged anywhere; only the Secure Vault's explicit "reveal" actions are.
- **A dependency chain (`googleapis` → `gaxios` → `uuid`) has a known moderate-severity advisory** that requires a breaking major-version upgrade of `googleapis` to fully resolve. Deliberately not forced blindly this session since that package is used by the (now-legacy) Sheets migration tooling and deserves a tested pass, not a rushed one.

**Functionality:**
- The document upload/download security fix (forcing downloads instead of letting a malicious file type render inline) shipped and type-checks cleanly, but hasn't been live-tested through a real authenticated upload/download cycle — worth a quick manual check.
- SMS/WhatsApp sending is fully built but has never fired against a real Twilio account (still pending A2P campaign approval) — expect to find and fix something small once real sends start happening for the first time.
- There's an `api.altaxgroup.com` custom domain in Railway alongside `www.altaxgroup.com`, originally added as a workaround during a certificate issue. Both are currently live and serving the identical app. Worth deciding whether to keep both permanently or consolidate.

**Nothing here blocks normal operation of the app today** — this is a punch list for whenever there's developer time to spend on it, roughly in the priority order listed.

---

## 7. Where to find more detail

- **`docs/MAINTENANCE_MANUAL.md`** — written for a non-technical owner: what the app is, where the code lives, how to run it, common problems and fixes.
- **`docs/USER_MANUAL.md`** — how to actually use the application day-to-day.
- **`git log`** — every single change ever made has a detailed commit message explaining what changed and why. This is the deepest source of truth for "how did we get here."
- **This document** — update it (or ask me to) whenever something in Sections 3–6 materially changes, so it stays a reliable snapshot rather than going stale.

---

*This document reflects the state of the project as of the most recent work session. If you're a developer picking this up: the person who built this (an AI coding assistant, working directly with the non-technical firm owner over an extended engagement) is available to answer specific questions about any decision documented here — just ask.*
