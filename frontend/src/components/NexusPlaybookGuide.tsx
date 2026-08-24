import { Link } from "react-router-dom";

/**
 * The Guide's one section with its own visual treatment instead of the plain
 * numbered-list template every other section uses — an actual operating
 * manual (daily rhythm, onboarding checklist, a real worked day) deserves to
 * read like one. Built entirely from this app's own design tokens (--ink,
 * --focus/--focus-text for the gold accent already used for focus rings and
 * the ⌘K badge, var(--serif) for headings) rather than a new hardcoded
 * palette, so it looks like part of this app, not a pasted-in artifact.
 */
const steps = (
  heading: string,
  items: string[],
  opts?: { route?: string; routeLabel?: string }
) => ({ heading, items, ...opts });

const RHYTHMS: { heading: string; items: string[]; route?: string; routeLabel?: string }[] = [
  steps(
    "Daily rhythm",
    [
      "Open Command Center — same order every morning, so it stays the one screen that answers “where do I look first.”",
      "Triage the Tasks list from its sidebar panel instead of opening every task individually.",
      "Enter sales data as it comes in — type it directly, or batch-import from a client's workbook. For a genuinely $0 month (client registered but dormant), put any note in that row's Notes column — a blank row with no note is treated as “not filled in yet” and silently skipped on import.",
      "Mark Filed the moment a return actually goes out, even at $0 — a nil return still has to be filed. Use Save and Send when the client should get a confirmation email automatically.",
    ],
    { route: "/dashboard", routeLabel: "Command Center" }
  ),
  steps("Onboarding a new client", [
    "Fill in Services Provided completely — this is the checklist that actually drives Fee Compliance, Contracts, and Onboarding Checklists. “Service Type” is just a label; the checkboxes are what does the work.",
    "Set “Registered Since” for any brand-new account (Sales Tax, EFTPS, MD Withholding, MD UI) if this client just registered. Without it, a freshly-registered client can show false “missing” filings for months before they even existed.",
    "Confirm the client's services match what's in the Minimum Fee Schedule (Reports → Firm Report), or adjust it if this client's real deal is different from the standard rate.",
    "Send the first invoice before you forget — even a placeholder for the first month starts the billing habit for this client from day one.",
  ]),
  steps(
    "Closing a filing period",
    [
      "Confirm the sales data for the period is complete — check Rows This Period and Period Sales against what the client actually sent.",
      "Check the Filing Discount / Late Penalty box — this is the real Form 202 math (timely discount if on time, penalty and interest if not). Trust this over a manual calculation.",
      "Mark Filed with the real filed date. This is also what clears the period's Past Due flag — skip it and the system keeps treating a period as overdue forever, even after it's actually been filed.",
      "Record the payment once it's actually paid. Filing and paying are tracked separately on purpose — if you file before payment clears, a payment-due reminder is automatically scheduled for the day before it's due.",
      "If a real notice came in, log it under that client's Notices tab and decide whether to check Notify Client — opt-in on purpose, so nothing goes out half-reviewed.",
    ],
    { route: "/accounting", routeLabel: "Accounting" }
  ),
  steps("Weekly rhythm", [
    "Work the MD Verification Due queue — MDTAXCONNECT and MD Business Express have to be checked by hand on Maryland's own site. Mark Checked the moment you actually look, not before, so the queue stays a real “who haven't I checked in a while” list.",
    "Review Communication Gaps and Document Collection Gaps in the Firm Report — clients who've gone quiet, and documents sitting requested-but-not-delivered, are both easy to lose track of client-by-client but obvious once rolled up.",
    "Check Staff Capacity honestly. It only means something if time is actually being logged — don't take on new clients on faith about how much room you have if it isn't.",
  ]),
  steps("Monthly / quarterly rhythm", [
    "Run Fee Compliance in the Firm Report. Once real invoices exist, this becomes the report that actually tells you who's underpaying — until then it can only flag “no revenue recorded,” a bookkeeping-coverage signal, not a billing one.",
    "Check Client Profitability and the firm-wide P&L — same caveat, accurate once billing is real. This is where you'll actually see which clients are worth keeping at their current rate.",
    "Run Recurring Billing for any client on a standing schedule, and confirm the sweep actually sent what it should have.",
    "Reconcile the bank (Bank Rec) against what's actually in the account, not just what the ledger says should be there.",
  ]),
];

const SAMPLE_DAY: { time: string; heading: string; body: string }[] = [
  { time: "9:00", heading: "Open Command Center", body: "Scan MD Verification Due and Overdue Tasks first — the two lists that turn into real penalties if ignored." },
  { time: "9:10", heading: "Triage the Tasks list", body: "From the sidebar panel, not by opening every task. Click a row to see status, due dates, and payment/filing info without leaving the list; click the task's own name only when you actually need to edit it." },
  { time: "9:25", heading: "Mark a client's MDTAXCONNECT check", body: "Real check on Maryland's site first, then Mark Checked here — the click is the record of when you actually looked, not the trigger for looking." },
  { time: "9:40", heading: "Import a client's bookkeeping workbook", body: "Accounting → Sales → Import from Excel. Review the preview, confirm." },
  { time: "10:00", heading: "Work a filing backlog", body: "Mark Filed on each period in order, oldest first, with the real filed date — Save and Send on the ones where the client should get a confirmation email." },
  { time: "11:00", heading: "A real notice came in", body: "Log it under that client's Notices tab. Check “Notify Client” only once you've actually read it, not before." },
  { time: "12:00", heading: "Send real invoices", body: "For whatever was collected that week, even though the money's already in hand — this is the “fix this first” habit, done daily instead of saved up." },
  { time: "2:00", heading: "A new client signs", body: "Work through the Onboarding a New Client checklist before the folder's even closed." },
  { time: "4:30", heading: "Last pass on Command Center", body: "Confirm nothing new landed since the morning." },
];

const REFERENCE: { feature: string; solves: string; when: string }[] = [
  { feature: "Mark Filed", solves: "Clears a period's Past Due flag for good; optionally emails the client a confirmation", when: "Every real return that goes out, including $0/nil returns" },
  { feature: "Registered Since", solves: "Stops the system from inventing “missing” filings from before an account existed", when: "Onboarding any client whose account is genuinely new" },
  { feature: "Sales Input Notes trick", solves: "Lets a confirmed $0 sales month import instead of being silently skipped", when: "A registered-but-dormant client, imported via Excel" },
  { feature: "Mark Checked", solves: "Real dated record of when you last checked MDTAXCONNECT / MD Business Express", when: "Right after you actually check — feeds the weekly worklist" },
  { feature: "Notify Client (Notices)", solves: "Sends a bilingual heads-up that a real agency notice arrived", when: "Only after you've reviewed the notice yourself" },
  { feature: "Send Reminder", solves: "Manual payment nudge, independent of the automatic 3-day one", when: "A client needs a nudge sooner, or a firmer tone" },
  { feature: "Task panel (Tasks list)", solves: "Full task info without leaving the list", when: "Triaging many tasks quickly" },
  { feature: "Fee Compliance", solves: "Compares real billing against your minimum fee schedule", when: "Only trustworthy once invoicing is real" },
];

export function NexusPlaybookGuide() {
  return (
    <div className="nexus-playbook">
      <style>{`
        .nexus-playbook .np-lede { margin: 0 0 24px; font-size: 13.5px; color: var(--muted); max-width: 66ch; }
        .nexus-playbook .np-fix {
          background: var(--red-soft); border: 1px solid var(--red); border-radius: 10px;
          padding: 18px 20px; margin-bottom: 28px;
        }
        .nexus-playbook .np-fix .np-eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 10.5px; font-weight: 800; color: var(--red); margin-bottom: 6px; }
        .nexus-playbook .np-fix h4 { font-family: var(--serif); font-size: 18px; margin: 0 0 10px; color: var(--red); }
        .nexus-playbook .np-fix p { margin: 0 0 8px; font-size: 13.5px; color: var(--ink); }
        .nexus-playbook .np-fix p:last-child { margin-bottom: 0; }
        .nexus-playbook section.np-block { margin-bottom: 32px; }
        .nexus-playbook section.np-block > h4 {
          font-family: var(--serif); font-size: 17px; font-weight: 700; margin: 0 0 14px; padding-bottom: 8px;
          border-bottom: 2px solid var(--focus); color: var(--ink); display: flex; align-items: center; justify-content: space-between; gap: 10px;
        }
        .nexus-playbook section.np-block > h4 a { font-family: Inter, sans-serif; font-size: 12px; font-weight: 700; color: var(--teal); white-space: nowrap; text-decoration: none; }
        .nexus-playbook section.np-block > h4 a:hover { text-decoration: underline; }
        .nexus-playbook ol.np-steps { list-style: none; margin: 0; padding: 0; counter-reset: npstep; }
        .nexus-playbook ol.np-steps > li { counter-increment: npstep; position: relative; padding-left: 38px; margin-bottom: 14px; font-size: 13.5px; color: var(--ink); line-height: 1.55; }
        .nexus-playbook ol.np-steps > li::before {
          content: counter(npstep); position: absolute; left: 0; top: -1px; width: 24px; height: 24px; border-radius: 50%;
          background: rgba(169, 131, 74, 0.14); color: var(--focus-text); font-family: var(--serif); font-weight: 700; font-size: 12px;
          display: flex; align-items: center; justify-content: center;
        }
        .nexus-playbook .np-timeline { position: relative; padding-left: 4px; }
        .nexus-playbook .np-timeline::before { content: ""; position: absolute; left: 54px; top: 4px; bottom: 4px; width: 2px; background: var(--line); }
        .nexus-playbook .np-entry { position: relative; display: grid; grid-template-columns: 46px 1fr; gap: 16px; margin-bottom: 18px; }
        .nexus-playbook .np-entry-time { font-family: var(--serif); font-weight: 700; font-size: 12.5px; color: var(--ink); text-align: right; padding-top: 2px; white-space: nowrap; }
        .nexus-playbook .np-entry-dot { position: absolute; left: 50px; top: 4px; width: 9px; height: 9px; border-radius: 50%; background: var(--focus); border: 2px solid var(--paper); }
        .nexus-playbook .np-entry-body { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
        .nexus-playbook .np-entry-body strong { font-size: 13px; display: block; margin-bottom: 2px; color: var(--ink); }
        .nexus-playbook .np-entry-body span { font-size: 12.5px; color: var(--muted); }
        .nexus-playbook table.np-ref .feat { font-weight: 700; color: var(--ink); white-space: nowrap; }
        @media (max-width: 560px) {
          .nexus-playbook .np-timeline::before { left: 36px; }
          .nexus-playbook .np-entry { grid-template-columns: 30px 1fr; gap: 10px; }
          .nexus-playbook .np-entry-dot { left: 32px; }
        }
      `}</style>

      <p className="np-lede">Not a feature list — the actual operating rhythm for running the practice through this app, in the order it matters most. Every example below is a real client and a real situation, not a hypothetical.</p>

      <div className="np-fix">
        <div className="np-eyebrow">Before anything else</div>
        <h4>Start invoicing through the app</h4>
        <p>Only a handful of invoices have ever been created in this system against 150+ active clients — your own rate card times real enrollment implies real monthly fee revenue this app currently has no way to verify is actually being collected.</p>
        <p>You don't have to change how clients pay you — check, cash, Venmo, all fine. The only change: whenever a client pays for sales tax, payroll, bookkeeping, or a return, log it as an invoice in Billing, even after the fact.</p>
        <p>Every other habit below — Fee Compliance, Client Profitability, real revenue reporting — only becomes trustworthy once this habit exists. It's the one change that unlocks the rest.</p>
      </div>

      <section className="np-block">
        <h4>A sample day</h4>
        <div className="np-timeline">
          {SAMPLE_DAY.map((e) => (
            <div className="np-entry" key={e.time}>
              <div className="np-entry-time">{e.time}</div>
              <div className="np-entry-dot" />
              <div className="np-entry-body">
                <strong>{e.heading}</strong>
                <span>{e.body}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {RHYTHMS.map((r) => (
        <section className="np-block" key={r.heading}>
          <h4>
            {r.heading}
            {r.route && <Link to={r.route}>Go to {r.routeLabel} →</Link>}
          </h4>
          <ol className="np-steps">
            {r.items.map((line, i) => <li key={i}>{line}</li>)}
          </ol>
        </section>
      ))}

      <section className="np-block">
        <h4>Quick reference — what each feature actually solves</h4>
        <div className="table-scroll">
          <table className="np-ref">
            <thead><tr><th scope="col">Feature</th><th scope="col">Solves</th><th scope="col">Use it when</th></tr></thead>
            <tbody>
              {REFERENCE.map((r) => (
                <tr key={r.feature}>
                  <td className="feat">{r.feature}</td>
                  <td>{r.solves}</td>
                  <td className="muted">{r.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
