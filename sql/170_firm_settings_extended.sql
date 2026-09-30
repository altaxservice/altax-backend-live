-- Extends v3_firm_settings with fields requested for the Firm Settings page
-- rebuild: firm credentials (print on engagement letters, prefill POA forms),
-- firm-wide billing defaults (today terms/payment instructions are typed
-- fresh on every single invoice), and firm-wide email sender defaults.
--
-- Deliberately does NOT add PTIN/CAF number here — those already exist per
-- preparer on v3_users (ptin, caf_number; see /auth/preparer-info and the
-- POA representative picker), which is the correct model since a firm's
-- individual preparers each carry their own PTIN/CAF, not the firm as a
-- whole. Duplicating them at the firm level would create two sources of
-- truth for the same data.
ALTER TABLE altax.v3_firm_settings
  ADD COLUMN IF NOT EXISTS ein VARCHAR(20),
  ADD COLUMN IF NOT EXISTS efin VARCHAR(20),
  ADD COLUMN IF NOT EXISTS website VARCHAR(255),
  ADD COLUMN IF NOT EXISTS default_payment_terms VARCHAR(50),
  ADD COLUMN IF NOT EXISTS default_payment_instructions TEXT,
  ADD COLUMN IF NOT EXISTS invoice_footer VARCHAR(500),
  ADD COLUMN IF NOT EXISTS email_from_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS email_reply_to VARCHAR(255),
  ADD COLUMN IF NOT EXISTS email_signature TEXT;
