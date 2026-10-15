# Document Builder audit tools

- `npx ts-node scripts/docAudit/mech.ts` — automated audit of every template in English and Arabic (unknown variables, empty/garbled sentences, missing signature lines or signers, English/Arabic mismatches, unused questions). Limit to some documents with `ONLY=key1,key2`. Expect harmless "line ends with colon" / numbering notes for intro lines before lists.
- `npx ts-node scripts/docAudit/render.ts <templateKey> <en|ar> [defaults|yes|no]` — prints the questions and the rendered document (`yes` = every switch on, `no` = every switch off).
Run `mech.ts` after editing any template; the full substantive legal review is in `legal-research/`.

- `npx ts-node --transpile-only scripts/docAudit/artifacts.ts` — renders every document (English and Arabic; defaults, all switches on, all off) and flags doubled punctuation, space before punctuation, empty brackets and repeated words. Limit with `ONLY=key1,key2`.
- Machine checks that block saving a document with a detectable mistake live in `src/modules/docBuilder/checks.ts` (tested by `src/tests/docChecks.test.ts`); add a check there when a document has a rule that can be tested (totals, date order, legal caps).
- The optional notary-acknowledgment step is added to every document without its own notary block at the bottom of `templates.ts` and rendered by `engine.ts`.
- Second audit write-up: `legal-research/AUDIT2_2026-10-14.md`.
