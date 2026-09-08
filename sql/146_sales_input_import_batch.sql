-- Tags every row an Excel import creates with a shared batch ID, so a whole
-- import can be reversed with one click instead of deleting rows one at a
-- time. Real incident: EUPHORIA SMOKE CIGAR SHOP INC had 8 months of another
-- company's sales data imported by mistake, and undoing it meant finding
-- every affected row by timestamp and deleting each individually. Null on
-- every row created before this shipped, and on manually-entered ("Add
-- Sale") rows — only the bulk importer ever sets it.
ALTER TABLE altax.v3_sales_input ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_v3_sales_input_import_batch ON altax.v3_sales_input(import_batch_id);
