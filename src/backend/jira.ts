import api, { route } from '@forge/api';
import type { IssueSnapshot } from './discovery-domain';

export type JiraProject = { id: string; key: string; name: string; projectTypeKey: string };
export type JiraChoice = { id: string; name: string };

function readIssue(raw: unknown): IssueSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const issue = raw as {
    id?: string; key?: string;
    fields?: {
      project?: { id?: string; key?: string };
      issuetype?: { id?: string };
      components?: Array<{ id?: string }>;
      summary?: string;
      created?: string;
    };
  };
  const { project, issuetype, components } = issue.fields || {};
  if (!issue.id || !issue.key || !project?.id || !project.key || !issuetype?.id) return null;
  return {
    id: issue.id,
    key: issue.key,
    projectId: project.id,
    projectKey: project.key,
    issueTypeId: issuetype.id,
    componentIds: (components || []).map(component => component.id).filter((id): id is string => !!id),
    ...(typeof issue.fields?.summary === 'string' ? { summary: issue.fields.summary } : {}),
    ...(typeof issue.fields?.created === 'string' ? { createdAt: issue.fields.created } : {}),
  };
}

export async function projectAsUser(projectId: string): Promise<JiraProject | null> {
  const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`);
  if (!response.ok) return null;
  const project = await response.json() as JiraProject;
  return project.id === projectId && project.projectTypeKey === 'service_desk' ? project : null;
}

export async function issueAsUser(issueId: string): Promise<IssueSnapshot | null> {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=project,issuetype,components,summary,created`);
  return response.ok ? readIssue(await response.json()) : null;
}

export async function issueAsApp(issueId: string): Promise<IssueSnapshot | null> {
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}?fields=project,issuetype,components`);
  return response.ok ? readIssue(await response.json()) : null;
}

export async function userHasPermission(projectId: string, permission: 'ADMINISTER_PROJECTS' | 'EDIT_ISSUES', issueId?: string): Promise<boolean> {
  const response = issueId
    ? await api.asUser().requestJira(route`/rest/api/3/mypermissions?issueId=${issueId}&permissions=${permission}`)
    : await api.asUser().requestJira(route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=${permission}`);
  if (!response.ok) return false;
  const result = await response.json() as { permissions?: Record<string, { havePermission?: boolean }> };
  return result.permissions?.[permission]?.havePermission === true;
}

export async function projectChoices(projectId: string): Promise<{ components: JiraChoice[]; issueTypes: JiraChoice[] }> {
  const [componentsResponse, typesResponse] = await Promise.all([
    api.asUser().requestJira(route`/rest/api/3/project/${projectId}/components`),
    api.asUser().requestJira(route`/rest/api/3/issuetype/project?projectId=${projectId}`),
  ]);
  if (!componentsResponse.ok || !typesResponse.ok) throw new Error('Jira project configuration could not be loaded.');
  const components = await componentsResponse.json() as JiraChoice[];
  const issueTypes = await typesResponse.json() as JiraChoice[];
  return {
    components: components.filter(choice => choice.id && choice.name),
    issueTypes: issueTypes.filter(choice => choice.id && choice.name),
  };
}
