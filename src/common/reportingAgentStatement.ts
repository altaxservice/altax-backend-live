/**
 * Quarterly written statement a payroll "reporting agent" must give the client — IRS Rev. Proc. 2012-32, section 5.05: the agent
 * "must provide the taxpayer with this statement when it enters into a contract for services with the taxpayer and on at least a
 * quarterly basis for as long as the Reporting Agent provides services". The signed payroll agreement carries the first copy; this
 * sweep sends the quarterly one by email to every active client for whom the firm files federal employment-tax returns (service
 * "federal_payroll_tax_941"). Runs daily during the first week of Jan/Apr/Jul/Oct; one statement per client per quarter (dedup key).
 * A client who cannot be emailed is counted and written to the audit log so staff hand them a paper copy.
 */
import { query, withTransaction } from "../config/db";
import { sendChannel } from "./sendChannel";
import { getFirmProfile } from "./firmProfile";
import { logAudit } from "./audit";
import { escapeHtml } from "./html";

export function quarterKey(d: Date): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export function buildReportingAgentStatement(clientName: string, firmName: string): { subject: string; body: string } {
  const name = escapeHtml(clientName);
  const en = `Dear ${name},

This is the notice ${firmName} is required to give you each quarter because we prepare and file your federal employment tax returns as your reporting agent (IRS Form 8655).

1. You are still responsible for making sure your federal employment tax returns are filed on time and your federal tax deposits and payments are made on time.
2. Authorizing ${firmName} to do some of this for you does not relieve you of any liability that results if the returns, deposits or payments are not made on time.
3. We recommend that you enroll in the Electronic Federal Tax Payment System (EFTPS) and use it to check that your deposits and payments have been made on time. You can enroll at eftps.gov.
4. Maryland and other states may also offer tax verification programs that let you check your state filings and payments.

If you have questions, please contact us.

Thank you,
${firmName}`;
  const ar = `عزيزنا ${name}،

هذا إشعار يلزمنا في ${firmName} بتقديمه إليكم كل ربع سنة، لأننا نعدّ ونقدّم إقرارات ضرائب التوظيف الاتحادية الخاصة بكم بصفتنا وكيل الإبلاغ (reporting agent) لديكم بموجب النموذج IRS Form 8655.

1. تبقون مسؤولين عن التأكد من تقديم إقرارات ضرائب التوظيف الاتحادية في موعدها، وعن سداد الإيداعات والدفعات الضريبية الاتحادية في موعدها.
2. تفويضكم ${firmName} بالقيام ببعض ذلك نيابةً عنكم لا يعفيكم من أي مسؤولية تنشأ إذا لم تُقدَّم الإقرارات أو لم تُسدَّد الإيداعات أو الدفعات في موعدها.
3. نوصيكم بالتسجيل في نظام الدفع الضريبي الاتحادي الإلكتروني (EFTPS) واستخدامه للتحقق من أن إيداعاتكم ودفعاتكم قد سُدِّدت في موعدها. ويمكنكم التسجيل عبر eftps.gov.
4. وقد تتيح ولاية ماريلاند وولايات أخرى كذلك برامج للتحقق الضريبي تمكّنكم من مراجعة تقديماتكم ودفعاتكم على مستوى الولاية.

وإذا كانت لديكم أسئلة فيرجى التواصل معنا.

شكرًا لكم،
${firmName}`;
  return { subject: `Quarterly notice about your payroll tax filings — ${firmName}`, body: `${en}\n\n---\n\n${ar}` };
}

export async function runReportingAgentStatements(actorEmail: string, asOf: Date = new Date()): Promise<{ sent: number; needsPaper: number }> {
  const firmName = (await getFirmProfile()).firmName;
  const qk = quarterKey(asOf);
  const clients = await query<any>(
    `SELECT client_id, client_name, email, email_allowed
       FROM altax.v3_clients
      WHERE 'federal_payroll_tax_941' = ANY(services)
            AND (status IS NULL OR lower(status) NOT IN ('no', 'false', 'inactive', 'archived'))`
  );
  let sent = 0;
  let needsPaper = 0;
  for (const c of clients) {
    try {
      const dedupKey = `ReportingAgentStatement#${c.client_id}#${qk}`;
      const { subject, body } = buildReportingAgentStatement(c.client_name, firmName);
      const canEmail = Boolean(c.email_allowed && c.email);
      const result = await withTransaction(async (db) => {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [dedupKey]);
        const existing = await db.queryOne<any>(`SELECT 1 FROM altax.v3_communications WHERE source_system = 'ReportingAgentStatement' AND source_record_id = $1`, [dedupKey]);
        if (existing) return "already" as const;
        if (!canEmail) return "paper" as const;
        const r = await sendChannel("email", c.email, subject, body, { firmName });
        if (!r.sent) return "failed" as const;
        await db.query(
          `INSERT INTO altax.v3_communications
             (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
              sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
           VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound','Email',now(),'Sent','ReportingAgentStatement',$8,$9)`,
          [`COM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`, c.client_id, c.client_name, subject, body, c.email, actorEmail, dedupKey, r.providerMessageId || null]
        );
        return "sent" as const;
      });
      if (result === "sent") sent++;
      else if (result === "paper" || result === "failed") {
        needsPaper++;
        await logAudit("Compliance", "REPORTING_AGENT_STATEMENT", c.client_id, "quarter", "", qk,
          `Quarterly reporting-agent statement (IRS Rev. Proc. 2012-32) could not be emailed to ${c.client_name}; hand or mail them a paper copy.`, actorEmail);
      }
    } catch { needsPaper++; }
  }
  return { sent, needsPaper };
}
