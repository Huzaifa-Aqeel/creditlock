export function idFrom(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : null;
}

export function contextProjectId(extension: Record<string, unknown>): string | null {
  const project = extension.project;
  return project && typeof project === 'object' ? idFrom((project as Record<string, unknown>).id) : null;
}

export function authorizedAccount(context: { accountId?: string; accountType?: string }): string | null {
  return context.accountId && context.accountType === 'licensed' ? context.accountId : null;
}
