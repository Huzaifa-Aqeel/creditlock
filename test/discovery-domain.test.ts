import assert from 'node:assert/strict';
import test from 'node:test';
import { caseId, coverageId, matches, monthsTouched, stableInputId, validReference, validateObservationRange, type Coverage, type IssueSnapshot } from '../src/backend/discovery-domain.ts';

const coverage: Coverage = {
  id: 'coverage-1', projectId: '10001', componentId: '20001', componentName: 'JSM', issueTypeId: '30001', issueTypeName: 'Incident',
  vendor: 'Atlassian', product: 'Jira Service Management', plan: 'Premium', accountOrSiteId: 'example-site', coveredExperience: 'browser',
  policyVersionId: 'ATLASSIAN_CLOUD_PREMIUM_2026_04_30', simulated: true, configuredBy: 'actor', configuredAt: '2026-11-05T00:00:00.000Z',
};
const issue: IssueSnapshot = { id: '40001', key: 'CCDEMO-1', projectId: '10001', projectKey: 'CCDEMO', issueTypeId: '30001', componentIds: ['20001'] };

test('matching requires the exact project, issue type and component IDs', () => {
  assert.equal(matches(coverage, issue), true);
  assert.equal(matches(coverage, { ...issue, projectId: '99999' }), false);
  assert.equal(matches(coverage, { ...issue, issueTypeId: '99999' }), false);
  assert.equal(matches(coverage, { ...issue, componentIds: [] }), false);
});

test('product-month identity is stable and independent of incident ID', () => {
  const profile = coverageId('10001', 'example-site');
  assert.equal(profile, coverageId('10001', 'EXAMPLE-SITE'));
  assert.equal(caseId('10001', profile, '2026-11'), caseId('10001', profile, '2026-11'));
  assert.notEqual(caseId('10001', profile, '2026-11'), caseId('10001', profile, '2026-12'));
  assert.notEqual(caseId('10001', profile, '2026-11'), caseId('10002', profile, '2026-11'));
});

test('dated observation identifies UTC months using an exclusive end', () => {
  assert.deepEqual(monthsTouched('2026-11-30T23:40:00.000Z', '2026-12-01T00:00:00.000Z'), ['2026-11']);
  assert.deepEqual(monthsTouched('2026-11-30T23:40:00.000Z', '2026-12-01T00:40:00.000Z'), ['2026-11', '2026-12']);
});

test('equivalent evidence submissions keep one ID across retries and reloads', () => {
  const fields = ['10001', '40001', 'coverage-1', '2026-11-05T12:00:00.000Z', '2026-11-05T13:00:00.000Z', 'CCDEMO-1'];
  assert.equal(stableInputId('observation', fields), stableInputId('observation', [...fields]));
  assert.notEqual(stableInputId('observation', fields), stableInputId('minute-evidence', fields));
  assert.notEqual(stableInputId('observation', fields), stableInputId('observation', [...fields.slice(0, -1), 'CCDEMO-2']));
});

test('invalid, missing and future observations are rejected', () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z');
  assert.throws(() => validateObservationRange('', '2026-11-05T11:00:00.000Z', now));
  assert.throws(() => validateObservationRange('2026-11-05T11:00:00.000Z', '2026-11-05T11:00:00.000Z', now));
  assert.throws(() => validateObservationRange('2026-11-05T11:00:00.000Z', '2026-11-06T11:00:00.000Z', now));
  assert.throws(() => validateObservationRange('2026-02-30T11:00:00.000Z', '2026-03-01T11:00:00.000Z', now));
});

test('references require HTTPS without embedded credentials or a Jira key', () => {
  assert.equal(validReference('CCDEMO-1'), true);
  assert.equal(validReference('https://example.com/evidence'), true);
  assert.equal(validReference('http://example.com/evidence'), false);
  assert.equal(validReference('https://user:secret@example.com/evidence'), false);
});
