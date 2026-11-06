# CreditClock build plan

This plan follows [FR.md](FR.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [AGENTS.md](AGENTS.md). A slice is complete only after its exit test, including the required Forge site check.

**FR acceptance status:** The completed slice labels below mean their narrow exit smokes passed; they do not mean every requirement in that slice is fully accepted. A 2026-11-06 audit found remaining P0 implementation and release gates listed at the end of this file. FR-18 through FR-21 are optional P1 and have not been implemented.

| Slice | Requirements | Deliverable and exit test | Status |
|---|---|---|---|
| 1. Installable shell | FR-01, FR-15 | Forge project page and issue context, authenticated resolver, JSM project/issue guard, useful empty states; open both modules on a development JSM site | Complete (permitted-user smoke) |
| 2. Discovery | FR-02, FR-03, FR-04, FR-05, FR-08 | Project coverage mapping; issue created/updated lead; dated evidence creates one deterministic product-month case; replay and unmatched issue tests | Complete |
| 3. Trusted core | FR-06 to FR-10, FR-17 | Provenance, review and completeness, pure UTC interval and Atlassian 2026 policy engine; boundary, overlap, month split, leap year and missing-evidence tests | Complete (provisional live calculation) |
| 4. Human workflow | FR-11 to FR-15, FR-17 | Case details, audited claim states, copyable draft, idempotent daily deadline flags; full incident-to-recorded-submission test | Complete (simulated live path) |
| 5. Judge demo | FR-16 | Labeled synthetic fixtures, fresh-site setup, installation and permission checks, demo rehearsal | In progress (role smoke pending) |
| 6. Optional Rovo | FR-18 | Bounded explanation and draft actions only after P0 passes | Deferred |

## Contract and identity rules

- A Jira issue creates a lead, never qualifying downtime. A case appears only from dated evidence.
- Case identity is project + canonical coverage profile + UTC month. Its policy version is frozen data, not part of the key. A conflicting version blocks automatic assessment pending human reconciliation.
- Only explicitly reviewed, contract-relevant minute evidence enters calculation. A negative threshold conclusion also requires reviewer attestation that the month's evidence set is complete.
- Calculations are preliminary. Claim state changes and vendor outcomes require an authorized human action.

## Environment gate

The Forge app must be registered and installed on a Jira Service Management development site to pass Slice 1. Local typecheck/build/lint cannot substitute for that observed installation result. Current results: `npm run check` and `forge lint` pass; the app is registered in the CreditClock Developer Space, deployed to Forge development, and installed in Jira on the active demo site `https://one-atlas-cxup.atlassian.net` (expires 2027-02-03). The remaining exit check is opening both modules in an actual JSM project as a permitted user and checking denied access with an unauthorized user. The Forge scoped token does not authorize Jira REST access (`/rest/api/3/myself` returned 401), so that browser check requires a site session or separate Jira API access.

The supplied JSM test targets are project `CCDEMO` (`/jira/servicedesk/projects/CCDEMO`) and issue `CCDEMO-1` (`/browse/CCDEMO-1`). The user opened both modules and confirmed that each shows the setup message. This passes Slice 1's installation/rendering exit check. A live non-admin and unauthorized-user check remains a later release gate; local identity-guard tests pass.

Slice 2 was deployed in Forge development version 3.2.0 and installed with `storage:app`. Local `npm run check` passed, including exact issue matching, deterministic product-month keys, half-open UTC month boundaries, invalid observation rejection, duplicate lead/recheck behavior, duplicate observation retry, two-incident aggregation, and partial-write retry. Forge lint found no errors; its one major-version approval was the expected storage scope change. Live mapping, event discovery, case association, and nonmatching issue checks passed on CCDEMO.

Live setup result (2026-11-06): the user saved the CCDEMO mapping and the project page displayed `Current: [System] Incident + Jira → one-atlas-cxup · DEMO / SIMULATED`. This confirms the project-scoped mapping persists and is displayed. CCDEMO-1 issue matching, lead creation, dated observation/case association, replay, and nonmatching issue checks remain pending.

Live issue result (2026-11-06): CCDEMO-1 initially displayed `CreditClock: Potential follow-up`, `Jira Service Management Premium · Jira`, `DEMO / SIMULATED`, and `This issue matches the service mapping. Check again to create its lead now.` This confirms issue matching and the no-case empty state for an issue that predates the saved mapping.

Live recheck result (2026-11-06): the user clicked `Check again` on CCDEMO-1 and the panel displayed `Matching incident lead found.` This confirms manual lead creation for the preexisting matching issue.

Live observation result (2026-11-06): after saving a simulated dated observation, CCDEMO-1 displayed `2026-11 UTC · Evidence needed`, `DEMO / SIMULATED`, and case `f99d79810272874929396f40`. This confirms an issue-linked product-month case was created without promoting the observation to qualifying downtime.

Live project-list result (2026-11-06): the CCDEMO Claims page displayed one `2026-11 UTC · Evidence needed` simulated case, source `CCDEMO-1`, and the same case ID `f99d79810272874929396f40`. This confirms project case-list visibility and issue-to-case association. Local tests cover repeat/replay identity.

Live negative-match result (2026-11-06): CCDEMO-2 loaded CreditClock and displayed `CreditClock: No covered service` with the explicit no-matching-mapping message and incident/SLA disclaimer. This confirms a nonmatching issue does not surface a covered service. The remaining Slice 2 live smoke is event-driven lead discovery from an issue created or updated after mapping activation.

Live event result (2026-11-06): newly created CCDEMO-3, configured as `[System] Incident` with Component `Jira`, displayed `Matching incident lead found.` before any manual recheck. It had no month case, as expected without dated evidence. This passes event-driven lead discovery and closes Slice 2.

Slice 3 work in progress (2026-11-06): implemented a pure UTC interval union and Premium 2026 preliminary assessment engine, immutable minute-evidence and review records, freshness-bound completeness attestation, backend access checks, and an issue-panel review section. The engine uses only explicitly reviewed whole-minute assertions; an unreviewed customer observation never becomes downtime. Local `npm run check` and Forge lint pass. Forge development versions 3.3.0 and 3.4.0 deployed successfully. CCDEMO-1 displayed the new `2026-11 UTC · Case evidence` section with `NEEDS EVIDENCE`. The live review/calculation smoke remains pending; Slice 3 is not complete.

Live evidence-entry result (2026-11-06): the user saved a simulated minute assertion on CCDEMO-1 and the app reported `Unverified minute evidence saved.` Before reviewer action, the case still displayed `NEEDS EVIDENCE`, confirming the assertion did not advance assessment. Forge development version 3.5.0 was subsequently deployed with a frozen-policy conflict guard and explicit coverage, support, billing, and exclusion gaps. Reviewer action and calculation smoke remain pending.

Live review result (2026-11-06): after the user checked the simulated >5% error-rule attestation and clicked `Review customer evidence`, the app reported `Customer evidence review recorded.` Site status and complete-month attestation were intentionally left unchanged for the next calculation smoke.

Live attestation diagnostic (2026-11-06): the app reported `Case attestation recorded`, but the case stayed `NEEDS EVIDENCE` with the production-status gap. A diagnostic display in Forge development version 3.6.0 showed the saved record as `site status: unknown · Evidence set marked complete`. The first attestation therefore did not establish simulated production status; the reviewer must explicitly select it and record a new attestation. The form is being updated to keep the saved selection visible on refresh.

Forge development version 3.7.0 deployed (2026-11-06) with the saved site status and completeness decision restored into the reviewer form on refresh. Local `npm run check` and Forge lint pass. Live simulated-production re-attestation is pending.

Live calculation result (2026-11-06): CCDEMO-1 displayed `IN PROGRESS MONTH`, 10 reviewed candidate minutes out of 43,200, and `99.976852%` preliminary uptime for November UTC. The panel listed unresolved coverage, support-report, billing, exclusion, and provider-monitoring checks. The latest attestation stored simulated production status and `Evidence set not marked complete`; no no-threshold or credit conclusion appeared. This confirms the live provisional calculation and preserves the open-month boundary. Local tests cover exact tier boundaries, overlap, month splitting, leap February, missing evidence, unsupported policy/experience, stale completeness, and policy conflicts. Slice 3 is complete for the provisional demo flow; a closed-month live no-threshold demonstration is left for judge fixtures.

Slice 4 work in progress (2026-11-06): implemented claim-state rules, attributed append-only action records with expected-version checks, copyable preliminary draft, date-only deadline, idempotent daily in-app deadline flags, case workflow card, and Claims-page stage/deadline/owner display. Local `npm run check` and Forge lint pass, including transition, conflict, deadline, draft, and schedule replay tests. Forge development version 3.8.0 deployed successfully. Live workflow rendering/action checks, a closed-month draft/submission fixture, and role-denial smoke remain pending; Slice 4 is not complete.

Forge development version 3.9.0 deployed with the draft's observation and evidence references labeled by provenance and a cleared reference input after each recorded action. Slice 4 live smoke remains pending.

Live workflow render result (2026-11-06): the user confirmed that CCDEMO-1 displays the new Claim workflow card in `OPEN` state with the 2026-12-15 UTC date-only deadline. Attributed action, project-list linkage, and closed-month submission tests remain pending.

Live state-action result (2026-11-06): after `Start review`, CCDEMO-1 displayed `Claim workflow · UNDER REVIEW · DEMO / SIMULATED`. The basic human claim-state transition is confirmed; activity attribution and project-list reflection still need checking. Forge KVS prefix queries are documented as eventually consistent, so claim-event read-after-write is being hardened with direct-key reads before further workflow smoke.

Live owner result (2026-11-06): after `Assign me as owner`, CCDEMO-1 displayed the current user's account ID as owner in Claim workflow, with support reference still missing. This confirms owner assignment persisted in the workflow card. The project Claims row and Activity entry still await readback.

Live project-workflow result (2026-11-06): the CCDEMO Claims row displayed `2026-11 UTC · in progress month · DEMO / SIMULATED`, `Claim: under review`, `Deadline: 2026-12-15`, the current user's account ID as owner, `Next action: Resolve evidence and contract gaps`, source `CCDEMO-1`, and the same case ID. This confirms the project view reflects assessment and human claim state. Activity attribution and closed-month draft/submission smoke remain pending.

Live activity result (2026-11-06): the user confirmed that the CCDEMO-1 Claim workflow Activity list shows both the `UNDER REVIEW` and `OWNER` actions with attribution. The closed-month draft/submission smoke remains pending.

Forge development version 3.11.0 deployed (2026-11-06) with clearer potential-submission deadline wording, evidence-review history, and a project-admin-only October 2026 fixture button on matching simulated issues. The fixture is idempotent and creates a fictional dated observation plus an unverified 60-minute assertion; reviewer and claim actions remain human-controlled. Live fixture and closed-month workflow checks are pending.

Live October fixture result (2026-11-06): after the demo fixture action, CCDEMO-1 displayed a `2026-10 UTC · Case evidence` card with `NEEDS EVIDENCE · DEMO / SIMULATED` and the production-status gap. This confirms a separate past-month case was created without promoting its unverified minute assertion. Explicit evidence review and simulated-production attestation remain pending.

Live October evidence-review result (2026-11-06): the 60-minute fixture assertion acquired an attributed `REVIEWED CUSTOMER EVIDENCE` history entry after manual review. No automated promotion occurred; the October case still needs a separate site-status and completeness attestation before the closed-month calculation smoke.

Live October calculation result (2026-11-06): after a separate simulated-production and complete-evidence attestation, the closed October case displayed `REVIEWABLE · DEMO / SIMULATED`, 60 reviewed candidate minutes out of 44,640, `99.865591%` preliminary uptime, and a `potential 10% credit tier`. The panel retained explicit coverage, support-report, billing, exclusion, and provider-monitoring gaps and did not claim a vendor award. This passes the live closed-month tier smoke; the human draft/submission record remains pending.

Forge development version 3.12.0 deployed (2026-11-06) with explicit `DEMO:` references allowed only for simulated case actions and visible external references in claim activity. Local `npm run check` and Forge lint passed. The user is running the October human workflow smoke with fictional support and submission references; no external vendor action is taken by the app.

Forge development version 3.13.0 deployed (2026-11-06) after the user had difficulty finding `Mark draft ready`: each claim workflow card now includes its UTC month in the heading, so the October and November cases are distinct. The October claim-state/support-reference gate still needs readback.

Live October draft result (2026-11-06): the 2026-10 Claim workflow card displayed `DRAFT READY · DEMO / SIMULATED`, the potential date-only submission deadline `2026-11-15 UTC`, source `CCDEMO-1`, the current user as owner, and a `DEMO:` fictional support reference. This confirms the human draft-ready transition on a closed, reviewable case. The final simulated external-submission record and activity readback remain pending.

Live October submission-record result (2026-11-06): the 2026-10 Claim workflow card displayed `SUBMITTED · DEMO / SIMULATED`, potential date-only deadline `2026-11-15 UTC`, source `CCDEMO-1`, the current user as owner, fictional support reference `DEMO:SUPPORT-1`, and fictional external submission reference `DEMO:CLAIM-1`. This completes the installed-site incident → evidence review → preliminary assessment → human draft-ready → recorded external-submission path. CreditClock did not contact the vendor. Local tests cover idempotent deadline flags; the daily schedule has not yet reached a live milestone. Slice 4's end-to-end exit is complete, with live role-denial and fresh-site checks retained as release gates.

Slice 5 status (2026-11-06): `docs/JUDGE_SETUP.md` documents the reproducible, labeled synthetic October path. The active demo site was newly provisioned for this build, and its administrator completed mapping, event discovery, negative matching, evidence review, preliminary calculation, draft-ready, and recorded fictional submission. The user has only one administrator account on the site, so a live non-admin and no-browse user smoke cannot be performed yet and is **not** marked passed. A local aggregate-source visibility test now denies missing, wrong-ID, and cross-project sources. Forge development version 3.14.0 deployed, `npm run check` and Forge lint passed, and `forge install list` reports the Jira installation on `one-atlas-cxup.atlassian.net` as up-to-date. A separate fresh installation on the final build remains untested.

## FR acceptance gaps (audit 2026-11-06)

- **FR-07:** Coverage, timely support report, billing standing, and exclusions are listed as unresolved, but the reviewer cannot record each verified/failed/unknown condition and its reference. The calculation therefore cannot clear these gaps.
- **FR-08:** Observation dates create both month cases and the pure calculator clips and unions ranges correctly. A submitted qualifying-minute assertion is currently stored on only the selected case, so one cross-month assertion does not automatically populate both cases. Fix and integration-test this path.
- **FR-14:** The app shows a date-only potential deadline and has an idempotent scheduled scanner. The scanner currently uses the frozen policy date without a recorded contract-window confirmation; gate alerts on an explicit reviewer confirmation and test the gate.
- **FR-17:** Evidence reviews and claim actions retain actor/time. Coverage-policy edits overwrite the current record without append-only edit history, and assessment changes are derived on read rather than recorded as attributable change events.
- **FR-15/FR-16 release gates:** The site has only one administrator account. Live non-admin and no-browse access checks are untested; a separate fresh install of the final build and full judge rehearsal are untested.
- **P1 FR-18–FR-21:** Rovo, illustrative fee estimate, linked Jira review task, and unsupported-vendor registry are intentionally deferred until P0 is accepted.

## FR gap remediation in progress

Forge development version 3.16.0 deployed after `npm run check` and Forge lint passed. This revision adds explicit referenced contract-check statuses for coverage, support, billing, exclusions, and the claim window; the deadline scanner now requires confirmed coverage and claim-window references before flagging a case. It writes every new project mapping together with an attributed append-only change record in one KVS transaction. A qualifying-minute assertion crossing a UTC month boundary links every touched case and uses a stable submission ID to repair partial retries. Assessment recalculations now create timestamped SYSTEM activity entries when the result changes. These paths are implemented and locally tested, but their new UI/storage paths still need installed-site smoke checks. Historical mapping saves before 3.15.0 cannot be reconstructed into an audit trail. Live role-denial and final-build fresh-install checks remain unavailable or unperformed.

## Correctness-first phase (2026-11-06)

The current implementation adds a backend submission-readiness decision: a closed, reviewable month; complete reviewed evidence; production status; all five referenced contract checks confirmed; a UTC claim-window date; owner; and support reference. Unknown or failed checks leave the preliminary draft readable but block new `DRAFT_READY` and `SUBMITTED` actions. Historical submitted actions remain audited. A confirmed deadline record now carries its UTC date, reference, reviewer, time, and frozen policy ID; the daily scanner uses this date. Old-date alert flags are hidden if the confirmed date changes.

KVS transactions now commit both directions of a case-source link together and commit a claim event with its head pointer. Backend-derived content IDs make identical observation and minute assertions idempotent across browser reloads, so retries can repair cross-month partial work. Competing claim branches are surfaced and block ordinary actions; an administrator can append an attributed decision to keep the current chain and retain the competing record. Forge KVS has no documented compare-and-swap on these ordinary keys, so simultaneous writers are detected and recoverable, not strictly serialized.

Assessments validate the case's frozen policy snapshot against the implemented adapter and reject months before its effective date. A changed or missing mapping blocks assessment. A project administrator can record referenced case-specific confirmation that the frozen policy still applies to an exact conflicting version pair, without rewriting the case. Case detail and the copyable draft now include each source issue's Jira summary, its creation time labeled as non-qualifying, observations, minute assertions, experience, policy version and effective date, calculation denominator, and deadline provenance.

`npm run check` passes nine test files, including actual resolver-handler tests with mocked Jira and KVS for authorization, cross-month retries, evidence reclassification, claim transitions/conflict reconciliation, policy reconciliation, and deadline scanning. An unresolved minute assertion now blocks submission readiness and a no-threshold conclusion even when the month evidence set was marked complete. Forge lint passed. Version 3.19.0 was deployed and the existing Jira development installation reported up-to-date. None of the new behavior has been independently smoke-tested in the installed Jira UI. A non-admin/no-browse live test, a true scheduled-run alert, and a final-build fresh-site rehearsal remain open release gates. The judge guide has been updated for the stricter simulated contract checks.
