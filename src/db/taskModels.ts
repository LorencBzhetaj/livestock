import { z } from 'zod'

export const taskTypes = ['vaccination', 'checkup', 'treatmentFollowUp', 'general'] as const
export const taskStatuses = ['pending', 'completed', 'cancelled'] as const
const id = z.uuid()
const timestamp = z.iso.datetime()
const date = z.iso.date()
const type = z.enum(taskTypes)
const status = z.enum(taskStatuses)
const fields = {
  title: z.string().trim().min(1), description: z.string().trim().optional(),
  type, dueDate: date, animalId: id.optional(),
}

export const taskDraftSchema = z.strictObject(fields)
export const taskDatesSchema = z.strictObject({ from: date.optional(), to: date.optional() })
export const taskFilterSchema = taskDatesSchema.extend({ type: type.optional(), animalId: id.optional(), status: status.optional() })
export const taskSchema = z.strictObject({
  ...fields, id, status, healthEventId: id.optional(),
  createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp.optional(),
  dueAt: timestamp.optional(), // Original timestamp retained on migrated tasks.
}).refine((task) => (task.status === 'completed') === Boolean(task.completedAt))
  .refine((task) => !task.healthEventId || (task.animalId && task.type !== 'general'))

export const reminderRequestSchema = z.strictObject({
  eventId: id, dueDate: date, title: fields.title,
})
export const taskActionSchema = z.enum(['completed', 'cancelled'])
export const taskIdSchema = id

export type Task = z.infer<typeof taskSchema>
export type TaskDraft = z.infer<typeof taskDraftSchema>
export type TaskFilter = z.infer<typeof taskFilterSchema>
export type TaskType = typeof taskTypes[number]
