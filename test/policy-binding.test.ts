import test from 'node:test';
import assert from 'node:assert/strict';
import { policyBinding } from '../src/backend/assessment-service';
import { POLICY, type Coverage, type MonthCase } from '../src/backend/discovery-domain';

const coverage: Coverage = {
  id: 'coverage', projectId: '100', componentId: '200', componentName: 'Jira', issueTypeId: '300', issueTypeName: 'Incident',
  vendor: 'Atlassian', product: 'Jira Service Management', plan: 'Premium', accountOrSiteId: 'demo', coveredExperience: 'browser',
  policyVersionId: POLICY.id, simulated: true, configuredBy: 'actor', configuredAt: '2026-11-01T00:00:00.000Z',
};
const monthCase: MonthCase = {
  id: 'case', projectId: '100', coverageId: coverage.id, period: '2026-10', policy: POLICY,
  assessmentState: 'NEEDS_EVIDENCE', claimState: 'OPEN', createdAt: '2026-11-01T00:00:00.000Z', simulated: true,
};

test('frozen policy is used only when its snapshot matches the implemented immutable version', () => {
  assert.equal(policyBinding(monthCase, coverage, undefined).policyVersionId, POLICY.id);
  assert.equal(policyBinding({ ...monthCase, policy: { ...POLICY, sourceUrl: 'https://example.com' } }, coverage, undefined).policyVersionId, 'UNSUPPORTED_FROZEN_POLICY');
  assert.equal(policyBinding({ ...monthCase, period: '2026-04' }, coverage, undefined).policyVersionId, 'UNSUPPORTED_FROZEN_POLICY');
  assert.equal(policyBinding(monthCase, undefined, undefined).currentPolicyVersionId, 'MAPPING_MISSING_OR_CHANGED');
});

test('a reconciliation applies only to the exact frozen and current version pair', () => {
  const changed = { ...coverage, policyVersionId: 'FUTURE_VERSION' as typeof POLICY.id };
  const resolution = { id: 'r', projectId: '100', caseId: 'case', frozenPolicyVersionId: POLICY.id,
    conflictingPolicyVersionId: 'FUTURE_VERSION', reference: 'CCDEMO-1', reason: 'Reviewed contract',
    actorAccountId: 'actor', recordedAt: '2026-11-06T00:00:00.000Z' };
  assert.equal(policyBinding(monthCase, changed, undefined).policyConflict, 'FUTURE_VERSION');
  assert.equal(policyBinding(monthCase, changed, resolution).policyReconciled, true);
  assert.equal(policyBinding(monthCase, changed, { ...resolution, conflictingPolicyVersionId: 'OTHER' }).policyReconciled, false);
  assert.equal(policyBinding(monthCase, undefined, resolution).policyReconciled, false);
});
