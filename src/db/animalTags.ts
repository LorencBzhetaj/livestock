export const normalizeEarTag = (value: string) => value.trim().toUpperCase()

export class AnimalTagConflict extends Error {
  constructor(readonly earTag: string) {
    super('Animal ear tag already exists')
  }
}

export function importTagIssues(tags: string[], existingTags: Iterable<string>) {
  const existing = new Set(existingTags)
  const counts = new Map<string, number>()
  for (const tag of tags) {
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return tags.map((tag) => ({
    existing: existing.has(tag),
    repeated: (counts.get(tag) ?? 0) > 1,
  }))
}
