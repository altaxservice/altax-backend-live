# Written Information Security Plan (WISP) — AL TAX SERVICE

Draft of 2026-10-15. Follows the structure of IRS Publication 4557 (Safeguarding Taxpayer Data) and the IRS Publication 5708 WISP template, and the elements of the FTC Safeguards Rule, 16 CFR 314.4. Every statement about the software was checked in the code of the AL Tax Nexus application on 2026-10-15. Items the code cannot show are marked **[CONFIRM]** (kept to a minimum). Print it, have the owner sign page 1, keep it in the firm's records, and review it once a year.

## 1. Why the firm needs this

- A tax preparer is a "financial institution" under the Gramm-Leach-Bliley Act: 16 CFR 314.2(h)(2)(viii) — "An accountant or other tax preparation service that is in the business of completing income tax returns is a financial institution". The Safeguards Rule therefore applies. 16 CFR 314.1(b) names "tax preparation firms" and says it covers "all customer information in your possession".
- 16 CFR 314.4 requires an information-security program with these elements: a qualified individual in charge; a written risk assessment; access controls; an inventory; encryption of customer information in transit and at rest; multi-factor authentication; secure disposal; change management; activity logging; testing; staff training; oversight of service providers; a written incident-response plan; and notice to the FTC of a breach.
- **Small-firm relief.** 16 CFR 314.6: "Section 314.4(b)(1), (d)(2), (h), and (i) do not apply to financial institutions that maintain customer information concerning fewer than five thousand consumers." The firm has about 175 clients, so the *written* risk assessment, the annual penetration test / six-month vulnerability scan, the written incident-response plan and the written annual report to a board are not legally required. This plan includes all of them anyway, in short form, because (a) the IRS expects every preparer to have a written security plan (Publication 4557, with the Publication 5708 template), and authorized e-file providers must have security systems in place (Publication 1345), and (b) Maryland law requires "reasonable security procedures and practices that are appropriate to the nature of the personal information" (Md. Code, Com. Law §14-3503(a)).
- Maryland breach law: Com. Law §14-3504 (notice to affected Maryland residents "as soon as reasonably practicable, but not later than 45 days after the business discovers or is notified of the breach", and prior notice to the Attorney General's office). Federal: 16 CFR 314.4(j) — notify the FTC "as soon as possible, and no later than 30 days after discovery" if the event involves "at least 500 consumers".

## 2. Qualified Individual and approval

| Role | Name |
|---|---|
| Qualified Individual (runs this plan; 314.4(a)) | **[CONFIRM: owner's name]** |
| Backup person if the owner is unavailable | **[CONFIRM: second admin]** |
| Approved by (owner signature and date) | ____________________   ____ / ____ / ______ |

## 3. What we protect and where it lives (data inventory)

| Data | Where | Protection in the system |
|---|---|---|
| Client SSN/EIN/state tax ID, employee and contractor SSN/EIN/TIN and bank details, saved payment methods | AL Tax Nexus database (Neon, hosted on Railway's platform) | Encrypted in storage: AES-256-GCM, each value with its own key, wrapped by the master key in the server settings (`src/common/encryption.ts`) |
| Secure Vault and Firm Portals credentials (EFTPS, Maryland Tax Connect) | same | Encrypted the same way; separate tables |
| Uploaded documents (returns, IDs, bank statements, POS photos) | same database (or object storage when switched on) | Every file is encrypted before it is stored (`writeUploadBlob`) |
| Government-form data (SS-4, 2553, W-9, W-4, 8832, etc.) | same | Encrypted form data, including SSN/EIN fields |
| Paycheck, contractor-payment and invoice-payment bank and SSN snapshots | same | Encrypted |
| 2FA authenticator secrets | same | Encrypted; backup codes stored as one-way hashes |
| Account passwords | same | Stored only as salted scrypt hashes (older accounts migrate on next login) |
| Names, addresses, phones, emails, invoice amounts, books | same | Not field-encrypted; protected by access control, the database provider and HTTPS |
| Daily backup | Emailed to the admins' mailboxes | Whole backup file encrypted (AES-256-GCM, key from `BACKUP_PASSPHRASE` or the master key) |
| Paper, printed returns, USB, laptops, phones | The office and staff devices | See sections 5 and 6 |

## 4. Risk assessment (short form of 314.4(b))

| Risk | Likelihood / harm | Safeguard now in place | Gap and action |
|---|---|---|---|
| Stolen or guessed staff password | Medium / high | Required two-step sign-in for admin and staff (authenticator app); email one-time code for clients and employees; account locks for 15 minutes after 5 failed attempts; 8-hour sessions | Confirm the required-roles settings are not turned off in Railway (`REQUIRE_2FA_ROLES`, `REQUIRE_EMAIL_OTP_ROLES`). Minimum password length is only 8; raise to 12 (software change, owner decision). |
| Phishing of staff email (the most common real attack on preparers) | High / high | None technical beyond Google Workspace defaults | Staff training (section 8); turn on Google 2-step verification for every staff mailbox **[CONFIRM]** |
| Database or hosting-provider breach | Low / high | Sensitive fields and files are encrypted, so a database copy alone does not expose SSNs, bank numbers or documents | Keep the master key out of the database and out of email; never paste it into chat or tickets |
| Lost master key (`VAULT_MASTER_KEY`) | Low / severe | None possible: encrypted data cannot be recovered without it | Store the key in two places: the password manager and a sealed printed copy in the office safe **[CONFIRM both done]** |
| Public forms abused (spam, flooding, injection) | Medium / low | Rate limits, hidden bot field, public forms use a database role with no access to client data, input length caps | None |
| Malicious file uploaded through the portal | Low / medium | File-type allow-list and size cap; virus scan through Cloudmersive when its key is set (alerts admins if the scan service fails) | **[CONFIRM]** `CLOUDMERSIVE_API_KEY` is set in production |
| Lost or stolen phone / laptop with portal session or saved passwords | Medium / medium | Sessions expire in 8 hours; 2-step sign-in | Device passcodes and disk encryption on every device that opens the portal (section 6) |
| Client sends SSN or bank details by text/email/contact form | High / medium | Website forms warn against it; portal exists for this | Staff delete sensitive texts/emails after saving to the portal; remind clients |
| Kiosk PIN guessing at the shared tablet | Low / low | PIN stored as a hash, 5 wrong tries lock 15 minutes, separate counter from real sign-in | None |
| Insider misuse | Low / high | Role-based access (admin, staff, client, employee); audit log of changes and sign-ins | Remove access the same day a staff member leaves (section 7) |
| Loss of data (software error, provider outage) | Low / high | Daily encrypted backup email; provider point-in-time recovery | Test a restore once a year (section 9) |

## 5. Safeguards (314.4(c)) — what the firm does

1. **Access.** Each person has their own account; no shared logins. Admin only for the owner and one backup. Staff see only what their role allows. Clients and employees see only their own records.
2. **Multi-factor sign-in.** Required for admin and staff; email one-time code for client and employee portals (default settings of the application).
3. **Encryption.** In transit: HTTPS to the website and portal (the host terminates TLS). At rest: the fields and files listed in section 3.
4. **Secure development and change management.** Code changes are made in a repository, type-checked and tested before release; production changes happen only through the repository's release (push to `main`). The test suite includes the money calculations.
5. **Logging.** The application writes an audit record for sensitive actions (creates, edits, deletes, sign-ins, kiosk and backup events); failures to send notices are logged and surface in Fix Center.
6. **Disposal (314.4(c)(6)).** Delete client information no later than **two years after** the last date it was used for the client's work, unless the law requires keeping it (tax-return records are kept per the retention rules in section 10) or it is needed for a legitimate business reason. The portal's delete function removes the record; remove the matching paper and any local downloads.
7. **Paper.** Return copies and IDs are kept in a locked cabinet; the office is locked when empty; shred paper that is no longer needed. **[CONFIRM: locked cabinet and shredder exist]**
8. **Clear desk and screen.** Lock the computer when stepping away; no client paperwork left in view.

## 6. Devices and accounts (staff rules)

- Every computer and phone that opens the portal or staff email has a screen-lock passcode, automatic updates on, and disk encryption (FileVault on Mac, BitLocker on Windows, default on current iPhone/Android).
- Never save the portal or vault password in a browser on a shared device. Use the password manager.
- Do not download client documents to personal devices or USB sticks. If a download is unavoidable, delete it the same day.
- Public Wi-Fi: use only the phone hotspot for portal work.
- Do not forward client documents to personal email. Do not discuss SSNs or bank numbers over text or WhatsApp; ask the client to use the portal.
- Report a lost device, a strange email, a wrong-recipient email or an unexpected login code to the Qualified Individual **the same day**.

## 7. People

- **Hiring:** every staff member signs a confidentiality statement before getting an account. **[CONFIRM: template exists]**
- **Training (314.4(e)):** a 30-minute session at hire and once a year, covering phishing, passwords/2-step sign-in, device rules above, how to handle an ID or SSN, and the incident steps in section 9. Keep the sign-in sheet.
- **Leaving:** on the last day, deactivate the user in AL Tax Nexus (Users page), remove from Google Workspace, and collect keys and any paper. Do this the same day.
- **Kiosk:** shared tablet shows names only; each person has their own PIN.

## 8. Service providers (314.4(f))

| Provider | What it receives | What the firm does |
|---|---|---|
| Railway (hosting), Neon (database) | All application data (sensitive fields encrypted) | Use accounts with 2-step verification; keep only the owner and backup as members |
| Resend (email) | Email addresses and message content | Do not put SSNs or bank numbers in email bodies |
| Twilio (SMS/WhatsApp) | Phone numbers and message text | Same rule; texts contain links, not sensitive data |
| Google Workspace (staff email and calendar) | Staff mail | 2-step verification required for each mailbox **[CONFIRM]** |
| Cloudmersive (virus scan, if enabled) | Uploaded files while being scanned | Confirm enabled; review its terms yearly |
| IRS e-file, EFTPS, Maryland Tax Connect, MD DLLR UI, other agency sites | Return and filing data the firm submits | Use only the firm's own credentials, stored in the vault |

Review each provider's security statement once a year and when it changes. Maryland also requires a contract term that service providers keep reasonable security (Com. Law §14-3503(b)); the standard terms of these providers include security commitments; save a copy of each provider's terms. **[CONFIRM: copies saved]**

## 9. Incident response plan (314.4(h))

**What counts.** Lost or stolen device with client data; a staff or client account used by someone else; client documents sent to the wrong person; ransomware or malware; a provider tells us of a breach; unexplained changes in the audit log; a client reports fraud on a return filed through us.

**Steps (Qualified Individual leads; write the date and time of each step):**

1. **Contain (first hour).** Deactivate or reset the affected account (Users page → reset password / reset 2FA; this also invalidates open sessions). Disconnect an infected computer from the network. Revoke a lost kiosk device (Kiosk → revoke).
2. **Preserve.** Do not delete anything. Save the audit-log entries and the emails involved.
3. **Assess.** What data, whose, how many clients, since when? Use the audit log and Fix Center. Check whether the data was encrypted (section 3).
4. **Notify the IRS if tax data may have been stolen.** Contact your IRS Stakeholder Liaison (find yours at irs.gov by searching "Stakeholder Liaison"); the IRS asks preparers to report data theft immediately. Also notify the Maryland Comptroller's office if state data is involved. If clients' returns were filed fraudulently, tell clients to file Form 14039 (Identity Theft Affidavit).
5. **Notify others as required.**
   - **Maryland residents:** written notice to affected people "as soon as reasonably practicable, but not later than 45 days" after discovery, and notice to the Maryland Attorney General's office **before** notifying residents (Com. Law §14-3504(b)(3), (h)).
   - **FTC:** if the event involves 500 or more consumers, notify the FTC through its online form within 30 days of discovery (16 CFR 314.4(j)). Below 500, keep the record.
   - **Insurance:** if the firm has cyber insurance, call the carrier first. **[CONFIRM whether a policy exists; consider getting one]**
   - **Law enforcement:** local police and the FBI's IC3 (ic3.gov) for theft or fraud.
6. **Remediate.** Rotate passwords and secrets that may have been exposed (admin password, `JWT_SECRET`, API keys). Rotate the master key only with a planned re-encryption (a casual rotation makes all encrypted data unreadable).
7. **Review (within 30 days).** What failed? Update this plan and retrain staff. Record the lessons.

**Contacts to keep on one card:** owner **[CONFIRM phone]**; IRS Stakeholder Liaison **[CONFIRM name and phone once looked up]**; Railway and Neon support; Resend and Twilio support; insurance carrier.

## 10. Retention and disposal schedule

- **Tax return work papers and copies:** keep at least as long as the IRS period of limitations (3 years from filing; 6 years if more than 25% of gross income was omitted; indefinitely if no return or a fraudulent return). Maryland's registered-preparer rule also requires records of personal income tax returns for a period the State Board sets that is "not more stringent than a length of time specified under federal law" (Bus. Occ. & Prof. §21-403(a)). Practical rule: **keep returns and work papers 7 years, then delete.** **[CONFIRM: owner may choose a different period; do not go below 3 years]**
- **Employment-tax records for client payroll:** at least 4 years after the tax is due or paid, whichever is later.
- **Identity documents (copies of IDs and Social Security cards):** delete when the engagement ends or 2 years after last use, whichever is first, unless needed for a pending filing (314.4(c)(6)).
- **Website messages that do not become clients:** delete after 2 years.
- **Backups:** the daily backup email is kept 30 days then deleted from the mailbox. **[CONFIRM mailbox rule]**

## 11. Testing and review (314.4(d), (g), (i))

- **Every 6 months:** open the Fix Center and clear every warning; confirm the 2-step settings and the backup emails are arriving; run the dependency security check (`npm audit`) and apply fixes.
- **Annually:** restore a backup into a test database and open a record to prove it works; review user accounts and remove anyone who no longer needs access; review providers; retrain staff; update this plan; the Qualified Individual signs a one-page written report to the owner (status, incidents, changes) and files it with this plan.
- **After any change** in how data is stored or shared, or any incident, update the plan.

## 12. IRS e-file and Pub 4557 reminders

- Keep the EFIN and PTIN information private; do not share e-file credentials.
- Check the IRS e-Services account and EFIN status monthly for unexpected filings.
- Pub 4557 "Safeguarding Taxpayer Data" and the Pub 5708 template are the IRS versions of this plan; this document replaces filling in the Pub 5708 blanks.

## 13. Known gaps in the software (for the owner's decision)

1. Minimum password length is 8 characters (software setting; recommend 12).
2. Names, addresses, phone numbers, email addresses and invoice amounts are not field-encrypted (only protected by access control, the provider and HTTPS). The Safeguards Rule's "encrypt all customer information at rest" is met for the sensitive fields; the remainder relies on the provider's disk-level encryption **[CONFIRM provider statement]**.
3. The daily backup is emailed. It is encrypted, but a mailbox is an unusual offsite store; keep the key separate from the mailbox.
4. No independent penetration test has been done. Not required for a firm this size (314.6); consider one once a year or when the portal changes substantially.
