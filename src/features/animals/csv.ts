import { animalSchema, type Animal, type Species } from '../../db/models'
import { importTagIssues, normalizeEarTag } from '../../db/animalTags'
import { newId, now } from '../../lib/identity'

export const columns = ['earTag', 'species', 'sex', 'name', 'breed', 'birthDate', 'acquisitionDate', 'status', 'notes'] as const
const requiredColumns = columns.slice(0, 3)
export const csvTemplate = columns.join(',') + '\r\n'
export const maxCsvBytes = 2 * 1024 * 1024

export function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([csvTemplate], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'livestockos-animals.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type CsvRecord = { line: number; cells: string[]; malformed: boolean }

function readCsv(input: string) {
  const records: CsvRecord[] = []
  const rows = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let line = 1
  let start = line
  let cells: string[] = []
  let cell = ''
  let state: 'plain' | 'quoted' | 'closed' = 'plain'
  let malformed = false

  for (let index = 0; index <= rows.length; index++) {
    const char = rows[index]
    if (state === 'quoted' && char !== undefined) {
      if (char === '"' && rows[index + 1] === '"') {
        cell += '"'
        index++
      } else if (char === '"') {
        state = 'closed'
      } else {
        cell += char
        if (char === '\n') line++
      }
      continue
    }

    if (char === ',' || char === '\n' || char === undefined) {
      cells.push(cell)
      malformed ||= state === 'quoted'
      cell = ''
      state = 'plain'
      if (char !== ',') {
        if (malformed || cells.length > 1 || cells.some((value) => value.trim())) {
          records.push({ line: start, cells, malformed })
        }
        cells = []
        malformed = false
        start = ++line
      }
    } else if (char === '"' && state === 'plain' && cell === '') {
      state = 'quoted'
    } else {
      malformed ||= state === 'closed' || char === '"'
      cell += char
    }
  }
  return records
}

export type CsvIssue = { key: 'malformedRow' | 'existingTag' | 'repeatedTag' } | { key: 'invalidField'; field: string }
export type PreviewRow = {
  line: number
  values: Partial<Record<typeof columns[number], string>>
  issues: CsvIssue[]
  animal?: Animal
}
export type CsvPreview = { rows: PreviewRow[]; fileIssue?: 'invalidHeader' | 'emptyFile' }

export function previewCsv(input: string, species: Species[], existingTags: Iterable<string>): CsvPreview {
  const [header, ...records] = readCsv(input)
  if (!header) return { rows: [], fileIssue: 'emptyFile' }
  const headers = header.cells.map((value) => value.trim())
  if (header.malformed || new Set(headers).size !== headers.length ||
      !requiredColumns.every((column) => headers.includes(column)) ||
      !headers.every((column) => columns.some((allowed) => allowed === column))) {
    return { rows: [], fileIssue: 'invalidHeader' }
  }
  if (!records.length) return { rows: [], fileIssue: 'emptyFile' }

  const timestamp = now()
  const availableSpecies = new Map<string, Species>()
  for (const item of species) {
    if (item.active && !availableSpecies.has(item.code)) availableSpecies.set(item.code, item)
  }
  const rows = records.map(({ line, cells, malformed }): PreviewRow => {
    const values = Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim()]))
    const issues: CsvIssue[] = []
    if (malformed || cells.length !== headers.length) issues.push({ key: 'malformedRow' })
    const parsed = animalSchema.safeParse({
      id: newId(), earTag: values.earTag, speciesId: availableSpecies.get(values.species?.toLowerCase())?.id,
      sex: values.sex?.toLowerCase(), status: values.status?.toLowerCase() || 'active',
      name: values.name || undefined, breed: values.breed || undefined,
      birthDate: values.birthDate || undefined, acquisitionDate: values.acquisitionDate || undefined,
      notes: values.notes || undefined, createdAt: timestamp, updatedAt: timestamp,
    })
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0])
        issues.push({ key: 'invalidField', field: field === 'speciesId' ? 'species' : field })
      }
    }
    return { line, values, issues, animal: parsed.success ? parsed.data : undefined }
  })
  const conflicts = importTagIssues(rows.map(({ values }) => normalizeEarTag(values.earTag ?? '')), existingTags)
  rows.forEach(({ issues }, index) => {
    if (conflicts[index].existing) issues.push({ key: 'existingTag' })
    if (conflicts[index].repeated) issues.push({ key: 'repeatedTag' })
  })
  return { rows }
}
