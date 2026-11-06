import { claimSnapshot, deadlineMilestone, type ClaimEvent } from './claims-domain';
import type { MonthCase } from './discovery-domain';
import { allByPrefix, caseCompletenessReviews, strongClaimEvents, storage, type DeadlineFlag } from './storage';
import type { CompletenessReview } from './evidence-domain';
import { monthBounds } from './rules/intervals';

export type ConfirmedDeadline = { dateUtc: string; reference: string; reviewerAccountId: string; reviewedAt: string; policyVersionId: string };

export function confirmedDeadline(monthCase: MonthCase, reviews: CompletenessReview[]): ConfirmedDeadline | null {
  const latest = [...reviews].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || b.id.localeCompare(a.id))[0];
  const window = latest?.conditions?.claimWindow;
  const date = window?.dateUtc;
  if (latest?.environment !== 'PRODUCTION' || latest.policyVersionId !== monthCase.policy.id
    || latest.conditions?.coverage.status !== 'CONFIRMED' || !latest.conditions.coverage.reference
    || window?.status !== 'CONFIRMED' || !window.reference || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = Date.parse(`${date}T00:00:00.000Z`);
  const [, monthEnd] = monthBounds(monthCase.period);
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== date || at < monthEnd || at > monthEnd + 366 * 86_400_000) return null;
  return { dateUtc: date, reference: window.reference, reviewerAccountId: latest.reviewerAccountId,
    reviewedAt: latest.reviewedAt, policyVersionId: latest.policyVersionId };
}

export type DeadlineRepo = {
  cases: () => Promise<MonthCase[]>;
  events: (projectId: string, caseId: string) => Promise<ClaimEvent[]>;
  deadline: (monthCase: MonthCase) => Promise<ConfirmedDeadline | null>;
  getFlag: (projectId: string, caseId: string, deadlineDateUtc: string, milestone: string) => Promise<DeadlineFlag | undefined>;
  saveFlag: (flag: DeadlineFlag) => Promise<unknown>;
};

const defaultRepo: DeadlineRepo = {
  cases: () => allByPrefix<MonthCase>('case:', 200),
  events: strongClaimEvents,
  deadline: async monthCase => confirmedDeadline(monthCase, await caseCompletenessReviews(monthCase.projectId, monthCase.id)),
  getFlag: storage.getDeadlineFlag,
  saveFlag: storage.saveDeadlineFlag,
};

export async function scanDeadlines(today = new Date().toISOString().slice(0, 10), repo: DeadlineRepo = defaultRepo): Promise<number> {
  const cases = await repo.cases();
  if (cases.length >= 200) throw new Error('Deadline scan case limit reached.');
  let created = 0;
  for (const monthCase of cases) {
    const claim = claimSnapshot(await repo.events(monthCase.projectId, monthCase.id));
    if (!claim.ownerAccountId || !['OPEN', 'UNDER_REVIEW', 'DRAFT_READY'].includes(claim.state) || claim.conflicts.length) continue;
    const confirmed = await repo.deadline(monthCase);
    if (!confirmed) continue;
    const milestone = deadlineMilestone(confirmed.dateUtc, today);
    if (!milestone || await repo.getFlag(monthCase.projectId, monthCase.id, confirmed.dateUtc, milestone)) continue;
    await repo.saveFlag({
      projectId: monthCase.projectId, caseId: monthCase.id, milestone,
      deadlineDateUtc: confirmed.dateUtc, deadlineReference: confirmed.reference, ownerAccountId: claim.ownerAccountId,
      createdAt: new Date().toISOString(), simulated: monthCase.simulated,
    });
    created++;
  }
  return created;
}

export async function onDailyDeadlineScan(): Promise<void> {
  await scanDeadlines();
}
