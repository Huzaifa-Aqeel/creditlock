import assert from 'node:assert/strict';
import test from 'node:test';
import { addObservationToIssue, ensureMonthCases, reconcileIssue, type DiscoveryStore } from '../src/backend/discovery-service.ts';
import type { Coverage, IssueSnapshot, Lead, MonthCase, Observation } from '../src/backend/discovery-domain.ts';
import { builtInPolicy } from '../src/backend/policy-registry.ts';

const coverage: Coverage = {
  id: 'coverage-1', projectId: '10001', componentId: '20001', componentName: 'JSM', issueTypeId: '30001', issueTypeName: 'Incident',
  vendor: 'Atlassian', product: 'Jira Service Management', plan: 'Premium', accountOrSiteId: 'example-site', coveredExperience: 'browser',
  policyVersionId: 'ATLASSIAN_CLOUD_PREMIUM_2026_04_30', simulated: true, configuredBy: 'actor', configuredAt: '2026-11-05T00:00:00.000Z',
};
const issue: IssueSnapshot = { id: '40001', key: 'CCDEMO-1', projectId: '10001', projectKey: 'CCDEMO', issueTypeId: '30001', componentIds: ['20001'] };

function memoryStore() {
  const leads = new Map<string, Lead>();
  const cases = new Map<string, MonthCase>();
  const observations = new Map<string, Observation>();
  const links = new Set<string>();
  let failLinkOnce = false;
  const repo: DiscoveryStore = {
    selectPolicyForPeriod: async projectId => builtInPolicy(projectId),
    getCoverage: async () => coverage,
    getLead: async (_projectId, issueId, coverageId) => leads.get(`${issueId}:${coverageId}`),
    saveLead: async lead => { leads.set(`${lead.issueId}:${lead.coverageId}`, lead); },
    getObservation: async (_projectId, issueId, id) => observations.get(`${issueId}:${id}`),
    saveObservation: async (_projectId, observation) => { observations.set(`${observation.issueId}:${observation.id}`, observation); },
    getCase: async (_projectId, id) => cases.get(id),
    saveCase: async item => { cases.set(item.id, item); },
    linkIssue: async (_projectId, issueId, caseId) => {
      if (failLinkOnce) { failLinkOnce = false; throw new Error('transient storage failure'); }
      links.add(`${issueId}:${caseId}`);
    },
    issueCases: async (_projectId, issueId) => [...links].filter(link => link.startsWith(`${issueId}:`)).map(link => cases.get(link.split(':')[1])!).filter(Boolean),
  };
  return { repo, leads, cases, observations, links, failNextLink: () => { failLinkOnce = true; } };
}

test('duplicate event and manual recheck preserve one lead and no undated case', async () => {
  const store = memoryStore();
  const first = await reconcileIssue(issue, '2026-11-05T00:00:00.000Z', store.repo);
  const second = await reconcileIssue(issue, '2026-11-05T01:00:00.000Z', store.repo);
  assert.deepEqual(second, first);
  assert.equal(store.leads.size, 1);
  assert.equal(store.cases.size, 0);
  assert.equal(await reconcileIssue({ ...issue, componentIds: [] }, undefined, store.repo), null);
});

test('observation retry and a second incident share one monthly case without duplicate links', async () => {
  const store = memoryStore();
  const input = {
    issue, coverage, start: '2026-11-05T10:00:00.000Z', end: '2026-11-05T11:00:00.000Z',
    reference: 'CCDEMO-1', accountId: 'actor', simulated: true, id: '11111111-1111-4111-8111-111111111111',
  };
  await addObservationToIssue(input, '2026-11-05T12:00:00.000Z', store.repo);
  await addObservationToIssue(input, '2026-11-05T12:05:00.000Z', store.repo);
  assert.equal(store.observations.size, 1);
  assert.equal(store.cases.size, 1);
  assert.equal(store.links.size, 1);
  await addObservationToIssue({ ...input, issue: { ...issue, id: '40002', key: 'CCDEMO-2' }, id: '22222222-2222-4222-8222-222222222222' }, '2026-11-05T12:10:00.000Z', store.repo);
  assert.equal(store.cases.size, 1);
  assert.equal(store.links.size, 2);
});

test('retry repairs a partially written observation and cross-month case links', async () => {
  const store = memoryStore();
  const input = {
    issue, coverage, start: '2026-11-30T23:40:00.000Z', end: '2026-12-01T00:40:00.000Z',
    reference: 'CCDEMO-1', accountId: 'actor', simulated: true, id: '33333333-3333-4333-8333-333333333333',
  };
  store.failNextLink();
  await assert.rejects(addObservationToIssue(input, '2026-12-01T01:00:00.000Z', store.repo));
  await addObservationToIssue(input, '2026-12-01T01:05:00.000Z', store.repo);
  assert.equal(store.observations.size, 1);
  assert.equal(store.cases.size, 2);
  assert.equal(store.links.size, 2);
});

test('dated qualifying evidence links both UTC months without inventing a customer observation', async () => {
  const store = memoryStore();
  const start = '2026-09-30T23:40:00.000Z';
  const end = '2026-10-01T00:40:00.000Z';
  const cases = await ensureMonthCases(issue, coverage, start, end, true, '2026-10-02T00:00:00.000Z', store.repo);
  assert.deepEqual(cases.map(item => item.period), ['2026-09', '2026-10']);
  assert.equal(store.observations.size, 0);
  assert.equal(store.cases.size, 2);
  assert.equal(store.links.size, 2);
  await ensureMonthCases(issue, coverage, start, end, true, '2026-10-02T00:01:00.000Z', store.repo);
  assert.equal(store.cases.size, 2);
  assert.equal(store.links.size, 2);
});
