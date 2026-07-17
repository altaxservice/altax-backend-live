import { useState } from "react";
import { useAuth } from "../auth/AuthContext";

interface Section { key: string; label: string; title: string; body: string[]; roles: string[] }

const ADMIN_STAFF_ROLES = ["admin", "staff"];

const SECTIONS: Section[] = [
  {
    key: "admin",
    label: "Admin",
    title: "Admin daily workflow",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "Sign in with the Admin email and password.",
      "Use Clients to add/edit/archive clients and confirm service settings such as sales tax, payroll, EFTPS, annual report, and business return type.",
      "Use Tasks for daily work status changes, edit task details, void incorrect tasks, and create document requests.",
      "Use Billing for invoices, payments, statements, view/print/send invoice, and void invoice.",
      "Use Accounting for sales input, payroll input, employees, paychecks, manual JE, GL, COA, and financial reports.",
      "Use Communications to send email/portal messages and control the Reminder Center.",
      "Use Security to review account readiness, lockouts, and audit events.",
    ],
  },
  {
    key: "portal-login",
    label: "Portal Login",
    title: "Signing in",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "Pick the portal that matches your role — Admin, Staff, Client, or Employee.",
      "Enter the email on file and your password.",
      "If your account has no password yet, ask an Admin to set a temporary one or send an invite.",
      "Five incorrect attempts locks the account for 15 minutes.",
    ],
  },
  {
    key: "messages",
    label: "Messages",
    title: "Communications",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "Staff messages are internal, firm-to-firm.",
      "Client messages go out from the assigned client record and are logged to that client's history.",
      "Choose a template or write a custom message before sending.",
    ],
  },
  {
    key: "reminders",
    label: "Reminders",
    title: "Reminder Center",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "Task rules generate work automatically based on each client's service settings.",
      "Warning windows (e.g. 14/7/3 days) control when a task is flagged Due Soon.",
    ],
  },
  {
    key: "staff",
    label: "Staff",
    title: "Staff portal",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "Your Command Center shows only tasks assigned to you.",
      "Use Documents and Communications the same way Admin does, scoped to your clients.",
    ],
  },
  {
    key: "employee",
    label: "Employee",
    title: "Employee portal",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "View paystubs shared by payroll.",
      "Contact the firm through Messages if something needs review.",
    ],
  },
  {
    key: "client",
    label: "Client",
    title: "Client portal",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "Review requested documents and upload files directly.",
      "Check open invoices and payment history under Billing.",
    ],
  },
  {
    key: "accounting",
    label: "Accounting",
    title: "Accounting workspace",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "Pick a client, then a date range, to work in their books.",
      "Sales Input, Payroll, Contractors, and Manual JE all post to that client's General Ledger.",
      "Reports pulls a P&L and account snapshot from the same GL data.",
    ],
  },
  {
    key: "task-process",
    label: "Task Process",
    title: "How tasks are created",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "Task Rules match clients by a trigger condition (e.g. Sales Tax Frequency = Monthly) and generate a task on the configured cadence.",
      "Batch creation lets you preview which clients a rule would match before creating tasks.",
    ],
  },
  {
    key: "data-storage",
    label: "Data Storage",
    title: "Where data lives",
    roles: ADMIN_STAFF_ROLES,
    body: [
      "All records are stored in PostgreSQL (Neon), not spreadsheets.",
      "Vault secrets and payment method numbers are encrypted at rest and only decrypted on individually-audited access.",
    ],
  },

  // Client role — 4 topics, client-specific wording (legacy: Client Portal, Messages, Task Process, Billing)
  {
    key: "client-portal",
    label: "Client Portal",
    title: "Client Portal basics",
    roles: ["client"],
    body: [
      "You only see records for your own company.",
      "Use Documents to review what AL TAX has requested and upload files directly.",
      "Use Communications to message AL TAX and see replies in one history.",
    ],
  },
  {
    key: "client-messages",
    label: "Messages",
    title: "Messages",
    roles: ["client"],
    body: [
      "Send a message to AL TAX any time from Communications.",
      "Choose Portal Note to save it for staff to review, or Email/SMS/WhatsApp to also notify them directly.",
      "Replies and updates from AL TAX show up in the same message history.",
    ],
  },
  {
    key: "client-task-process",
    label: "Task Process",
    title: "How your work gets done",
    roles: ["client"],
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
    body: [
      "Review your open and paid invoices, payment history, and statements from Billing.",
      "Contact AL TAX through Messages if anything on an invoice looks incorrect before a payment is processed.",
    ],
  },

  // Employee role — 4 topics, employee-specific wording (legacy: Employee, Login, Messages, Data Storage)
  {
    key: "employee-portal",
    label: "Employee",
    title: "Employee portal",
    roles: ["employee"],
    body: [
      "View your paystubs shared by payroll, including gross pay, taxes, and net pay for each period.",
      "Contact the firm through Messages if something on a paystub needs review.",
    ],
  },
  {
    key: "employee-login",
    label: "Login",
    title: "Signing in",
    roles: ["employee"],
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
    body: [
      "Your pay records are stored in PostgreSQL (Neon), not spreadsheets.",
      "Bank account numbers on file are encrypted at rest and only decrypted on individually-audited access.",
    ],
  },
];

export function GuidePage() {
  const { user } = useAuth();
  const role = user?.role || "client";
  const visibleSections = SECTIONS.filter((s) => s.roles.includes(role));
  const fallback = visibleSections[0] || SECTIONS[0];
  const [active, setActive] = useState(fallback.key);
  const section = visibleSections.find((s) => s.key === active) || fallback;

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">Instruction Manual</h2>
          <div className="command-panel-note">Built into the portal</div>
        </div>
      </div>
      <div className="guide-layout">
        <div className="guide-toc">
          {visibleSections.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`nav-item ${active === s.key ? "active" : ""}`}
              style={{ color: active === s.key ? "var(--teal)" : "var(--ink)", background: active === s.key ? "var(--teal-soft)" : "var(--surface)", border: "1px solid var(--line)" }}
              onClick={() => setActive(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="card">
          <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>{section.title}</h3>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 13, color: "var(--ink)" }}>
            {section.body.map((line, i) => <li key={i}>{line}</li>)}
          </ol>
        </div>
      </div>
    </div>
  );
}
