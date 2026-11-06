import { kvs, WhereConditions, Filter, FilterConditions } from '@forge/kvs';
import type { Coverage, Lead, MonthCase, Observation } from './discovery-domain';
import type { MinuteEvidence, EvidenceReview, CompletenessReview } from './evidence-domain';
import type { ClaimEvent } from './claims-domain';
import type { Assessment } from './rules/evaluate';
import type { PolicyRecord, PolicyLifecycle } from './policy-registry';

const coverageKey = (projectId: string) => `config:project:${projectId}`;
const coverageChangeKey = (projectId: string, id: string) => `coverage_change:${projectId}:${id}`;
export type CoverageChange = { id: string; projectId: string; previous?: Coverage; current: Coverage; actorAccountId: string; recordedAt: string; reason: string };
const leadKey = (projectId: string, issueId: string, coverageId: string) => `lead:${projectId}:${issueId}:${coverageId}`;
const caseKey = (projectId: string, caseId: string) => `case:${projectId}:${caseId}`;
const caseIssueKey = (projectId: string, issueId: string, caseId: string) => `case_issue:${projectId}:${issueId}:${caseId}`;
const caseSourceKey = (projectId: string, caseId: string, issueId: string) => `case_source:${projectId}:${caseId}:${issueId}`;
const observationKey = (projectId: string, issueId: string, observationId: string) => `observation:${projectId}:${issueId}:${observationId}`;
const evidenceKey = (projectId: string, caseId: string, id: string) => `case_evidence:${projectId}:${caseId}:${id}`;
const evidenceReviewKey = (projectId: string, caseId: string, id: string) => `case_evidence_review:${projectId}:${caseId}:${id}`;
const completenessKey = (projectId: string, caseId: string, id: string) => `case_completeness:${projectId}:${caseId}:${id}`;
const claimEventKey = (projectId: string, caseId: string, id: string) => `claim_event:${projectId}:${caseId}:${id}`;
const claimHeadKey = (projectId: string, caseId: string) => `claim_head:${projectId}:${caseId}`;
const deadlineFlagKey = (projectId: string, caseId: string, deadlineDateUtc: string, milestone: string) => `deadline_flag:${projectId}:${caseId}:${deadlineDateUtc}:${milestone}`;
const assessmentHeadKey = (projectId: string, caseId: string) => `assessment_head:${projectId}:${caseId}`;
const assessmentActivityKey = (projectId: string, caseId: string, id: string) => `assessment_activity:${projectId}:${caseId}:${id}`;
const policyResolutionKey = (projectId: string, caseId: string, id: string) => `policy_resolution:${projectId}:${caseId}:${id}`;
const policyResolutionHeadKey = (projectId: string, caseId: string) => `policy_resolution_head:${projectId}:${caseId}`;
const policyKey = (projectId: string, id: string) => `policy:${projectId}:${id}`;
const policyEventKey = (projectId: string, id: string, eventId: string) => `policy_event:${projectId}:${id}:${eventId}`;
const activePolicyKey = (projectId: string) => `policy_active:${projectId}`;
export type PolicyControl = { revision: number; activeId: string };
const controlEntity = 'policy_control';
export type PolicyResolution = { id: string; projectId: string; caseId: string; frozenPolicyVersionId: string; conflictingPolicyVersionId: string; reference: string; reason: string; actorAccountId: string; recordedAt: string };
export type AssessmentHead = { fingerprint: string; state: Assessment['state']; activityId: string };
export type AssessmentActivity = { id: string; projectId: string; caseId: string; previousState?: Assessment['state']; currentState: Assessment['state']; fingerprint: string; actor: 'SYSTEM'; recordedAt: string; summary: string };

export type DeadlineFlag = { projectId: string; caseId: string; milestone: string; deadlineDateUtc: string; deadlineReference?: string; ownerAccountId: string; createdAt: string; simulated: boolean };

export const storage = {
  getPolicyControl: (projectId: string) => kvs.entity<PolicyControl>(controlEntity).get(projectId),
  ensurePolicyControl: async (projectId: string): Promise<PolicyControl> => {
    const prior = await kvs.entity<PolicyControl>(controlEntity).get(projectId);
    if (prior) return prior;
    const activeId = await kvs.get<string>(activePolicyKey(projectId)) || 'NONE';
    try {
      await kvs.transact().set(projectId, { revision: 0, activeId }, { entityName: controlEntity,
        conditions: new Filter<PolicyControl>().and('revision', FilterConditions.notExists()) }).execute();
    } catch (error) {
      const raced = await kvs.entity<PolicyControl>(controlEntity).get(projectId);
      if (!raced) throw error;
      return raced;
    }
    return (await kvs.entity<PolicyControl>(controlEntity).get(projectId))!;
  },
  getPolicy: (projectId: string, id: string) => kvs.get<PolicyRecord>(policyKey(projectId, id)),
  getActivePolicy: (projectId: string) => kvs.get<string>(activePolicyKey(projectId)),
  setActivePolicy: (projectId: string, id: string) => kvs.set(activePolicyKey(projectId), id),
  savePolicyCreated: (record: PolicyRecord, event: PolicyLifecycle, control: PolicyControl) => {
    const nextControl: PolicyControl = { revision: control.revision + 1, activeId: record.status === 'ACTIVE' ? record.definition.id : control.activeId };
    const tx = kvs.transact().set(event.projectId, nextControl, { entityName: controlEntity,
      conditions: new Filter<PolicyControl>().and('revision', FilterConditions.equalTo(control.revision)) })
      .set(policyKey(record.definition.projectId, record.definition.id), record)
      .set(policyEventKey(event.projectId, event.policyId, event.id), event);
    return (record.status === 'ACTIVE' ? tx.set(activePolicyKey(event.projectId), event.policyId) : tx).execute();
  },
  savePolicyTransition: (record: PolicyRecord, event: PolicyLifecycle, control: PolicyControl, active?: string) => {
    const tx = kvs.transact().set(event.projectId, { revision: control.revision + 1, activeId: active === undefined ? control.activeId : active || 'NONE' }, { entityName: controlEntity,
      conditions: new Filter<PolicyControl>().and('revision', FilterConditions.equalTo(control.revision)) })
      .set(policyKey(event.projectId, event.policyId), record).set(policyEventKey(event.projectId, event.policyId, event.id), event);
    return (active === undefined ? tx : tx.set(activePolicyKey(event.projectId), active)).execute();
  },
  getCoverage: (projectId: string) => kvs.get<Coverage>(coverageKey(projectId)),
  saveCoverage: (coverage: Coverage) => kvs.set(coverageKey(coverage.projectId), coverage),
  saveCoverageWithAudit: (coverage: Coverage, change: CoverageChange) => kvs.transact()
    .set(coverageKey(coverage.projectId), coverage)
    .set(coverageChangeKey(change.projectId, change.id), change)
    .execute(),
  getLead: (projectId: string, issueId: string, coverageId: string) => kvs.get<Lead>(leadKey(projectId, issueId, coverageId)),
  saveLead: (lead: Lead) => kvs.set(leadKey(lead.projectId, lead.issueId, lead.coverageId), lead),
  getCase: (projectId: string, caseId: string) => kvs.get<MonthCase>(caseKey(projectId, caseId)),
  saveCase: (monthCase: MonthCase) => kvs.set(caseKey(monthCase.projectId, monthCase.id), monthCase),
  linkIssue: (projectId: string, issueId: string, caseId: string) => kvs.transact()
    .set(caseIssueKey(projectId, issueId, caseId), { issueId, caseId })
    .set(caseSourceKey(projectId, caseId, issueId), { issueId, caseId })
    .execute(),
  getObservation: (projectId: string, issueId: string, id: string) => kvs.get<Observation>(observationKey(projectId, issueId, id)),
  saveObservation: (projectId: string, observation: Observation) => kvs.set(observationKey(projectId, observation.issueId, observation.id), observation),
  saveMinuteEvidence: (item: MinuteEvidence) => kvs.set(evidenceKey(item.projectId, item.caseId, item.id), item),
  getMinuteEvidence: (projectId: string, caseId: string, id: string) => kvs.get<MinuteEvidence>(evidenceKey(projectId, caseId, id)),
  saveEvidenceReview: (item: EvidenceReview) => kvs.set(evidenceReviewKey(item.projectId, item.caseId, item.id), item),
  saveCompletenessReview: (item: CompletenessReview) => kvs.set(completenessKey(item.projectId, item.caseId, item.id), item),
  saveClaimAction: (item: ClaimEvent) => kvs.transact()
    .set(claimEventKey(item.projectId, item.caseId, item.id), item)
    .set(claimHeadKey(item.projectId, item.caseId), { eventId: item.id })
    .execute(),
  getClaimEvent: (projectId: string, caseId: string, id: string) => kvs.get<ClaimEvent>(claimEventKey(projectId, caseId, id)),
  getClaimHead: (projectId: string, caseId: string) => kvs.get<{ eventId: string }>(claimHeadKey(projectId, caseId)),
  getDeadlineFlag: (projectId: string, caseId: string, deadlineDateUtc: string, milestone: string) => kvs.get<DeadlineFlag>(deadlineFlagKey(projectId, caseId, deadlineDateUtc, milestone)),
  saveDeadlineFlag: (item: DeadlineFlag) => kvs.set(deadlineFlagKey(item.projectId, item.caseId, item.deadlineDateUtc, item.milestone), item),
  getAssessmentHead: (projectId: string, caseId: string) => kvs.get<AssessmentHead>(assessmentHeadKey(projectId, caseId)),
  saveAssessmentChange: (head: AssessmentHead, activity: AssessmentActivity) => kvs.transact()
    .set(assessmentHeadKey(activity.projectId, activity.caseId), head)
    .set(assessmentActivityKey(activity.projectId, activity.caseId, activity.id), activity)
    .execute(),
  getPolicyResolution: async (projectId: string, caseId: string) => {
    const head = await kvs.get<{ id: string }>(policyResolutionHeadKey(projectId, caseId));
    return head ? kvs.get<PolicyResolution>(policyResolutionKey(projectId, caseId, head.id)) : undefined;
  },
  savePolicyResolution: (item: PolicyResolution) => kvs.transact()
    .set(policyResolutionKey(item.projectId, item.caseId, item.id), item)
    .set(policyResolutionHeadKey(item.projectId, item.caseId), { id: item.id })
    .execute(),
};

export async function allByPrefix<T>(prefix: string, max = 200): Promise<T[]> {
  const values: T[] = [];
  let cursor: string | undefined;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(20);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany<T>();
    values.push(...page.results.map(result => result.value));
    cursor = page.nextCursor;
  } while (cursor && values.length < max);
  return values.slice(0, max);
}

export async function issueCases(projectId: string, issueId: string): Promise<MonthCase[]> {
  const links = await allByPrefix<{ issueId: string; caseId: string }>(`case_issue:${projectId}:${issueId}:`);
  const cases = await Promise.all(links.map(link => storage.getCase(projectId, link.caseId)));
  return cases.filter((item): item is MonthCase => !!item).sort((a, b) => a.period.localeCompare(b.period));
}

export async function caseSourceIds(projectId: string, caseId: string): Promise<string[]> {
  const links = await allByPrefix<{ issueId: string; caseId: string }>(`case_source:${projectId}:${caseId}:`);
  return links.map(link => link.issueId);
}

export const caseEvidence = (projectId: string, caseId: string) => allByPrefix<MinuteEvidence>(`case_evidence:${projectId}:${caseId}:`);
export const caseEvidenceReviews = (projectId: string, caseId: string) => allByPrefix<EvidenceReview>(`case_evidence_review:${projectId}:${caseId}:`);
export const caseCompletenessReviews = (projectId: string, caseId: string) => allByPrefix<CompletenessReview>(`case_completeness:${projectId}:${caseId}:`);
export const caseClaimEvents = (projectId: string, caseId: string) => allByPrefix<ClaimEvent>(`claim_event:${projectId}:${caseId}:`);
export async function strongClaimEvents(projectId: string, caseId: string): Promise<ClaimEvent[]> {
  const head = await storage.getClaimHead(projectId, caseId);
  if (!head) return caseClaimEvents(projectId, caseId);
  const events: ClaimEvent[] = [];
  const seen = new Set<string>();
  let id: string | null = head.eventId;
  while (id) {
    if (seen.has(id) || events.length >= 200) throw new Error('Invalid or oversized claim history.');
    seen.add(id);
    const event: ClaimEvent | undefined = await storage.getClaimEvent(projectId, caseId, id);
    if (!event || event.projectId !== projectId || event.caseId !== caseId) throw new Error('Claim history is incomplete.');
    events.push(event);
    id = event.previousId;
  }
  const byId = new Map(events.reverse().map(item => [item.id, item]));
  for (const item of await caseClaimEvents(projectId, caseId)) byId.set(item.id, item);
  if (byId.size >= 200) throw new Error('Claim history limit reached.');
  return [...byId.values()];
}
export const caseDeadlineFlags = (projectId: string, caseId: string) => allByPrefix<DeadlineFlag>(`deadline_flag:${projectId}:${caseId}:`);
export const issueObservations = (projectId: string, issueId: string) => allByPrefix<Observation>(`observation:${projectId}:${issueId}:`);
export const coverageChanges = (projectId: string) => allByPrefix<CoverageChange>(`coverage_change:${projectId}:`);
export const assessmentActivities = (projectId: string, caseId: string) => allByPrefix<AssessmentActivity>(`assessment_activity:${projectId}:${caseId}:`);
export const casePolicyResolutions = (projectId: string, caseId: string) => allByPrefix<PolicyResolution>(`policy_resolution:${projectId}:${caseId}:`);
