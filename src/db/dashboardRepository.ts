import type { LivestockDatabase } from './database'
import type { createHealthRepository } from './healthRepository'
import type { createTaskRepository } from './taskRepository'
import { shiftDay } from '../lib/calendar'

export function createDashboardRepository(
  db: LivestockDatabase, health: ReturnType<typeof createHealthRepository>, tasks: ReturnType<typeof createTaskRepository>,
) {
  return (today: string) => db.transaction('r',
    [db.animals, db.species, db.tasks, db.healthEvents, db.vaccinations], async () => {
      const lastDay = shiftDay(today, 30)
      const [total, active, archived, species, taskCounts, records, upcoming, sources] = await Promise.all([
        db.animals.count(), db.animals.where('status').equals('active').count(), db.animals.where('status').equals('archived').count(),
        db.species.toArray(), tasks.pendingCounts(today, shiftDay(today, 1), shiftDay(today, 7), lastDay),
        health.recent(6),
        tasks.range({ from: today, to: lastDay, status: 'pending' }),
        health.upcomingSources(today, lastDay),
      ])
      const speciesCounts = (await Promise.all(species.map(async (item) => ({
        species: item, count: await db.animals.where('speciesId').equals(item.id).count(),
      })))).filter(({ count }) => count > 0)
      const unlinked = await Promise.all(sources.map(async (source) =>
        await tasks.reminderFor(source.rootId, source.type) ? undefined : source,
      ))
      const clinicalTasks = upcoming.filter(({ type }) => type === 'vaccination' || type === 'checkup')
      const clinicalDates = unlinked.flatMap((source) => source && source.type !== 'treatmentFollowUp' ? [source] : [])
      const ids = new Set([
        ...records.map(({ animalId }) => animalId),
        ...clinicalTasks.flatMap(({ animalId }) => animalId ? [animalId] : []),
        ...clinicalDates.map(({ event }) => event.animalId),
      ])
      const animals = new Map((await db.animals.bulkGet([...ids]))
        .flatMap((animal) => animal ? [[animal.id, animal] as const] : []))
      return { total, active, archived, speciesCounts, taskCounts, records, clinicalTasks, clinicalDates, animals }
    })
}
