import type { UtcInterval } from './rules/intervals';

export type EvidenceSource = 'CUSTOMER_LOGS' | 'VENDOR_SUPPORT' | 'PROVIDER_CONFIRMATION' | 'OTHER';
export type Experience = 'browser' | 'api' | 'mobile' | 'other';
export const CONDITION_KEYS = ['coverage', 'support', 'billing', 'exclusions', 'claimWindow'] as const;
export type ConditionKey = typeof CONDITION_KEYS[number];
export type ContractCheck = { status: 'UNKNOWN' | 'CONFIRMED' | 'FAILED'; reference?: string; dateUtc?: string };
export type ContractChecks = Record<ConditionKey, ContractCheck>;

export function conditionValue(check: ContractCheck | undefined): boolean | null {
  return check?.status === 'CONFIRMED' ? true : check?.status === 'FAILED' ? false : null;
}

export type MinuteEvidence = {
  id: string;
  projectId: string;
  caseId: string;
  issueId: string;
  coverageId: string;
  sourceType: EvidenceSource;
  coveredExperience: Experience;
  qualifyingRanges: UtcInterval[];
  reference: string;
  vendorReference?: string;
  authorAccountId: string;
  createdAt: string;
  simulated: boolean;
};

export type EvidenceReview = {
  id: string;
  projectId: string;
  caseId: string;
  evidenceId: string;
  trust: 'REVIEWED_CUSTOMER_EVIDENCE' | 'VENDOR_CONFIRMED' | 'UNVERIFIED';
  confirmedPolicyRule: boolean;
  reason: string;
  reviewerAccountId: string;
  reviewedAt: string;
};

export type CompletenessReview = {
  id: string;
  projectId: string;
  caseId: string;
  complete: boolean;
  environment: 'PRODUCTION' | 'TRIAL' | 'SANDBOX' | 'UNKNOWN';
  conditions?: ContractChecks;
  policyVersionId?: string;
  reason: string;
  reviewerAccountId: string;
  reviewedAt: string;
};

export function latestByEvidence(reviews: EvidenceReview[]): Map<string, EvidenceReview> {
  const latest = new Map<string, EvidenceReview>();
  for (const review of [...reviews].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id))) latest.set(review.evidenceId, review);
  return latest;
}

export function completenessStillCurrent(attestation: CompletenessReview | undefined, evidence: MinuteEvidence[], reviews: EvidenceReview[]): boolean {
  return !!attestation?.complete
    && !evidence.some(item => item.createdAt >= attestation.reviewedAt)
    && !reviews.some(item => item.reviewedAt >= attestation.reviewedAt);
}
