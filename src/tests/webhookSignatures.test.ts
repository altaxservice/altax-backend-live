/**
 * Unit tests (no server, no database) for the delivery-status webhook signature
 * verification added for BC-001. Both providers' algorithms are security-critical
 * (an unverified webhook would let anyone forge "delivered"/"bounced" status for
 * any communication row), so this pins the exact behavior against known-good and
 * deliberately-tampered test vectors rather than relying on a live callback,
 * which no dev environment here can trigger for real.
 *
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import twilio from "twilio";
import { verifyResendSignature } from "../modules/webhooks/webhooks.routes";

function signResend(secret: string, id: string, timestamp: string, body: string): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${body}`;
  return `v1,${crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64")}`;
}

test("verifyResendSignature: accepts a correctly-signed payload", () => {
  const secret = `whsec_${Buffer.from("test-signing-secret").toString("base64")}`;
  const id = "msg_2abc";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_123" } });
  const headers = { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signResend(secret, id, timestamp, body) };
  assert.equal(verifyResendSignature(Buffer.from(body), headers as any, secret), true);
});

test("verifyResendSignature: rejects a tampered body (signature no longer matches)", () => {
  const secret = `whsec_${Buffer.from("test-signing-secret").toString("base64")}`;
  const id = "msg_2abc";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const originalBody = JSON.stringify({ type: "email.delivered", data: { email_id: "re_123" } });
  const tamperedBody = JSON.stringify({ type: "email.delivered", data: { email_id: "re_999" } }); // attacker swaps the target id
  const headers = { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signResend(secret, id, timestamp, originalBody) };
  assert.equal(verifyResendSignature(Buffer.from(tamperedBody), headers as any, secret), false);
});

test("verifyResendSignature: rejects a signature made with the wrong secret", () => {
  const realSecret = `whsec_${Buffer.from("real-secret").toString("base64")}`;
  const wrongSecret = `whsec_${Buffer.from("attacker-guess").toString("base64")}`;
  const id = "msg_2abc";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_123" } });
  const headers = { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signResend(wrongSecret, id, timestamp, body) };
  assert.equal(verifyResendSignature(Buffer.from(body), headers as any, realSecret), false);
});

test("verifyResendSignature: rejects a stale timestamp (replay protection)", () => {
  const secret = `whsec_${Buffer.from("test-signing-secret").toString("base64")}`;
  const id = "msg_2abc";
  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 60); // 1 hour old, well past the 5-minute tolerance
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_123" } });
  const headers = { "svix-id": id, "svix-timestamp": staleTimestamp, "svix-signature": signResend(secret, id, staleTimestamp, body) };
  assert.equal(verifyResendSignature(Buffer.from(body), headers as any, secret), false);
});

test("verifyResendSignature: accepts one valid signature among multiple space-separated candidates (secret rotation)", () => {
  const secret = `whsec_${Buffer.from("current-secret").toString("base64")}`;
  const oldSecret = `whsec_${Buffer.from("old-secret").toString("base64")}`;
  const id = "msg_2abc";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_123" } });
  const combined = `${signResend(oldSecret, id, timestamp, body)} ${signResend(secret, id, timestamp, body)}`;
  const headers = { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": combined };
  assert.equal(verifyResendSignature(Buffer.from(body), headers as any, secret), true);
});

// --- Twilio: twilio.validateRequest() is the actual library function the route calls
// (already a dependency — see notifications.ts's twilioClient()) — this pins that it
// behaves as expected against this app's own usage shape rather than re-implementing it.
test("twilio.validateRequest: accepts a correctly-signed status callback", () => {
  const authToken = "test-auth-token";
  const url = "https://altaxgroup.com/webhooks/twilio";
  const params = { MessageSid: "SM123", MessageStatus: "delivered" };
  // Twilio's documented algorithm: sort params by key, concatenate key+value onto the
  // URL, HMAC-SHA1 with the auth token, base64-encode.
  const sorted = Object.keys(params).sort().reduce((acc, k) => acc + k + (params as any)[k], url);
  const signature = crypto.createHmac("sha1", authToken).update(Buffer.from(sorted, "utf-8")).digest("base64");
  assert.equal(twilio.validateRequest(authToken, signature, url, params), true);
});

test("twilio.validateRequest: rejects a tampered param (e.g. attacker flips status to delivered)", () => {
  const authToken = "test-auth-token";
  const url = "https://altaxgroup.com/webhooks/twilio";
  const realParams = { MessageSid: "SM123", MessageStatus: "failed" };
  const sorted = Object.keys(realParams).sort().reduce((acc, k) => acc + k + (realParams as any)[k], url);
  const signature = crypto.createHmac("sha1", authToken).update(Buffer.from(sorted, "utf-8")).digest("base64");
  const tamperedParams = { MessageSid: "SM123", MessageStatus: "delivered" };
  assert.equal(twilio.validateRequest(authToken, signature, url, tamperedParams), false);
});

test("twilio.validateRequest: rejects a signature made with the wrong auth token", () => {
  const realToken = "real-auth-token";
  const wrongToken = "attacker-guess";
  const url = "https://altaxgroup.com/webhooks/twilio";
  const params = { MessageSid: "SM123", MessageStatus: "delivered" };
  const sorted = Object.keys(params).sort().reduce((acc, k) => acc + k + (params as any)[k], url);
  const signature = crypto.createHmac("sha1", wrongToken).update(Buffer.from(sorted, "utf-8")).digest("base64");
  assert.equal(twilio.validateRequest(realToken, signature, url, params), false);
});
