-- A page note can also show on other pages (besides the one it was written on). Safe to run more than once.
ALTER TABLE altax.v3_page_notes ADD COLUMN IF NOT EXISTS also_pages TEXT[] NOT NULL DEFAULT '{}';
