import { localDay } from '../lib/calendar'
import { taskSchema } from './taskModels'

export function migrateTask(old: { dueAt: string; status: string }) {
  return taskSchema.parse({
    ...old, dueDate: localDay(new Date(old.dueAt)), type: 'general',
    status: old.status === 'open' ? 'pending' : old.status === 'done' ? 'completed' : old.status,
  })
}
