-- Written Information Security Plan (WISP) — required for every IRS paid
-- preparer under Pub. 4557 and the FTC Safeguards Rule (16 CFR Part 314).
-- Previously only a reminder task told staff to "walk through" a WISP that
-- didn't actually exist as a document. Two tables: a singleton settings row
-- (coordinators + adopted/reviewed dates) and a per-user acknowledgment log
-- keyed by last_reviewed_date as its "version" — bumping that date (the
-- annual-review action) requires every staff member to re-acknowledge,
-- giving a real, timestamped record of annual security training instead of
-- an unenforced policy on paper.
CREATE TABLE IF NOT EXISTS altax.v3_wisp_settings (
    id VARCHAR(16) PRIMARY KEY DEFAULT 'WISP-1',
    coordinator_names TEXT NOT NULL DEFAULT 'Abdulsamad Almabari, Hesham A. Almabari',
    adopted_date DATE NOT NULL DEFAULT CURRENT_DATE,
    last_reviewed_date DATE NOT NULL DEFAULT CURRENT_DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS altax.v3_wisp_acknowledgments (
    user_id VARCHAR(64) NOT NULL REFERENCES altax.v3_users(user_id) ON DELETE CASCADE,
    version DATE NOT NULL,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, version)
);
