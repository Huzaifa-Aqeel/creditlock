import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { authorizedAccount, contextProjectId, idFrom } from './shell-auth';
import { caseId, coverageId, matches, POLICY, stableInputId, validReference, validateObservationRange, type Coverage } from './discovery-domain';
import { issueAsUser, projectAsUser, projectChoices, userHasPermission } from './jira';
import { addObservationToIssue, ensureMonthCases, issueDiscovery, reconcileIssue } from './discovery-service';
import { ensureBuiltInPolicy, createPolicy, changePolicyStatus, validStoredPolicy, type PolicyStatus } from './policy-registry';
import { allByPrefix, assessmentActivities, casePolicyResolutions, caseSourceIds, coverageChanges, issueObservations, storage } from './storage';
import { loadAssessment } from './assessment-service';
import { intervalTimes, monthBounds } from './rules/intervals';
import { createHash, randomUUID } from 'node:crypto';
import { CONDITION_KEYS, latestByEvidence, type ContractChecks, type EvidenceSource, type Experience, type EvidenceReview, type CompletenessReview, type MinuteEvidence } from './evidence-domain';
import { claimDraft, claimSnapshot, deadlineDateUtc, submissionReadiness, validDemoReference, validateClaimAction, type ClaimEvent } from './claims-domain';
import { caseDeadlineFlags, strongClaimEvents } from './storage';
import { confirmedDeadline } from './deadlines';
import { allSourcesVisible } from './case-auth';

async function enrichedIssueDiscovery(issue: import('./discovery-domain').IssueSnapshot) {
  const discovery = await issueDiscovery(issue);
  const cases = await Promise.all(discovery.cases.map(async monthCase => {
    const sourceIds = await caseSourceIds(issue.projectId, monthCase.id);
    const sources = await Promise.all(sourceIds.map(issueAsUser));
    if (!allSourcesVisible(issue.projectId, sourceIds, sources)) return null;
    const { assessment } = await loadAssessment(monthCase);
    return { ...monthCase, assessmentState: assessment.state };
  }));
  return { ...discovery, cases: cases.filter((item): item is NonNullable<typeof item> => !!item) };
}

type PageResult =
  | { state: 'ready'; project: { id: string; key: string; name: string }; accountId: string }
  | { state: 'no_access'; message: string }
  | { state: 'error'; message: string };

type IssueResult =
  | { state: 'ready'; issue: { id: string; key: string; summary: string }; project: { id: string; key: string }; accountId: string }
  | { state: 'no_access'; message: string }
  | { state: 'error'; message: string };

const ResolverClass = (Resolver as unknown as { default?: typeof Resolver }).default || Resolver;
const resolver = new ResolverClass();

resolver.define('getProjectShell', async ({ payload, context }): Promise<PageResult> => {
  const accountId = authorizedAccount(context);
  const projectId = idFrom(payload.projectId);
  const boundProjectId = contextProjectId(context.extension);
  if (!accountId || !projectId || projectId !== boundProjectId) {
    return { state: 'no_access', message: 'You need licensed Jira access to this project.' };
  }

  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`);
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return { state: 'no_access', message: 'You cannot browse this Jira project.' };
    }
    if (!response.ok) return { state: 'error', message: 'Jira could not load this project. Try again.' };
    const project = await response.json() as { id: string; key: string; name: string; projectTypeKey: string };
    if (project.id !== projectId || project.projectTypeKey !== 'service_desk') {
      return { state: 'no_access', message: 'CreditClock is available in Jira Service Management projects.' };
    }
    return { state: 'ready', project: { id: project.id, key: project.key, name: project.name }, accountId };
  } catch {
    return { state: 'error', message: 'Jira access could not be checked. Try again.' };
  }
});

resolver.define('getIssueShell', async ({ payload, context }): Promise<IssueResult> => {
  const accountId = authorizedAccount(context);
  const issueId = idFrom(payload.issueId);
  const boundIssueId = idFrom(context.extension.issue?.id);
  const boundProjectId = contextProjectId(context.extension);
  if (!accountId || !issueId || issueId !== boundIssueId || !boundProjectId) {
    return { state: 'no_access', message: 'You need licensed Jira access to this issue.' };
  }

  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=summary,project`);
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return { state: 'no_access', message: 'You cannot browse this Jira issue.' };
    }
    if (!response.ok) return { state: 'error', message: 'Jira could not load this issue. Try again.' };
    const issue = await response.json() as {
      id: string;
      key: string;
      fields: { summary: string; project: { id: string; key: string; projectTypeKey: string } };
    };
    const project = issue.fields?.project;
    if (issue.id !== issueId || project?.id !== boundProjectId || project.projectTypeKey !== 'service_desk') {
      return { state: 'no_access', message: 'CreditClock is available for issues in Jira Service Management projects.' };
    }
    return {
      state: 'ready',
      issue: { id: issue.id, key: issue.key, summary: issue.fields.summary },
      project: { id: project.id, key: project.key },
      accountId,
    };
  } catch {
    return { state: 'error', message: 'Jira access could not be checked. Try again.' };
  }
});

resolver.define('getProjectSetup', async ({ payload, context }) => {
  const projectId = idFrom(payload.projectId);
  if (!authorizedAccount(context) || !projectId || projectId !== contextProjectId(context.extension)) {
    return { state: 'no_access', message: 'You cannot access this project.' };
  }
  try {
    const project = await projectAsUser(projectId);
    if (!project) return { state: 'no_access', message: 'You cannot browse this Jira Service Management project.' };
    const canConfigure = await userHasPermission(projectId, 'ADMINISTER_PROJECTS');
    const [coverage, choices, history, builtIn] = await Promise.all([
      storage.getCoverage(projectId),
      canConfigure ? projectChoices(projectId) : Promise.resolve({ components: [], issueTypes: [] }),
      canConfigure ? coverageChanges(projectId) : Promise.resolve([]),
      canConfigure ? ensureBuiltInPolicy(projectId) : Promise.resolve(undefined),
    ]);
    const policyRecords = canConfigure ? await allByPrefix<import('./policy-registry').PolicyRecord>(`policy:${projectId}:`, 100) : [];
    if (builtIn && !policyRecords.some(item => item.definition.id === POLICY.id)) policyRecords.push(builtIn);
    return { state: 'ready', project: { id: project.id, key: project.key, name: project.name }, canConfigure, coverage, choices, coverageHistory: history, policy: POLICY, policyRecords };
  } catch {
    return { state: 'error', message: 'Project setup could not be loaded. Try again.' };
  }
});

resolver.define('saveCoverage', async ({ payload, context }) => {
  const projectId = idFrom(payload.projectId);
  if (!authorizedAccount(context) || !projectId || projectId !== contextProjectId(context.extension)) {
    return { state: 'no_access', message: 'You cannot configure this project.' };
  }
  try {
    const project = await projectAsUser(projectId);
    if (!project || !await userHasPermission(projectId, 'ADMINISTER_PROJECTS')) {
      return { state: 'no_access', message: 'Project administrator permission is required.' };
    }
    const componentId = idFrom(payload.componentId);
    const issueTypeId = idFrom(payload.issueTypeId);
    const accountOrSiteId = typeof payload.accountOrSiteId === 'string' ? payload.accountOrSiteId.trim() : '';
    const changeReason = typeof payload.changeReason === 'string' ? payload.changeReason.trim() : '';
    if (!componentId || !issueTypeId || !/^[A-Za-z0-9._:-]{2,100}$/.test(accountOrSiteId) || payload.verifiedPolicy !== true || typeof payload.simulated !== 'boolean') {
      return { state: 'error', message: 'Select a component and issue type, enter a site/account ID, and confirm the cited policy.' };
    }
    if (changeReason.length < 3 || changeReason.length > 500) return { state: 'error', message: 'Add a short mapping-change reason.' };
    const choices = await projectChoices(projectId);
    const component = choices.components.find(choice => choice.id === componentId);
    const issueType = choices.issueTypes.find(choice => choice.id === issueTypeId);
    if (!component || !issueType) return { state: 'error', message: 'The Jira component or issue type is no longer available.' };
    const existing = await storage.getCoverage(projectId);
    const id = coverageId(projectId, accountOrSiteId);
    if (existing && existing.id !== id) {
      const cases = await allByPrefix<import('./discovery-domain').MonthCase>(`case:${projectId}:`, 100);
      if (cases.length >= 100 || cases.some(monthCase => monthCase.coverageId === existing.id)) {
        return { state: 'error', message: 'This account/site already has cases. Keep the mapping and reconcile a new profile separately.' };
      }
    }
    const template = await ensureBuiltInPolicy(projectId);
    if (template.status === 'APPROVED' && (await storage.ensurePolicyControl(projectId)).activeId === 'NONE') await changePolicyStatus(projectId, POLICY.id, context.accountId!, 'ACTIVE', `Administrator reviewed policy for mapping: ${changeReason}`, template.lastEventId);
    const activeId = (await storage.ensurePolicyControl(projectId)).activeId;
    const active = activeId !== 'NONE' ? await storage.getPolicy(projectId, activeId) : undefined;
    if (!active || active.status !== 'ACTIVE' || !validStoredPolicy(active) || active.definition.adapter !== 'ATLASSIAN_PREMIUM_2026') return { state: 'error', message: 'Activate a validated, supported policy version before saving the mapping.' };
    const coverage: Coverage = {
      id,
      projectId,
      componentId,
      componentName: component.name,
      issueTypeId,
      issueTypeName: issueType.name,
      vendor: 'Atlassian',
      product: 'Jira Service Management',
      plan: 'Premium',
      accountOrSiteId,
      coveredExperience: 'browser',
      policyVersionId: active.definition.id,
      simulated: payload.simulated,
      configuredBy: context.accountId!,
      configuredAt: new Date().toISOString(),
    };
    await storage.saveCoverageWithAudit(coverage, {
      id: randomUUID(), projectId, ...(existing ? { previous: existing } : {}), current: coverage,
      actorAccountId: context.accountId!, recordedAt: coverage.configuredAt, reason: changeReason,
    });
    return { state: 'ready', coverage };
  } catch {
    return { state: 'error', message: 'Coverage could not be saved. Try again.' };
  }
});

resolver.define('createPolicyVersion', async ({ payload, context }) => {
  const projectId = idFrom(payload.projectId);
  if (!authorizedAccount(context) || !projectId || projectId !== contextProjectId(context.extension)) return { state: 'no_access' };
  try {
    if (!await projectAsUser(projectId) || !await userHasPermission(projectId, 'ADMINISTER_PROJECTS')) return { state: 'no_access' };
    const field = (name: string) => typeof payload[name] === 'string' ? (payload[name] as string).trim() : '';
    const sourceKind = payload.sourceKind === 'OFFICIAL_URL' ? 'OFFICIAL_URL' : 'CUSTOMER_DOCUMENT';
    const record = await createPolicy(projectId, context.accountId!, { id: field('id'), version: field('version'), title: field('title'), effectiveFrom: field('effectiveFrom'), effectiveTo: field('effectiveTo') || undefined, sourceKind, sourceReference: field('sourceReference'), sourceVersion: field('sourceVersion'), sourceHash: field('sourceHash'), clauseReferences: Array.isArray(payload.clauseReferences) ? payload.clauseReferences.map(String) : undefined, clauseReference: field('clauseReference'), supportedTerms: payload.supportedTerms === true, reason: field('reason') });
    return { state: 'ready', record };
  } catch (error) { return { state: 'error', message: error instanceof Error ? error.message : 'Policy version could not be created.' }; }
});

resolver.define('changePolicyStatus', async ({ payload, context }) => {
  const projectId = idFrom(payload.projectId);
  if (!authorizedAccount(context) || !projectId || projectId !== contextProjectId(context.extension)) return { state: 'no_access' };
  try {
    if (!await projectAsUser(projectId) || !await userHasPermission(projectId, 'ADMINISTER_PROJECTS')) return { state: 'no_access' };
    const id = typeof payload.policyId === 'string' && /^[A-Za-z0-9_-]{4,100}$/.test(payload.policyId) ? payload.policyId : null;
    const next = payload.next as PolicyStatus;
    if (!id || !['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED'].includes(next) || typeof payload.expectedEventId !== 'string') return { state: 'error', message: 'Invalid policy action.' };
    const record = await changePolicyStatus(projectId, id, context.accountId!, next, String(payload.reason || ''), payload.expectedEventId);
    return { state: 'ready', record };
  } catch (error) { return { state: 'error', message: error instanceof Error ? error.message : 'Policy status could not be changed.' }; }
});

async function permittedIssue(payload: Record<string, unknown>, context: { accountId?: string; accountType?: string; extension?: Record<string, unknown> }) {
  const issueId = idFrom(payload.issueId);
  const extension = context.extension || {};
  const boundIssueId = idFrom((extension.issue as { id?: unknown } | undefined)?.id);
  const boundProjectId = contextProjectId(extension);
  if (!authorizedAccount(context) || !issueId || issueId !== boundIssueId || !boundProjectId) return null;
  const [project, issue] = await Promise.all([projectAsUser(boundProjectId), issueAsUser(issueId)]);
  return project && issue?.projectId === boundProjectId ? issue : null;
}

resolver.define('getIssueDiscovery', async ({ payload, context }) => {
  try {
    const issue = await permittedIssue(payload, context);
    if (!issue) return { state: 'no_access', message: 'You cannot browse this Jira Service Management issue.' };
    const discovery = await enrichedIssueDiscovery(issue);
    const canAddObservation = await userHasPermission(issue.projectId, 'EDIT_ISSUES', issue.id);
    const canCreateDemo = !!discovery.coverage?.simulated && await userHasPermission(issue.projectId, 'ADMINISTER_PROJECTS');
    return { state: 'ready', issue, ...discovery, canAddObservation, canCreateDemo };
  } catch {
    return { state: 'error', message: 'Issue discovery could not be loaded. Try again.' };
  }
});

resolver.define('recheckIssue', async ({ payload, context }) => {
  try {
    const issue = await permittedIssue(payload, context);
    if (!issue) return { state: 'no_access', message: 'You cannot browse this issue.' };
    if (!await userHasPermission(issue.projectId, 'EDIT_ISSUES', issue.id) && !await userHasPermission(issue.projectId, 'ADMINISTER_PROJECTS')) {
      return { state: 'no_access', message: 'Issue contributor or project administrator permission is required.' };
    }
    await reconcileIssue(issue);
    return { state: 'ready', issue, ...await enrichedIssueDiscovery(issue) };
  } catch {
    return { state: 'error', message: 'The issue could not be rechecked. Try again.' };
  }
});

resolver.define('addObservation', async ({ payload, context }) => {
  try {
    const issue = await permittedIssue(payload, context);
    if (!issue || !context.accountId) return { state: 'no_access', message: 'You cannot browse this issue.' };
    if (!await userHasPermission(issue.projectId, 'EDIT_ISSUES', issue.id)) {
      return { state: 'no_access', message: 'Edit Issues permission is required to add an observation.' };
    }
    const coverage = await storage.getCoverage(issue.projectId);
    if (!coverage || !matches(coverage, issue)) return { state: 'error', message: 'This issue has no configured covered service.' };
    let start: string;
    let end: string;
    try {
      ({ start, end } = validateObservationRange(payload.start, payload.end, Date.now()));
    } catch (error) {
      return { state: 'error', message: error instanceof Error ? error.message : 'Enter valid UTC observation times.' };
    }
    if (!validReference(payload.reference) || typeof payload.simulated !== 'boolean') {
      return { state: 'error', message: 'Add an HTTPS evidence link or Jira issue key and identify whether this is simulated.' };
    }
    const stableId = stableInputId('observation', [issue.projectId, issue.id, coverage.id, start, end, payload.reference, context.accountId, String(payload.simulated)]);
    const added = await addObservationToIssue({ issue, coverage, start, end, reference: payload.reference, accountId: context.accountId, simulated: payload.simulated, id: stableId });
    return { state: 'ready', ...added };
  } catch {
    return { state: 'error', message: 'Observation could not be saved. Try again.' };
  }
});

resolver.define('listProjectCases', async ({ payload, context }) => {
  const projectId = idFrom(payload.projectId);
  if (!authorizedAccount(context) || !projectId || projectId !== contextProjectId(context.extension)) {
    return { state: 'no_access', message: 'You cannot access this project.' };
  }
  try {
    if (!await projectAsUser(projectId)) return { state: 'no_access', message: 'You cannot browse this project.' };
    const cases = await allByPrefix<import('./discovery-domain').MonthCase>(`case:${projectId}:`, 100);
    const visible = [];
    for (const monthCase of cases) {
      const sourceIds = await caseSourceIds(projectId, monthCase.id);
      if (sourceIds.length === 0) continue;
      const sources = await Promise.all(sourceIds.map(issueAsUser));
      if (!allSourcesVisible(projectId, sourceIds, sources)) continue;
      const [{ assessment, completeness }, events, flags] = await Promise.all([
        loadAssessment(monthCase), strongClaimEvents(projectId, monthCase.id), caseDeadlineFlags(projectId, monthCase.id),
      ]);
      const claim = claimSnapshot(events);
      const deadline = confirmedDeadline(monthCase, completeness);
      visible.push({
        ...monthCase, assessmentState: assessment.state, claimState: claim.state,
        ownerAccountId: claim.ownerAccountId, deadlineDateUtc: deadline?.dateUtc || deadlineDateUtc(monthCase.period),
        deadlineConfirmed: !!deadline,
        notices: flags.filter(flag => deadline && flag.deadlineDateUtc === deadline.dateUtc).map(flag => flag.milestone), issueKeys: sources.map(source => source!.key),
      });
    }
    return { state: 'ready', cases: visible.sort((a, b) => a.deadlineDateUtc.localeCompare(b.deadlineDateUtc)) };
  } catch {
    return { state: 'error', message: 'Cases could not be loaded. Try again.' };
  }
});

async function permittedCase(payload: Record<string, unknown>, context: { accountId?: string; accountType?: string; extension?: Record<string, unknown> }) {
  const issue = await permittedIssue(payload, context);
  const caseIdValue = typeof payload.caseId === 'string' && /^[0-9a-f]{24}$/.test(payload.caseId) ? payload.caseId : null;
  if (!issue || !caseIdValue) return null;
  const monthCase = await storage.getCase(issue.projectId, caseIdValue);
  if (!monthCase || monthCase.projectId !== issue.projectId) return null;
  const sources = await caseSourceIds(issue.projectId, caseIdValue);
  if (!sources.includes(issue.id) || sources.length === 0) return null;
  const visible = await Promise.all(sources.map(issueAsUser));
  if (!allSourcesVisible(issue.projectId, sources, visible)) return null;
  return { issue, monthCase };
}

resolver.define('getCaseAssessment', async ({ payload, context }) => {
  try {
    const allowed = await permittedCase(payload, context);
    if (!allowed) return { state: 'no_access', message: 'You cannot access every source of this case.' };
    const data = await loadAssessment(allowed.monthCase);
    const canReview = await userHasPermission(allowed.issue.projectId, 'ADMINISTER_PROJECTS');
    const canContribute = await userHasPermission(allowed.issue.projectId, 'EDIT_ISSUES', allowed.issue.id);
    return { state: 'ready', caseId: allowed.monthCase.id, ...data, canReview, canContribute };
  } catch {
    return { state: 'error', message: 'Case assessment could not be loaded. Try again.' };
  }
});

resolver.define('submitMinuteEvidence', async ({ payload, context }) => {
  try {
    const allowed = await permittedCase(payload, context);
    if (!allowed || !context.accountId) return { state: 'no_access', message: 'You cannot access this case.' };
    if (!await userHasPermission(allowed.issue.projectId, 'EDIT_ISSUES', allowed.issue.id)) {
      return { state: 'no_access', message: 'Edit Issues permission is required.' };
    }
    const sourceType = payload.sourceType as EvidenceSource;
    const coveredExperience = payload.coveredExperience as Experience;
    if (!['CUSTOMER_LOGS', 'VENDOR_SUPPORT', 'PROVIDER_CONFIRMATION', 'OTHER'].includes(sourceType)
      || !['browser', 'api', 'mobile', 'other'].includes(coveredExperience)
      || !validReference(payload.reference)) return { state: 'error', message: 'Select a source and experience and add a valid evidence reference.' };
    const start = payload.start;
    const end = payload.end;
    if (typeof start !== 'string' || typeof end !== 'string') return { state: 'error', message: 'Enter a qualifying minute range.' };
    const [from, to] = intervalTimes({ start, end });
    const [monthStart, monthEnd] = monthBounds(allowed.monthCase.period);
    if (to <= monthStart || from >= monthEnd || to > Date.now() + 5 * 60_000 || to - from > 366 * 24 * 60 * 60_000) {
      return { state: 'error', message: 'The minute range must overlap this UTC month and cannot end in the future.' };
    }
    const vendorReference = typeof payload.vendorReference === 'string' ? payload.vendorReference.trim() : '';
    if (vendorReference && !validReference(vendorReference)) return { state: 'error', message: 'Use a valid vendor reference.' };
    const stableId = stableInputId('minute-evidence', [allowed.issue.projectId, allowed.issue.id, allowed.monthCase.coverageId,
      start, end, sourceType, coveredExperience, payload.reference, vendorReference, context.accountId]);
    const coverage = await storage.getCoverage(allowed.issue.projectId);
    if (!coverage || coverage.id !== allowed.monthCase.coverageId || !matches(coverage, allowed.issue)) {
      return { state: 'error', message: 'The current issue mapping no longer matches this case.' };
    }
    const cases = await ensureMonthCases(allowed.issue, coverage, start, end, allowed.monthCase.simulated);
    for (const monthCase of cases) {
      if (await storage.getMinuteEvidence(allowed.issue.projectId, monthCase.id, stableId)) continue;
      const item: MinuteEvidence = {
        id: stableId, projectId: allowed.issue.projectId, caseId: monthCase.id,
        issueId: allowed.issue.id, coverageId: coverage.id,
        sourceType, coveredExperience, qualifyingRanges: [{ start, end }],
        reference: payload.reference, ...(vendorReference ? { vendorReference } : {}),
        authorAccountId: context.accountId, createdAt: new Date().toISOString(), simulated: monthCase.simulated,
      };
      await storage.saveMinuteEvidence(item);
    }
    return { state: 'ready', evidenceId: stableId, caseIds: cases.map(item => item.id) };
  } catch (error) {
    return { state: 'error', message: error instanceof Error ? error.message : 'Evidence could not be saved.' };
  }
});

resolver.define('reviewMinuteEvidence', async ({ payload, context }) => {
  try {
    const allowed = await permittedCase(payload, context);
    if (!allowed || !context.accountId) return { state: 'no_access', message: 'You cannot access this case.' };
    if (!await userHasPermission(allowed.issue.projectId, 'ADMINISTER_PROJECTS')) {
      return { state: 'no_access', message: 'Project administrator review permission is required.' };
    }
    const evidenceId = typeof payload.evidenceId === 'string' && /^[0-9a-f-]{36}$/.test(payload.evidenceId) ? payload.evidenceId : '';
    const evidence = evidenceId && await storage.getMinuteEvidence(allowed.issue.projectId, allowed.monthCase.id, evidenceId);
    const trust = payload.trust as EvidenceReview['trust'];
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!evidence || !['UNVERIFIED', 'REVIEWED_CUSTOMER_EVIDENCE', 'VENDOR_CONFIRMED'].includes(trust) || reason.length < 3 || reason.length > 500) {
      return { state: 'error', message: 'Select evidence, a review status, and a reason.' };
    }
    if (trust !== 'UNVERIFIED' && payload.confirmedPolicyRule !== true) {
      return { state: 'error', message: 'Confirm that this evidence supports qualifying minutes under the cited SLA rule.' };
    }
    if (trust === 'VENDOR_CONFIRMED' && !evidence.vendorReference) return { state: 'error', message: 'Vendor confirmation needs a vendor reference on the evidence.' };
    const review: EvidenceReview = {
      id: randomUUID(), projectId: allowed.issue.projectId, caseId: allowed.monthCase.id,
      evidenceId, trust, confirmedPolicyRule: trust !== 'UNVERIFIED', reason, reviewerAccountId: context.accountId, reviewedAt: new Date().toISOString(),
    };
    await storage.saveEvidenceReview(review);
    return { state: 'ready' };
  } catch {
    return { state: 'error', message: 'Evidence review could not be saved.' };
  }
});

resolver.define('attestCaseEvidence', async ({ payload, context }) => {
  try {
    const allowed = await permittedCase(payload, context);
    if (!allowed || !context.accountId) return { state: 'no_access', message: 'You cannot access this case.' };
    if (!await userHasPermission(allowed.issue.projectId, 'ADMINISTER_PROJECTS')) {
      return { state: 'no_access', message: 'Project administrator review permission is required.' };
    }
    const environment = payload.environment as CompletenessReview['environment'];
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!['PRODUCTION', 'TRIAL', 'SANDBOX', 'UNKNOWN'].includes(environment) || typeof payload.complete !== 'boolean' || reason.length < 3 || reason.length > 500) {
      return { state: 'error', message: 'Select site status, evidence completeness, and a review reason.' };
    }
    const rawChecks = payload.conditions;
    if (!rawChecks || typeof rawChecks !== 'object') return { state: 'error', message: 'Record every contract check as unknown, confirmed, or failed.' };
    const conditions = {} as ContractChecks;
    for (const key of CONDITION_KEYS) {
      const raw = (rawChecks as Record<string, unknown>)[key];
      if (!raw || typeof raw !== 'object') return { state: 'error', message: `Set the ${key} contract check.` };
      const check = raw as Record<string, unknown>;
      const status = check.status;
      const reference = typeof check.reference === 'string' ? check.reference.trim() : '';
      if (!['UNKNOWN', 'CONFIRMED', 'FAILED'].includes(status as string)) return { state: 'error', message: `Set the ${key} contract check.` };
      if (status !== 'UNKNOWN' && !(validReference(reference) || allowed.monthCase.simulated && validDemoReference(reference))) {
        return { state: 'error', message: `Add a valid reference for the ${key} contract check.` };
      }
      if (key === 'claimWindow' && status === 'CONFIRMED') {
        const dateUtc = check.dateUtc;
        const [, monthEnd] = monthBounds(allowed.monthCase.period);
        const at = typeof dateUtc === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateUtc) ? Date.parse(`${dateUtc}T00:00:00.000Z`) : NaN;
        if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== dateUtc || at < monthEnd || at > monthEnd + 366 * 86_400_000) {
          return { state: 'error', message: 'Enter the confirmed UTC deadline date after the affected month and within one year.' };
        }
        conditions[key] = { status: 'CONFIRMED', reference, dateUtc: dateUtc as string };
      } else conditions[key] = { status: status as ContractChecks[typeof key]['status'], ...(reference ? { reference } : {}) };
    }
    const review: CompletenessReview = {
      id: randomUUID(), projectId: allowed.issue.projectId, caseId: allowed.monthCase.id,
      complete: payload.complete, environment, conditions, policyVersionId: allowed.monthCase.policy.id,
      reason, reviewerAccountId: context.accountId, reviewedAt: new Date().toISOString(),
    };
    await storage.saveCompletenessReview(review);
    return { state: 'ready' };
  } catch {
    return { state: 'error', message: 'Case attestation could not be saved.' };
  }
});

resolver.define('getCaseWorkflow', async ({ payload, context }) => {
  try {
    const allowed = await permittedCase(payload, context);
    if (!allowed) return { state: 'no_access', message: 'You cannot access every source of this case.' };
    const [events, flags, assessmentData, sourceIds, coverage] = await Promise.all([
      strongClaimEvents(allowed.issue.projectId, allowed.monthCase.id),
      caseDeadlineFlags(allowed.issue.projectId, allowed.monthCase.id),
      loadAssessment(allowed.monthCase),
      caseSourceIds(allowed.issue.projectId, allowed.monthCase.id),
      storage.getCoverage(allowed.issue.projectId),
    ]);
    if (events.length >= 200 || flags.length >= 200) return { state: 'error', message: 'Case history limit reached; contact the project administrator.' };
    const sources = await Promise.all(sourceIds.map(issueAsUser));
    if (!allSourcesVisible(allowed.issue.projectId, sourceIds, sources)) return { state: 'no_access', message: 'You cannot access every source of this case.' };
    const observations = (await Promise.all(sourceIds.map(id => issueObservations(allowed.issue.projectId, id)))).flat();
    if (observations.length >= 200) return { state: 'error', message: 'Observation list limit reached; review this case before drafting.' };
    const [monthStart, monthEnd] = monthBounds(allowed.monthCase.period);
    const caseObservations = observations.filter(item => item.coverageId === allowed.monthCase.coverageId && Date.parse(item.observedStartUtc) < monthEnd && Date.parse(item.observedEndUtc) > monthStart);
    const claim = claimSnapshot(events);
    const readiness = submissionReadiness(assessmentData.assessment, assessmentData.completeness, claim);
    const deadline = confirmedDeadline(allowed.monthCase, assessmentData.completeness);
    const assessmentHistory = (await assessmentActivities(allowed.issue.projectId, allowed.monthCase.id))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
    const policyHistory = (await casePolicyResolutions(allowed.issue.projectId, allowed.monthCase.id))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
    const siteId = coverage?.id === allowed.monthCase.coverageId ? coverage.accountOrSiteId : 'unverified site';
    const reviewsByEvidence = latestByEvidence(assessmentData.reviews);
    const latestConditions = [...assessmentData.completeness].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || b.id.localeCompare(a.id))[0]?.conditions;
    const draft = claimDraft({
      caseId: allowed.monthCase.id, period: allowed.monthCase.period, accountOrSiteId: siteId,
      sourceKeys: sources.map(source => source!.key), assessment: assessmentData.assessment,
      policyUrl: allowed.monthCase.policy.sourceUrl, supportReference: claim.supportReference,
      policyVersionId: allowed.monthCase.policy.id, policyEffectiveFrom: allowed.monthCase.policy.effectiveFrom,
      coveredExperience: coverage?.id === allowed.monthCase.coverageId ? coverage.coveredExperience : undefined,
      sourceDetails: sources.map(source => ({ key: source!.key, summary: source!.summary, createdAt: source!.createdAt })),
      minuteEvidence: assessmentData.evidence.flatMap(item => item.qualifyingRanges.map(range => ({
        start: range.start, end: range.end, reference: item.reference,
        trust: reviewsByEvidence.get(item.id)?.trust || 'UNVERIFIED',
      }))),
      ownerAccountId: claim.ownerAccountId, simulated: allowed.monthCase.simulated,
      evidenceReferences: assessmentData.evidence.map(item => ({ reference: item.reference, trust: reviewsByEvidence.get(item.id)?.trust || 'UNVERIFIED' })),
      observations: caseObservations.map(item => ({ start: item.observedStartUtc, end: item.observedEndUtc, reference: item.reference })),
      contractChecks: CONDITION_KEYS.map(key => `${key}: ${latestConditions?.[key]?.status?.toLowerCase() || 'unknown'}${latestConditions?.[key]?.reference ? ` (${latestConditions[key].reference})` : ''}`),
      confirmedDeadline: deadline,
    });
    return {
      state: 'ready', caseId: allowed.monthCase.id, period: allowed.monthCase.period,
      policy: allowed.monthCase.policy, deadlineDateUtc: deadline?.dateUtc || deadlineDateUtc(allowed.monthCase.period), confirmedDeadline: deadline,
      sourceKeys: sources.map(source => source!.key), assessment: assessmentData.assessment,
      sourceDetails: sources.map(source => ({ key: source!.key, summary: source!.summary, createdAt: source!.createdAt })),
      observations: caseObservations, minuteEvidence: assessmentData.evidence.map(item => ({ ...item, trust: reviewsByEvidence.get(item.id)?.trust || 'UNVERIFIED' })),
      claim, readiness, flags: flags.filter(flag => deadline && flag.deadlineDateUtc === deadline.dateUtc), assessmentHistory, policyHistory,
      policyConflict: assessmentData.policyConflict, policyReconciled: assessmentData.policyReconciled,
      draft, canManage: await userHasPermission(allowed.issue.projectId, 'ADMINISTER_PROJECTS'),
      simulated: allowed.monthCase.simulated,
    };
  } catch {
    return { state: 'error', message: 'Case workflow could not be loaded.' };
  }
});

resolver.define('recordPolicyReconciliation', async ({ payload, context }) => {
  try {
    const allowed = await permittedCase(payload, context);
    if (!allowed || !context.accountId || !await userHasPermission(allowed.issue.projectId, 'ADMINISTER_PROJECTS')) {
      return { state: 'no_access', message: 'Project administrator permission is required.' };
    }
    const coverage = await storage.getCoverage(allowed.issue.projectId);
    if (!coverage || coverage.id !== allowed.monthCase.coverageId || coverage.policyVersionId === allowed.monthCase.policy.id) {
      return { state: 'error', message: 'There is no reconcilable policy-version conflict for this case.' };
    }
    const frozenRecord = await storage.getPolicy(allowed.issue.projectId, allowed.monthCase.policy.id);
    const registered = !!frozenRecord && validStoredPolicy(frozenRecord) && frozenRecord.definition.definitionHash === allowed.monthCase.policy.definitionHash;
    const legacy = allowed.monthCase.policy.id === POLICY.id && !allowed.monthCase.policy.definitionHash && allowed.monthCase.policy.sourceUrl === POLICY.sourceUrl && allowed.monthCase.policy.effectiveFrom === POLICY.effectiveFrom;
    if (!registered && !legacy) {
      return { state: 'error', message: 'The frozen policy is not a supported immutable version.' };
    }
    const reference = typeof payload.reference === 'string' ? payload.reference.trim() : '';
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!(validReference(reference) || allowed.monthCase.simulated && validDemoReference(reference)) || reason.length < 3 || reason.length > 500) {
      return { state: 'error', message: 'Add a policy reference and a review reason.' };
    }
    const prior = await storage.getPolicyResolution(allowed.issue.projectId, allowed.monthCase.id);
    if (prior?.frozenPolicyVersionId === allowed.monthCase.policy.id && prior.conflictingPolicyVersionId === coverage.policyVersionId) {
      return { state: 'ready', alreadyRecorded: true };
    }
    await storage.savePolicyResolution({
      id: randomUUID(), projectId: allowed.issue.projectId, caseId: allowed.monthCase.id,
      frozenPolicyVersionId: allowed.monthCase.policy.id, conflictingPolicyVersionId: coverage.policyVersionId,
      reference, reason, actorAccountId: context.accountId, recordedAt: new Date().toISOString(),
    });
    return { state: 'ready' };
  } catch {
    return { state: 'error', message: 'Policy reconciliation could not be recorded.' };
  }
});

resolver.define('recordClaimAction', async ({ payload, context }) => {
  try {
    const allowed = await permittedCase(payload, context);
    if (!allowed || !context.accountId) return { state: 'no_access', message: 'You cannot access this case.' };
    if (!await userHasPermission(allowed.issue.projectId, 'ADMINISTER_PROJECTS')) {
      return { state: 'no_access', message: 'Project administrator review permission is required.' };
    }
    const events = await strongClaimEvents(allowed.issue.projectId, allowed.monthCase.id);
    if (events.length >= 200) return { state: 'error', message: 'Case history limit reached.' };
    const current = claimSnapshot(events);
    const kind = payload.kind as ClaimEvent['kind'];
    if (!['STATE', 'OWNER', 'SUPPORT_REF', 'CONFLICT_RESOLUTION'].includes(kind)) return { state: 'error', message: 'Unknown case action.' };
    if (current.conflicts.length && kind !== 'CONFLICT_RESOLUTION') return { state: 'error', message: 'Concurrent case actions need administrator reconciliation.' };
    const externalReference = typeof payload.externalReference === 'string' ? payload.externalReference.trim() : '';
    if (externalReference && !validReference(externalReference) && !(allowed.monthCase.simulated && validDemoReference(externalReference))) {
      return { state: 'error', message: 'Use an HTTPS link, Jira key, or a DEMO: reference in a simulated case.' };
    }
    const event: ClaimEvent = {
      id: randomUUID(), projectId: allowed.issue.projectId, caseId: allowed.monthCase.id,
      previousId: payload.expectedLastEventId === null ? null : typeof payload.expectedLastEventId === 'string' ? payload.expectedLastEventId : 'invalid',
      kind, ...(kind === 'STATE' ? { state: payload.nextState as ClaimEvent['state'] } : {}),
      ...(kind === 'OWNER' ? { ownerAccountId: context.accountId } : {}),
      ...(kind === 'CONFLICT_RESOLUTION' ? { resolvedEventIds: Array.isArray(payload.resolvedEventIds) ? payload.resolvedEventIds : [] } : {}),
      ...(externalReference ? { externalReference } : {}),
      reason: typeof payload.reason === 'string' ? payload.reason.trim() : '',
      actorAccountId: context.accountId, recordedAt: new Date().toISOString(),
    };
    const { assessment, completeness } = await loadAssessment(allowed.monthCase);
    validateClaimAction(current, event, submissionReadiness(assessment, completeness, current));
    await storage.saveClaimAction(event);
    const head = await storage.getClaimHead(allowed.issue.projectId, allowed.monthCase.id);
    if (head?.eventId !== event.id) return { state: 'error', message: 'A concurrent action won. Reload the case before continuing.' };
    const after = claimSnapshot([...events, event]);
    return { state: 'ready', claim: after };
  } catch (error) {
    return { state: 'error', message: error instanceof Error ? error.message : 'Case action could not be recorded.' };
  }
});

function demoId(kind: string, issueId: string): string {
  const hex = createHash('sha256').update(`creditclock-demo|${kind}|${issueId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

resolver.define('createOctoberDemoCase', async ({ payload, context }) => {
  try {
    const issue = await permittedIssue(payload, context);
    if (!issue || !context.accountId) return { state: 'no_access', message: 'You cannot access this issue.' };
    if (!await userHasPermission(issue.projectId, 'ADMINISTER_PROJECTS')) {
      return { state: 'no_access', message: 'Project administrator permission is required for demo fixtures.' };
    }
    const coverage = await storage.getCoverage(issue.projectId);
    if (!coverage?.simulated || !matches(coverage, issue)) {
      return { state: 'error', message: 'This demo fixture requires a matching simulated mapping.' };
    }
    const start = '2026-10-05T12:00:00.000Z';
    const end = '2026-10-05T13:00:00.000Z';
    if (Date.parse(end) > Date.now()) return { state: 'error', message: 'The October 2026 demo fixture is not available yet.' };
    const added = await addObservationToIssue({
      issue, coverage, start, end, reference: issue.key,
      accountId: context.accountId, simulated: true, id: demoId('observation', issue.id),
    });
    const monthCase = added.cases.find(item => item.period === '2026-10');
    if (!monthCase) return { state: 'error', message: 'The October demo case could not be created.' };
    const evidenceId = demoId('minute-evidence', issue.id);
    if (!await storage.getMinuteEvidence(issue.projectId, monthCase.id, evidenceId)) {
      await storage.saveMinuteEvidence({
        id: evidenceId, projectId: issue.projectId, caseId: monthCase.id, issueId: issue.id,
        coverageId: coverage.id, sourceType: 'CUSTOMER_LOGS', coveredExperience: 'browser',
        qualifyingRanges: [{ start, end }], reference: issue.key,
        authorAccountId: context.accountId, createdAt: new Date().toISOString(), simulated: true,
      });
    }
    return { state: 'ready', caseId: monthCase.id };
  } catch {
    return { state: 'error', message: 'October demo fixture could not be created.' };
  }
});

export const handler = resolver.getDefinitions();
