import { test } from "node:test";
import assert from "node:assert/strict";
import { periodLabelFor, statusOf } from "../modules/filingTracker/filingTracker.routes";

const today = "2026-10-16";
const rec = (filedDate: string | null, paidDate: string | null, sentAt: string | null) => ({ filedDate, paidDate, sentAt });

test("status: nothing recorded is not filed", () => {
  assert.equal(statusOf(null, true, today), "not_filed");
  assert.equal(statusOf(rec(null, null, null), true, today), "not_filed");
});

test("status: filed with no payment, a future payment date, then paid", () => {
  assert.equal(statusOf(rec("2026-10-10", null, null), true, today), "unpaid");
  assert.equal(statusOf(rec("2026-10-10", "2026-10-20", null), true, today), "scheduled");
  assert.equal(statusOf(rec("2026-10-10", "2026-10-16", "2026-10-10T10:00:00Z"), true, today), "done");
});

test("status: paid but the client was never told only counts when the client can be reached", () => {
  assert.equal(statusOf(rec("2026-10-10", "2026-10-12", null), true, today), "not_sent");
  assert.equal(statusOf(rec("2026-10-10", "2026-10-12", null), false, today), "done");
});

test("period labels read as a month, a quarter, a half or a year", () => {
  assert.equal(periodLabelFor("2026-09-01", "2026-09-30"), "Sep 2026");
  assert.equal(periodLabelFor("2026-07-01", "2026-09-30"), "Q3 2026");
  assert.equal(periodLabelFor("2026-01-01", "2026-06-30"), "Jan–Jun 2026");
  assert.equal(periodLabelFor("2026-01-01", "2026-12-31"), "2026");
});
