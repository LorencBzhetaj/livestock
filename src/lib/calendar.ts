export function localDay(value = new Date()) {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
    .map((part) => String(part).padStart(2, '0')).join('-')
}

export function recordedDay(value: string, dateOnly?: boolean) {
  return dateOnly ? value.slice(0, 10) : localDay(new Date(value))
}

// UTC is used only for arithmetic on calendar labels, which have no time zone.
export function shiftDay(day: string, amount: number) {
  const date = new Date(day + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function shiftMonth(day: string, amount: number) {
  const date = new Date(day.slice(0, 7) + '-01T00:00:00Z')
  date.setUTCMonth(date.getUTCMonth() + amount)
  return date.toISOString().slice(0, 10)
}

export function monthDays(day: string) {
  const start = day.slice(0, 7) + '-01'
  const end = shiftMonth(start, 1)
  const days: string[] = []
  for (let current = start; current < end; current = shiftDay(current, 1)) days.push(current)
  return days
}

export function weekday(day: string) {
  return (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7
}

export function groupByDueDate<T extends { dueDate: string }>(tasks: T[]) {
  const groups = new Map<string, T[]>()
  for (const task of tasks) {
    const group = groups.get(task.dueDate) ?? []
    group.push(task)
    groups.set(task.dueDate, group)
  }
  return groups
}

export function isOverdue(task: { dueDate: string; status: string }, today: string) {
  return task.status === 'pending' && task.dueDate < today
}
