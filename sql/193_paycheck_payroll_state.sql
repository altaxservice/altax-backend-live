-- Which state a paycheck's state tax (and SUTA) is reported to. NULL = the employee's home state (the app's own payroll);
-- imported paychecks set it to the client's state, because the Excel/payroll file only carries that state's withholding.
ALTER TABLE altax.v3_paychecks ADD COLUMN IF NOT EXISTS payroll_state VARCHAR(8);
