import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import api from '@forge/api';
import { kvs } from '@forge/kvs';
import { handler } from '../src/backend/index';
import { scanDeadlines } from '../src/backend/deadlines';
import { caseId, coverageId, POLICY, type Coverage, type MonthCase } from '../src/backend/discovery-domain';
import type { ContractChecks, MinuteEvidence, EvidenceReview } from '../src/backend/evidence-domain';
import { selectPolicyForPeriod } from '../src/backend/policy-registry';

const projectId = '100';
const issueId = '400';
const coverage: Coverage = {
  id: coverageId(projectId, 'demo'), projectId, componentId: '200', componentName: 'Jira', issueTypeId: '300', issueTypeName: 'Incident',
  vendor: 'Atlassian', product: 'Jira Service Management', plan: 'Premium', accountOrSiteId: 'demo',
  coveredExperience: 'browser', policyVersionId: POLICY.id, simulated: true, configuredBy: 'admin', configuredAt: '2026-11-01T00:00:00.000Z',
};
const confirmed = { status: 'CONFIRMED' as const, reference: 'DEMO:CONTRACT-1' };
const conditions: ContractChecks = {
  coverage: confirmed, support: confirmed, billing: confirmed, exclusions: confirmed,
  claimWindow: { ...confirmed, dateUtc: '2026-11-15' },
};

function harness() {
  const records = new Map<string, unknown>();
  const entities = new Map<string, unknown>();
  records.set(`config:project:${projectId}`, coverage);
  let admin = true;
  let issueVisible = true;
  const requestJira = async (route: { value_: string }) => {
    const path = route.value_;
    if (path.includes('/components')) return { ok: true, status: 200, json: async () => [{ id: '200', name: 'Jira' }] };
    if (path.startsWith('/rest/api/3/issuetype/project')) return { ok: true, status: 200, json: async () => [{ id: '300', name: 'Incident' }] };
    if (path.startsWith('/rest/api/3/project/')) return { ok: true, status: 200, json: async () => ({ id: projectId, key: 'CCDEMO', name: 'Demo', projectTypeKey: 'service_desk' }) };
    if (path.startsWith('/rest/api/3/issue/')) return issueVisible
      ? { ok: true, status: 200, json: async () => ({ id: issueId, key: 'CCDEMO-1', fields: { project: { id: projectId, key: 'CCDEMO' }, issuetype: { id: '300' }, components: [{ id: '200' }], summary: 'Simulated browser errors', created: '2026-10-05T11:00:00.000Z' } }) }
      : { ok: false, status: 403, json: async () => ({}) };
    if (path.startsWith('/rest/api/3/mypermissions')) {
      const name = path.includes('ADMINISTER_PROJECTS') ? 'ADMINISTER_PROJECTS' : 'EDIT_ISSUES';
      return { ok: true, status: 200, json: async () => ({ permissions: { [name]: { havePermission: name === 'EDIT_ISSUES' || admin } } }) };
    }
    throw new Error(`Unexpected Jira route: ${path}`);
  };
  mock.method(api, 'asUser', () => ({ requestJira }));
  mock.method(kvs, 'get', async (key: string) => records.get(key));
  mock.method(kvs, 'set', async (key: string, value: unknown) => { records.set(key, value); });
  mock.method(kvs, 'entity', (_name: string) => ({ get: async (key: string) => entities.get(key) }));
  mock.method(kvs, 'transact', () => {
    const pending: Array<[string, unknown, { entityName?: string; conditions?: { filters: () => Array<{ property: string; condition: string; values: unknown[] }> } } | undefined]> = [];
    const builder = {
      set(key: string, value: unknown, options?: { entityName?: string; conditions?: { filters: () => Array<{ property: string; condition: string; values: unknown[] }> } }) { pending.push([key, value, options]); return builder; },
      execute: async () => {
        for (const [key, , options] of pending) for (const filter of options?.conditions?.filters() || []) {
          const prior = entities.get(key) as Record<string, unknown> | undefined;
          const value = prior?.[filter.property];
          if (filter.condition === 'EQUAL_TO' && value !== filter.values[0] || filter.condition === 'NOT_EXISTS' && value !== undefined) throw new Error('Conditional transaction conflict');
        }
        for (const [key, value, options] of pending) (options?.entityName ? entities : records).set(key, value);
      },
    };
    return builder;
  });
  mock.method(kvs, 'query', () => {
    let prefix = '';
    let max = 20;
    const query = {
      where(_key: string, condition: { values: string[] }) { prefix = condition.values[0]; return query; },
      limit(value: number) { max = value; return query; },
      cursor(_value: string) { return query; },
      getMany: async () => ({ results: [...records].filter(([key]) => key.startsWith(prefix)).slice(0, max).map(([key, value]) => ({ key, value })), nextCursor: undefined }),
    };
    return query;
  });
  const call = (functionKey: string, payload: Record<string, unknown> = {}, accountId = 'admin') => handler({
    call: { functionKey, payload, jobId: 'test' },
    context: { accountType: 'licensed', extension: { project: { id: projectId }, issue: { id: issueId } } },
  } as never, { principal: { accountId } } as never) as Promise<Record<string, any>>;
  return { records, call, setAdmin(value: boolean) { admin = value; }, setIssueVisible(value: boolean) { issueVisible = value; }, restore() { mock.restoreAll(); } };
}

function seedCase(records: Map<string, unknown>, period = '2026-10'): MonthCase {
  const id = caseId(projectId, coverage.id, period);
  const monthCase: MonthCase = { id, projectId, coverageId: coverage.id, period, policy: POLICY,
    assessmentState: 'NEEDS_EVIDENCE', claimState: 'OPEN', createdAt: '2026-11-01T00:00:00.000Z', simulated: true };
  records.set(`case:${projectId}:${id}`, monthCase);
  records.set(`case_source:${projectId}:${id}:${issueId}`, { caseId: id, issueId });
  records.set(`case_issue:${projectId}:${issueId}:${id}`, { caseId: id, issueId });
  return monthCase;
}

test('resolvers deny review writes without admin permission or source browse access', async () => {
  const h = harness();
  try {
    const monthCase = seedCase(h.records);
    h.setAdmin(false);
    assert.equal((await h.call('attestCaseEvidence', { issueId, caseId: monthCase.id, complete: true, environment: 'PRODUCTION', conditions, reason: 'Reviewed' })).state, 'no_access');
    assert.equal((await h.call('recordClaimAction', { issueId, caseId: monthCase.id, kind: 'STATE', nextState: 'UNDER_REVIEW', reason: 'Reviewed' })).state, 'no_access');
    h.setIssueVisible(false);
    assert.equal((await h.call('getCaseWorkflow', { issueId, caseId: monthCase.id })).state, 'no_access');
  } finally { h.restore(); }
});

test('cross-month minute submission is idempotent across retries', async () => {
  const h = harness();
  try {
    const october = seedCase(h.records);
    const payload = { issueId, caseId: october.id, start: '2026-10-31T23:40:00.000Z', end: '2026-11-01T00:40:00.000Z',
      sourceType: 'CUSTOMER_LOGS', coveredExperience: 'browser', reference: 'CCDEMO-1' };
    const first = await h.call('submitMinuteEvidence', payload);
    const second = await h.call('submitMinuteEvidence', payload);
    assert.equal(first.state, 'ready');
    assert.equal(second.evidenceId, first.evidenceId);
    assert.equal(first.caseIds.length, 2);
    assert.equal([...h.records.keys()].filter(key => key.startsWith('case_evidence:')).length, 2);
    assert.equal([...h.records.keys()].filter(key => key.startsWith('case_source:')).length, 2);
  } finally { h.restore(); }
});

test('administrator can audit and set aside a conflicting claim branch', async () => {
  const h = harness();
  try {
    const monthCase = seedCase(h.records);
    const first = { id: 'first', projectId, caseId: monthCase.id, previousId: null, kind: 'STATE', state: 'UNDER_REVIEW',
      reason: 'First review', actorAccountId: 'admin', recordedAt: '2026-11-01T00:00:00.000Z' };
    const competing = { ...first, id: 'competing', state: 'CLOSED', reason: 'Competing close', recordedAt: '2026-11-01T00:00:01.000Z' };
    h.records.set(`claim_event:${projectId}:${monthCase.id}:${first.id}`, first);
    h.records.set(`claim_event:${projectId}:${monthCase.id}:${competing.id}`, competing);
    h.records.set(`claim_head:${projectId}:${monthCase.id}`, { eventId: first.id });
    const before = await h.call('getCaseWorkflow', { issueId, caseId: monthCase.id });
    assert.equal(before.claim.conflicts.length, 1);
    assert.equal((await h.call('recordClaimAction', { issueId, caseId: monthCase.id, kind: 'OWNER', reason: 'Assign owner', expectedLastEventId: first.id })).state, 'error');
    assert.equal((await h.call('recordClaimAction', { issueId, caseId: monthCase.id, kind: 'CONFLICT_RESOLUTION',
      reason: 'Reviewed both actions and retain the active review', expectedLastEventId: first.id, resolvedEventIds: [competing.id] })).state, 'ready');
    const after = await h.call('getCaseWorkflow', { issueId, caseId: monthCase.id });
    assert.equal(after.claim.state, 'UNDER_REVIEW');
    assert.equal(after.claim.conflicts.length, 0);
    assert.equal(after.claim.resolvedConflicts[0].id, competing.id);
    assert.equal(after.claim.history.at(-1).kind, 'CONFLICT_RESOLUTION');
  } finally { h.restore(); }
});

test('policy conflict blocks assessment until an administrator records the exact frozen-version decision', async () => {
  const h = harness();
  try {
    const monthCase = seedCase(h.records);
    h.records.set(`config:project:${projectId}`, { ...coverage, policyVersionId: 'FUTURE_VERSION' });
    const before = await h.call('getCaseWorkflow', { issueId, caseId: monthCase.id });
    assert.equal(before.assessment.state, 'ASSESSMENT_BLOCKED');
    assert.equal(before.policyConflict, 'FUTURE_VERSION');
    h.setAdmin(false);
    assert.equal((await h.call('recordPolicyReconciliation', { issueId, caseId: monthCase.id,
      reference: 'DEMO:CONTRACT-1', reason: 'Reviewed contract' })).state, 'no_access');
    h.setAdmin(true);
    const payload = { issueId, caseId: monthCase.id, reference: 'DEMO:CONTRACT-1', reason: 'Reviewed contract' };
    assert.equal((await h.call('recordPolicyReconciliation', payload)).state, 'ready');
    assert.equal((await h.call('recordPolicyReconciliation', payload)).alreadyRecorded, true);
    const after = await h.call('getCaseWorkflow', { issueId, caseId: monthCase.id });
    assert.equal(after.policyReconciled, true);
    assert.equal(after.assessment.state, 'NEEDS_EVIDENCE');
    assert.equal(after.policyHistory.length, 1);
  } finally { h.restore(); }
});

test('policy registry preserves legacy case policy and rejects unsupported activation', async () => {
  const h = harness();
  try {
    const oldCase = seedCase(h.records);
    const setup = await h.call('getProjectSetup', { projectId });
    assert.equal(setup.state, 'ready');
    assert.equal(setup.policyRecords[0].status, 'ACTIVE');
    assert.equal(await selectPolicyForPeriod(projectId, '2026-03'), null);
    assert.equal(await selectPolicyForPeriod(projectId, '2026-04'), null);
    assert.equal((await selectPolicyForPeriod(projectId, '2026-10'))?.id, POLICY.id);
    const draft = await h.call('createPolicyVersion', { projectId, id: 'CUSTOM_TERMS_2027', version: '2027', title: 'Customer terms', effectiveFrom: '2027-01-01', sourceKind: 'OFFICIAL_URL', sourceReference: 'https://example.com/terms', clauseReference: 'Schedule 2 section 4', reason: 'Contract received' });
    assert.equal(draft.state, 'ready');
    let record = draft.record;
    for (const next of ['IN_REVIEW', 'APPROVED']) {
      const result = await h.call('changePolicyStatus', { projectId, policyId: record.definition.id, next, reason: 'Reviewed source clauses', expectedEventId: record.lastEventId });
      assert.equal(result.state, 'ready', result.message);
      record = result.record;
    }
    const blocked = await h.call('changePolicyStatus', { projectId, policyId: record.definition.id, next: 'ACTIVE', reason: 'Attempt activation', expectedEventId: record.lastEventId });
    assert.equal(blocked.state, 'error');
    assert.match(blocked.message, /Unsupported policy/);
    assert.equal((h.records.get(`case:${projectId}:${oldCase.id}`) as MonthCase).policy.id, POLICY.id);
    assert.equal((await h.call('getCaseWorkflow', { issueId, caseId: oldCase.id })).assessment.assessedPolicyVersion, POLICY.id);
    h.setAdmin(false);
    assert.equal((await h.call('createPolicyVersion', { projectId, id: 'OTHER', version: '1', title: 'Other', effectiveFrom: '2027-01-01', sourceReference: 'Ref', clauseReference: '1', reason: 'Attempt' })).state, 'no_access');
    assert.equal((await h.call('changePolicyStatus', { projectId, policyId: record.definition.id, next: 'RETIRED', reason: 'Attempt retire', expectedEventId: record.lastEventId })).state, 'no_access');
  } finally { h.restore(); }
});

test('reviewed equivalent policy can replace the active version without rewriting prior cases', async () => {
  const h = harness();
  try {
    const oldCase = seedCase(h.records, '2026-10');
    const setup = await h.call('getProjectSetup', { projectId });
    const builtIn = setup.policyRecords.find((item: { definition: { id: string } }) => item.definition.id === POLICY.id);
    const payload = { projectId, id: 'ATLASSIAN_CUSTOM_2026_11', version: 'customer-2026-11', title: 'Reviewed customer SLA reference', effectiveFrom: '2026-11-01', sourceKind: 'OFFICIAL_URL', sourceReference: POLICY.sourceUrl, sourceVersion: '2026-04-30', supportedTerms: true, clauseReferences: ['Appendix A', 'Section 1 and Calculation', 'Appendix B Definitions', 'Section 3', 'Appendix B Credits', 'Section 2.1'], reason: 'Reviewed equivalent source' };
    const created = await h.call('createPolicyVersion', payload);
    assert.equal(created.state, 'ready', created.message);
    let record = created.record;
    for (const next of ['IN_REVIEW', 'APPROVED']) {
      const result = await h.call('changePolicyStatus', { projectId, policyId: record.definition.id, next, reason: 'Reviewed all cited clauses', expectedEventId: record.lastEventId });
      assert.equal(result.state, 'ready', result.message);
      const stale = await h.call('changePolicyStatus', { projectId, policyId: record.definition.id, next: 'RETIRED', reason: 'Competing old action', expectedEventId: record.lastEventId });
      assert.equal(stale.state, 'error');
      assert.match(stale.message, /Refresh and retry/);
      record = result.record;
    }
    const conflict = await h.call('changePolicyStatus', { projectId, policyId: record.definition.id, next: 'ACTIVE', reason: 'Activate reviewed version', expectedEventId: record.lastEventId });
    assert.equal(conflict.state, 'error');
    assert.match(conflict.message, /conflicts/);
    assert.equal((await h.call('changePolicyStatus', { projectId, policyId: POLICY.id, next: 'RETIRED', reason: 'Superseded by reviewed version', expectedEventId: builtIn.lastEventId })).state, 'ready');
    const activated = await h.call('changePolicyStatus', { projectId, policyId: record.definition.id, next: 'ACTIVE', reason: 'Activate reviewed version', expectedEventId: record.lastEventId });
    assert.equal(activated.state, 'ready', activated.message);
    assert.equal((await selectPolicyForPeriod(projectId, '2026-10')), null);
    assert.equal((await selectPolicyForPeriod(projectId, '2026-11'))?.id, record.definition.id);
    const mapping = await h.call('saveCoverage', { projectId, componentId: '200', issueTypeId: '300', accountOrSiteId: 'demo', verifiedPolicy: true, simulated: true, changeReason: 'Updated verified policy version' });
    assert.equal(mapping.state, 'ready', mapping.message);
    assert.equal(mapping.coverage.policyVersionId, record.definition.id);
    assert.equal((h.records.get(`case:${projectId}:${oldCase.id}`) as MonthCase).policy.id, POLICY.id);
    const observation = await h.call('addObservation', { issueId, start: '2026-11-05T10:00:00.000Z', end: '2026-11-05T11:00:00.000Z', reference: 'CCDEMO-1', simulated: true });
    assert.equal(observation.state, 'ready', observation.message);
    const novemberId = caseId(projectId, coverage.id, '2026-11');
    const newCase = h.records.get(`case:${projectId}:${novemberId}`) as MonthCase;
    assert.equal(newCase.policy.id, record.definition.id);
    assert.equal(newCase.policy.definitionHash, record.definition.definitionHash);
    const workflow = await h.call('getCaseWorkflow', { issueId, caseId: novemberId });
    assert.equal(workflow.assessment.assessedPolicyVersion, record.definition.id);
    assert.notEqual(workflow.assessment.state, 'NEEDS_POLICY');
  } finally { h.restore(); }
});

test('concurrent policy decisions commit one lifecycle branch', async () => {
  const h = harness();
  try {
    const created = await h.call('createPolicyVersion', { projectId, id: 'CONCURRENT_POLICY', version: '1', title: 'Proposed terms', effectiveFrom: '2026-11-01', sourceKind: 'OFFICIAL_URL', sourceReference: POLICY.sourceUrl, clauseReference: 'Section 1', reason: 'Review proposal' });
    assert.equal(created.state, 'ready', created.message);
    const review = await h.call('changePolicyStatus', { projectId, policyId: created.record.definition.id, next: 'IN_REVIEW', reason: 'Submit to reviewer', expectedEventId: created.record.lastEventId });
    assert.equal(review.state, 'ready', review.message);
    const base = { projectId, policyId: created.record.definition.id, reason: 'Reviewed proposal', expectedEventId: review.record.lastEventId };
    const results = await Promise.all([h.call('changePolicyStatus', { ...base, next: 'APPROVED' }), h.call('changePolicyStatus', { ...base, next: 'DRAFT' })]);
    assert.deepEqual(results.map(item => item.state).sort(), ['error', 'ready']);
    const stored = h.records.get(`policy:${projectId}:${created.record.definition.id}`) as { status: string };
    assert.ok(stored.status === 'APPROVED' || stored.status === 'DRAFT');
    assert.equal([...h.records.keys()].filter(key => key.startsWith(`policy_event:${projectId}:${created.record.definition.id}:`)).length, 3);
  } finally { h.restore(); }
});

test('claim and deadline resolvers require referenced checks and preserve action history', async () => {
  const h = harness();
  try {
    const monthCase = seedCase(h.records);
    const evidence: MinuteEvidence = { id: '12345678-1234-1234-1234-123456789abc', projectId, caseId: monthCase.id, issueId, coverageId: coverage.id,
      sourceType: 'CUSTOMER_LOGS', coveredExperience: 'browser', qualifyingRanges: [{ start: '2026-10-05T12:00:00.000Z', end: '2026-10-05T13:00:00.000Z' }],
      reference: 'CCDEMO-1', authorAccountId: 'admin', createdAt: '2026-11-01T00:00:00.000Z', simulated: true };
    const review: EvidenceReview = { id: 'review', projectId, caseId: monthCase.id, evidenceId: evidence.id,
      trust: 'REVIEWED_CUSTOMER_EVIDENCE', confirmedPolicyRule: true, reason: 'Reviewed minute logs', reviewerAccountId: 'admin', reviewedAt: '2026-11-01T01:00:00.000Z' };
    h.records.set(`case_evidence:${projectId}:${monthCase.id}:${evidence.id}`, evidence);
    h.records.set(`case_evidence_review:${projectId}:${monthCase.id}:${review.id}`, review);
    const action = async (kind: string, state?: string, externalReference = '') => {
      const current = await h.call('getCaseWorkflow', { issueId, caseId: monthCase.id });
      return h.call('recordClaimAction', { issueId, caseId: monthCase.id, kind, nextState: state,
        reason: 'Reviewed demo case', externalReference, expectedLastEventId: current.claim.lastEventId });
    };
    assert.equal((await action('OWNER')).state, 'ready');
    assert.equal((await action('SUPPORT_REF', undefined, 'DEMO:SUPPORT-1')).state, 'ready');
    assert.equal((await action('STATE', 'UNDER_REVIEW')).state, 'ready');
    assert.equal((await action('STATE', 'DRAFT_READY')).state, 'error');
    assert.equal(await scanDeadlines('2026-11-08'), 0);
    assert.equal((await h.call('attestCaseEvidence', { issueId, caseId: monthCase.id, complete: true, environment: 'PRODUCTION',
      conditions: { ...conditions, claimWindow: { ...conditions.claimWindow, dateUtc: '2026-10-31' } }, reason: 'Reviewed all evidence' })).state, 'error');
    assert.equal((await h.call('attestCaseEvidence', { issueId, caseId: monthCase.id, complete: true, environment: 'PRODUCTION',
      conditions, reason: 'Reviewed all evidence' })).state, 'ready');
    assert.equal((await action('STATE', 'DRAFT_READY')).state, 'ready');
    assert.equal(await scanDeadlines('2026-11-08'), 1);
    assert.equal(await scanDeadlines('2026-11-08'), 0);
    assert.equal((await action('STATE', 'SUBMITTED', 'DEMO:CLAIM-1')).state, 'ready');
    const after = await h.call('getCaseWorkflow', { issueId, caseId: monthCase.id });
    assert.equal(after.claim.state, 'SUBMITTED');
    assert.equal(after.claim.history.length, 5);
    assert.equal(after.confirmedDeadline.dateUtc, '2026-11-15');
    assert.match(after.draft, /Simulated browser errors/);
    assert.match(after.draft, /Covered experience: browser/);
    assert.match(after.draft, /UTC month denominator: 44640 minutes/);
    assert.match(after.draft, /Potential qualifying-minute intervals/);
    assert.equal((await h.call('reviewMinuteEvidence', { issueId, caseId: monthCase.id, evidenceId: evidence.id,
      trust: 'UNVERIFIED', reason: 'Evidence no longer supports claimed minutes' })).state, 'ready');
    const revised = await h.call('getCaseWorkflow', { issueId, caseId: monthCase.id });
    assert.equal(revised.assessment.state, 'NEEDS_EVIDENCE');
    assert.equal(revised.claim.state, 'SUBMITTED');
    assert.equal(revised.claim.history.length, 5);
  } finally { h.restore(); }
});
