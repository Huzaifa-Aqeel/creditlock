import { createHash, randomUUID } from 'node:crypto';
import type { MonthCase } from './discovery-domain';
import type { Assessment } from './rules/evaluate';
import { storage } from './storage';

export function assessmentFingerprint(assessment: Assessment): string {
  return createHash('sha256').update(JSON.stringify(assessment)).digest('hex');
}

export async function recordAssessmentChange(monthCase: MonthCase, assessment: Assessment): Promise<void> {
  const fingerprint = assessmentFingerprint(assessment);
  const previous = await storage.getAssessmentHead(monthCase.projectId, monthCase.id);
  if (previous?.fingerprint === fingerprint) return;
  const id = randomUUID();
  await storage.saveAssessmentChange({ fingerprint, state: assessment.state, activityId: id }, {
    id, projectId: monthCase.projectId, caseId: monthCase.id,
    ...(previous ? { previousState: previous.state } : {}), currentState: assessment.state,
    fingerprint, actor: 'SYSTEM', recordedAt: new Date().toISOString(),
    summary: previous ? `Assessment recalculated: ${previous.state} → ${assessment.state}` : `Initial assessment: ${assessment.state}`,
  });
}
