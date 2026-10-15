import test from "node:test";
import assert from "node:assert/strict";
import { ClientKeyRow, clusters, compare, normName, normPhone, pairKey, relatedTo } from "../modules/clientGroups/relatedClients";

const row = (id: string, name: string, o: Partial<ClientKeyRow> = {}): ClientKeyRow => ({
  client_id: id, client_name: name, status: "Active", phone: null, email: null, company_contact_name: null, company_contact_phone: null, company_contact_email: null, ...o,
});

test("phone numbers match however they are typed, and short or foreign numbers never match", () => {
  assert.equal(normPhone("(929) 589-9350"), "9295899350");
  assert.equal(normPhone("+1 929-589-9350"), "9295899350");
  assert.equal(normPhone("589-9350"), "");
});

test("a lone first name is not an owner identity", () => {
  assert.equal(normName("Amro"), "");
  assert.equal(normName("AMRO  Essa."), "amro essa");
});

test("same owner phone, email or name is a strong match; same company phone is medium", () => {
  const a = row("C-1", "A INC", { company_contact_phone: "718-200-0782", company_contact_name: "Amro Essa" });
  const b = row("C-2", "B LLC", { company_contact_phone: "(718) 200-0782", company_contact_name: "AMRO ESSA" });
  const kinds = compare(a, b).map((r) => r.kind);
  assert.deepEqual(kinds.sort(), ["owner name", "owner phone"]);
  const c = row("C-3", "C INC", { phone: "3135551212" });
  const d = row("C-4", "D INC", { phone: "313-555-1212" });
  assert.deepEqual(compare(c, d).map((r) => [r.kind, r.weight]), [["company phone", 2]]);
});

test("an owner who is also a client under his own name is connected to his company", () => {
  const person = row("C-1", "BASHEER ALQADRI");
  const shop = row("C-2", "BROWAY MART INC", { company_contact_name: "Basheer Alqadri" });
  assert.ok(compare(person, shop).some((r) => r.kind === "owner is this client"));
});

test("unrelated companies do not match, and a dismissed pair is not suggested again", () => {
  const a = row("C-1", "A INC", { email: "x@y.com" });
  const b = row("C-2", "B INC", { email: "x@y.com" });
  const z = row("C-3", "Z INC", { email: "other@y.com" });
  assert.equal(relatedTo(a, [a, b, z], new Set()).length, 1);
  assert.equal(relatedTo(a, [a, b, z], new Set([pairKey("C-2", "C-1").join("|")])).length, 0);
});

test("clusters join companies that are connected through a chain of matches", () => {
  const a = row("C-1", "A", { phone: "4105550001" });
  const b = row("C-2", "B", { phone: "4105550001", email: "q@q.com" });
  const c = row("C-3", "C", { email: "q@q.com" });
  const lone = row("C-9", "LONE", { phone: "4105559999" });
  const found = clusters([a, b, c, lone], new Set());
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].ids.sort(), ["C-1", "C-2", "C-3"]);
});
