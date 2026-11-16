import 'fake-indexeddb/auto'
import { deflateSync, crc32 } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { expect, test } from 'vitest'
import { LivestockDatabase } from '../src/db/database'
import type { HealthEvent } from '../src/db/models'
import { createRepositories } from '../src/db/repositories'
import { createBackup, previewBackup, restoreBackup } from '../src/features/backup/backup'
import { maxBackupBytes } from '../src/features/backup/format'
import { newId } from '../src/lib/identity'
import { sha256 } from '../src/lib/sha256'

const MiB = 1024 * 1024
const instant = '2026-07-01T08:00:00.000Z'

function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data])
  const metadata = Buffer.alloc(8)
  metadata.writeUInt32BE(data.length, 0)
  metadata.writeUInt32BE(crc32(body), 4)
  return Buffer.concat([metadata.subarray(0, 4), body, metadata.subarray(4)])
}

function syntheticPhoto(seed: number) {
  const width = 1024
  const height = 768
  const stride = width * 3 + 1
  const pixels = Buffer.alloc(stride * height)
  let random = seed
  for (let row = 0; row < height; row++) {
    for (let column = 1; column < stride; column++) {
      random ^= random << 13
      random ^= random >>> 17
      random ^= random << 5
      pixels[row * stride + column] = random & 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return new Blob([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0)),
  ], { type: 'image/png' })
}

test.skipIf(process.env.LIVESTOCK_BACKUP_STRESS !== '1')(
  'round-trips 200 animals, 1000 clinical events and 42 unique synthetic PNGs near the backup limit',
  async () => {
    const source = new LivestockDatabase(newId())
    let target = new LivestockDatabase(newId())
    const measurements: Record<string, { rssMiB: number; heapMiB: number; peakRssMiB: number; elapsedMs: number }> = {}
    let started = performance.now()
    function measure(stage: string) {
      const memory = process.memoryUsage()
      measurements[stage] = {
        rssMiB: Math.round(memory.rss / MiB), heapMiB: Math.round(memory.heapUsed / MiB),
        peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), elapsedMs: Math.round(performance.now() - started),
      }
      started = performance.now()
    }

    try {
      const repositories = createRepositories(source)
      await repositories.species.ensureCatalog()
      const species = await repositories.species.list()
      const goat = species.find(({ code }) => code === 'goat')!
      const sheep = species.find(({ code }) => code === 'sheep')!
      const animals = await Promise.all(Array.from({ length: 200 }, (_, index) => repositories.animals.save({
        id: newId(), speciesId: index < 180 ? goat.id : sheep.id, earTag: 'STRESS-' + index,
        sex: index % 5 === 0 ? 'male' : 'female', status: index < 15 ? 'archived' : 'active',
        createdAt: instant, updatedAt: instant,
      })))
      const events: HealthEvent[] = animals.flatMap(({ id }) =>
        (['checkup', 'vaccination', 'treatment', 'illness', 'followUp'] as const).map((kind) => ({
          id: newId(), animalId: id, kind, occurredAt: instant, createdAt: instant, updatedAt: instant,
          reason: 'Synthetic fixture', notes: 'Synthetic validation note',
        })))
      await source.healthEvents.bulkAdd(events)
      await source.vaccinations.bulkAdd(events.filter(({ kind }) => kind === 'vaccination').map((event) => ({
        id: newId(), animalId: event.animalId, healthEventId: event.id, productName: 'Synthetic vaccine', administeredAt: instant,
      })))
      await source.treatments.bulkAdd(events.filter(({ kind }) => kind === 'treatment').map((event) => ({
        id: newId(), animalId: event.animalId, healthEventId: event.id, medicineName: 'Synthetic product', startedAt: instant,
      })))
      for (let index = 0; index < 42; index++) {
        await source.animalPhotos.add({ animalId: animals[index].id, image: syntheticPhoto(index + 1) })
      }
      const audit = { id: newId(), entityType: 'animal', entityId: animals[0].id, action: 'fixture', occurredAt: instant, summary: 'Synthetic audit' }
      await source.auditEvents.add(audit)
      const original = await createRepositories(target).tasks.create({ title: 'Rollback fixture', dueDate: '2026-07-01', type: 'general' })
      measure('fixture')

      const exported = await createBackup(source)
      measure('export')
      expect(exported.file.size).toBeGreaterThan(125 * MiB)
      expect(exported.file.size).toBeLessThanOrEqual(maxBackupBytes)
      const file = new File([exported.file], exported.name, { type: 'application/json' })
      const tooLarge = new File([file, new Uint8Array(maxBackupBytes - file.size + 1)], 'oversized.backup.json', { type: 'application/json' })
      await expect(previewBackup(tooLarge)).rejects.toMatchObject({ code: 'size' })
      const preview = await previewBackup(file)
      measure('preview')
      expect(preview).toMatchObject({ archived: 15, counts: { animals: 200, healthEvents: 1000, animalPhotos: 42 } })

      const abort = (_id: string, _row: unknown, transaction: { abort(): void }) => transaction.abort()
      target.auditEvents.hook('creating', abort)
      await expect(restoreBackup(target, preview)).rejects.toThrow()
      expect(await target.tasks.get(original.id)).toEqual(original)
      expect(await target.animals.count()).toBe(0)
      expect(await target.animalPhotos.count()).toBe(0)
      target.auditEvents.hook('creating').unsubscribe(abort)
      measure('abortedRestore')

      await restoreBackup(target, preview)
      measure('restore')
      await restoreBackup(target, preview)
      measure('repeatedRestore')
      target.close()
      target = new LivestockDatabase(target.name)
      for (const table of source.tables.filter(({ name }) => name !== 'animalPhotos')) {
        expect(await target.table(table.name).toArray()).toEqual(await table.toArray())
      }
      const photos = await source.animalPhotos.toArray()
      for (const photo of photos) {
        const restored = await target.animalPhotos.get(photo.animalId)
        expect(restored?.image.type).toBe(photo.image.type)
        expect(restored?.image.size).toBe(photo.image.size)
        expect(await sha256(new Uint8Array(await restored!.image.arrayBuffer())))
          .toBe(await sha256(new Uint8Array(await photo.image.arrayBuffer())))
      }
      expect(await target.animalPhotos.count()).toBe(42)
      measure('reopenAndCompare')
      console.info('LivestockOS synthetic desktop backup stress', JSON.stringify({ fileBytes: file.size, measurements }))
    } finally {
      await target.delete()
      await source.delete()
    }
  },
  180_000,
)
