# CreditClock

CreditClock is a Forge app for Jira Service Management that will connect configured incidents to evidence-backed, preliminary vendor SLA claim cases. See [the functional requirements](docs/FR.md), [architecture](docs/ARCHITECTURE.md), and [build plan](docs/BUILD_PLAN.md).

## Current build

Slices 1 and 2 are installed and smoke tested in CCDEMO. Slice 3 passed live provisional and closed-month calculation checks. Slice 4 passed a live, simulated incident-to-recorded-submission path. The app supports event and manual lead discovery, deterministic product-month cases, attributed evidence review, preliminary Atlassian Premium 2026 calculations, human claim actions, a copyable draft, and date-only deadline flags. Customer observations and unreviewed assertions never count as qualifying downtime. The current correctness phase adds explicit submission readiness, confirmed deadline provenance, atomic paired KVS writes, recoverable claim conflicts, frozen-policy reconciliation, resolver-level tests, and fuller case details. These changes pass local checks but still need installed-site smoke tests. **The full P0 requirements are not yet accepted**: live permission roles and final-build fresh-install checks also remain. See [BUILD_PLAN.md](docs/BUILD_PLAN.md) and [JUDGE_SETUP.md](docs/JUDGE_SETUP.md). Optional P1 requirements remain deferred.

## Local checks

Requires Node.js 22. Run:

```sh
npm install
npm run check
```

This runs TypeScript, focused identity, discovery, and policy-rule tests, and the Custom UI build.

## Register and smoke test on a JSM development site

Forge needs an Atlassian account with a Forge API scoped token and a Jira Service Management development site. The local CLI is pinned to version 14 because the available Node.js 22.22.3 is below CLI 15's minimum Node.js version. On a machine without a working keychain, use `FORGE_EMAIL` and `FORGE_API_TOKEN` environment variables as described in [Atlassian's getting-started guide](https://developer.atlassian.com/platform/forge/getting-started/#using-environment-variables-to-login). Keep the token out of source control and terminal output.

For a fresh account/site, once credentials and a test site are available:

```sh
npx forge register CreditClock
npm run forge:lint
npx forge deploy
npx forge install --product jira --site your-site.atlassian.net
```

`forge register` adds the real app ID to `manifest.yml`; do not substitute a made-up ID. In the test JSM project, open CreditClock from project navigation and the CreditClock panel on an issue. Check that a permitted licensed user sees onboarding, while a user without project or issue browse permission sees no protected issue details. Record the observed installation and permission results in the build plan before marking Slice 1 complete.

The current app has already been registered, deployed to development, and installed in Jira on `https://one-atlas-cxup.atlassian.net`. Do not rerun `forge register`: that would assign a new app ID and disconnect the installed app. Live CCDEMO checks passed for mapping, issue matching, event discovery, the nonmatching state, and case association. A live unauthorized-user check remains a release gate.

Forge can use a writable `XDG_CONFIG_HOME` if its default config directory is read-only in the development environment. Set it to a path you control before running the commands above.
