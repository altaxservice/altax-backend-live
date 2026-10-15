import test from "node:test";
import assert from "node:assert/strict";
import { phoneDigits, withSmsOptOut, SMS_OPT_OUT_LINE } from "../common/smsConsent";
import { MIN_PASSWORD_LENGTH } from "../modules/auth/password";

test("phoneDigits keeps the last 10 digits so +1 and formatting do not matter", () => {
  assert.equal(phoneDigits("+1 (443) 825-8804"), "4438258804");
  assert.equal(phoneDigits("443-825-8804"), "4438258804");
});

test("withSmsOptOut appends the opt-out line once", () => {
  const once = withSmsOptOut("Hello");
  assert.ok(once.endsWith(SMS_OPT_OUT_LINE));
  assert.equal(withSmsOptOut(once), once);
});

test("new passwords need at least 12 characters", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
});
