# CreditClock judge setup and demo

CreditClock is a Forge app for Jira Service Management. The demo uses fictional incidents and minute evidence. It does not submit a claim to Atlassian or assert that any real outage occurred.

## Prerequisites

- A Jira Cloud site with Jira Service Management and a project where you can administer project settings and edit issues.
- A licensed Jira/JSM user for the demo. Portal-only and anonymous users are not supported.
- The Forge app installed in Jira. For a fresh site, use the registered app ID in `manifest.yml`; do not run `forge register` again. Follow [Forge installation documentation](https://developer.atlassian.com/platform/forge/cli-reference/install/) with the site hostname and the development environment, or ask the app owner to install it.
- A Jira Component named `Jira` (create it in project settings if absent) and an incident issue type. The CCDEMO example uses `[System] Incident`.

## Reproduce the simulated case

1. Open **CreditClock** in the JSM project navigation and select **Covered service**. Map the incident issue type and `Jira` Component to a non-secret site ID such as `judge-demo`. Keep **Demo / simulated mapping** checked and acknowledge the cited policy. Save. The page must display the current mapping.
2. Create a new issue of the mapped type with Component `Jira`. Suggested summary: `[DEMO] Simulated Jira browser service incident`. Suggested description: `CreditClock test issue only. No real outage or SLA breach occurred.` Open its CreditClock issue panel. A matching lead appears after the Jira event is delivered (Forge triggers can take [up to three minutes](https://developer.atlassian.com/platform/forge/manifest-reference/modules/trigger/)); **Check again** provides a manual fallback.
3. On that issue panel, click **Create October demo case** in **Demo fixture**. The action is idempotent. It creates a fictional October 5, 2026 12:00–13:00 UTC customer observation and an **unverified** 60-minute assertion. The case should read **NEEDS EVIDENCE**. The issue timestamp is never treated as downtime.
4. In the **2026-10 Case evidence** card, check the simulated >5% browser-error rule box and click **Review customer evidence** beside the October assertion. Its review history should show the actor and timestamp. Set **Site status** to **Simulated production account (demo only)**, check the complete-evidence-set box, leave contract checks **Unknown**, and click **Record attestation**.
5. The closed October case should read **REVIEWABLE · DEMO / SIMULATED** with **60 / 44,640** reviewed candidate minutes, **99.865591%** preliminary uptime, and a **potential 10%** tier. The claim workflow must say submission is **not ready** while contract checks are unknown. Its preliminary draft remains readable. This is not an award or a real eligibility decision. The reference [Atlassian SLA](https://www.atlassian.com/legal/sla) gives the Premium threshold and tier; only Atlassian's monitoring and contractual determination control an actual credit.
6. For this fictional fixture only, set each of the five **Contract checks** to **Confirmed**, using clearly fictional `DEMO:` references such as `DEMO:CONTRACT-1`. For **Applicable claim submission window**, enter the fictional confirmed deadline date **2026-11-15** UTC and its `DEMO:` reference. Click **Record attestation** again. The workflow should display the confirmed date and its reviewer, time, policy version, and reference. These simulated confirmations must never be reused for a real claim.
7. In the **2026-10 Claim workflow** card, assign yourself as owner, start review, and record `DEMO:SUPPORT-1` as the fictional support reference. Once all readiness gaps are resolved, mark the draft ready, read or copy the prominently marked **DEMO / SIMULATED** draft, then record `DEMO:CLAIM-1` as a fictional external submission reference. These are records inside CreditClock; no vendor API call or message is sent. The Activity list should show each human action, actor, and time.
8. Return to the project **Claims** page. Confirm one October case linked to the source issue, its claim stage, owner, confirmed date-only deadline **2026-11-15**, and the next action. Confirm that the case detail links every source issue and separates Jira issue timestamps, customer observations, and reviewed candidate minutes.

## Negative checks

- Open an issue with a different issue type or without the mapped Component. The panel should say **No covered service** and make no claim case.
- Repeat **Check again** on a matching issue and repeat the October fixture action. Neither should create another product-month case.
- Mark the October minute assertion **Unverified** after recording the simulated submission. The assessment should return to **NEEDS EVIDENCE**, while the earlier **SUBMITTED** action and its reference remain in the audit history.
- A user who can browse the issue but lacks project-admin permission should not see administrative review and claim-action buttons. A user without permission to browse every source issue must not receive full case details. These are release checks, not a substitute for the backend authorization tests.

## Local verification

Run `npm run check` and `npm run forge:lint` before deployment. The first command runs strict typechecking, domain and discovery tests, and the Custom UI build. The build plan records observed deployment and smoke outcomes.
