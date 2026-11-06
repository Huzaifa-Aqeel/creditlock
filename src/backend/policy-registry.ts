import { createHash, randomUUID } from 'node:crypto';
import { POLICY } from './discovery-domain';
import { storage } from './storage';
import { monthBounds } from './rules/intervals';

export const ATLASSIAN_FAMILY_TERMS = {
  period: 'UTC_CALENDAR_MONTH', downtime: 'PROVIDER_CONFIRMED_ERROR_RATE_OVER_5_PERCENT',
  threshold: { numerator: 999, denominator: 1000 },
  tiers: [{ below: 95, denominator: 100, creditPercent: 50 }, { below: 99, denominator: 100, creditPercent: 25 }, { below: 999, denominator: 1000, creditPercent: 10 }],
} as const;

export type PolicyStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'ACTIVE' | 'RETIRED';
export type PolicyDefinition = {
  id: string; projectId: string; version: string; title: string;
  vendor: string; product: string; plan: string; coveredExperience: string;
  adapter: 'ATLASSIAN_PREMIUM_2026' | 'UNSUPPORTED';
  terms?: typeof ATLASSIAN_FAMILY_TERMS;
  effectiveFrom: string; effectiveTo?: string;
  source: { kind: 'OFFICIAL_URL' | 'CUSTOMER_DOCUMENT'; reference: string; documentVersion?: string; retrievedAt?: string; contentHash?: string; clauses: string[] };
  createdBy: string; createdAt: string; definitionHash: string;
};
export type PolicyLifecycle = { id: string; projectId: string; policyId: string; from?: PolicyStatus; to: PolicyStatus; actor: string; at: string; reason: string; previousId?: string };
export type PolicyRecord = { definition: PolicyDefinition; status: PolicyStatus; lastEventId: string };
export function validStoredPolicy(record: PolicyRecord): boolean {
  const { definitionHash, ...content } = record.definition;
  if (hash(content) !== definitionHash) return false;
  const legacyBuiltIn = content.id === POLICY.id && content.adapter === 'ATLASSIAN_PREMIUM_2026' && !content.terms
    && content.source.reference === POLICY.sourceUrl && content.effectiveFrom === POLICY.effectiveFrom
    && content.vendor === 'Atlassian' && content.product === 'Jira Service Management' && content.plan === 'Premium' && content.coveredExperience === 'browser';
  return legacyBuiltIn || validateDefinition(content).length === 0;
}
export function policySnapshot(definition: PolicyDefinition) {
  return { id: definition.id, sourceUrl: definition.source.reference, effectiveFrom: definition.effectiveFrom, displayTitle: definition.title, definitionHash: definition.definitionHash };
}

const date = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateDefinition(input: Omit<PolicyDefinition, 'definitionHash'>): string[] {
  const errors: string[] = [];
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(input.id)) errors.push('Use a stable policy version ID.');
  if (!input.title.trim() || !input.version.trim() || !input.vendor.trim() || !input.product.trim() || !input.plan.trim() || !input.coveredExperience.trim()) errors.push('Identity and coverage fields are required.');
  if (!date(input.effectiveFrom) || input.effectiveTo && (!date(input.effectiveTo) || input.effectiveTo <= input.effectiveFrom)) errors.push('Enter a valid effective period.');
  if (!input.source.reference.trim() || !input.source.clauses.length || input.source.clauses.some(c => !c.trim())) errors.push('A source and clause references are required.');
  if (input.source.kind === 'OFFICIAL_URL') {
    try { const u = new URL(input.source.reference); if (u.protocol !== 'https:' || u.username || u.password) errors.push('Official sources require an HTTPS URL.'); }
    catch { errors.push('Official sources require an HTTPS URL.'); }
  }
  if (input.adapter === 'ATLASSIAN_PREMIUM_2026') {
    if (input.vendor !== 'Atlassian' || input.product !== 'Jira Service Management' || input.plan !== 'Premium' || input.coveredExperience !== 'browser' || JSON.stringify(input.terms) !== JSON.stringify(ATLASSIAN_FAMILY_TERMS)) errors.push('The proposed terms do not match the tested Atlassian Premium rule family.');
    if (!input.source.documentVersion || input.source.clauses.length < 6) errors.push('Supported policies require a source version and references for coverage, commitment, downtime, exclusions, credits, and submission.');
    if (input.source.kind === 'OFFICIAL_URL') {
      try { const host = new URL(input.source.reference).hostname; if (host !== 'atlassian.com' && !host.endsWith('.atlassian.com')) errors.push('The supported Atlassian family requires an Atlassian official URL or a hashed customer agreement.'); }
      catch { errors.push('The supported Atlassian family requires an Atlassian official URL or a hashed customer agreement.'); }
    }
  }
  if (input.source.kind === 'CUSTOMER_DOCUMENT' && !/^[a-fA-F0-9]{64}$/.test(input.source.contentHash || '')) errors.push('Customer documents require a SHA-256 content hash.');
  if (input.source.reference.length > 500 || input.source.clauses.some(c => c.length > 500) || input.title.length > 200 || input.version.length > 100) errors.push('Policy fields exceed storage limits.');
  return errors;
}
export function builtInPolicy(projectId: string): PolicyDefinition {
  const base = { id: POLICY.id, projectId, version: '2026-04-30', title: POLICY.displayTitle, vendor: 'Atlassian', product: 'Jira Service Management', plan: 'Premium', coveredExperience: 'browser', adapter: 'ATLASSIAN_PREMIUM_2026' as const, terms: ATLASSIAN_FAMILY_TERMS, effectiveFrom: POLICY.effectiveFrom,
    source: { kind: 'OFFICIAL_URL' as const, reference: POLICY.sourceUrl, documentVersion: POLICY.effectiveFrom, clauses: ['Appendix A: Jira Service Management Premium browser covered experiences', 'Section 1: Premium 99.9% service level commitment', 'Appendix B Definitions: Downtime Minute and Error Rate; Calculation: UTC month', 'Section 3: Exclusions', 'Appendix B: Premium Plan Service Credits', 'Section 2.1: Eligibility and 15-day claim window'] }, createdBy: 'CREDITCLOCK_BUILT_IN', createdAt: new Date().toISOString() };
  return { ...base, definitionHash: hash(base) };
}
export async function ensureBuiltInPolicy(projectId: string): Promise<PolicyRecord> {
  const control = await storage.ensurePolicyControl(projectId);
  const existing = await storage.getPolicy(projectId, POLICY.id);
  if (existing) return existing;
  const definition = builtInPolicy(projectId);
  const coverage = await storage.getCoverage(projectId);
  const status: PolicyStatus = coverage?.policyVersionId === POLICY.id ? 'ACTIVE' : 'APPROVED';
  const event: PolicyLifecycle = { id: randomUUID(), projectId, policyId: POLICY.id, to: status, actor: 'CREDITCLOCK_MIGRATION', at: new Date().toISOString(), reason: status === 'ACTIVE' ? 'Existing administrator-verified mapping migrated; approval history remains in mapping audit.' : 'Built-in verified template registered; administrator activation required.' };
  const record = { definition, status, lastEventId: event.id };
  try { await storage.savePolicyCreated(record, event, control); }
  catch (error) {
    const raced = await storage.getPolicy(projectId, POLICY.id);
    if (raced) return raced;
    throw error;
  }
  return (await storage.getPolicy(projectId, POLICY.id)) || record;
}
export type NewPolicyInput = { id: string; version: string; title: string; effectiveFrom: string; effectiveTo?: string; sourceKind?: 'OFFICIAL_URL' | 'CUSTOMER_DOCUMENT'; sourceReference: string; sourceVersion?: string; sourceHash?: string; clauseReferences?: string[]; clauseReference?: string; supportedTerms?: boolean; reason: string };
export async function createPolicy(projectId: string, actor: string, values: NewPolicyInput): Promise<PolicyRecord> {
  const supported = values.supportedTerms === true;
  const base = { id: values.id.trim(), projectId, version: values.version.trim(), title: values.title.trim(), vendor: 'Atlassian', product: 'Jira Service Management', plan: 'Premium', coveredExperience: 'browser', adapter: supported ? 'ATLASSIAN_PREMIUM_2026' as const : 'UNSUPPORTED' as const, ...(supported ? { terms: ATLASSIAN_FAMILY_TERMS } : {}), effectiveFrom: values.effectiveFrom, ...(values.effectiveTo ? { effectiveTo: values.effectiveTo } : {}), source: { kind: values.sourceKind || 'CUSTOMER_DOCUMENT', reference: values.sourceReference.trim(), ...(values.sourceVersion ? { documentVersion: values.sourceVersion.trim() } : {}), ...(values.sourceHash ? { contentHash: values.sourceHash.trim() } : {}), clauses: values.clauseReferences?.map(c => c.trim()) || [values.clauseReference?.trim() || ''] }, createdBy: actor, createdAt: new Date().toISOString() };
  const errors = validateDefinition(base);
  if (errors.length || values.reason.trim().length < 3) throw new Error(errors[0] || 'Add a reason.');
  if (await storage.getPolicy(projectId, base.id)) throw new Error('This policy version already exists; create a new version ID.');
  const control = await storage.ensurePolicyControl(projectId);
  const definition = { ...base, definitionHash: hash(base) };
  const event: PolicyLifecycle = { id: randomUUID(), projectId, policyId: base.id, to: 'DRAFT', actor, at: new Date().toISOString(), reason: values.reason.trim() };
  const record: PolicyRecord = { definition, status: 'DRAFT', lastEventId: event.id };
  try { await storage.savePolicyCreated(record, event, control); }
  catch { throw new Error('Policy registry changed concurrently. Refresh and retry.'); }
  return record;
}
export async function changePolicyStatus(projectId: string, id: string, actor: string, next: PolicyStatus, reason: string, expectedEventId: string): Promise<PolicyRecord> {
  const current = await storage.getPolicy(projectId, id);
  if (!current) throw new Error('Policy version not found.');
  if (current.lastEventId !== expectedEventId) throw new Error('Policy changed. Refresh and retry.');
  const allowed: Record<PolicyStatus, PolicyStatus[]> = { DRAFT: ['IN_REVIEW'], IN_REVIEW: ['APPROVED', 'DRAFT'], APPROVED: ['ACTIVE', 'RETIRED'], ACTIVE: ['RETIRED'], RETIRED: [] };
  if (!allowed[current.status].includes(next)) throw new Error('Invalid policy lifecycle transition.');
  if (reason.trim().length < 3 || reason.length > 500) throw new Error('Add a review reason.');
  if (!validStoredPolicy(current)) throw new Error('Policy definition failed integrity validation.');
  const control = await storage.ensurePolicyControl(projectId);
  if (current.status === 'ACTIVE' && control.activeId !== id) throw new Error('Active policy pointer conflicts with the lifecycle record; review the registry before changing it.');
  if (next === 'ACTIVE') {
    if (current.definition.adapter === 'UNSUPPORTED') throw new Error('Unsupported policy is tracking-only and cannot be activated.');
    const active = control.activeId === 'NONE' ? '' : control.activeId;
    if (active && active !== id) throw new Error(`Active policy ${active} conflicts. Retire it before activation.`);
  }
  const event: PolicyLifecycle = { id: randomUUID(), projectId, policyId: id, from: current.status, to: next, actor, at: new Date().toISOString(), reason: reason.trim(), previousId: current.lastEventId };
  const updated = { ...current, status: next, lastEventId: event.id };
  try { await storage.savePolicyTransition(updated, event, control, next === 'ACTIVE' ? id : current.status === 'ACTIVE' ? '' : undefined); }
  catch { throw new Error('Policy changed concurrently. Refresh and retry.'); }
  return updated;
}

export async function selectPolicyForPeriod(projectId: string, period: string): Promise<PolicyDefinition | null> {
  const control = await storage.ensurePolicyControl(projectId);
  const activeId = control.activeId === 'NONE' ? '' : control.activeId;
  const record = activeId ? await storage.getPolicy(projectId, activeId) : await ensureBuiltInPolicy(projectId);
  if (!record || record.status !== 'ACTIVE' || !validStoredPolicy(record) || record.definition.adapter !== 'ATLASSIAN_PREMIUM_2026') return null;
  const [start, end] = monthBounds(period);
  return start >= Date.parse(`${record.definition.effectiveFrom}T00:00:00.000Z`)
    && (!record.definition.effectiveTo || end <= Date.parse(`${record.definition.effectiveTo}T00:00:00.000Z`)) ? record.definition : null;
}
