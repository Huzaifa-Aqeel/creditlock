import { issueAsApp } from './jira';
import { reconcileIssue } from './discovery-service';

export async function onIssueEvent(event: { eventType?: string; selfGenerated?: boolean; issue?: { id?: string } }): Promise<void> {
  if (event.selfGenerated || !['avi:jira:created:issue', 'avi:jira:updated:issue'].includes(event.eventType || '')) return;
  const issueId = event.issue?.id;
  if (!issueId || !/^\d{1,20}$/.test(issueId)) return;
  const issue = await issueAsApp(issueId);
  if (!issue) return;
  await reconcileIssue(issue);
}
