# AL TAX SERVICE — Phase 0 Foundation

This is the first concrete slice of the migration plan: **no user-facing change yet**,
just the pieces everything else depends on.

## What's in here

```
sql/
  generate_schema.py     # generates 001_init_schema.sql straight from the real
                          # AL_TAX_V3_SCHEMA (schema_source.json is a copy of it)
  001_init_schema.sql     # PostgreSQL DDL — 28 tables, PKs, FKs, indexes.
                          # Validated to parse cleanly with sqlglot (postgres dialect).
src/
  config/db.ts            # Postgres connection pool
  common/
    audit.ts              # ported from v3LogAudit_
    requireAuth.ts         # JWT verification + SERVER-SIDE role enforcement
  modules/
    auth/
      password.ts          # ported 1:1 from alTaxV5HashPassword_ / alTaxV5CreatePasswordHash_ /
                            # alTaxV5VerifyPassword_ — same algorithm, same "v2$iter$salt$hash"
                            # format, so existing v3_Users.PasswordHash values keep working.
      auth.service.ts       # ported from alTaxV3AuthenticateUser — same lockout rule
                            # (5 attempts / 15 min), same legacy-hash upgrade-on-login,
                            # same client/employee resolution and inactive-account checks.
      auth.routes.ts         # POST /auth/login
    clients/
      clients.routes.ts      # first CRUD slice: list, get (with SSN/EIN masking), create
  migration/
    sheetsToPostgres.ts     # reads every v3_ tab via the Sheets API and upserts into Postgres.
                            # Skips v3_Client_Secrets / v3_Secret_Access_Log on purpose —
                            # those get a separate, reviewed migration path (Phase 6).
  server.ts                 # Express app wiring auth + clients routes
```

## Why these pieces first

Every other module (Tasks, Billing, Payroll, Documents, Accounting, Vault) reads and
writes `v3_Clients` and `v3_Users`, and every portal screen needs a login. Phase 0
exists so Phase 1 (Client Management + Auth, per the migration plan) has a real
database and a real, behavior-identical login to build against.

## Running it locally

```bash
cp .env.example .env
# edit .env: DATABASE_URL, JWT_SECRET

npm install
npm run migrate:schema        # applies sql/001_init_schema.sql
npm run dev                   # starts the API on :4000
```

To pull real data in from the existing spreadsheet (read-only from Sheets, safe to
run repeatedly — it upserts by primary key):

```bash
# .env additionally needs GOOGLE_SERVICE_ACCOUNT_JSON and SOURCE_SPREADSHEET_ID
# (share the sheet, view-only, with that service account's email first)
npm run migrate:sheets
```

## What was intentionally NOT done yet

- **Password hashing was not upgraded to bcrypt/argon2.** The plan's tech-stack table
  suggested a stronger KDF long-term, but Phase 0 ports the *exact* existing scheme so
  no one is locked out and no passwords need to be reset on cutover day. A stronger
  KDF can be introduced later behind the same "needsUpgrade" migration path already
  used for the legacy SHA-256 format.
- **`v3_Client_Secrets` / `v3_Secret_Access_Log` are not migrated by this script.**
  Per the plan's Phase 6 gate, the Secure Vault gets its own reviewed migration and
  re-implementation of the client-side encryption model, given its sensitivity.
- **Only Clients has real routes.** Tasks, Billing, Payroll, Documents, Accounting,
  and Communications are Phase 2–6 per the plan — this skeleton establishes the
  pattern (route → service → audit log) each of those will follow.
- **No frontend yet.** This is API + database only.

## Test gate for this phase (per the migration plan, Section 6)

Before Phase 1 begins:
- [ ] `npm run migrate:schema` runs clean against a fresh Postgres database.
- [ ] `npm run migrate:sheets` pulls every non-restricted `v3_` tab with row counts
      matching the source sheet.
- [ ] A known existing portal user (with a real `PasswordHash` from the live sheet)
      can log in via `POST /auth/login` with their existing password, unchanged.
- [ ] 5 wrong password attempts locks the account for 15 minutes, matching today's
      behavior exactly.
