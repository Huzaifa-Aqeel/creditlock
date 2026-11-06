import { createHash } from 'node:crypto';

export const POLICY = {
  id: 'ATLASSIAN_CLOUD_PREMIUM_2026_04_30',
  sourceUrl: 'https://www.atlassian.com/legal/sla',
  effectiveFrom: '2026-04-30',
  displayTitle: 'Atlassian Cloud Premium SLA (2026 reference)',
} as const;

export type FrozenPolicy = { id: string; sourceUrl: string; effectiveFrom: string; displayTitle: string; definitionHash?: string };

export type Coverage = {
  id: string;
  projectId: string;
  componentId: string;
  componentName: string;
  issueTypeId: string;
  issueTypeName: string;
  vendor: 'Atlassian';
  product: 'Jira Service Management';
  plan: 'Premium';
  accountOrSiteId: string;
  coveredExperience: 'browser';
  policyVersionId: string;
  simulated: boolean;
  configuredBy: string;
  configuredAt: string;
};

export type IssueSnapshot = {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  issueTypeId: string;
  componentIds: string[];
  summary?: string;
  createdAt?: string;
};

export type Lead = {
  id: string;
  projectId: string;
  issueId: string;
  issueKey: string;
  coverageId: string;
  state: 'MATCHED_UNDATED' | 'LINKED_TO_CASE';
  createdAt: string;
  simulated: boolean;
};

export type MonthCase = {
  id: string;
  projectId: string;
  coverageId: string;
  period: string;
  policy: FrozenPolicy;
  assessmentState: 'NEEDS_EVIDENCE';
  claimState: 'OPEN';
  createdAt: string;
  simulated: boolean;
};

export type Observation = {
  id: string;
  issueId: string;
  coverageId: string;
  observedStartUtc: string;
  observedEndUtc: string;
  reference: string;
  authorAccountId: string;
  createdAt: string;
  status: 'UNVERIFIED_CUSTOMER_OBSERVATION';
  simulated: boolean;
};

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function stableInputId(kind: 'observation' | 'minute-evidence', fields: string[]): string {
  const hex = createHash('sha256').update(JSON.stringify([kind, ...fields])).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function coverageId(projectId: string, accountOrSiteId: string): string {
  return shortHash(`coverage|${projectId}|atlassian|jira-service-management|premium|${accountOrSiteId.trim().toLowerCase()}`);
}

export function caseId(projectId: string, coverageIdValue: string, monthUtc: string): string {
  return shortHash(`case|${projectId}|${coverageIdValue}|${monthUtc}`);
}

export function matches(config: Coverage, issue: IssueSnapshot): boolean {
  return config.projectId === issue.projectId && config.issueTypeId === issue.issueTypeId && issue.componentIds.includes(config.componentId);
}

export function validateObservationRange(start: unknown, end: unknown, nowMs: number): { start: string; end: string } {
  if (typeof start !== 'string' || typeof end !== 'string') throw new Error('Enter both UTC start and end times.');
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (!pattern.test(start) || !pattern.test(end)) throw new Error('Use complete UTC timestamps.');
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || new Date(startMs).toISOString() !== start || new Date(endMs).toISOString() !== end) {
    throw new Error('Enter valid UTC dates.');
  }
  if (endMs <= startMs) throw new Error('The end must be after the start.');
  if (endMs > nowMs + 5 * 60_000) throw new Error('An observed interval cannot end in the future.');
  if (endMs - startMs > 366 * 24 * 60 * 60_000) throw new Error('Split observations longer than one year.');
  return { start, end };
}

export function monthsTouched(start: string, end: string): string[] {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error('Invalid interval.');
  const lastMoment = new Date(endMs - 1);
  const last = Date.UTC(lastMoment.getUTCFullYear(), lastMoment.getUTCMonth(), 1);
  const firstMoment = new Date(startMs);
  const months: string[] = [];
  for (let at = Date.UTC(firstMoment.getUTCFullYear(), firstMoment.getUTCMonth(), 1); at <= last; ) {
    const date = new Date(at);
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
    at = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
  return months;
}

export function validReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false;
  if (/^[A-Z][A-Z0-9_]*-\d+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
