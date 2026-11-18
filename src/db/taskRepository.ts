import Dexie from 'dexie'
import { farmWrite, journal } from '../features/sync/local'
import type { LivestockDatabase } from './database'
import type { createHealthRepository } from './healthRepository'
import { reminderRequestSchema, taskActionSchema, taskDraftSchema, taskFilterSchema, taskIdSchema, taskSchema,
  type Task, type TaskDraft, type TaskFilter } from './taskModels'
import { newId, now } from '../lib/identity'

export class TaskConflict extends Error {
  constructor(readonly code: 'closed' | 'missing' | 'linked' | 'reminderChanged') { super(code) }
}

export function createTaskRepository(db: LivestockDatabase, health: ReturnType<typeof createHealthRepository>) {
  function range(filters: TaskFilter) {
    const { from, to, status, type, animalId } = taskFilterSchema.parse(filters)
    const lower = from ?? Dexie.minKey
    const upper = to ?? Dexie.maxKey
    const dates = status
      ? db.tasks.where('[status+dueDate]').between([status, lower], [status, upper], true, true)
      : db.tasks.where('dueDate').between(lower, upper, true, true)
    return type || animalId ? dates.and((task) => (!type || type === task.type) && (!animalId || animalId === task.animalId)) : dates
  }

  async function checkAnimal(id?: string) {
    if (id && !await db.animals.get(id)) throw new Error('Animal missing')
  }

  async function pending(id: string) {
    const task = await db.tasks.get(taskIdSchema.parse(id))
    if (!task) throw new TaskConflict('missing')
    if (task.status !== 'pending') throw new TaskConflict('closed')
    return task
  }

  async function create(input: TaskDraft, healthEventId?: string) {
    const timestamp = now()
    const task = taskSchema.parse({
      ...taskDraftSchema.parse(input), id: newId(), status: 'pending', healthEventId,
      createdAt: timestamp, updatedAt: timestamp,
    })
    await checkAnimal(task.animalId)
    await db.tasks.add(task)
    await journal(db, [{ entity: 'tasks', records: [task] }])
    return task
  }

  return {
    get: (id: string) => db.tasks.get(id),
    range: (filters: TaskFilter = {}) => range(filters).toArray(),
    pendingCounts: async (today: string, tomorrow: string, week: string, month: string) => {
      const [overdue, todayCount, weekCount, monthCount] = await Promise.all([
        db.tasks.where('[status+dueDate]').between(['pending', Dexie.minKey], ['pending', today], true, false).count(),
        db.tasks.where('[status+dueDate]').equals(['pending', today]).count(),
        db.tasks.where('[status+dueDate]').between(['pending', tomorrow], ['pending', week], true, true).count(),
        db.tasks.where('[status+dueDate]').between(['pending', tomorrow], ['pending', month], true, true).count(),
      ])
      return { overdue, today: todayCount, week: weekCount, month: monthCount }
    },
    create: (input: TaskDraft) => farmWrite(db, [db.tasks, db.animals], async () => await create(input)),
    edit: (id: string, input: TaskDraft) => farmWrite(db, [db.tasks, db.animals], async () => {
      const task = await pending(id)
      const draft = taskDraftSchema.parse(input)
      if (task.healthEventId && (draft.animalId !== task.animalId || draft.type !== task.type)) throw new TaskConflict('linked')
      await checkAnimal(draft.animalId)
      const saved = taskSchema.parse({ ...task, ...draft, animalId: draft.animalId, description: draft.description, updatedAt: now() })
      await db.tasks.put(saved)
      await journal(db, [{ entity: 'tasks', records: [saved] }])
      return saved
    }),
    finish: (id: string, action: 'completed' | 'cancelled') => farmWrite(db, [db.tasks], async () => {
      const status = taskActionSchema.parse(action)
      const task = await pending(id)
      const timestamp = now()
      const saved = taskSchema.parse({ ...task, status, updatedAt: timestamp, completedAt: status === 'completed' ? timestamp : undefined })
      await db.tasks.put(saved)
      await journal(db, [{ entity: 'tasks', records: [saved] }])
      return saved
    }),
    fromEvent: (input: { eventId: string; dueDate: string; title: string }) =>
      farmWrite(db, [db.tasks, db.animals, db.healthEvents, db.vaccinations], async () => {
        const request = reminderRequestSchema.parse(input)
        const source = await health.reminderSource(request.eventId)
        if (!source) throw new TaskConflict('reminderChanged')
        const existing = await db.tasks.where('[healthEventId+type]').equals([source.rootId, source.type]).first()
        if (existing) return { task: existing, created: false }
        if (source.dueDate !== request.dueDate) throw new TaskConflict('reminderChanged')
        const task = await create({
          title: request.title, dueDate: source.dueDate, animalId: source.event.animalId, type: source.type,
        }, source.rootId)
        return { task, created: true }
      }),
    reminderAt: (rootId: string) => db.tasks.where('[healthEventId+type]')
      .between([rootId, Dexie.minKey], [rootId, Dexie.maxKey], true, true).first(),
    reminderFor: (rootId: string, type: Task['type']) => db.tasks.where('[healthEventId+type]').equals([rootId, type]).first(),
  }
}
