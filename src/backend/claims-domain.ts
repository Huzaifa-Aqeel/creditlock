import type { Assessment } from './rules/evaluate';
import { monthBounds } from './rules/intervals';
import { CONDITION_KEYS, type CompletenessReview } from './evidence-domain';

export type ClaimState = 'OPEN' | 'UNDER_REVIEW' | 'DRAFT_READY' | 'SUBMITTED' | 'CREDITED' | 'REJECTED' | 'CLOSED';

export function validDemoReference(value: string): boolean {
  return /^DEMO:[A-Z0-9][A-Z0-9-]{2,79}$/.test(value);
}
export type ClaimEvent = {
  id: string;
  projectId: string;
  caseId: string;
  previousId: string | null;
  kind: 'STATE' | 'OWNER' | 'SUPPORT_REF' | 'CONFLICT_RESOLUTION';
  state?: ClaimState;
  ownerAccountId?: string;
  externalReference?: string;
  resolvedEventIds?: string[];
  reason: string;
  actorAccountId: string;
  recordedAt: string;
};

export type ClaimSnapshot = {
  state: ClaimState;
  ownerAccountId?: string;
  supportReference?: string;
  submittedReference?: string;
  vendorDecisionReference?: string;
  lastEventId: string | null;
  history: ClaimEvent[];
  conflicts: ClaimEvent[];
  resolvedConflicts: ClaimEvent[];
};

export type SubmissionReadiness = { ready: boolean; gaps: string[] };

export function submissionReadiness(assessment: Assessment, reviews: CompletenessReview[], claim: ClaimSnapshot): SubmissionReadiness {
  const latest = [...reviews].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || b.id.localeCompare(a.id))[0];
  const gaps: string[] = [];
  if (assessment.state !== 'REVIEWABLE') gaps.push('The closed-month assessment must be reviewable.');
  if (!assessment.evidenceSetComplete) gaps.push('Review and mark the qualifying-minute evidence set complete.');
  if (assessment.unresolvedEvidenceCount > 0) gaps.push('Review or exclude every unresolved minute assertion.');
  if (latest?.environment !== 'PRODUCTION') gaps.push('Confirm an eligible production site.');
  for (const key of CONDITION_KEYS) {
    const check = latest?.conditions?.[key];
    if (check?.status !== 'CONFIRMED' || !check.reference || key === 'claimWindow' && !check.dateUtc) gaps.push(`Confirm ${key} with a reference${key === 'claimWindow' ? ' and UTC deadline date' : ''}.`);
  }
  if (!claim.ownerAccountId) gaps.push('Assign a review owner.');
  if (!claim.supportReference) gaps.push('Record the external support reference.');
  return { ready: gaps.length === 0, gaps };
}

export function deadlineDateUtc(period: string): string {
  const [, end] = monthBounds(period);
  return new Date(end + 14 * 24 * 60 * 60_000).toISOString().slice(0, 10);
}

const transitions: Record<ClaimState, ClaimState[]> = {
  OPEN: ['UNDER_REVIEW', 'CLOSED'],
  UNDER_REVIEW: ['DRAFT_READY', 'CLOSED'],
  DRAFT_READY: ['UNDER_REVIEW', 'SUBMITTED', 'CLOSED'],
  SUBMITTED: ['CREDITED', 'REJECTED', 'CLOSED'],
  CREDITED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  CLOSED: ['UNDER_REVIEW'],
};

export function validateClaimAction(current: ClaimSnapshot, next: ClaimEvent, readiness: SubmissionReadiness): void {
  if (next.reason.trim().length < 3 || next.reason.length > 500) throw new Error('Add a review reason (3–500 characters).');
  if (next.previousId !== current.lastEventId) throw new Error('This case changed. Reload before recording an action.');
  if (next.kind === 'STATE') {
    if (!next.state || !transitions[current.state].includes(next.state)) throw new Error('This claim-state transition is not allowed.');
    if (['DRAFT_READY', 'SUBMITTED'].includes(next.state) && (!current.ownerAccountId || !current.supportReference)) throw new Error('Assign an owner and record the external support reference before this action.');
    if (['DRAFT_READY', 'SUBMITTED'].includes(next.state) && !readiness.ready) throw new Error(`Resolve claim-readiness gaps before this action: ${readiness.gaps.join(' ')}`);
    if (['SUBMITTED', 'CREDITED', 'REJECTED'].includes(next.state) && !next.externalReference) throw new Error('Record the external submission or vendor decision reference.');
  } else if (next.kind === 'OWNER') {
    if (!next.ownerAccountId) throw new Error('Select an accountable owner.');
  } else if (next.kind === 'SUPPORT_REF') {
    if (!next.externalReference) throw new Error('Enter the Atlassian support reference.');
  } else if (next.kind === 'CONFLICT_RESOLUTION') {
    const expected = current.conflicts.map(item => item.id).sort();
    const supplied = [...(next.resolvedEventIds || [])].sort();
    if (!expected.length || JSON.stringify(expected) !== JSON.stringify(supplied)) throw new Error('Concurrent actions changed. Reload before resolving them.');
  }
}

export function claimSnapshot(events: ClaimEvent[]): ClaimSnapshot {
  const sorted = [...events].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
  const snapshot: ClaimSnapshot = { state: 'OPEN', lastEventId: null, history: [], conflicts: [], resolvedConflicts: [] };
  const remaining = [...sorted];
  const resolvedIds = new Set<string>();
  while (remaining.length) {
    const nextIndex = remaining.findIndex(item => item.previousId === snapshot.lastEventId);
    if (nextIndex < 0) break;
    const [item] = remaining.splice(nextIndex, 1);
    snapshot.history.push(item);
    snapshot.lastEventId = item.id;
    if (item.kind === 'OWNER') snapshot.ownerAccountId = item.ownerAccountId;
    if (item.kind === 'SUPPORT_REF') snapshot.supportReference = item.externalReference;
    if (item.kind === 'CONFLICT_RESOLUTION') for (const id of item.resolvedEventIds || []) resolvedIds.add(id);
    if (item.kind === 'STATE' && item.state) {
      snapshot.state = item.state;
      if (item.state === 'SUBMITTED') snapshot.submittedReference = item.externalReference;
      if (item.state === 'CREDITED' || item.state === 'REJECTED') snapshot.vendorDecisionReference = item.externalReference;
    }
  }
  snapshot.conflicts = remaining.filter(item => !resolvedIds.has(item.id));
  snapshot.resolvedConflicts = remaining.filter(item => resolvedIds.has(item.id));
  return snapshot;
}

export function deadlineMilestone(deadline: string, today: string): 'SEVEN_DAYS' | 'THREE_DAYS' | 'ONE_DAY' | 'DUE_TODAY' | 'OVERDUE' | null {
  const due = Date.parse(`${deadline}T00:00:00.000Z`);
  const now = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(due) || !Number.isFinite(now)) throw new Error('Invalid deadline date.');
  const days = Math.round((due - now) / 86_400_000);
  if (days < 0) return 'OVERDUE';
  if (days === 0) return 'DUE_TODAY';
  if (days <= 1) return 'ONE_DAY';
  if (days <= 3) return 'THREE_DAYS';
  if (days <= 7) return 'SEVEN_DAYS';
  return null;
}

export function claimDraft(input: {
  caseId: string; period: string; accountOrSiteId: string; sourceKeys: string[];
  assessment: Assessment; policyUrl: string; supportReference?: string; ownerAccountId?: string;
  policyVersionId?: string; policyEffectiveFrom?: string; coveredExperience?: string;
  sourceDetails?: Array<{ key: string; summary?: string; createdAt?: string }>;
  minuteEvidence?: Array<{ start: string; end: string; reference: string; trust: string }>;
  evidenceReferences?: Array<{ reference: string; trust: string }>;
  observations?: Array<{ start: string; end: string; reference: string }>;
  contractChecks?: string[];
  confirmedDeadline?: { dateUtc: string; reference: string } | null;
  simulated: boolean;
}): string {
  const lines = [
    input.simulated ? 'DEMO / SIMULATED — fictional claim preparation; do not submit' : 'PRELIMINARY CLAIM DRAFT — human review required before external submission',
    `Case: ${input.caseId}`,
    `Service: Jira Service Management Premium · ${input.accountOrSiteId}`,
    `UTC month: ${input.period}`,
    `Source issues: ${input.sourceKeys.join(', ') || 'none'}`,
    `Jira incident summaries (customer-reported, not proof of vendor downtime): ${input.sourceDetails?.map(item => `${item.key}: ${item.summary || 'summary unavailable'}${item.createdAt ? ` · issue created ${item.createdAt}` : ''}`).join('; ') || 'none available'}`,
    `Covered experience: ${input.coveredExperience || 'not verified'}`,
    `Customer-observed intervals (unverified as qualifying downtime): ${input.observations?.map(item => `${item.start} to ${item.end} · ${item.reference}`).join('; ') || 'none recorded'}`,
    `Potential qualifying-minute intervals (human-classified evidence, not vendor award): ${input.minuteEvidence?.map(item => `${item.start} to ${item.end} · ${item.reference} (${item.trust.replaceAll('_', ' ').toLowerCase()})`).join('; ') || 'none recorded'}`,
    `Evidence references: ${input.evidenceReferences?.map(item => `${item.reference} (${item.trust.replaceAll('_', ' ').toLowerCase()})`).join('; ') || 'none recorded'}`,
    `Contract checks: ${input.contractChecks?.join('; ') || 'not reviewed'}`,
    `Policy: ${input.policyVersionId || input.assessment.assessedPolicyVersion} · effective ${input.policyEffectiveFrom || 'verify'} · ${input.policyUrl}`,
    `${input.confirmedDeadline ? 'Confirmed contractual deadline' : 'Potential claim submission deadline'}: ${input.confirmedDeadline?.dateUtc || deadlineDateUtc(input.period)} (date only; confirm applicable time cutoff)${input.confirmedDeadline ? ` · source ${input.confirmedDeadline.reference}` : ''}`,
    `Assessment: ${input.assessment.state.replaceAll('_', ' ')}`,
    `Reviewed candidate downtime minutes: ${input.assessment.candidateQualifyingMinutes ?? 'unknown'}`,
    `UTC month denominator: ${input.assessment.totalMinutesInMonth} minutes`,
    `Preliminary uptime: ${input.assessment.uptimePercent ? `${input.assessment.uptimePercent}%` : 'unknown'}`,
    `Potential credit tier: ${input.assessment.preliminaryCreditTierPercent ? `${input.assessment.preliminaryCreditTierPercent}%` : input.assessment.state === 'NO_THRESHOLD_INDICATED' ? 'no threshold indicated by the reviewed complete set' : 'not calculated'}`,
    `Atlassian support reference: ${input.supportReference || 'missing'}`,
    `Responsible reviewer: ${input.ownerAccountId || 'unassigned'}`,
    `Open checks: ${input.assessment.reasons.join(' ') || 'none recorded'}`,
    'Atlassian monitoring and its contractual determination govern any service credit. No vendor submission has been made by CreditClock.',
  ];
  return lines.join('\n');
}
