-- Optional "smart reading" of POS report photos by Claude (vision). OFF until an admin turns it on — it sends the picture to Anthropic.
ALTER TABLE altax.v3_firm_settings ADD COLUMN IF NOT EXISTS pos_smart_reading_enabled BOOLEAN NOT NULL DEFAULT false;
