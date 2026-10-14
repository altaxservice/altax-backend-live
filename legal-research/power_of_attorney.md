# Power of Attorney — research notes for attorney review

Prepared 2026-10-14 while upgrading the Document Builder's **Power of Attorney** (`general_poa`) and **Business Power of Attorney** (`business_poa`). These are research notes, not legal advice. Primary sources are the Maryland statute pages; secondary sources (form sites) were only used to find the right sections.

## What the law says (primary sources)

Source: Maryland Code, Estates & Trusts Article, Title 17 — https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=get&section=17-110&enactments=false (and sections 17-105, 17-113, 17-202 on the same site).

| Point | Where | What it says (paraphrased) | How the template handles it |
|---|---|---|---|
| Execution | §17-110(a) | A power of attorney signed on/after Oct 1, 2010 must be in writing; signed by the principal (or by another at the principal's direction, in their presence); acknowledged before a notary (in person or electronically); and attested and signed by **two or more adult witnesses**, in the physical/electronic presence of the principal and each other. | Signature block, two-witness attestation with addresses, and a notary acknowledgment block (county, date, signature/seal, commission expiry). |
| Notary as witness | §17-110(b) | The notary who takes the acknowledgment may also be one of the witnesses. | Notes it in the review note; template still has two separate witness lines (safer). |
| Remote signing | §17-110(c) | Extra rules (supervising attorney, Maryland resident/location, certification) apply to remote execution, except for real-estate powers. | Not built — paper/in-person execution only. E-sign in the app is **not** a substitute (the builder already warns a notary is needed). |
| Durable by default | §17-105(c) | A written power naming an agent is durable "unless otherwise provided by its terms". | Durable option defaults to **on**; the "not durable" wording ends the power on incapacity. |
| Agent duties | §17-113 | Act with care, competence and diligence for the principal's best interest; keep records; not liable merely because property value declines. | Duties paragraph follows these points. |
| Statutory form | §17-202 | Maryland publishes a statutory *personal financial* POA form with fixed headings: warnings, agent/co-agents/successors, compensation, general authority, 11 subjects (real property, tangible personal property, stocks and bonds, banks, insurance and annuities, claims and litigation, government benefits, retirement plans, taxes, digital assets, trust and estate matters), optional gift limits, joint accounts, effective/termination dates, copies, revocation, reliance by third parties, guardian nomination, signature/acknowledgment, witness attestation. | The Power of Attorney now lists the same subjects (switchable), gift limits, successor agent, compensation, effective/termination, revocation, reliance, witness attestation and notary block. It is **not** a copy of the statutory form. |
| Real estate | §17-203 (not read in full) and Real Property Art. | Secondary sources say a power used to sell/mortgage real property should use the statutory *limited* form (or one that substantially conforms), and be recorded in the county land records. | Review note says so. **Open item** — confirm with the attorney/title company. |

## Items I could NOT confirm from primary text
- Whether an agent may act as a witness (the statute page I read does not mention it). Templates conservatively say witnesses should not be the agent.
- Statutory rules on whether banks/title companies must accept a power of attorney, and any agent certification form (the section I fetched, §17-113, does not cover it).
- How Maryland treats a power of attorney **from a business entity** (LLC/corporation). Title 17 reads as written for individual principals; a company's authority normally comes from its governing documents and a resolution. The Business Power of Attorney is therefore drafted as an agency grant signed by the owner and tells users to bring a corporate resolution, but **the attorney should confirm** whether the notary/witness formalities and a resolution are required.

## Questions for the attorney
1. Should the Business POA name the authority under which the owner signs (operating agreement / resolution), and do banks you work with accept it without their own form?
2. Is the added "sell the business / change ownership / gifts" option acceptable, or should it require owner consent attached?
3. Confirm recording and certification steps for real-estate powers.
4. Review the Arabic edition for legal accuracy (my own translation).

## Sources
- Md. Code, Est. & Trusts §17-110, §17-105, §17-113, §17-202 — mgaleg.maryland.gov (links above).
- National Notary Association summary of the 2020 notary/witness change — https://www.nationalnotary.org/knowledge-center/news/law-updates/md-senate-bill-309
