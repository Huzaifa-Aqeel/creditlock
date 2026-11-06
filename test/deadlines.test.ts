import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmedDeadline, scanDeadlines, type DeadlineRepo } from '../src/backend/deadlines';
import type { CompletenessReview } from '../src/backend/evidence-domain';
import { POLICY, type MonthCase } from '../src/backend/discovery-domain';
import type { ClaimEvent } from '../src/backend/claims-domain';
import type { DeadlineFlag } from '../src/backend/storage';

const monthCase: MonthCase = {
  id: 'c', projectId: 'p', coverageId: 'v', period: '2026-10', policy: POLICY,
  assessmentState: 'NEEDS_EVIDENCE', claimState: 'OPEN', createdAt: '2026-11-01T00:00:00.000Z', simulated: true,
};
const owner: ClaimEvent = {
  id: 'e', projectId: 'p', caseId: 'c', previousId: null, kind: 'OWNER', ownerAccountId: 'reviewer',
  reason: 'Assigned review owner', actorAccountId: 'reviewer', recordedAt: '2026-11-01T00:00:00.000Z',
};

test('daily deadline replay writes one stable milestone flag', async () => {
  const flags = new Map<string, DeadlineFlag>();
  let due = '2026-11-15';
  const repo: DeadlineRepo = {
    cases: async () => [monthCase],
    events: async () => [owner],
    deadline: async () => ({ dateUtc: due, reference: 'DEMO:WINDOW-1', reviewerAccountId: 'reviewer', reviewedAt: '2026-11-01T00:00:00.000Z', policyVersionId: POLICY.id }),
    getFlag: async (_projectId, _caseId, deadlineDateUtc, milestone) => flags.get(`${deadlineDateUtc}:${milestone}`),
    saveFlag: async flag => { flags.set(`${flag.deadlineDateUtc}:${flag.milestone}`, flag); },
  };
  assert.equal(await scanDeadlines('2026-11-08', repo), 1);
  assert.equal(await scanDeadlines('2026-11-08', repo), 0);
  assert.equal(flags.size, 1);
  assert.equal(flags.get('2026-11-15:SEVEN_DAYS')?.deadlineDateUtc, '2026-11-15');
  assert.equal(await scanDeadlines('2026-11-12', repo), 1);
  assert.equal(flags.size, 2);
  due = '2026-11-16';
  assert.equal(await scanDeadlines('2026-11-12', repo), 1);
  assert.equal(flags.size, 3);
});

test('submitted cases and unassigned cases receive no flags', async () => {
  const submitted: ClaimEvent = {
    ...owner, id: 's', previousId: 'e', kind: 'STATE', state: 'SUBMITTED', externalReference: 'CCDEMO-1',
    recordedAt: '2026-11-02T00:00:00.000Z',
  };
  const repo: DeadlineRepo = {
    cases: async () => [monthCase], events: async () => [owner, submitted],
    deadline: async () => ({ dateUtc: '2026-11-15', reference: 'DEMO:WINDOW-1', reviewerAccountId: 'reviewer', reviewedAt: '2026-11-01T00:00:00.000Z', policyVersionId: POLICY.id }),
    getFlag: async () => undefined, saveFlag: async () => { throw new Error('unexpected flag'); },
  };
  assert.equal(await scanDeadlines('2026-11-14', repo), 0);
});

test('deadline scan refuses an unconfirmed contract window', async () => {
  const base: CompletenessReview = {
    id: 'r', projectId: 'p', caseId: 'c', complete: true, environment: 'PRODUCTION',
    reason: 'Reviewed', reviewerAccountId: 'reviewer', reviewedAt: '2026-11-01T00:00:00.000Z',
  };
  assert.equal(confirmedDeadline(monthCase, [base]), null);
  const conditions = {
    coverage: { status: 'CONFIRMED' as const, reference: 'DEMO:CONTRACT-1' },
    support: { status: 'UNKNOWN' as const }, billing: { status: 'UNKNOWN' as const }, exclusions: { status: 'UNKNOWN' as const },
    claimWindow: { status: 'CONFIRMED' as const, reference: 'DEMO:CLAIM-WINDOW-1', dateUtc: '2026-11-15' },
  };
  assert.equal(confirmedDeadline(monthCase, [{ ...base, policyVersionId: POLICY.id, conditions }])?.dateUtc, '2026-11-15');
  assert.equal(confirmedDeadline(monthCase, [{ ...base, policyVersionId: POLICY.id, conditions: { ...conditions, claimWindow: { status: 'UNKNOWN' } } }]), null);
  assert.equal(confirmedDeadline(monthCase, [{ ...base, policyVersionId: POLICY.id, conditions: { ...conditions, claimWindow: { ...conditions.claimWindow, dateUtc: '2026-10-31' } } }]), null);
  assert.equal(confirmedDeadline(monthCase, [{ ...base, policyVersionId: 'wrong', conditions }]), null);
  const repo: DeadlineRepo = {
    cases: async () => [monthCase], events: async () => [owner], deadline: async () => null,
    getFlag: async () => undefined, saveFlag: async () => { throw new Error('unexpected flag'); },
  };
  assert.equal(await scanDeadlines('2026-11-08', repo), 0);
});
