/**
 * Shared Form 941 quarterly totals query — extracted from the original
 * inline query in accounting.routes.ts's GET /tax-forms/941/:clientId so
 * both that route and form941Filings.routes.ts (the real filing-record
 * module) compute the exact same numbers the exact same way. grossLiability
 * mirrors form941.ts's own Line 12/14 math (lines 133-139) — the quarter's
 * gross federal liability before subtracting any deposits already made.
 */
import { queryOne } from "../../config/db";

export interface Form941QuarterTotals {
  employeeCount: number;
  wages: number;
  federalWithholding: number;
  socialSecurityWages: number;
  medicareWages: number;
  grossLiability: number;
}

export async function computeForm941Quarter(clientId: string, year: number, quarter: 1 | 2 | 3 | 4): Promise<Form941QuarterTotals> {
  const totals = await queryOne<any>(
    `SELECT
       COUNT(DISTINCT p.employee) AS employee_count,
       COALESCE(SUM(p.gross_wages), 0) AS wages,
       COALESCE(SUM(p.federal_withholding), 0) AS federal_withholding,
       COALESCE(SUM(p.social_security_wages), 0) AS ss_wages,
       COALESCE(SUM(p.medicare_wages), 0) AS medicare_wages
     FROM altax.v3_paychecks p
     JOIN altax.v3_employees e ON e.employee_name = p.employee AND e.client_id = p.client_id
     WHERE p.client_id = $1 AND EXTRACT(YEAR FROM p.pay_date) = $2::int AND EXTRACT(QUARTER FROM p.pay_date) = $3::int
       AND lower(p.status) <> 'void' AND lower(e.worker_type) = 'employee'`,
    [clientId, year, quarter]
  );
  const wages = Number(totals?.wages) || 0;
  const federalWithholding = Number(totals?.federal_withholding) || 0;
  const socialSecurityWages = Number(totals?.ss_wages) || 0;
  const medicareWages = Number(totals?.medicare_wages) || 0;
  const grossLiability = federalWithholding + socialSecurityWages * 0.124 + medicareWages * 0.029;
  return { employeeCount: Number(totals?.employee_count) || 0, wages, federalWithholding, socialSecurityWages, medicareWages, grossLiability };
}

/** Sum of EFTPS deposits recorded for this client whose period falls within [periodStart, periodEnd] — the quarter's actual federal deposits already made, used to net down Form 941's gross liability into a real balance due. */
export async function sumEftpsDepositsInPeriod(clientId: string, periodStart: string, periodEnd: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(total_amount), 0) AS total FROM altax.v3_eftps_deposits
      WHERE client_id = $1 AND period_end >= $2::date AND period_end <= $3::date`,
    [clientId, periodStart, periodEnd]
  );
  return Number(row?.total) || 0;
}
