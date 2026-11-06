import { POLICY } from '../discovery-domain';
import { minutesInMonth, monthBounds, unionMinutesInMonth, type UtcInterval } from './intervals';
import { ATLASSIAN_PREMIUM_2026 } from './atlassian-2026';

export type ReviewedMinuteEvidence = {
  id: string;
  trust: 'UNVERIFIED' | 'REVIEWED_CUSTOMER_EVIDENCE' | 'VENDOR_CONFIRMED';
  coveredExperience: 'browser' | 'api' | 'mobile' | 'other';
  qualifyingRanges: UtcInterval[];
  reviewerAccountId?: string;
  reviewedAt?: string;
  confirmedPolicyRule?: boolean;
  vendorReference?: string;
  superseded?: boolean;
};

export type AssessmentInput = {
  period: string;
  policyVersionId: string;
  policyExecutable?: boolean;
  currentPolicyVersionId?: string;
  product: string;
  plan: string;
  coveredExperience: string;
  environment: 'PRODUCTION' | 'TRIAL' | 'SANDBOX' | 'UNKNOWN';
  coverageVerified?: boolean | null;
  supportReported?: boolean | null;
  billingEntitlement?: boolean | null;
  exclusionsCleared?: boolean | null;
  evidence: ReviewedMinuteEvidence[];
  evidenceSetComplete: boolean;
  nowUtc: string;
};

export type Assessment = {
  state: 'NEEDS_POLICY' | 'NEEDS_EVIDENCE' | 'IN_PROGRESS_MONTH' | 'REVIEWABLE' | 'NO_THRESHOLD_INDICATED' | 'ASSESSMENT_BLOCKED';
  reasons: string[];
  totalMinutesInMonth: number;
  candidateQualifyingMinutes?: number;
  uptimePercent?: string;
  preliminaryCreditTierPercent?: 10 | 25 | 50;
  evidenceIds: string[];
  evidenceSetComplete: boolean;
  assessedPolicyVersion: string;
  unresolvedEvidenceCount: number;
};

export function evaluate(input: AssessmentInput): Assessment {
  const totalMinutesInMonth = minutesInMonth(input.period);
  const base: Assessment = {
    state: 'NEEDS_EVIDENCE', reasons: [], totalMinutesInMonth,
    evidenceIds: [], evidenceSetComplete: input.evidenceSetComplete,
    assessedPolicyVersion: input.policyVersionId,
    unresolvedEvidenceCount: 0,
  };
  if (!(input.policyExecutable ?? input.policyVersionId === POLICY.id) || input.product !== ATLASSIAN_PREMIUM_2026.product || input.plan !== ATLASSIAN_PREMIUM_2026.plan) {
    return { ...base, state: 'NEEDS_POLICY', reasons: ['Verify an implemented, applicable policy version for this product and plan.'] };
  }
  if (input.currentPolicyVersionId && input.currentPolicyVersionId !== input.policyVersionId) {
    return { ...base, state: 'ASSESSMENT_BLOCKED', reasons: ['The current mapping conflicts with this case’s frozen policy version; reconcile it before calculation.'] };
  }
  if (input.coveredExperience !== 'browser') {
    return { ...base, state: 'ASSESSMENT_BLOCKED', reasons: ['This experience is outside the configured browser coverage.'] };
  }
  if (input.environment === 'TRIAL' || input.environment === 'SANDBOX') {
    return { ...base, state: 'ASSESSMENT_BLOCKED', reasons: ['Trial or sandbox service is excluded from this preliminary assessment.'] };
  }
  if (input.environment !== 'PRODUCTION') {
    return { ...base, reasons: ['Confirm that the affected site is an eligible production service.'] };
  }
  if ([input.coverageVerified, input.supportReported, input.billingEntitlement, input.exclusionsCleared].some(value => value === false)) {
    return { ...base, state: 'ASSESSMENT_BLOCKED', reasons: ['A required coverage, support, billing, or exclusion condition was marked unmet; review before calculation.'] };
  }
  if (input.coverageVerified !== true) base.reasons.push('Verify the applicable product, plan, experience, and contract version.');
  if (input.supportReported !== true) base.reasons.push('Confirm a timely Atlassian support report and retain its reference.');
  if (input.billingEntitlement !== true) base.reasons.push('Confirm billing entitlement and account standing.');
  if (input.exclusionsCleared !== true) base.reasons.push('Review contractual exclusions and the provider monitoring record.');
  const reviewed = input.evidence.filter(item => !item.superseded && item.trust !== 'UNVERIFIED' && !!item.reviewerAccountId && !!item.reviewedAt && item.confirmedPolicyRule === true && item.coveredExperience === 'browser' && (item.trust !== 'VENDOR_CONFIRMED' || !!item.vendorReference));
  const unresolvedEvidenceCount = input.evidence.filter(item => !item.superseded && item.qualifyingRanges.length && !reviewed.includes(item)).length;
  base.unresolvedEvidenceCount = unresolvedEvidenceCount;
  if (unresolvedEvidenceCount > 0) {
    base.reasons.push('Review or exclude unverified qualifying-minute assertions.');
  }
  const intervals = reviewed.flatMap(item => item.qualifyingRanges);
  let candidateQualifyingMinutes: number;
  try {
    candidateQualifyingMinutes = unionMinutesInMonth(input.period, intervals);
  } catch {
    return { ...base, state: 'ASSESSMENT_BLOCKED', reasons: ['Correct invalid qualifying-minute ranges before assessment.'] };
  }
  if (!input.evidenceSetComplete && candidateQualifyingMinutes === 0) {
    return { ...base, reasons: [...base.reasons, 'Add reviewed qualifying-minute evidence or attest the complete evidence set.'] };
  }
  const uptimeNumerator = totalMinutesInMonth - candidateQualifyingMinutes;
  const uptimePercent = ((uptimeNumerator / totalMinutesInMonth) * 100).toFixed(6);
  const common = {
    ...base, candidateQualifyingMinutes, uptimePercent,
    evidenceIds: reviewed.map(item => item.id),
  };
  const [, monthEnd] = monthBounds(input.period);
  if (Date.parse(input.nowUtc) < monthEnd) {
    return { ...common, state: 'IN_PROGRESS_MONTH', reasons: [...base.reasons, 'The UTC month is still in progress; figures are provisional.'] };
  }
  const tier = ATLASSIAN_PREMIUM_2026.tiers.find(item => uptimeNumerator * item.uptimeDenominator < totalMinutesInMonth * item.uptimeBelowNumerator);
  if (tier) {
    return { ...common, state: 'REVIEWABLE', preliminaryCreditTierPercent: tier.creditPercent, reasons: [...base.reasons, 'Atlassian monitoring and contractual conditions require human review.'] };
  }
  if (!input.evidenceSetComplete || unresolvedEvidenceCount > 0) {
    return { ...common, state: 'NEEDS_EVIDENCE', reasons: [...base.reasons, 'Attest that the month’s qualifying-minute evidence set is complete before a no-threshold conclusion.'] };
  }
  return { ...common, state: 'NO_THRESHOLD_INDICATED', reasons: ['No threshold is indicated by the reviewed, complete candidate evidence set.'] };
}
