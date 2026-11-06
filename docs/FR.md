# CreditClock — Functional Requirements

**Document:** FR.md  
**Version:** 1.0 • 5 November 2026  
**Status:** Build baseline (product decisions, not a legal interpretation)  
**Target:** Codegeist 2026 — Apps for Business Teams  
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) · [AGENTS.md](AGENTS.md)

## 1. Product definition

**One sentence:** CreditClock connects Jira Service Management incidents to vendor SLA obligations, assembling evidence and tracking potential service-credit claims before their deadlines.

**The job:** An IT team resolves an outage in Jira; procurement or finance may never learn that the contract offers a time-limited service credit. CreditClock makes that *possible financial follow-up* visible, assigns it to a human, and preserves the evidence trail.

**Important boundary:** CreditClock is a **claim-readiness assistant**, not an outage detector, an authoritative vendor monitoring system, an automated legal interpreter, or a guaranteed credit-recovery service. A closed Jira ticket is not evidence of a contractual breach. All calculations are preliminary and subject to the vendor's terms and determination.

### 1.1 Product promise

> Every relevant vendor incident leads to one of three understandable outcomes: an evidence gap, a documented preliminary claim assessment, or a documented reason to stop pursuing it — with an accountable human and an accurate deadline when one exists.

### 1.2 Core differentiation

- **Operational-to-financial handoff:** starts from *existing* JSM incident records rather than requiring a separate finance ticket to find the issue.
- **Evidence-first:** shows exactly what is known, disputed, missing, and merely inferred.
- **Contract-specific:** calculates only for a policy profile that has an implemented, verified rule adapter.
- **Time-limited action:** turns a potentially forgotten submission window into an assigned, trackable task.

## 2. Users and permissions

| Role | Primary task | MVP authority |
|---|---|---|
| IT incident owner | Connect incident to affected service; supply customer observations | View applicable assessment; add evidence for incidents they can access |
| Claim reviewer (procurement/finance) | Examine evidence, prepare claim, record submission/outcome | View permitted cases; update review/claim state; mark submission manually |
| Project administrator | Configure service mapping, policy profile, reviewers | Manage configuration for a permitted Jira project |
| Rovo assistant | Explain existing assessments and draft text | Read-only by default; no financial approval or submission authority |

**MVP licensing assumption:** Users accessing Forge pages are authenticated, appropriately licensed Jira/JSM users with permission to see the relevant Jira project/issues. Customer portal-only and anonymous access are not supported. Do not imply all finance users can access JSM; route work through licensed Jira users or a suitable licensed Jira project. Access control must be checked by the backend, not only hidden buttons. A case aggregating several restricted issues must not disclose any issue details the viewer cannot browse; the MVP may deny full-case access unless the viewer can browse every linked source issue.

## 3. Scope and non-goals

### 3.1 Required MVP (P0)

1. Installable Forge app running inside a Jira Service Management project.
2. Project-scoped CreditClock dashboard and incident context panel.
3. Admin-configurable service-to-policy mapping for **one covered service per source incident**.
4. One **implemented policy calculator**: Atlassian Cloud Premium, using the April 30, 2026 SLA as the documented *reference* and a clearly identified example of an eligible product/covered experience. A real customer's applicable contract and eligibility must still be verified.
5. Manual evidence entry: impacted experience, time range, evidence source/reference, provenance, verification state, and vendor support ticket reference (if required).
6. Event-driven *lead discovery* on Jira issue created/updated, plus a **manual recheck** on the incident panel; create a dated month case when evidence establishes an impacted month.
7. One case per **affected product + account/site + UTC calendar month**, aggregating evidence from multiple incidents without double counting qualifying minutes. Each case retains its frozen policy version; a mid-month policy conflict blocks automatic assessment pending human reconciliation rather than creating another case.
8. Deterministic monthly preliminary uptime / credit-tier calculation only when the required inputs are available; otherwise show an explicit evidence/policy gap.
9. Claim case detail: sources, policy reference, calculation breakdown, missing evidence, deadline, owner, activity history.
10. Human-controlled actions: mark reviewed, prepare a copyable draft, record submitted / rejected / credited / closed.
11. Daily deadline scan with an idempotent in-app alert and optional assigned Jira follow-up task (never spam issues).
12. Judge-ready synthetic demo data clearly labeled **DEMO / SIMULATED**; no reliance on a real vendor outage or a paid production Atlassian SLA.

### 3.2 Included if P0 is healthy (P1)

- A bounded `rovo:agent` explaining assessments and preparing a claim draft through **read-only** and **draft-only** Forge actions. It is not a prerequisite for a functional claim flow.
- Optional partial-claim estimate using an explicitly supplied eligible monthly fee. Label **illustrative, not guaranteed**; never infer invoice values.
- One-click creation of a linked Jira review task (with role/permission checks, idempotency, and an assigned owner).
- Manual vendor policy registry for unsupported providers in **tracking-only** mode (no calculator and no eligibility label).

### 3.3 Explicitly out of scope

- Auto-submitting claims to vendors, sending external emails, or impersonating billing admins.
- Reading arbitrary PDFs/contracts and automatically converting them into executable financial rules.
- Automatic intake of provider telemetry, status-page incidents, emails, billing exports, or monitoring APIs.
- AI-based probability of winning a claim or AI-made eligibility decisions.
- Generic SLA calculator for all SaaS/cloud vendors; generic legal advice.
- Confluence cross-product read integration, Teamwork Graph, MCP exposure, Marketplace payment flows, and public customer portals.
- Storing raw evidence attachments, complete logs, card/payment details, or broad confidential contract text.
- Replacing Atlassian's existing support/compensation workflow.

**Scope gate:** No P1 item may delay completion of the P0 demo scenario and acceptance tests.

## 4. Concepts and authoritative sources

**Source incident** — Jira/JSM issue that describes an operational problem. It is *not* a provider-confirmed downtime record.

**Covered service** — configured provider + product + plan + site/account + experience. These dimensions distinguish eligible and ineligible experiences.

**Policy version** — frozen, cited contractual rules applicable to a specific service, plan, and effective period. A new version creates a new immutable record; prior cases retain the version they used.

**Evidence item** — a time-bounded assertion or referenced document, with source, author, classification, confidence/provenance, and human verification. The referenced data itself can remain in Jira/external source; only metadata and links are stored in CreditClock.

**Qualifying downtime minute** — a minute meeting the *contract's* definition, not a minute during which a ticket was open. The Atlassian SLA defines a qualifying minute as >5% errors among the customer's requests to covered experiences, with provider monitoring as the sole source of truth. Customer observations can support a **provisional** claim, never a final vendor-confirmed conclusion.

**Claim case** — one vendor-product/account/calendar-month assessment aggregating linked incident evidence and claim-state changes. One incident may span multiple months, and must then contribute correctly to each month.

**Claim decision** — what a human recorded after review/submission; never synthesized by the app.

### 4.1 MVP policy profile: Atlassian Cloud Premium (2026)

Use the **legally published policy effective April 30, 2026** as a *readable, versioned template*. Demonstration cases may use a fictional account; they must be labeled simulated. Before supporting a real claim, a human must verify that the customer's product, plan, covered experience, production status, support-reporting requirement, exclusions, and contractual version match.

Atlassian's published Premium threshold is **99.9% monthly uptime**; below that, published service-credit tiers are **10%** at `[99.0%, 99.9%)`, **25%** at `[95.0%, 99.0%)`, and **50%** below `95.0%`. The month is **UTC**; calculations use qualifying *minutes*. Billing and other eligibility conditions still apply. Their guidance calls for reporting the outage and submitting a separate compensation request by the 15th of the next month (legal SLA: within 15 days after month end); treat the date as a deadline for human review and conservatively avoid claiming a precise submission cutoff time unless confirmed.

**Crucial:** The source support page and legal agreement have separate details. If they conflict or are updated, surface the source/version discrepancy and require human confirmation; do not silently select a favorable interpretation.

Primary sources: https://www.atlassian.com/legal/sla and https://support.atlassian.com/subscriptions-and-billing/docs/service-level-agreement-for-atlassian-cloud-products/

## 5. End-to-end user journeys

### Journey A — Potential claim found

1. Admin opens CreditClock within a JSM project; registers a **covered service** and selects its supported policy version.
2. IT files or updates a configured Incident issue and identifies the affected service.
3. Forge issue event matches the configured service and displays a lead; once dated evidence is supplied, the app creates or links the correct product-month case.
4. Issue panel shows **Potential contractual follow-up** rather than **SLA breached**.
5. Incident owner supplies observed timestamps and evidence references. The app asks for qualifying-minute evidence; it never derives it from issue open-to-close time.
6. Claim reviewer verifies the evidence metadata and relevant conditions; unverified or inapplicable input remains explicitly unknown.
7. If qualifying minutes are available, a deterministic calculation reports monthly uptime, matching *potential* credit tier, assumptions, policy version, and missing conditions.
8. Reviewer prepares a draft, records any required support-reference, and submits through the provider's official process *outside CreditClock*.
9. Reviewer records submission reference, date, and final vendor response. Case retains its audit trail.

### Journey B — No calculation possible

1. Relevant incident appears, but no trustworthy qualifying-minute evidence exists.
2. Panel reads **Evidence needed**, with actionable missing fields and the relevant policy link.
3. App does not show a credit percentage, monetary value, or fabricated probability.
4. Reviewer can record **Not pursuing — insufficient evidence** with a reason; the case remains traceable.

### Journey C — Multiple incidents in one month

1. Two incidents reference the same covered product/site in November UTC.
2. Both appear in one November case. If qualifying-minute ranges overlap, the calculation counts the union, not the sum.
3. If one incident spans November/December, minutes split into the respective month cases.
4. The case produces one monthly draft for that product. No per-incident double claims.

### Journey D — Deadline approaching

1. An open case has a confirmed policy deadline and an owner.
2. The daily scheduled scan marks the case as approaching/overdue for configured lead times.
3. The dashboard surfaces this once for each lead-time milestone. Optionally create a linked review task once.
4. Submitted/closed cases stop producing reminders. Re-running the job does not produce duplicates.

## 6. Functional requirements and acceptance criteria

P0 is mandatory. IDs are stable references for code and tests.

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| FR-01 | P0 | Native entry point | Install in a fresh eligible Jira Cloud test site; see CreditClock as a JSM project page, no external host. |
| FR-02 | P0 | Project configuration | Authorized admin selects source incident issue types and maps Jira Components to covered services; edits persist and are project-scoped. |
| FR-03 | P0 | Versioned policy | Admin can activate the reference policy for an eligible service; all assessments retain policy ID, version, source URL, effective date. |
| FR-04 | P0 | Event discovery | Creating/updating a matching incident results in a lead; dated evidence results in the correct monthly case. Irrelevant project, issue type, or service does nothing. |
| FR-05 | P0 | Manual re-evaluate | Reviewer can request recheck from issue context; repeated rechecks do not create duplicate cases. |
| FR-06 | P0 | Provenance of evidence | Every stored minute-range assertion has source type, URL/reference, submitted by, observed status, and verification timestamp/actor when verified. |
| FR-07 | P0 | Evidence gaps | Missing contract coverage, evidence, support report, or account status is shown explicitly; the app never assumes a missing value is false or true. |
| FR-08 | P0 | Month aggregation | Same vendor/product/account/month contributes to exactly one case regardless of policy-version changes; the case retains its frozen policy version and a conflicting version blocks automatic assessment pending human reconciliation. Overlapping ranges count once; cross-month ranges split; period uses UTC. |
| FR-09 | P0 | Deterministic evaluation | Given same inputs + policy version, results are identical. Tier boundaries match published table; no model used in arithmetic. |
| FR-10 | P0 | Responsible wording | All predicted outcomes are labeled preliminary; never display “approved,” “owed,” or “guaranteed” absent a recorded vendor decision. |
| FR-11 | P0 | Case details | User can see source incidents, time intervals, effective policy, missing inputs, calculations, owner, deadline, and activity history. |
| FR-12 | P0 | Claim stages | Reviewer can record review, draft ready, submitted (with external reference), credited, rejected, or closed with actor/time/reason. |
| FR-13 | P0 | Human submission | Copyable draft contains only confirmed facts and marked assumptions; no submit-to-vendor action exists. |
| FR-14 | P0 | Deadline awareness | Confirmed claim window derived from frozen policy and period; scheduled scan reports approaching/overdue, never duplicate alerts. |
| FR-15 | P0 | Access protection | Unauthorized actor cannot read privileged case data, modify policies/evidence, or change claim state through backend calls. |
| FR-16 | P0 | Stable demo | On a judge's fresh site, supplied setup instructions and explicitly simulated fixtures reproduce the demo without production vendor access. |
| FR-17 | P0 | Auditability | Policy edits, evidence verification, assessment changes, ownership, submissions and outcomes are attributable and timestamped. |
| FR-18 | P1 | Rovo | Agent can explain a case via read action and produce a *draft* via dedicated action; cannot change eligibility or submit claim. |
| FR-19 | P1 | Credit estimate | An illustrative amount appears only with a user-supplied fee known to be attributable to the covered product; precision/currency/assumptions disclosed. |
| FR-20 | P1 | Jira review task | Authorized user can create one linked Jira task per case and see its key; retry does not create extra tasks. |
| FR-21 | P1 | Unsupported vendor registry | Unimplemented policy shows tracking-only state and due-date metadata; no calculated credit tier. |

### 6.1 Assessment state and claim state are separate

**Assessment state** (system-computed):

- `NEEDS_POLICY` — no currently applicable, implemented policy profile.
- `NEEDS_EVIDENCE` — source/candidate exists but qualifying-minute data or required proof is missing.
- `IN_PROGRESS_MONTH` — qualifying data exists but period has not ended; any numbers are labeled provisional.
- `REVIEWABLE` — period is closed, calculation is available, and human conditions still require review.
- `NO_THRESHOLD_INDICATED` — documented qualifying minutes do not cross the configured threshold; this is **not** proof there was no qualifying outage.
- `ASSESSMENT_BLOCKED` — explicit ineligibility/exclusion, contradictory or invalid evidence, stale policy, or authorization-related data gaps. Reason mandatory.

**Claim state** (human-managed):

`OPEN → UNDER_REVIEW → DRAFT_READY → SUBMITTED → {CREDITED | REJECTED | CLOSED}`.

Allow `CLOSED` from any pre-submission state only with a reason, and allow an authorized reviewer to reopen with an audited reason. App-computed assessment changes **must never silently transition** a human claim state.

`NO_THRESHOLD_INDICATED` may be calculated only when the evidence reviewer explicitly marks the month’s qualifying-minute evidence set complete; otherwise show `NEEDS_EVIDENCE`.

## 7. Data capture and UX contract

### Main CreditClock page (four tabs maximum)

1. **Claims:** table sorted by deadline with vendor, product, month, case assessment, claim stage, evidence gap, owner, next action.
2. **Case detail:** policy/source summary, incident timeline, qualifying-minute ranges, math, exclusions checklist, audit history, draft/status actions.
3. **Policies:** covered-service mapping and policy reference/profile; visible only to authorized admins.
4. **Help / Demo:** small onboarding checklist, explain what is simulated; no separate generic analytics suite.

### Issue context panel

- Headline: `CreditClock: [Potential follow-up | Evidence needed | Case ready for review | No covered service]`.
- Links to case and selected policy; supports `Check again` and `Add evidence` for authorized users.
- Never suggests that Jira incident status alone implies contract breach.

### Evidence form (minimum)

- Incident link (automatically bound, read-only).
- Covered experience from policy allowlist; **browser vs API** distinction preserved.
- Customer-observed impacted start/end (UTC), optional.
- **Qualifying minute ranges** `[start, end)` in UTC, if explicitly documented; do not auto-map observed time intervals into them.
- Evidence URL or Jira reference; evidence source type (`customer_logs`, `vendor_support`, `provider_confirmation`, `other`).
- Verification status (`unverified`, `reviewed_customer_evidence`, `vendor_confirmed`) and review actor/time. `vendor_confirmed` requires an actual vendor reference.
- Mandatory checklist: production vs trial/sandbox; applicable plan/coverage; exclusions assessed; support issue reported; billing entitlement known/unknown.
- Note / reviewer rationale. Never store credentials or full raw logs.

### Draft claim content

Case ID, vendor/product/site, UTC month, incident keys, factual symptoms, covered experience, observed evidence, separately labeled potential qualifying minutes, policy citation, supporting references, support-request ID, claim deadline, **preliminary** calculation, missing/unverified facts, responsible reviewer. No fabricated vendor confirmation and no promised amount.

## 8. Business rules and non-negotiable invariants

1. A Jira resolution timestamp **must not be used** as a qualifying downtime timestamp.
2. No calculator for unsupported/unverified contract profiles; tracking-only is legitimate.
3. Claims aggregate by covered **product + account/site + UTC month**; each case holds the selected frozen policy version (a mid-month policy change must be flagged for human reconciliation, not silently create a second claim); avoid confusing this with per-Jira-ticket payouts.
4. Intervals use `[start, end)` and UTC; validation rejects `end <= start` and unreasonable future ranges. Split across months before union. Minute rounding/eligibility follows the profile rule, not a global assumption.
5. Contract tier boundaries are exact: `99.9%` is **not** below `99.9%`.
6. Claims are *prospective* until vendor decision; `vendor_confirmed` evidence still does not imply credit was awarded.
7. Trial, sandbox, plan exclusions, lack of required vendor support notification, and contract disputes require explicit human review; never silently default to eligible.
8. If policy/legal/source terms change, preserve prior case snapshots and flag a re-review; never retroactively mutate audited decisions.
9. Source references must be linkable, with attribution and timestamp. Broken/unavailable references stay labeled unresolved.
10. Duplicate events, repeated manual requests, and duplicate schedules do not duplicate cases, ranges, tasks, or alerts.
11. Multiple incidents for the same affected product/month appear in a single draft. Different products get separate cases.
12. No external submission without new, separately specified authorization and security requirements (out of scope for MVP).

## 9. Examples of calculation behavior (synthetic)

For a 30-day UTC month: `totalMinutes = 43,200`.

| Test | Qualifying minute evidence | Expected preliminary outcome |
|---|---|---|
| A | 60 unique minutes, complete and reviewed | Uptime ≈ 99.861111%; Premium *potential* 10% credit tier, subject to conditions |
| B | 43 unique minutes, complete and reviewed | Uptime ≈ 99.900463%; no threshold indicated |
| C | 44 unique minutes, complete and reviewed | Uptime ≈ 99.898148%; below 99.9% threshold |
| D | Two overlapping ranges of 30 and 45 min, 15 min overlap | Count 60 unique minutes, not 75 |
| E | Observed outage 90 min, no qualifying-minute evidence | `NEEDS_EVIDENCE`; no percentage or tier |
| F | Evidence 20 min Nov 30 + 40 min Dec 1 | Split across month cases; separate denominators |
| G | API-only errors for a browser-only covered experience | Not countable under that covered-experience rule; explanatory block |
| H | Site is trial/sandbox | Flag explicit contract ineligibility; no ready-to-submit suggestion |
| I | Duplicate issue event / scheduled job | Same case ID and one notification per milestone |

*All values above are simulated to test calculations; they do not prove real vendor outages.*

## 10. Non-functional requirements

- **Correctness:** For the supported policy and validated fixtures, 100% of published threshold-boundary / interval tests must pass before demo.
- **Traceability:** Every figure shows source evidence, period, policy version and calculation inputs; changes produce an activity entry.
- **Authorization:** Least-privilege Forge scopes. Verify Jira permissions and CreditClock role on every relevant resolver/action.
- **Tenant safety:** App data isolated by Forge installation; business keys scoped to project and product/account where appropriate.
- **Privacy:** Store metadata and links; do not download or persist raw monitoring logs, contracts, or sensitive billing documents for the MVP.
- **Resilience:** Handle missing Jira fields, 403/404, expired links, Forge retries, partial outages, and rate limits without hiding errors or inventing data.
- **Usability:** Clear first-run onboarding, empty/loading/error states, visible provenance, and meaningful actions for each blocked status.
- **Time:** Use UTC for period arithmetic; display local timezone to user with UTC label/tooltips. Date-only claim deadlines do not imply an exact vendor cutoff time.
- **Performance target (engineering goal, not service guarantee):** Typical dashboard initial response under 3 seconds for a seeded project of 20 cases in the development site; keep calculations small and event-driven.
- **Demo honesty:** All fixtures and mocked evidence labeled. Never show a made-up vendor credit as already collected.

## 11. Product acceptance / definition of done

The MVP is complete only when a judge can install it on a fresh permitted Jira site, follow a concise setup guide, and demonstrate **without developer intervention**:

1. See a clearly simulated JSM incident matched to a registered covered service.
2. See that a ticket alone creates **a lead, not an automatic award**.
3. Add or inspect sourced, human-reviewed minute evidence and a support-reference.
4. Obtain a deterministic, checkable monthly calculation with an explanation and the correct tier for the supported profile.
5. See the single product-month case with its source issue(s), missing conditions and deadline.
6. Prepare a traceable draft and manually record an external submission.
7. Refresh/replay an event without creating duplicate case or alert.
8. Show that removing critical evidence returns the case to `NEEDS_EVIDENCE`, while prior submissions remain audited.

**Submission gate:** Produce a public YouTube demo video under 5 minutes (judges need not watch past 3), a working Forge installation link, and exact test-site setup instructions. See official rules: https://codegeist2026.devpost.com/rules

## 12. Decisions and assumptions to validate during implementation

| Issue | Baseline decision | Must verify |
|---|---|---|
| Demo contract | Atlassian Cloud Premium reference dated April 30, 2026 | Applicable product/covered experience and current legal term before real claims |
| Evidence | User-supplied qualifying-minute ranges; references and confidence | Whether real users can obtain sufficiently granular inputs; otherwise preserve as `NEEDS_EVIDENCE` |
| Source incident | Configured JSM incident issue type/field | Exact issue type and asset/service field in the installed Jira demo site |
| Finance access | Authenticated, licensed Jira project users | Role/permission strategy for actual IT+finance tenants |
| Rovo | P1 explanation/draft; no autonomous state changes | Rovo availability and required action module setup in judge's site |
| Unsupported contracts | Tracking-only | Any future policy-specific implementations require separate documented rules/tests |
| Claim deadline | Calendar-date value, conservative warning | Vendor's timezone/cutoff, holidays, contract update rules |

## 13. Reference documentation

- Codegeist resources: https://codegeist2026.devpost.com/resources
- Codegeist official rules: https://codegeist2026.devpost.com/rules
- Atlassian SLA effective Apr 30, 2026: https://www.atlassian.com/legal/sla
- Atlassian compensation process: https://support.atlassian.com/subscriptions-and-billing/docs/service-level-agreement-for-atlassian-cloud-products/
- Forge Jira events: https://developer.atlassian.com/platform/forge/events-reference/jira/
- Forge project page: https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-project-page/
- Forge issue context: https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-issue-context/
