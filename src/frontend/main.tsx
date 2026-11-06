import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, router, view } from '@forge/bridge';
import './style.css';

type Choice = { id: string; name: string };
type ConditionKey = 'coverage' | 'support' | 'billing' | 'exclusions' | 'claimWindow';
type ContractCheck = { status: 'UNKNOWN' | 'CONFIRMED' | 'FAILED'; reference: string; dateUtc?: string };
const conditionLabels: Record<ConditionKey, string> = {
  coverage: 'Product, plan, experience, and contract version', support: 'Timely Atlassian support report',
  billing: 'Billing entitlement and account standing', exclusions: 'Contractual exclusions assessed',
  claimWindow: 'Applicable claim submission window',
};
const emptyChecks = (): Record<ConditionKey, ContractCheck> => ({
  coverage: { status: 'UNKNOWN', reference: '' }, support: { status: 'UNKNOWN', reference: '' },
  billing: { status: 'UNKNOWN', reference: '' }, exclusions: { status: 'UNKNOWN', reference: '' },
  claimWindow: { status: 'UNKNOWN', reference: '' },
});
type Coverage = { id: string; componentId: string; componentName: string; issueTypeId: string; issueTypeName: string; accountOrSiteId: string; simulated: boolean; policyVersionId: string; product: string };
type MonthCase = { id: string; period: string; assessmentState: string; claimState: string; simulated: boolean; issueKeys?: string[]; ownerAccountId?: string; deadlineDateUtc?: string; deadlineConfirmed?: boolean; notices?: string[] };
type PolicyRecord = { definition: { id: string; title: string; version: string; effectiveFrom: string; effectiveTo?: string; adapter: string; source: { reference: string; clauses: string[] } }; status: string; lastEventId: string };
type Setup =
  | { state: 'ready'; project: { id: string; key: string; name: string }; canConfigure: boolean; coverage?: Coverage; choices: { components: Choice[]; issueTypes: Choice[] }; coverageHistory: Array<{ id: string; previous?: Coverage; current: Coverage; actorAccountId: string; recordedAt: string; reason: string }>; policy: { id: string; sourceUrl: string; effectiveFrom: string; displayTitle: string }; policyRecords: PolicyRecord[] }
  | { state: 'no_access' | 'error'; message: string };
type Discovery =
  | { state: 'ready'; issue: { id: string; key: string }; coverage?: Coverage; lead?: { state: string }; cases: MonthCase[]; canAddObservation?: boolean; canCreateDemo?: boolean }
  | { state: 'no_access' | 'error'; message: string };
type CaseList = { state: 'ready'; cases: MonthCase[] } | { state: 'no_access' | 'error'; message: string };
type ActionResult = { state: 'ready' | 'no_access' | 'error'; message?: string };
type AssessmentView = {
  state: 'ready'; caseId: string; canReview: boolean; canContribute: boolean;
  assessment: { state: string; reasons: string[]; totalMinutesInMonth: number; candidateQualifyingMinutes?: number; uptimePercent?: string; preliminaryCreditTierPercent?: number; evidenceSetComplete: boolean };
  evidence: Array<{ id: string; sourceType: string; coveredExperience: string; qualifyingRanges: Array<{ start: string; end: string }>; reference: string; vendorReference?: string; authorAccountId: string; createdAt: string; simulated: boolean }>;
  reviews: Array<{ id: string; evidenceId: string; trust: string; reason: string; reviewerAccountId: string; reviewedAt: string }>;
  completeness: Array<{ id: string; complete: boolean; environment: string; conditions?: Record<ConditionKey, ContractCheck>; reason: string; reviewerAccountId: string; reviewedAt: string }>;
} | { state: 'no_access' | 'error'; message: string };
type WorkflowView = {
  state: 'ready'; caseId: string; period: string; deadlineDateUtc: string; confirmedDeadline: { dateUtc: string; reference: string; reviewerAccountId: string; reviewedAt: string; policyVersionId: string } | null; sourceKeys: string[];
  policy: { id: string; sourceUrl: string; effectiveFrom: string };
  assessment: { state: string; preliminaryCreditTierPercent?: number; reasons: string[]; candidateQualifyingMinutes?: number; totalMinutesInMonth: number; uptimePercent?: string; evidenceSetComplete: boolean };
  sourceDetails: Array<{ key: string; summary?: string; createdAt?: string }>;
  observations: Array<{ observedStartUtc: string; observedEndUtc: string; reference: string }>;
  minuteEvidence: Array<{ id: string; reference: string; coveredExperience: string; trust: string; qualifyingRanges: Array<{ start: string; end: string }> }>;
  readiness: { ready: boolean; gaps: string[] };
  claim: { state: string; ownerAccountId?: string; supportReference?: string; submittedReference?: string; vendorDecisionReference?: string; lastEventId: string | null; history: Array<{ id: string; kind: string; state?: string; reason: string; externalReference?: string; actorAccountId: string; recordedAt: string }>; conflicts: Array<{ id: string; kind: string; state?: string; actorAccountId: string; recordedAt: string; reason: string }>; resolvedConflicts: Array<{ id: string; kind: string; state?: string; actorAccountId: string; recordedAt: string; reason: string }> };
  assessmentHistory: Array<{ id: string; previousState?: string; currentState: string; actor: 'SYSTEM'; recordedAt: string; summary: string }>;
  policyHistory: Array<{ id: string; frozenPolicyVersionId: string; conflictingPolicyVersionId: string; reference: string; reason: string; actorAccountId: string; recordedAt: string }>;
  policyConflict: string | null; policyReconciled: boolean;
  flags: Array<{ milestone: string; createdAt: string; deadlineDateUtc: string }>;
  draft: string; canManage: boolean; simulated: boolean;
} | { state: 'no_access' | 'error'; message: string };
type Screen =
  | { kind: 'loading' }
  | { kind: 'project'; projectId: string; setup: Setup; cases: CaseList }
  | { kind: 'issue'; issueId: string; discovery: Discovery }
  | { kind: 'error'; message: string };

function responseBody<T extends object>(response: T | { body: T }): T {
  return 'body' in response ? response.body : response;
}
async function call<T extends object>(name: string, payload: object): Promise<T> {
  return responseBody(await invoke<T>(name, payload));
}

function CaseAssessmentCard({ issueId, monthCase }: { issueId: string; monthCase: MonthCase }) {
  const [data, setData] = useState<AssessmentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reference, setReference] = useState('');
  const [vendorReference, setVendorReference] = useState('');
  const [sourceType, setSourceType] = useState('CUSTOMER_LOGS');
  const [experience, setExperience] = useState('browser');
  const [reviewReason, setReviewReason] = useState('Reviewed supporting minute evidence');
  const [confirmedPolicyRule, setConfirmedPolicyRule] = useState(false);
  const [attestationReason, setAttestationReason] = useState('Reviewed month evidence set');
  const [environment, setEnvironment] = useState('UNKNOWN');
  const [complete, setComplete] = useState(false);
  const [checks, setChecks] = useState(emptyChecks);

  async function refresh() {
    const result = await call<AssessmentView>('getCaseAssessment', { issueId, caseId: monthCase.id });
    setData(result);
    if (result.state === 'ready') {
      const saved = [...result.completeness].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || b.id.localeCompare(a.id))[0];
      if (saved) {
        setEnvironment(saved.environment); setComplete(saved.complete);
        setChecks(saved.conditions ? Object.fromEntries((Object.keys(conditionLabels) as ConditionKey[]).map(key => [key, { status: saved.conditions?.[key]?.status || 'UNKNOWN', reference: saved.conditions?.[key]?.reference || '', dateUtc: saved.conditions?.[key]?.dateUtc || '' }])) as Record<ConditionKey, ContractCheck> : emptyChecks());
      }
    }
  }
  useEffect(() => { void refresh().catch(() => setData({ state: 'error', message: 'Case assessment could not be loaded.' })); }, [issueId, monthCase.id]);
  async function action(name: string, payload: object, success: string) {
    setBusy(true); setNotice('');
    try {
      const result = await call<ActionResult>(name, { issueId, caseId: monthCase.id, ...payload });
      setNotice(result.state === 'ready' ? success : result.message || 'Action failed.');
      if (result.state === 'ready') {
        await refresh();
      }
    } catch { setNotice('Action failed. Try again.'); }
    finally { setBusy(false); }
  }
  if (!data) return <section className="card"><p>Loading case assessment…</p></section>;
  if (data.state !== 'ready') return <section className="card"><p role="alert">{data.message}</p></section>;
  const current = new Map([...data.reviews].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id)).map(item => [item.evidenceId, item]));
  const latestAttestation = [...data.completeness].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || b.id.localeCompare(a.id))[0];
  return <section className="card">
    <h2>{monthCase.period} UTC · Case evidence</h2>
    <p><strong>{data.assessment.state.replaceAll('_', ' ')}</strong>{monthCase.simulated && <span className="demo">DEMO / SIMULATED</span>}</p>
    <p className="muted">{data.assessment.reasons.join(' ')}</p>
    {latestAttestation && <p className="muted">Recorded site status: {latestAttestation.environment.replaceAll('_', ' ').toLowerCase()} · Evidence set {latestAttestation.complete ? 'marked complete' : 'not marked complete'} · {latestAttestation.reviewedAt}</p>}
    {latestAttestation && <ul className="caseList">{(Object.keys(conditionLabels) as ConditionKey[]).map(key => <li key={key}><strong>{conditionLabels[key]}:</strong> {latestAttestation.conditions?.[key]?.status?.toLowerCase() || 'unknown'}{latestAttestation.conditions?.[key]?.reference ? ` · ${latestAttestation.conditions[key].reference}` : ''}</li>)}</ul>}
    {data.assessment.candidateQualifyingMinutes !== undefined && <p>Reviewed candidate minutes: {data.assessment.candidateQualifyingMinutes} / {data.assessment.totalMinutesInMonth} · preliminary uptime {data.assessment.uptimePercent}%{data.assessment.preliminaryCreditTierPercent ? ` · potential ${data.assessment.preliminaryCreditTierPercent}% credit tier` : ''}</p>}
    <p className="muted">Customer observations and unreviewed assertions do not enter this calculation. Atlassian monitoring and contract review remain decisive.</p>
    {data.evidence.length ? <ul className="caseList">{data.evidence.map(item => <li key={item.id}>
      <strong>{item.sourceType.replaceAll('_', ' ')}</strong> · {item.coveredExperience} · {current.get(item.id)?.trust.replaceAll('_', ' ') || 'UNVERIFIED'}<br />
      <span className="muted">{item.qualifyingRanges[0]?.start} to {item.qualifyingRanges[0]?.end} · {item.reference}<br />Submitted by {item.authorAccountId} · {item.createdAt}</span>
      {data.canReview && <div className="reviewActions"><button disabled={busy || !confirmedPolicyRule} onClick={() => void action('reviewMinuteEvidence', { evidenceId: item.id, trust: 'REVIEWED_CUSTOMER_EVIDENCE', reason: reviewReason, confirmedPolicyRule }, 'Customer evidence review recorded.')}>Review customer evidence</button>{item.vendorReference && <button disabled={busy || !confirmedPolicyRule} onClick={() => void action('reviewMinuteEvidence', { evidenceId: item.id, trust: 'VENDOR_CONFIRMED', reason: reviewReason, confirmedPolicyRule }, 'Vendor-confirmed evidence review recorded.')}>Mark vendor confirmed</button>}<button disabled={busy} onClick={() => void action('reviewMinuteEvidence', { evidenceId: item.id, trust: 'UNVERIFIED', reason: reviewReason }, 'Evidence marked unverified.')}>Mark unverified</button></div>}
    </li>)}</ul> : <p className="muted">No qualifying-minute assertions yet.</p>}
    {data.canContribute && <><h3>Add candidate minute evidence</h3>
      <p className="muted">Enter only a range supported by the reference. The form does not turn observed outage time into qualifying minutes.</p>
      <label>Minute start (UTC)<input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>Minute end (UTC)<input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></label>
      <label>Source type<select value={sourceType} onChange={event => setSourceType(event.target.value)}><option value="CUSTOMER_LOGS">Customer logs</option><option value="VENDOR_SUPPORT">Vendor support</option><option value="PROVIDER_CONFIRMATION">Provider confirmation</option><option value="OTHER">Other</option></select></label>
      <label>Experience<select value={experience} onChange={event => setExperience(event.target.value)}><option value="browser">Browser</option><option value="api">API</option><option value="mobile">Mobile</option><option value="other">Other</option></select></label>
      <label>Evidence HTTPS link or Jira key<input value={reference} onChange={event => setReference(event.target.value)} /></label>
      <label>Vendor reference, if available<input value={vendorReference} onChange={event => setVendorReference(event.target.value)} /></label>
      <button disabled={busy || !start || !end || !reference} onClick={() => void action('submitMinuteEvidence', { start: `${start}:00.000Z`, end: `${end}:00.000Z`, sourceType, coveredExperience: experience, reference: reference.trim(), vendorReference: vendorReference.trim() }, 'Unverified minute evidence saved to every affected UTC month.')}>Save minute assertion</button>
    </>}
    {data.canReview && <><h3>Reviewer attestation</h3>
      <label>Review reason<input value={reviewReason} onChange={event => setReviewReason(event.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={confirmedPolicyRule} onChange={event => setConfirmedPolicyRule(event.target.checked)} /> {monthCase.simulated ? 'For this simulated demo, I confirm the fictional evidence represents minutes with >5% request errors in a covered browser experience' : 'I checked that the selected evidence supports minutes with >5% request errors for a covered browser experience under the cited SLA'}</label>
      <label>Site status<select value={environment} onChange={event => setEnvironment(event.target.value)}><option value="UNKNOWN">Unknown</option><option value="PRODUCTION">{monthCase.simulated ? 'Simulated production account (demo only)' : 'Production'}</option><option value="TRIAL">Trial</option><option value="SANDBOX">Sandbox</option></select></label>
      <label className="check"><input type="checkbox" checked={complete} onChange={event => setComplete(event.target.checked)} /> I reviewed the complete qualifying-minute evidence set for this month</label>
      <h3>Contract checks</h3><p className="muted">Leave a condition Unknown until it is reviewed. Confirmed or Failed needs an HTTPS/Jira reference{monthCase.simulated ? ' or a clearly fictional DEMO: reference' : ''}.</p>
      {(Object.keys(conditionLabels) as ConditionKey[]).map(key => <div key={key} className="conditionRow">
        <label>{conditionLabels[key]}<select value={checks[key].status} onChange={event => setChecks(previous => ({ ...previous, [key]: { ...previous[key], status: event.target.value as ContractCheck['status'] } }))}><option value="UNKNOWN">Unknown</option><option value="CONFIRMED">Confirmed</option><option value="FAILED">Failed</option></select></label>
        {checks[key].status !== 'UNKNOWN' && <label>Reference for {conditionLabels[key].toLowerCase()}<input value={checks[key].reference} onChange={event => setChecks(previous => ({ ...previous, [key]: { ...previous[key], reference: event.target.value } }))} placeholder={monthCase.simulated ? 'DEMO:CHECK-1' : 'HTTPS link or Jira key'} /></label>}
        {key === 'claimWindow' && checks[key].status === 'CONFIRMED' && <label>Confirmed contractual deadline (UTC date)<input type="date" value={checks[key].dateUtc || ''} onChange={event => setChecks(previous => ({ ...previous, claimWindow: { ...previous.claimWindow, dateUtc: event.target.value } }))} /></label>}
      </div>)}
      <label>Attestation reason<input value={attestationReason} onChange={event => setAttestationReason(event.target.value)} /></label>
      <button disabled={busy} onClick={() => void action('attestCaseEvidence', { environment, complete, conditions: checks, reason: attestationReason }, 'Case attestation recorded.')}>Record attestation</button>
    </>}
    {(data.reviews.length > 0 || data.completeness.length > 0) && <><h3>Evidence review history</h3><ul className="caseList">
      {[...data.reviews.map(item => ({ id: item.id, at: item.reviewedAt, label: item.trust.replaceAll('_', ' '), actor: item.reviewerAccountId, reason: item.reason })), ...data.completeness.map(item => ({ id: item.id, at: item.reviewedAt, label: `Site ${item.environment.toLowerCase()} · evidence ${item.complete ? 'complete' : 'incomplete'}`, actor: item.reviewerAccountId, reason: item.reason }))].sort((a, b) => b.at.localeCompare(a.at)).map(item => <li key={item.id}><strong>{item.label}</strong> · {item.at}<br /><span className="muted">Reviewer {item.actor} · {item.reason}</span></li>)}
    </ul></>}
    {notice && <p role="status" className="notice">{notice}</p>}
  </section>;
}

function CaseWorkflowCard({ issueId, monthCase }: { issueId: string; monthCase: MonthCase }) {
  const [data, setData] = useState<WorkflowView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('Reviewed fictional demo case');
  const [externalReference, setExternalReference] = useState('');
  async function refresh() { setData(await call<WorkflowView>('getCaseWorkflow', { issueId, caseId: monthCase.id })); }
  useEffect(() => { void refresh().catch(() => setData({ state: 'error', message: 'Case workflow could not be loaded.' })); }, [issueId, monthCase.id]);
  async function record(kind: 'STATE' | 'OWNER' | 'SUPPORT_REF' | 'CONFLICT_RESOLUTION', nextState?: string) {
    if (!data || data.state !== 'ready') return;
    setBusy(true); setNotice('');
    try {
      const result = await call<ActionResult>('recordClaimAction', {
        issueId, caseId: monthCase.id, kind, nextState, reason, externalReference: externalReference.trim(),
        expectedLastEventId: data.claim.lastEventId,
        ...(kind === 'CONFLICT_RESOLUTION' ? { resolvedEventIds: data.claim.conflicts.map(item => item.id) } : {}),
      });
      setNotice(result.state === 'ready' ? 'Case action recorded.' : result.message || 'Case action failed.');
      if (result.state === 'ready') { setExternalReference(''); await refresh(); }
    } catch { setNotice('Case action failed. Try again.'); }
    finally { setBusy(false); }
  }
  async function reconcilePolicy() {
    setBusy(true); setNotice('');
    try {
      const result = await call<ActionResult>('recordPolicyReconciliation', {
        issueId, caseId: monthCase.id, reason, reference: externalReference.trim(),
      });
      setNotice(result.state === 'ready' ? 'Frozen policy applicability review recorded.' : result.message || 'Policy review failed.');
      if (result.state === 'ready') await refresh();
    } catch { setNotice('Policy review failed. Try again.'); }
    finally { setBusy(false); }
  }
  if (!data) return <section className="card"><p>Loading claim workflow…</p></section>;
  if (data.state !== 'ready') return <section className="card"><p role="alert">{data.message}</p></section>;
  const state = data.claim.state;
  return <section className="card">
    <h2>{data.period} UTC · Claim workflow</h2>
    <p><strong>{state.replaceAll('_', ' ')}</strong>{data.simulated && <span className="demo">DEMO / SIMULATED</span>}</p>
    <p>{data.confirmedDeadline ? 'Confirmed contractual deadline' : 'Potential claim submission deadline'}: <strong>{data.deadlineDateUtc} UTC</strong> (date only; confirm the applicable cutoff time)</p>
    {data.confirmedDeadline && <p className="muted">Window reference: {data.confirmedDeadline.reference} · Reviewed by {data.confirmedDeadline.reviewerAccountId} at {data.confirmedDeadline.reviewedAt} · Policy {data.confirmedDeadline.policyVersionId}</p>}
    <p className="muted">Sources: {data.sourceKeys.join(', ')} · Owner: {data.claim.ownerAccountId || 'unassigned'} · Support reference: {data.claim.supportReference || 'missing'}</p>
    <h3>Incident and evidence timeline</h3>
    <ul className="caseList">{data.sourceDetails.map(item => <li key={item.key}><button onClick={() => void router.open({ target: 'issue', issueKey: item.key })}>{item.key}</button> · {item.summary || 'Summary unavailable'}{item.createdAt && <span className="muted"> · Jira issue created {item.createdAt} (not qualifying downtime)</span>}</li>)}
      {data.observations.map((item, index) => <li key={`observation-${index}`}>Customer observation · {item.observedStartUtc} to {item.observedEndUtc} · {item.reference} (unverified as qualifying downtime)</li>)}
      {data.minuteEvidence.flatMap(item => item.qualifyingRanges.map((range, index) => <li key={`${item.id}-${index}`}>Minute assertion · {range.start} to {range.end} · {item.coveredExperience} · {item.trust.replaceAll('_', ' ').toLowerCase()} · {item.reference}</li>))}</ul>
    <p>Reviewed candidate minutes: {data.assessment.candidateQualifyingMinutes ?? 'unknown'} / {data.assessment.totalMinutesInMonth} UTC month minutes · preliminary uptime {data.assessment.uptimePercent ? `${data.assessment.uptimePercent}%` : 'unknown'}{data.assessment.preliminaryCreditTierPercent ? ` · potential ${data.assessment.preliminaryCreditTierPercent}% tier` : ''}</p>
    {data.claim.submittedReference && <p className="muted">External submission reference: {data.claim.submittedReference}</p>}
    {data.claim.vendorDecisionReference && <p className="muted">Recorded vendor decision reference: {data.claim.vendorDecisionReference}</p>}
    <p className="muted">Policy: <a href={data.policy.sourceUrl} target="_blank" rel="noreferrer">{data.policy.id}</a> · effective {data.policy.effectiveFrom}</p>
    {data.policyConflict && <p role="alert" className="notice">Current mapping policy: {data.policyConflict}. Frozen case policy: {data.policy.id}. {data.policyReconciled ? 'An administrator recorded that the frozen policy still applies to this case.' : 'Assessment is blocked until an administrator confirms whether the frozen policy applies.'}</p>}
    {data.canManage && data.policyConflict && !data.policyReconciled && <div className="reviewActions"><p>To retain the frozen policy for this case, enter a policy reference and reason below, then record the review.</p><button disabled={busy || !externalReference || reason.trim().length < 3} onClick={() => void reconcilePolicy()}>Confirm frozen policy applies</button></div>}
    {!data.readiness.ready && <p role="status" className="notice">Claim submission is not ready: {data.readiness.gaps.join(' ')} The preliminary draft remains available for review.</p>}
    {state === 'DRAFT_READY' && !data.readiness.ready && <p role="alert" className="notice">Readiness changed since this draft was marked ready. Recheck the evidence and contract before external use.</p>}
    {data.flags.length > 0 && <p role="status">Deadline notices: {data.flags.map(item => item.milestone.replaceAll('_', ' ').toLowerCase()).join(', ')}</p>}
    {data.claim.conflicts.length > 0 && <div role="alert" className="notice"><p>Concurrent actions need administrator reconciliation. Review these competing records before keeping the current claim history:</p><ul>{data.claim.conflicts.map(item => <li key={item.id}>{item.kind}{item.state ? ` ${item.state}` : ''} · {item.actorAccountId} · {item.recordedAt} · {item.reason}</li>)}</ul>{data.canManage && <button disabled={busy || reason.trim().length < 3} onClick={() => void record('CONFLICT_RESOLUTION')}>Keep current history and set aside competing actions</button>}</div>}
    <h3>Copyable preliminary draft</h3>
    <textarea readOnly value={data.draft} rows={13} aria-label="Preliminary claim draft" />
    <button onClick={() => void navigator.clipboard.writeText(data.draft).then(() => setNotice('Draft copied. Review before external use.')).catch(() => setNotice('Select and copy the draft text manually.'))}>Copy draft</button>
    {data.canManage && <><h3>Record human action</h3>
      <label>Reason<input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label>
      <label>External support, submission, or decision reference<input value={externalReference} onChange={event => setExternalReference(event.target.value)} placeholder={data.simulated ? 'DEMO:SUPPORT-1, HTTPS link, or Jira key' : 'HTTPS link or Jira key'} maxLength={500} /></label>
      <div className="reviewActions">
        <button disabled={busy} onClick={() => void record('OWNER')}>Assign me as owner</button>
        <button disabled={busy || !externalReference} onClick={() => void record('SUPPORT_REF')}>Record support reference</button>
        {state === 'OPEN' && <button disabled={busy} onClick={() => void record('STATE', 'UNDER_REVIEW')}>Start review</button>}
        {state === 'UNDER_REVIEW' && <button disabled={busy || !data.readiness.ready} onClick={() => void record('STATE', 'DRAFT_READY')}>Mark draft ready</button>}
        {state === 'DRAFT_READY' && <button disabled={busy || !externalReference || !data.readiness.ready} onClick={() => void record('STATE', 'SUBMITTED')}>Record external submission</button>}
        {state === 'SUBMITTED' && <><button disabled={busy || !externalReference} onClick={() => void record('STATE', 'CREDITED')}>Record vendor credit</button><button disabled={busy || !externalReference} onClick={() => void record('STATE', 'REJECTED')}>Record vendor rejection</button></>}
        {state !== 'CLOSED' && <button disabled={busy} onClick={() => void record('STATE', 'CLOSED')}>Close with reason</button>}
        {state === 'CLOSED' && <button disabled={busy} onClick={() => void record('STATE', 'UNDER_REVIEW')}>Reopen with reason</button>}
      </div>
    </>}
    <h3>Activity</h3>
    {data.assessmentHistory.length > 0 && <ul className="caseList">{data.assessmentHistory.map(item => <li key={item.id}><strong>{item.summary}</strong> · {item.recordedAt}<br /><span className="muted">Actor {item.actor}</span></li>)}</ul>}
    {data.policyHistory.length > 0 && <ul className="caseList">{data.policyHistory.map(item => <li key={item.id}><strong>Frozen policy applicability confirmed</strong> · {item.recordedAt}<br /><span className="muted">Actor {item.actorAccountId} · {item.reason} · {item.reference} · Conflicting version {item.conflictingPolicyVersionId}</span></li>)}</ul>}
    {data.claim.history.length ? <ul className="caseList">{data.claim.history.map(item => <li key={item.id}><strong>{item.kind === 'STATE' ? item.state?.replaceAll('_', ' ') : item.kind.replaceAll('_', ' ')}</strong> · {item.recordedAt}<br /><span className="muted">Actor {item.actorAccountId} · {item.reason}{item.externalReference ? ` · Reference ${item.externalReference}` : ''}</span></li>)}</ul> : <p className="muted">No human claim actions recorded yet.</p>}
    {data.claim.resolvedConflicts.length > 0 && <ul className="caseList">{data.claim.resolvedConflicts.map(item => <li key={item.id}>Competing action set aside: {item.kind}{item.state ? ` ${item.state}` : ''} · {item.recordedAt} · Actor {item.actorAccountId} · {item.reason}</li>)}</ul>}
    {notice && <p role="status" className="notice">{notice}</p>}
  </section>;
}

function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'claims' | 'policy'>('claims');
  const [componentId, setComponentId] = useState('');
  const [issueTypeId, setIssueTypeId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [simulated, setSimulated] = useState(true);
  const [verifiedPolicy, setVerifiedPolicy] = useState(false);
  const [changeReason, setChangeReason] = useState('Reviewed service mapping');
  const [policyDraft, setPolicyDraft] = useState({ id: '', version: '', title: '', effectiveFrom: '', effectiveTo: '', sourceReference: '', sourceVersion: '', sourceHash: '', clauseReference: '', reason: '', sourceKind: 'OFFICIAL_URL', supportedTerms: false });
  const [clauseReferences, setClauseReferences] = useState(['', '', '', '', '', '']);
  const [policyReason, setPolicyReason] = useState('Reviewed contractual source and policy status');
  const [observedStart, setObservedStart] = useState('');
  const [observedEnd, setObservedEnd] = useState('');
  const [reference, setReference] = useState('');

  async function loadProject(projectId: string) {
    const [setup, cases] = await Promise.all([
      call<Setup>('getProjectSetup', { projectId }),
      call<CaseList>('listProjectCases', { projectId }),
    ]);
    if (setup.state === 'ready') {
      setComponentId(setup.coverage?.componentId || setup.choices.components[0]?.id || '');
      setIssueTypeId(setup.coverage?.issueTypeId || setup.choices.issueTypes.find(choice => /incident/i.test(choice.name))?.id || setup.choices.issueTypes[0]?.id || '');
      setSiteId(setup.coverage?.accountOrSiteId || '');
      setSimulated(setup.coverage?.simulated ?? true);
    }
    setScreen({ kind: 'project', projectId, setup, cases });
  }
  async function loadIssue(issueId: string) {
    const discovery = await call<Discovery>('getIssueDiscovery', { issueId });
    setScreen({ kind: 'issue', issueId, discovery });
  }
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const context = await view.getContext();
        const extension = context.extension as Record<string, unknown>;
        const project = extension.project as { id?: string } | undefined;
        const issue = extension.issue as { id?: string } | undefined;
        if (!active) return;
        if (issue?.id) await loadIssue(issue.id);
        else if (project?.id) await loadProject(project.id);
        else setScreen({ kind: 'error', message: 'Jira did not provide a project or issue context.' });
      } catch {
        if (active) setScreen({ kind: 'error', message: 'CreditClock could not load. Refresh this page to retry.' });
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function saveCoverage(projectId: string) {
    setBusy(true); setNotice('');
    try {
      const result = await call<ActionResult>('saveCoverage', { projectId, componentId, issueTypeId, accountOrSiteId: siteId, simulated, verifiedPolicy, changeReason });
      if (result.state !== 'ready') setNotice(result.message || 'Mapping could not be saved.');
      else { setNotice('Service mapping saved. Matching incidents will now create leads.'); await loadProject(projectId); }
    } catch { setNotice('Mapping could not be saved. Try again.'); }
    finally { setBusy(false); }
  }
  async function createPolicyVersion(projectId: string) {
    setBusy(true); setNotice('');
    try {
      const result = await call<ActionResult>('createPolicyVersion', { projectId, ...policyDraft, clauseReferences: policyDraft.supportedTerms ? clauseReferences : [policyDraft.clauseReference] });
      setNotice(result.state === 'ready' ? policyDraft.supportedTerms ? 'Structured policy draft saved for human review.' : 'Tracking-only policy draft saved. Unsupported terms cannot be activated.' : result.message || 'Policy draft could not be saved.');
      if (result.state === 'ready') await loadProject(projectId);
    } catch { setNotice('Policy draft could not be saved.'); }
    finally { setBusy(false); }
  }
  async function setPolicyStatus(projectId: string, record: PolicyRecord, next: string) {
    setBusy(true); setNotice('');
    try {
      const result = await call<ActionResult>('changePolicyStatus', { projectId, policyId: record.definition.id, next, reason: policyReason, expectedEventId: record.lastEventId });
      setNotice(result.state === 'ready' ? `Policy moved to ${next.toLowerCase().replaceAll('_', ' ')}.` : result.message || 'Policy status could not be changed.');
      if (result.state === 'ready') await loadProject(projectId);
    } catch { setNotice('Policy status could not be changed.'); }
    finally { setBusy(false); }
  }
  async function recheck(issueId: string) {
    setBusy(true); setNotice('');
    try {
      const result = await call<ActionResult>('recheckIssue', { issueId });
      if (result.state !== 'ready') setNotice(result.message || 'Recheck failed.');
      else { setNotice('Issue checked against the current mapping.'); await loadIssue(issueId); }
    } catch { setNotice('Recheck failed. Try again.'); }
    finally { setBusy(false); }
  }
  async function addObservation(issueId: string) {
    setBusy(true); setNotice('');
    try {
      if (!observedStart || !observedEnd) throw new Error('Enter start and end times in UTC.');
      const start = new Date(`${observedStart}Z`).toISOString();
      const end = new Date(`${observedEnd}Z`).toISOString();
      const result = await call<ActionResult>('addObservation', { issueId, start, end, reference: reference.trim(), simulated });
      if (result.state !== 'ready') setNotice(result.message || 'Observation could not be saved.');
      else {
        setNotice('Observed interval saved. Its month case needs qualifying-minute evidence and review.');
        setObservedStart(''); setObservedEnd(''); setReference('');
        await loadIssue(issueId);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Observation could not be saved.'); }
    finally { setBusy(false); }
  }
  async function createOctoberDemoCase(issueId: string) {
    setBusy(true); setNotice('');
    try {
      const result = await call<ActionResult>('createOctoberDemoCase', { issueId });
      if (result.state !== 'ready') setNotice(result.message || 'Demo case could not be created.');
      else { setNotice('October 2026 simulated case created with unverified evidence. A reviewer must classify it.'); await loadIssue(issueId); }
    } catch { setNotice('Demo case could not be created. Try again.'); }
    finally { setBusy(false); }
  }

  if (screen.kind === 'loading') return <main className="shell"><p>Loading CreditClock…</p></main>;
  if (screen.kind === 'error') return <main className="shell"><h1>CreditClock</h1><p role="alert">{screen.message}</p></main>;
  if (screen.kind === 'project') {
    if (screen.setup.state !== 'ready') return <main className="shell"><h1>CreditClock</h1><p role="alert">{screen.setup.message}</p></main>;
    const setup = screen.setup;
    return <main className="shell">
      <p className="eyebrow">{setup.project.key} · Claims overview</p><h1>CreditClock</h1>
      <p className="intro">Turn configured incidents into evidence-backed potential vendor SLA follow-ups.</p>
      <nav className="tabs" aria-label="CreditClock sections"><button className={tab === 'claims' ? 'selected' : ''} onClick={() => setTab('claims')}>Claims</button>{setup.canConfigure && <button className={tab === 'policy' ? 'selected' : ''} onClick={() => setTab('policy')}>Covered service</button>}</nav>
      {notice && <p role="status" className="notice">{notice}</p>}
      {tab === 'claims' ? <>
        {screen.cases.state !== 'ready' ? <p role="alert">{screen.cases.message}</p> : screen.cases.cases.length ?
          <section className="card"><h2>Product-month cases</h2><ul className="caseList">{screen.cases.cases.map(item => <li key={item.id}><strong>{item.period} UTC</strong> · {item.assessmentState.replaceAll('_', ' ').toLowerCase()}{item.simulated && <span className="demo">DEMO / SIMULATED</span>}<br /><span className="muted">Claim: {item.claimState.replaceAll('_', ' ').toLowerCase()} · {item.deadlineConfirmed ? 'Confirmed deadline' : 'Potential deadline'}: {item.deadlineDateUtc || 'pending'} · Owner: {item.ownerAccountId || 'unassigned'}</span><br /><span className="muted">Next action: {item.claimState === 'OPEN' ? 'Start human review' : item.claimState === 'UNDER_REVIEW' ? 'Resolve evidence and contract gaps' : item.claimState === 'DRAFT_READY' ? 'Submit through Atlassian support outside CreditClock' : item.claimState === 'SUBMITTED' ? 'Record the vendor decision' : 'Review case history'}</span><br /><span className="muted">Sources: {item.issueKeys?.join(', ')} · Case {item.id}</span>{item.notices?.length ? <p role="status">Deadline notices: {item.notices.join(', ')}</p> : null}<br />{item.issueKeys?.[0] && <button onClick={() => void router.open({ target: 'issue', issueKey: item.issueKeys![0] })}>Open source issue and case</button>}</li>)}</ul></section>
          : <section className="card"><h2>No cases yet</h2><p>Configure a service, then add a dated observation on a matching incident. An incident alone creates a lead, not a claim case.</p></section>}
        <p className="notice">A case is a follow-up record. Jira issue dates do not establish qualifying downtime or a service credit.</p>
      </> : <>
        <section className="card"><h2>Atlassian Cloud Premium reference</h2><p><a href={setup.policy.sourceUrl} target="_blank" rel="noreferrer">{setup.policy.displayTitle}</a> · effective {setup.policy.effectiveFrom}</p><p className="muted">This is a cited template. Real product, plan, experience, production status and contract version must be verified before calculation or submission.</p></section>
        {setup.canConfigure && <section className="card"><h2>Policy registry</h2><p className="muted">Approved definitions are immutable. New contractual terms are tracking-only until a supported, tested adapter is available.</p>
          <ul className="caseList">{setup.policyRecords.map(record => <li key={record.definition.id}><strong>{record.definition.title}</strong> · {record.status}<br /><span className="muted">Version {record.definition.version} · effective {record.definition.effectiveFrom}{record.definition.effectiveTo ? ` to ${record.definition.effectiveTo}` : ''} · {record.definition.adapter} · {record.definition.id}</span><br /><span className="muted">Source: {record.definition.source.reference} · clauses: {record.definition.source.clauses.join(', ')}</span><br />
            {record.status === 'DRAFT' && <button disabled={busy} onClick={() => void setPolicyStatus(screen.projectId, record, 'IN_REVIEW')}>Send for review</button>}
            {record.status === 'IN_REVIEW' && <button disabled={busy} onClick={() => void setPolicyStatus(screen.projectId, record, 'APPROVED')}>Approve definition</button>}
            {record.status === 'APPROVED' && record.definition.adapter !== 'UNSUPPORTED' && <button disabled={busy} onClick={() => void setPolicyStatus(screen.projectId, record, 'ACTIVE')}>Activate</button>}
            {(record.status === 'APPROVED' || record.status === 'ACTIVE') && <button disabled={busy} onClick={() => void setPolicyStatus(screen.projectId, record, 'RETIRED')}>Retire</button>}
          </li>)}</ul><label>Policy action reason<input value={policyReason} onChange={event => setPolicyReason(event.target.value)} maxLength={500} /></label>
          <h3>Record a structured policy version</h3><p className="muted">A reviewer must compare every cited term with the source. Different or unknown rules remain tracking-only.</p>
          <label className="check"><input type="checkbox" checked={policyDraft.supportedTerms} onChange={event => setPolicyDraft({ ...policyDraft, supportedTerms: event.target.checked })} /> I verified that this source has the same UTC monthly calculation, provider-confirmed &gt;5% error-minute definition, 99.9% commitment, Premium credit tiers, and contractual conditions as the tested Atlassian family.</label>
          <label>Source type<select value={policyDraft.sourceKind} onChange={event => setPolicyDraft({ ...policyDraft, sourceKind: event.target.value })}><option value="OFFICIAL_URL">Official HTTPS URL</option><option value="CUSTOMER_DOCUMENT">Customer document reference</option></select></label>
          {(['id', 'version', 'title', 'effectiveFrom', 'effectiveTo', 'sourceReference', 'sourceVersion', 'sourceHash', 'reason'] as const).map(field => <label key={field}>{field.replace(/([A-Z])/g, ' $1')}<input value={policyDraft[field]} onChange={event => setPolicyDraft({ ...policyDraft, [field]: event.target.value })} maxLength={500} placeholder={field === 'effectiveFrom' || field === 'effectiveTo' ? 'YYYY-MM-DD' : field === 'sourceHash' ? 'SHA-256 for customer documents' : undefined} /></label>)}
          {policyDraft.supportedTerms ? ['Coverage and covered experience', 'Commitment and period', 'Downtime definition and source of truth', 'Exclusions', 'Credit tiers', 'Submission conditions and deadline'].map((label, index) => <label key={label}>{label} clause location<input value={clauseReferences[index]} onChange={event => setClauseReferences(clauseReferences.map((value, i) => i === index ? event.target.value : value))} maxLength={500} /></label>) : <label>Unsupported clause location<input value={policyDraft.clauseReference} onChange={event => setPolicyDraft({ ...policyDraft, clauseReference: event.target.value })} maxLength={500} /></label>}
          <button disabled={busy} onClick={() => void createPolicyVersion(screen.projectId)}>Save policy draft</button>
        </section>}
        {setup.canConfigure ? <section className="card"><h2>Map one covered service</h2>
          {setup.choices.components.length === 0 && <p role="status">No Jira Components are available. Create one in Jira project settings first.</p>}
          <label>Source issue type<select value={issueTypeId} onChange={event => setIssueTypeId(event.target.value)}>{setup.choices.issueTypes.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
          <label>Jira Component<select value={componentId} onChange={event => setComponentId(event.target.value)}>{setup.choices.components.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
          <label>Account or site ID<input value={siteId} onChange={event => setSiteId(event.target.value)} placeholder="example-site" maxLength={100} /></label>
          <p>Covered product: Jira Service Management Premium · browser experience</p>
          <label className="check"><input type="checkbox" checked={simulated} onChange={event => setSimulated(event.target.checked)} /> Demo / simulated mapping</label>
          <label className="check"><input type="checkbox" checked={verifiedPolicy} onChange={event => setVerifiedPolicy(event.target.checked)} /> I reviewed the cited policy version for this mapping</label>
          <label>Reason for saving this mapping<input value={changeReason} onChange={event => setChangeReason(event.target.value)} maxLength={500} /></label>
          <button className="primary" disabled={busy || !componentId || !issueTypeId} onClick={() => void saveCoverage(screen.projectId)}>Save mapping</button>
          {setup.coverage && <p className="muted">Current: {setup.coverage.issueTypeName} + {setup.coverage.componentName} → {setup.coverage.accountOrSiteId}{setup.coverage.simulated ? ' · DEMO / SIMULATED' : ''}</p>}
        </section> : <section className="card"><h2>Service mapping</h2><p>{setup.coverage ? `${setup.coverage.issueTypeName} + ${setup.coverage.componentName} → ${setup.coverage.accountOrSiteId}` : 'A project administrator must configure a covered service.'}</p></section>}
        {setup.canConfigure && setup.coverageHistory.length > 0 && <section className="card"><h2>Mapping history</h2><ul className="caseList">{[...setup.coverageHistory].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map(item => <li key={item.id}><strong>{item.current.issueTypeName} + {item.current.componentName}</strong> · {item.current.policyVersionId}<br /><span className="muted">{item.previous ? 'Updated' : 'Created'} by {item.actorAccountId} · {item.recordedAt} · {item.reason}</span></li>)}</ul></section>}
      </>}
    </main>;
  }
  if (screen.discovery.state !== 'ready') return <main className="shell compact"><h1>CreditClock</h1><p role="alert">{screen.discovery.message}</p></main>;
  const discovery = screen.discovery;
  return <main className="shell compact">
    <p className="eyebrow">{discovery.issue.key} · Potential contractual follow-up</p><h1>CreditClock: {discovery.coverage ? discovery.cases.length ? discovery.cases.some(item => item.assessmentState === 'REVIEWABLE') ? 'Case ready for review' : 'Evidence needed' : 'Potential follow-up' : 'No covered service'}</h1>
    {discovery.coverage ? <>
      <p>{discovery.coverage.product} Premium · {discovery.coverage.componentName}</p>{discovery.coverage.simulated && <span className="demo">DEMO / SIMULATED</span>}
      <p>{discovery.lead ? 'Matching incident lead found.' : 'This issue matches the service mapping. Check again to create its lead now.'}</p>
      {discovery.cases.length ? <><ul className="caseList">{discovery.cases.map(item => <li key={item.id}><strong>{item.period} UTC</strong> · Case record{item.simulated && <span className="demo">DEMO / SIMULATED</span>}<br /><span className="muted">Case {item.id}</span></li>)}</ul>{discovery.cases.map(item => <React.Fragment key={item.id}><CaseAssessmentCard issueId={screen.issueId} monthCase={item} /><CaseWorkflowCard issueId={screen.issueId} monthCase={item} /></React.Fragment>)}</> : <p className="muted">No month case yet. A dated observation is needed to establish the affected month.</p>}
      {discovery.canAddObservation && <><button disabled={busy} onClick={() => void recheck(screen.issueId)}>Check again</button>
        <section className="card"><h2>Add customer observation</h2><p className="muted">These timestamps locate a potential case month. They are never counted as qualifying vendor downtime.</p>
          <label>Observed start (UTC)<input type="datetime-local" value={observedStart} onChange={event => setObservedStart(event.target.value)} /></label>
          <label>Observed end (UTC)<input type="datetime-local" value={observedEnd} onChange={event => setObservedEnd(event.target.value)} /></label>
          <label>Evidence HTTPS link or Jira key<input value={reference} onChange={event => setReference(event.target.value)} placeholder="https://… or CCDEMO-1" /></label>
          <label className="check"><input type="checkbox" checked={simulated} onChange={event => setSimulated(event.target.checked)} /> Demo / simulated observation</label>
          <button className="primary" disabled={busy} onClick={() => void addObservation(screen.issueId)}>Save observation</button>
        </section></>}
      {discovery.canCreateDemo && <section className="card"><h2>Demo fixture</h2><p className="muted">Create one fictional October 2026 case with a 60-minute customer observation and an unverified minute assertion. This is simulated data; it requires human review before any preliminary calculation.</p><button disabled={busy} onClick={() => void createOctoberDemoCase(screen.issueId)}>Create October demo case</button></section>}
    </> : <p>No matching service mapping for this issue type and Jira Component. A project administrator can configure one from CreditClock in the project navigation.</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <p className="muted">A Jira ticket alone does not establish SLA downtime, eligibility or an award.</p>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
