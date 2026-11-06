import { randomUUID } from 'node:crypto';
import { caseId, matches, monthsTouched, type Coverage, type IssueSnapshot, type Lead, type MonthCase, type Observation } from './discovery-domain';
import { issueCases, storage } from './storage';
import { policySnapshot, selectPolicyForPeriod } from './policy-registry';

export type DiscoveryStore = Pick<typeof storage, 'getCoverage' | 'getLead' | 'saveLead' | 'getObservation' | 'saveObservation' | 'getCase' | 'saveCase' | 'linkIssue'> & {
  issueCases: typeof issueCases;
  selectPolicyForPeriod: typeof selectPolicyForPeriod;
};
const defaultStore: DiscoveryStore = { ...storage, issueCases, selectPolicyForPeriod };

export async function reconcileIssue(issue: IssueSnapshot, now = new Date().toISOString(), repo: DiscoveryStore = defaultStore): Promise<Lead | null> {
  const coverage = await repo.getCoverage(issue.projectId);
  if (!coverage || !matches(coverage, issue)) return null;
  const previous = await repo.getLead(issue.projectId, issue.id, coverage.id);
  if (previous) return previous;
  const lead: Lead = {
    id: `${issue.projectId}:${issue.id}:${coverage.id}`,
    projectId: issue.projectId,
    issueId: issue.id,
    issueKey: issue.key,
    coverageId: coverage.id,
    state: 'MATCHED_UNDATED',
    createdAt: now,
    simulated: coverage.simulated,
  };
  await repo.saveLead(lead);
  return lead;
}

export async function issueDiscovery(issue: IssueSnapshot, repo: DiscoveryStore = defaultStore): Promise<{ coverage?: Coverage; lead?: Lead; cases: MonthCase[] }> {
  const coverage = await repo.getCoverage(issue.projectId);
  if (!coverage || !matches(coverage, issue)) return { cases: [] };
  const [lead, cases] = await Promise.all([
    repo.getLead(issue.projectId, issue.id, coverage.id),
    repo.issueCases(issue.projectId, issue.id),
  ]);
  return { coverage, lead, cases };
}

export async function addObservationToIssue(input: {
  issue: IssueSnapshot;
  coverage: Coverage;
  start: string;
  end: string;
  reference: string;
  accountId: string;
  simulated: boolean;
  id?: string;
}, now = new Date().toISOString(), repo: DiscoveryStore = defaultStore): Promise<{ observation: Observation; cases: MonthCase[] }> {
  if (!matches(input.coverage, input.issue)) throw new Error('The issue no longer matches the configured service.');
  const id = input.id || randomUUID();
  const existing = await repo.getObservation(input.issue.projectId, input.issue.id, id);
  const observation: Observation = existing || {
    id,
    issueId: input.issue.id,
    coverageId: input.coverage.id,
    observedStartUtc: input.start,
    observedEndUtc: input.end,
    reference: input.reference,
    authorAccountId: input.accountId,
    createdAt: now,
    status: 'UNVERIFIED_CUSTOMER_OBSERVATION',
    simulated: input.coverage.simulated || input.simulated,
  };
  if (!existing) await repo.saveObservation(input.issue.projectId, observation);
  const cases = await ensureMonthCases(input.issue, input.coverage, observation.observedStartUtc, observation.observedEndUtc, observation.simulated, now, repo);
  return { observation, cases };
}

export async function ensureMonthCases(
  issue: IssueSnapshot, coverage: Coverage, start: string, end: string, simulated: boolean,
  now = new Date().toISOString(), repo: DiscoveryStore = defaultStore,
): Promise<MonthCase[]> {
  if (!matches(coverage, issue)) throw new Error('The issue no longer matches the configured service.');
  const lead = await reconcileIssue(issue, now, repo);
  if (!lead) throw new Error('The incident is not mapped to a covered service.');
  const cases: MonthCase[] = [];
  for (const period of monthsTouched(start, end)) {
    const id = caseId(issue.projectId, coverage.id, period);
    let monthCase = await repo.getCase(issue.projectId, id);
    if (!monthCase) {
      const selected = await repo.selectPolicyForPeriod(issue.projectId, period);
      if (!selected || selected.id !== coverage.policyVersionId) throw new Error('No active, applicable policy version matches this service and month. Ask a project administrator to review the policy registry.');
      monthCase = {
        id,
        projectId: issue.projectId,
        coverageId: coverage.id,
        period,
        policy: policySnapshot(selected),
        assessmentState: 'NEEDS_EVIDENCE',
        claimState: 'OPEN',
        createdAt: now,
        simulated,
      };
      await repo.saveCase(monthCase);
    } else if (simulated && !monthCase.simulated) {
      monthCase = { ...monthCase, simulated: true };
      await repo.saveCase(monthCase);
    }
    await repo.linkIssue(issue.projectId, issue.id, id);
    cases.push(monthCase);
  }
  if (lead.state !== 'LINKED_TO_CASE') await repo.saveLead({ ...lead, state: 'LINKED_TO_CASE' });
  return cases;
}
