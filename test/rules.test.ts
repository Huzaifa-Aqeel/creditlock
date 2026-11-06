import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLICY } from '../src/backend/discovery-domain';
import { evaluate, type AssessmentInput, type ReviewedMinuteEvidence } from '../src/backend/rules/evaluate';
import { minutesInMonth, unionMinutesInMonth } from '../src/backend/rules/intervals';
import { completenessStillCurrent, type CompletenessReview, type MinuteEvidence } from '../src/backend/evidence-domain';

const at = (date: string) => `${date}:00.000Z`;
const range = (start: string, end: string) => ({ start: at(start), end: at(end) });
const reviewed = (ranges: ReturnType<typeof range>[]): ReviewedMinuteEvidence => ({
  id: 'e1', trust: 'REVIEWED_CUSTOMER_EVIDENCE', coveredExperience: 'browser',
  qualifyingRanges: ranges, reviewerAccountId: 'reviewer', reviewedAt: at('2026-12-01T12:00'), confirmedPolicyRule: true,
});
const base = (evidence: ReviewedMinuteEvidence[], complete = false): AssessmentInput => ({
  period: '2026-11', policyVersionId: POLICY.id, product: 'Jira Service Management', plan: 'Premium',
  coveredExperience: 'browser', environment: 'PRODUCTION', evidence, evidenceSetComplete: complete,
  nowUtc: at('2026-12-01T12:00'),
});

test('30-day Premium thresholds use exact minute fractions', () => {
  const sixty = evaluate(base([reviewed([range('2026-11-05T12:00', '2026-11-05T13:00')])]));
  assert.equal(sixty.totalMinutesInMonth, 43_200);
  assert.equal(sixty.candidateQualifyingMinutes, 60);
  assert.equal(sixty.uptimePercent, '99.861111');
  assert.equal(sixty.preliminaryCreditTierPercent, 10);
  assert.equal(evaluate(base([reviewed([range('2026-11-05T12:00', '2026-11-05T12:43')])], true)).state, 'NO_THRESHOLD_INDICATED');
  assert.equal(evaluate(base([reviewed([range('2026-11-05T12:00', '2026-11-05T12:44')])])).preliminaryCreditTierPercent, 10);
});

test('99% and 95% tier boundaries are strict', () => {
  const minutes = (count: number) => evaluate(base([reviewed([{
    start: at('2026-11-01T00:00'), end: new Date(Date.parse(at('2026-11-01T00:00')) + count * 60_000).toISOString(),
  }])], true)).preliminaryCreditTierPercent;
  assert.equal(minutes(432), 10);
  assert.equal(minutes(433), 25);
  assert.equal(minutes(2160), 25);
  assert.equal(minutes(2161), 50);
});

test('overlaps union; month boundary and leap February split correctly', () => {
  const intervals = [range('2026-11-05T12:00', '2026-11-05T12:30'), range('2026-11-05T12:15', '2026-11-05T13:00')];
  assert.equal(unionMinutesInMonth('2026-11', intervals), 60);
  const crossing = [range('2026-11-30T23:40', '2026-12-01T00:40')];
  assert.equal(unionMinutesInMonth('2026-11', crossing), 20);
  assert.equal(unionMinutesInMonth('2026-12', crossing), 40);
  assert.equal(minutesInMonth('2024-02'), 41_760);
  assert.equal(minutesInMonth('2025-02'), 40_320);
});

test('unreviewed observations and incomplete zero evidence cannot become no-threshold', () => {
  const unreviewed = reviewed([range('2026-11-05T12:00', '2026-11-05T13:30')]);
  unreviewed.trust = 'UNVERIFIED';
  assert.equal(evaluate(base([unreviewed])).state, 'NEEDS_EVIDENCE');
  assert.equal(evaluate(base([unreviewed])).preliminaryCreditTierPercent, undefined);
  assert.equal(evaluate(base([unreviewed], true)).state, 'NEEDS_EVIDENCE');
  assert.equal(evaluate(base([])).state, 'NEEDS_EVIDENCE');
  assert.equal(evaluate(base([], true)).state, 'NO_THRESHOLD_INDICATED');
});

test('a complete current month remains provisional', () => {
  const current = evaluate({ ...base([reviewed([range('2026-11-05T12:00', '2026-11-05T12:10')])], true), nowUtc: at('2026-11-06T12:00') });
  assert.equal(current.state, 'IN_PROGRESS_MONTH');
  assert.equal(current.candidateQualifyingMinutes, 10);
  assert.equal(current.uptimePercent, '99.976852');
  assert.equal(current.preliminaryCreditTierPercent, undefined);
});

test('closed 31-day October demo yields a preliminary 10% tier from 60 reviewed minutes', () => {
  const october = evaluate({
    ...base([reviewed([range('2026-10-05T12:00', '2026-10-05T13:00')])], true),
    period: '2026-10', nowUtc: at('2026-11-06T12:00'),
  });
  assert.equal(october.state, 'REVIEWABLE');
  assert.equal(october.totalMinutesInMonth, 44_640);
  assert.equal(october.candidateQualifyingMinutes, 60);
  assert.equal(october.uptimePercent, '99.865591');
  assert.equal(october.preliminaryCreditTierPercent, 10);
});

test('unsupported policy, experience and excluded site block calculation', () => {
  assert.equal(evaluate({ ...base([]), policyVersionId: 'UNKNOWN' }).state, 'NEEDS_POLICY');
  assert.equal(evaluate({ ...base([]), coveredExperience: 'api' }).state, 'ASSESSMENT_BLOCKED');
  assert.equal(evaluate({ ...base([]), environment: 'SANDBOX' }).state, 'ASSESSMENT_BLOCKED');
  assert.equal(evaluate({ ...base([]), environment: 'UNKNOWN' }).state, 'NEEDS_EVIDENCE');
  assert.equal(evaluate({ ...base([]), currentPolicyVersionId: 'CONFLICTING_VERSION' }).state, 'ASSESSMENT_BLOCKED');
  assert.equal(evaluate({ ...base([reviewed([range('2026-11-05T12:00', '2026-11-05T13:00')])]), exclusionsCleared: false }).state, 'ASSESSMENT_BLOCKED');
});

test('invalid or fractional minute ranges block assessment', () => {
  const bad = reviewed([{ start: '2026-11-05T12:00:30.000Z', end: at('2026-11-05T13:00') }]);
  assert.equal(evaluate(base([bad])).state, 'ASSESSMENT_BLOCKED');
  assert.throws(() => unionMinutesInMonth('2026-11', [range('2026-11-05T12:00', '2026-11-05T12:00')]));
});

test('a new assertion or review invalidates a prior completeness attestation', () => {
  const attestation: CompletenessReview = {
    id: 'c1', projectId: 'p', caseId: 'c', complete: true, environment: 'PRODUCTION',
    reason: 'Reviewed month', reviewerAccountId: 'r', reviewedAt: at('2026-12-01T12:00'),
  };
  assert.equal(completenessStillCurrent(attestation, [], []), true);
  const evidence: MinuteEvidence = {
    id: 'e1', projectId: 'p', caseId: 'c', issueId: 'i', coverageId: 'v', sourceType: 'CUSTOMER_LOGS',
    coveredExperience: 'browser', qualifyingRanges: [range('2026-11-05T12:00', '2026-11-05T12:01')],
    reference: 'CCDEMO-1', authorAccountId: 'a', createdAt: at('2026-12-01T12:01'), simulated: true,
  };
  assert.equal(completenessStillCurrent(attestation, [evidence], []), false);
});
