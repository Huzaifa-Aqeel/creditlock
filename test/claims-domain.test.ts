import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimDraft, claimSnapshot, deadlineDateUtc, deadlineMilestone, submissionReadiness, validDemoReference, validateClaimAction, type ClaimEvent } from '../src/backend/claims-domain';
import { evaluate } from '../src/backend/rules/evaluate';
import { POLICY } from '../src/backend/discovery-domain';
import type { CompletenessReview, ContractChecks } from '../src/backend/evidence-domain';

const assessment = evaluate({
  period: '2026-10', policyVersionId: POLICY.id, product: 'Jira Service Management', plan: 'Premium',
  coveredExperience: 'browser', environment: 'PRODUCTION', evidenceSetComplete: true,
  evidence: [{ id: 'e', trust: 'REVIEWED_CUSTOMER_EVIDENCE', coveredExperience: 'browser', confirmedPolicyRule: true,
    qualifyingRanges: [{ start: '2026-10-05T12:00:00.000Z', end: '2026-10-05T13:00:00.000Z' }], reviewerAccountId: 'r', reviewedAt: '2026-11-01T00:00:00.000Z' }],
  nowUtc: '2026-11-06T00:00:00.000Z',
});
const event = (id: string, previousId: string | null, kind: ClaimEvent['kind'], state?: ClaimEvent['state']): ClaimEvent => ({
  id, previousId, kind, state, projectId: 'p', caseId: 'c', reason: 'Demo review action', actorAccountId: 'r', recordedAt: `2026-11-06T00:00:0${id}.000Z`,
});

test('deadline is the 15th of the next UTC month and milestones are stable', () => {
  assert.equal(deadlineDateUtc('2026-11'), '2026-12-15');
  assert.equal(deadlineDateUtc('2024-02'), '2024-03-15');
  assert.equal(deadlineMilestone('2026-12-15', '2026-12-08'), 'SEVEN_DAYS');
  assert.equal(deadlineMilestone('2026-12-15', '2026-12-16'), 'OVERDUE');
});

test('claim transitions require reviewable assessment and external references', () => {
  const eligible = { ready: true, gaps: [] };
  const open = claimSnapshot([]);
  const review = event('1', null, 'STATE', 'UNDER_REVIEW');
  validateClaimAction(open, review, eligible);
  const current = claimSnapshot([review]);
  const owner = { ...event('2', '1', 'OWNER'), ownerAccountId: 'reviewer' };
  const support = { ...event('3', '2', 'SUPPORT_REF'), externalReference: 'CCDEMO-1' };
  const ready = event('4', '3', 'STATE', 'DRAFT_READY');
  assert.throws(() => validateClaimAction(current, { ...ready, previousId: '1' }, eligible));
  validateClaimAction(current, owner, eligible);
  validateClaimAction(claimSnapshot([review, owner]), support, eligible);
  validateClaimAction(claimSnapshot([review, owner, support]), ready, eligible);
  const submitted = event('5', '4', 'STATE', 'SUBMITTED');
  assert.throws(() => validateClaimAction(claimSnapshot([review, owner, support, ready]), submitted, eligible));
  submitted.externalReference = 'CCDEMO-1';
  validateClaimAction(claimSnapshot([review, owner, support, ready]), submitted, eligible);
  assert.throws(() => validateClaimAction(open, ready, eligible));
  assert.throws(() => validateClaimAction(claimSnapshot([review, owner, support]), ready, { ready: false, gaps: ['Contract check unknown.'] }));
  assert.throws(() => validateClaimAction(claimSnapshot([review, owner, support, ready]), submitted, { ready: false, gaps: ['Evidence changed.'] }));
});

test('submission readiness requires a complete review and every referenced contract check', () => {
  const owner = { ...event('1', null, 'OWNER'), ownerAccountId: 'reviewer' };
  const support = { ...event('2', '1', 'SUPPORT_REF'), externalReference: 'CCDEMO-1' };
  const claim = claimSnapshot([owner, support]);
  const confirmed = { status: 'CONFIRMED' as const, reference: 'CCDEMO-1' };
  const conditions: ContractChecks = { coverage: confirmed, support: confirmed, billing: confirmed, exclusions: confirmed, claimWindow: { ...confirmed, dateUtc: '2026-11-15' } };
  const review: CompletenessReview = { id: 'r', projectId: 'p', caseId: 'c', complete: true, environment: 'PRODUCTION',
    conditions, reason: 'Reviewed contract', reviewerAccountId: 'reviewer', reviewedAt: '2026-11-06T00:00:00.000Z' };
  assert.equal(submissionReadiness(assessment, [review], claim).ready, true);
  assert.equal(submissionReadiness(assessment, [{ ...review, conditions: { ...conditions, billing: { status: 'UNKNOWN' } } }], claim).ready, false);
  assert.equal(submissionReadiness({ ...assessment, evidenceSetComplete: false }, [review], claim).ready, false);
  assert.equal(submissionReadiness({ ...assessment, unresolvedEvidenceCount: 1 }, [review], claim).ready, false);
  assert.equal(submissionReadiness(assessment, [review], claimSnapshot([owner])).ready, false);
});

test('concurrent same-parent events yield one active chain and a conflict', () => {
  const first = event('1', null, 'STATE', 'UNDER_REVIEW');
  const competing = event('2', null, 'STATE', 'CLOSED');
  const snapshot = claimSnapshot([competing, first]);
  assert.equal(snapshot.state, 'UNDER_REVIEW');
  assert.equal(snapshot.history.length, 1);
  assert.equal(snapshot.conflicts.length, 1);
  const resolution = { ...event('3', '1', 'CONFLICT_RESOLUTION'), resolvedEventIds: ['2'] };
  validateClaimAction(snapshot, resolution, { ready: false, gaps: ['Contract unknown.'] });
  const reconciled = claimSnapshot([competing, first, resolution]);
  assert.equal(reconciled.conflicts.length, 0);
  assert.equal(reconciled.resolvedConflicts[0].id, '2');
  assert.equal(reconciled.state, 'UNDER_REVIEW');
  assert.throws(() => validateClaimAction(snapshot, { ...resolution, resolvedEventIds: ['missing'] }, { ready: false, gaps: [] }));
});

test('copyable draft is explicitly preliminary and never says submission occurred', () => {
  const draft = claimDraft({ caseId: 'c', period: '2026-10', accountOrSiteId: 'demo-site', sourceKeys: ['CCDEMO-1'],
    assessment, policyUrl: POLICY.sourceUrl, simulated: true });
  assert.match(draft, /DEMO \/ SIMULATED/);
  assert.match(draft, /CCDEMO-1/);
  assert.match(draft, /2026-11-15/);
  assert.match(draft, /No vendor submission has been made/);
});

test('fictional references must be visibly marked as demo data', () => {
  assert.equal(validDemoReference('DEMO:SUPPORT-1'), true);
  assert.equal(validDemoReference('SUPPORT-1'), false);
  assert.equal(validDemoReference('DEMO:https://example.com'), false);
});
