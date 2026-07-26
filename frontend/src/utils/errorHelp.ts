/**
 * Turns an error message into an actionable next step.
 *
 * An error that only says what went wrong leaves the user stuck — especially
 * non-technical staff and clients, who read "403" or "constraint violation" as
 * "the app is broken" and ring the office. Every message the app can produce
 * has a knowable cause, so it should also carry what to do about it.
 *
 * Matching is on the message TEXT rather than an error code because the API
 * returns human sentences, and those sentences are written in this codebase —
 * they are stable enough to key on, and a miss simply yields no suggestion
 * rather than a wrong one.
 *
 * Ordered most-specific first: the first pattern that matches wins, so a
 * targeted rule is never shadowed by a broad one.
 */
interface ErrorHelpRule {
  match: RegExp;
  fix: string;
}

const RULES: ErrorHelpRule[] = [
  // ---- Sign-in and access ----
  {
    match: /out-of-date version of the app/i,
    fix: "Reload the page (Cmd+Shift+R, or Ctrl+Shift+R on Windows). If it persists, close the app completely and reopen it.",
  },
  {
    match: /two-factor authentication is required|cannot be turned off/i,
    fix: "2FA is required on this portal. If you replaced your phone, use one of your recovery codes, or ask an admin to reset your 2FA from Users & Access.",
  },
  {
    match: /incorrect authenticator code|incorrect code/i,
    fix: "Codes change every 30 seconds — wait for a fresh one and retype it. Check your phone's clock is set to update automatically. You can also enter a recovery code instead.",
  },
  {
    match: /setup session expired|sign-in request expired|login session expired/i,
    fix: "Go back to the sign-in page and enter your email and password again to start over.",
  },
  {
    // Caught by testing rather than guessing: this is what the API actually
    // returns on an expired or bad token, and it matched nothing at first.
    match: /invalid or expired session|session expired|not signed in|missing token|unauthorized|401/i,
    fix: "Your session has ended — sessions close after 30 minutes of inactivity. Sign in again to continue.",
  },
  {
    match: /password.*(do not match|does not match)|confirmation do not match/i,
    fix: "Retype the new password in both boxes so they match exactly, then save again.",
  },
  {
    match: /required|cannot be empty|is missing/i,
    fix: "Fill in every field marked with * before saving.",
  },
  {
    match: /could not send your sign-in code/i,
    fix: "Wait a minute and try again. If it keeps failing, contact the office — the email service may be down.",
  },
  {
    match: /too many attempts|too many incorrect codes/i,
    fix: "Wait for the period shown to pass, then try again. This limit protects accounts from password guessing.",
  },
  {
    match: /locked|account is locked/i,
    fix: "The account unlocks automatically after 15 minutes. An admin can also reset the password from Users & Access.",
  },
  {
    match: /incorrect portal password|invalid email or password/i,
    fix: "Check the email address and that Caps Lock is off. Use “Forgot password?” if you need a reset link.",
  },
  {
    match: /do not have access to this client/i,
    fix: "You are only assigned to certain clients. Ask an admin to assign this client to you from Users & Access.",
  },
  {
    match: /only admin can|admin only|forbidden|not authorized|403/i,
    fix: "This action needs an admin account. Ask the firm admin to do it, or to raise your role in Users & Access.",
  },

  // ---- Accounting ----
  {
    match: /out of balance/i,
    fix: "Debits must equal credits. Check each line's amount and which column it is in, then reopen Reports → Trial Balance to confirm.",
  },
  {
    match: /journal entry needs at least two lines|must include debit and credit/i,
    fix: "A journal entry needs at least one debit line and one credit line, and the two totals must match.",
  },
  {
    match: /type delete to confirm/i,
    fix: "Type the word DELETE in capitals into the box, exactly as shown, then confirm.",
  },
  {
    match: /client is required|choose a client/i,
    fix: "Pick a client from the Client dropdown at the top of the page first.",
  },
  {
    match: /valid from\/to dates|from and to dates/i,
    fix: "Set both the From and To date boxes. The From date must not be later than the To date.",
  },
  {
    match: /category lines|invalid category/i,
    fix: "Each sales line needs a category and a taxable amount above zero. Add categories under Accounting → Tax Rates if the list is empty.",
  },
  {
    match: /no active .*(rate|tax rate)/i,
    fix: "Add or activate the rate under Accounting → Tax Rates, making sure its state matches the client's state.",
  },
  {
    match: /paycheck.*(locked|cannot be edited)/i,
    fix: "Paychecks lock once issued so payroll records stay accurate. Void it and create a replacement instead.",
  },

  // ---- Files and email ----
  {
    match: /file (is )?too large|exceeds|payload too large|413/i,
    fix: "Files must be under 8MB. Compress the file, or split a large PDF into parts.",
  },
  {
    match: /email is not connected|resend_api_key/i,
    fix: "Email sending is not configured yet. Add RESEND_API_KEY to the backend environment variables.",
  },
  {
    match: /sms|whatsapp|twilio/i,
    fix: "SMS/WhatsApp sending is not configured. Add the Twilio credentials to the backend environment variables.",
  },
  {
    match: /encryption is not configured/i,
    fix: "The vault needs its encryption key set. Add ENCRYPTION_KEY to the backend environment variables.",
  },

  // ---- Data integrity ----
  {
    match: /duplicate key|already exists/i,
    fix: "A record with this ID or name already exists. Use a different one, or open the existing record and edit it.",
  },
  {
    match: /violates foreign key|still referenced|in use by/i,
    fix: "Something else still points at this record. Remove or reassign those items first, then try again.",
  },
  {
    match: /not found|404/i,
    fix: "The record may have been deleted or renamed. Refresh the page; if it is still missing, check it was not removed by someone else.",
  },

  // ---- Network / server ----
  {
    match: /could not reach the server|failed to fetch|network|offline/i,
    fix: "Check your internet connection and try again. If you are online, the server may be restarting — wait a minute.",
  },
  {
    match: /internal server error|500|unexpected error/i,
    fix: "Try the action once more. If it fails again, note what you were doing and report it — the details are in the server log.",
  },
];

/** Returns a suggested fix for an error message, or null when there is nothing useful to add. */
export function suggestFix(message: string | null | undefined): string | null {
  const text = String(message || "").trim();
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.match.test(text)) return rule.fix;
  }
  return null;
}
