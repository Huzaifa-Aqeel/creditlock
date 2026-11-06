import type { MonthCase } from './discovery-domain';
import { completenessStillCurrent, conditionValue, latestByEvidence } from './evidence-domain';
import { evaluate } from './rules/evaluate';
import { caseCompletenessReviews, caseEvidence, caseEvidenceReviews, storage } from './storage';
import { recordAssessmentChange } from './assessment-audit';
import { POLICY, type Coverage } from './discovery-domain';
import type { PolicyResolution } from './storage';
import { monthBounds } from './rules/intervals';
import { validStoredPolicy, type PolicyRecord } from './policy-registry';

export function policyBinding(monthCase: MonthCase, coverage: Coverage | undefined, resolution: PolicyResolution | undefined, stored?: PolicyRecord) {
  const [monthStart, monthEnd] = monthBounds(monthCase.period);
  const legacyValid = monthCase.policy.id === POLICY.id && !monthCase.policy.definitionHash
    && Object.keys(POLICY).every(key => monthCase.policy[key as keyof typeof POLICY] === POLICY[key as keyof typeof POLICY]);
  const registeredValid = !!stored && (stored.status === 'ACTIVE' || stored.status === 'RETIRED') && validStoredPolicy(stored) && stored.definition.adapter === 'ATLASSIAN_PREMIUM_2026'
    && stored.definition.id === monthCase.policy.id && stored.definition.definitionHash === monthCase.policy.definitionHash
    && stored.definition.source.reference === monthCase.policy.sourceUrl && stored.definition.effectiveFrom === monthCase.policy.effectiveFrom;
  const frozenValid = (legacyValid || registeredValid)
    && monthStart >= Date.parse(`${monthCase.policy.effectiveFrom}T00:00:00.000Z`)
    && (!stored?.definition.effectiveTo || monthEnd <= Date.parse(`${stored.definition.effectiveTo}T00:00:00.000Z`));
  const current = coverage?.id === monthCase.coverageId ? coverage.policyVersionId : 'MAPPING_MISSING_OR_CHANGED';
  const conflict = current !== monthCase.policy.id;
  const resolved = conflict && coverage?.id === monthCase.coverageId && resolution?.frozenPolicyVersionId === monthCase.policy.id
    && resolution.conflictingPolicyVersionId === current;
  return {
    policyVersionId: frozenValid ? monthCase.policy.id : 'UNSUPPORTED_FROZEN_POLICY',
    policyExecutable: frozenValid,
    currentPolicyVersionId: resolved ? monthCase.policy.id : current,
    policyConflict: conflict ? current : null,
    policyReconciled: !!resolved,
  };
}

export async function loadAssessment(monthCase: MonthCase, nowUtc = new Date().toISOString()) {
  const [evidence, reviews, completeness, coverage, resolution, storedPolicy] = await Promise.all([
    caseEvidence(monthCase.projectId, monthCase.id),
    caseEvidenceReviews(monthCase.projectId, monthCase.id),
    caseCompletenessReviews(monthCase.projectId, monthCase.id),
    storage.getCoverage(monthCase.projectId),
    storage.getPolicyResolution(monthCase.projectId, monthCase.id),
    storage.getPolicy(monthCase.projectId, monthCase.policy.id),
  ]);
  if (evidence.length >= 200 || reviews.length >= 200 || completeness.length >= 200) {
    throw new Error('Case evidence limit reached; review the case before further assessment.');
  }
  const byEvidence = latestByEvidence(reviews);
  const latestCompleteness = [...completeness].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || b.id.localeCompare(a.id))[0];
  const evidenceSetComplete = completenessStillCurrent(latestCompleteness, evidence, reviews);
  const binding = policyBinding(monthCase, coverage, resolution, storedPolicy);
  const assessment = evaluate({
    period: monthCase.period,
    policyVersionId: binding.policyVersionId,
    policyExecutable: binding.policyExecutable,
    currentPolicyVersionId: binding.currentPolicyVersionId,
    product: 'Jira Service Management',
    plan: 'Premium',
    coveredExperience: 'browser',
    environment: latestCompleteness?.environment || 'UNKNOWN',
    coverageVerified: conditionValue(latestCompleteness?.conditions?.coverage),
    supportReported: conditionValue(latestCompleteness?.conditions?.support),
    billingEntitlement: conditionValue(latestCompleteness?.conditions?.billing),
    exclusionsCleared: conditionValue(latestCompleteness?.conditions?.exclusions),
    evidenceSetComplete,
    evidence: evidence.map(item => {
      const review = byEvidence.get(item.id);
      return {
        id: item.id,
        trust: review?.trust || 'UNVERIFIED',
        coveredExperience: item.coveredExperience,
        qualifyingRanges: item.qualifyingRanges,
        reviewerAccountId: review?.reviewerAccountId,
        reviewedAt: review?.reviewedAt,
        confirmedPolicyRule: review?.confirmedPolicyRule,
        vendorReference: item.vendorReference,
      };
    }),
    nowUtc,
  });
  try { await recordAssessmentChange(monthCase, assessment); } catch (error) { console.error('Assessment audit write failed', error); }
  return { assessment, evidence, reviews, completeness, policyConflict: binding.policyConflict, policyReconciled: binding.policyReconciled };
}
