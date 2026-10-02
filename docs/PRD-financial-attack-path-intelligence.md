# PRD: Financial Attack Path Intelligence (FAPI)

| Field | Value |
|---|---|
| Author | Jaxz (technical owner), from XploitLab's brief + technical handoff |
| Status | Draft, needs founder sign-off on Section 8 |
| Version | 0.1 |
| Last updated | 18 Sep 2026 |
| Related TRD | TRD-financial-attack-path-intelligence.md |
| Mode | Hackathon (AI Builder Cup 2026, BFSI track) |

## 1. Problem statement

Bank security teams report risk as CVE counts and attack paths. CFOs, boards, and regulators decide in dollars, disruption hours, and reporting thresholds. Nobody translates between the two, so cyber risk stays an unquantified line item, security budgets get cut because their value can't be shown, and when regulations like DORA demand quantified impact on a clock, banks reconstruct the numbers after the fact.

## 2. Goals & success metrics

| Goal | Metric | Target |
|---|---|---|
| A non-technical judge understands the scenario unaided | Judge can state the exposure figure and why the fix matters, with no team explanation | Passes with 3/3 non-security test viewers before demo day |
| Every number is defensible | Verdict values with a visible source (node, edge, or rule) | 100% |
| The what-if lands live | Time from click to recomputed verdict | < 2 s, with no LLM call in the recompute |
| Demo is reliable | Full demo journey completes with Gemini unavailable | Yes (cached fallback) |

## 3. Non-goals / Out of scope for demo

- Real integrations (scanners, SIEM, core banking). **All data is synthetic.**
- Auth, accounts, multi-tenancy, billing.
- Graph editor, scenario library, or more than one scenario.
- Breach *probability* prediction. This is a scenario-based exposure estimate.
- Legal regulatory determination. The regulatory flag is a simplified rule check.
- Databases, queues, microservices, Kubernetes, vector stores.
- Mobile layout. Demo runs on a laptop/projector.

**Fake vs build:** fake the bank (JSON file) and the control data. Build for real: the Gemini reasoning call, the path validator, the exposure engine, the what-if recompute, the UI.

## 4. Target users & personas

| Persona | Context | Need |
|---|---|---|
| CISO | Has attack-path findings, must justify remediation spend | One defensible dollar figure per compromise, and what a fix is worth |
| CFO / board member | Non-technical, reads four numbers and decides | Plain language, no security jargon, a "why" behind each number |
| Hackathon judge (actual demo user) | 3–5 min, scoring against a rubric (40% Gen AI implementation) | Sees Gemini doing real work and numbers that hold up when questioned |

## 5. User stories & functional requirements

| ID | User story | Priority | Acceptance criteria |
|---|---|---|---|
| FR-1 | As a viewer, I see the compromised entity and the bank environment so I know the starting point | Must | Scenario loads on open; entry node visibly marked; 10–15 nodes rendered |
| FR-2 | As a viewer, I get a plain-language explanation of how the compromise cascades | Must | Gemini returns ordered hops + narrative; narrative contains no unexplained jargon; each hop names a technique |
| FR-3 | As a CISO, I only see attack steps backed by real configuration | Must | Every hop maps to an existing `allowed` edge; a hop that doesn't is rejected and never displayed |
| FR-4 | As a board member, I see a four-part verdict | Must | Cyber Risk, Financial Exposure ($), Disruption (hrs), Regulatory status shown separately, never blended into one score |
| FR-5 | As a CISO, I can open "Show Me Why" for every number | Must | Each factor lists value, source node/edge/config, and the rule applied; the displayed factors multiply out to the displayed total |
| FR-6 | As an auditor, missing evidence is shown as UNKNOWN, not assumed safe | Must | A factor without evidence renders UNKNOWN; the verdict is flagged incomplete; it never silently defaults to 0 |
| FR-7 | As a CISO, I can simulate one fix and see the verdict recompute | Must | One click on "Revoke payment-write"; before/after shown side by side; completes in < 2 s |
| FR-8 | As a CFO, I see what the fix is worth | Must | Avoided exposure ($) and effort estimate shown; figure equals before minus after |
| FR-9 | As a viewer, I see the attack path as a diagram, with the broken link highlighted after the fix | Must | Path edges highlighted; the removed edge is visibly cut in the after-state |
| FR-10 | As the presenter, the demo works if Gemini is slow or down | Should | Pre-validated cached output served on timeout/error; the UI indicates cached vs live |
| FR-11 | As a viewer, I can try a second predefined fix | Could | Second what-if option using the same mechanism |
| FR-12 | As a user, I can edit the graph or add scenarios | Won't | — |

## 6. User flow

1. App opens on the scenario: "Vendor API key compromised."
2. Viewer clicks **Analyze**. The attack path animates across the graph and Gemini's narrative appears beside it.
3. The verdict appears: HIGH / $2.3M / 72 hrs / MATERIAL.
4. Viewer opens **Show Me Why** and sees the factors and sources behind each number.
5. Viewer clicks **What-If: revoke payment-write permission**.
6. **The key moment:** the before/after verdict appears side by side, the path visibly breaks, and "$1.5M avoided for about 1 engineering hour" is shown.

## 7. Non-functional requirements

| ID | Category | Requirement | Rationale |
|---|---|---|---|
| NFR-1 | Integrity | No dollar figure, disruption value, or regulatory status originates from the LLM | Core credibility claim |
| NFR-2 | Determinism | Same graph + same path gives an identical verdict on every run | Demo must be repeatable |
| NFR-3 | Performance | What-if < 2 s; first analysis < 10 s live or < 1 s cached | Live-demo pacing |
| NFR-4 | Compliance (hackathon) | Uses the Gemini API; deployed on Google Cloud Run | Mandatory rules |
| NFR-5 | Security | No secrets in the repo; Gemini key via env/Secret Manager; synthetic data only | Hygiene; no real bank data exists |
| NFR-6 | UX | Reads like a finance product: minimal jargon, legible on a projector | Non-security audience |
| NFR-7 | Honesty | UI labels the regulatory flag as a "simplified rule, not legal advice" and the data as synthetic | Holds up under judge questions |

## 8. Assumptions & open questions

**Assumptions**

> ⚠️ Assumption: Deadline unknown. Milestones below are relative (D-day = demo).
> ⚠️ Assumption: Solo technical build, with the founder available for rule sign-off.
> ⚠️ Assumption: USD display is fine for an EU-regulation story.

**Open questions (all owner: founder; decide before engine work starts)**

1. **The source docs' numbers don't compute.** $2.5M × 0.65 × 0.55 ≈ $894K, not $2.3M. The TRD (Section 4) proposes factors that reach exactly $2.3M and $0.8M. Accept or replace?
2. **Where does the after-fix $0.8M come from?** If the only path breaks, exposure should be about $0. The TRD proposal adds a second, smaller reachable system (refunds API) that survives the fix. Accept?
3. **ROI is inconsistent:** the brief says "$750K / eng. hour" while the handoff says $1.5M per ~1 hr. The proposal is $1.5M avoided / ~1 hr (2.3 − 0.8). The deck needs updating.
4. **DORA threshold.** DORA's economic-impact criterion is €100K, so $0.8M alone would not be "below threshold." The proposed rule is MATERIAL only when a *critical-function* system is reached **and** exposure is ≥ €100K-equivalent. After the fix no critical system is reached, so "below" becomes defensible. Accept?
5. **UNKNOWN behavior.** The proposal is to compute the factor at worst case (1.0), show the exposure as "up to $X", and flag the verdict INCOMPLETE. The alternative is to show no figure at all.

## 9. Milestones

| Milestone | Scope | Target |
|---|---|---|
| M0: Rules frozen | Open questions 1–5 answered; graph JSON final | D-7 |
| M1: Engine + API | FR-3, 4, 5, 6, 7 (backend), tests green | D-5 |
| M2: Gemini + UI | FR-1, 2, 8, 9, full flow clickable locally | D-3 |
| M3: Demo build | FR-10, Cloud Run deploy, 3-viewer test | D-1 |
| Stretch | FR-11, path animation polish | If time allows |
