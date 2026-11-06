export function allSourcesVisible(
  projectId: string,
  sourceIds: string[],
  sources: Array<{ id: string; projectId: string } | null>,
): boolean {
  return sourceIds.length > 0
    && sourceIds.length === sources.length
    && sourceIds.every((id, index) => sources[index]?.id === id && sources[index]?.projectId === projectId);
}
