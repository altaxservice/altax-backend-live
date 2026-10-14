# Document Builder audit tools

- `npx ts-node scripts/docAudit/mech.ts` — automated audit of every template in English and Arabic (unknown variables, empty/garbled sentences, missing signature lines or signers, English/Arabic mismatches, unused questions). Limit to some documents with `ONLY=key1,key2`. Expect harmless "line ends with colon" / numbering notes for intro lines before lists.
- `npx ts-node scripts/docAudit/render.ts <templateKey> <en|ar> [defaults|yes|no]` — prints the questions and the rendered document (`yes` = every switch on, `no` = every switch off).
Run `mech.ts` after editing any template; the full substantive legal review is in `legal-research/`.
