import { useRef, useState, type ChangeEvent } from 'react'
import type { Language } from '../../db/models'
import { database } from '../../db/repositories'
import { backupStrings } from '../../i18n/backup'
import { createBackup, previewBackup, restoreBackup, type RestorePreview } from './backup'
import { BackupError } from './format'
import { notifyRestore } from './restoreNotice'

type Notice = { error: boolean; message: keyof typeof backupStrings.en; size?: number }

export default function BackupSettings({ language }: { language: Language }) {
  const t = backupStrings[language]
  const [busy, setBusy] = useState<'exporting' | 'reading' | 'restoring'>()
  const [preview, setPreview] = useState<RestorePreview>()
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const locked = useRef(false)
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 2 })
  const sizeLabel = (size: number) => size >= 1024 * 1024
    ? number.format(size / (1024 * 1024)) + ' MiB'
    : number.format(size / 1024) + ' KiB'

  async function perform(action: NonNullable<typeof busy>, failure: Notice['message'], work: () => Promise<void>) {
    if (locked.current) return
    locked.current = true
    setBusy(action)
    setNotice(undefined)
    try {
      await work()
    } catch (error) {
      setNotice({ error: true, message: error instanceof BackupError ? error.code : failure })
    } finally {
      locked.current = false
      setBusy(undefined)
    }
  }

  function download() {
    void perform('exporting', 'exportFailed', async () => {
      const backup = await createBackup(database)
      const url = URL.createObjectURL(backup.file)
      const link = document.createElement('a')
      link.href = url
      link.download = backup.name
      document.body.append(link)
      try {
        link.click()
        setNotice({ error: false, message: 'exported', size: backup.file.size })
      } finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 3000)
      }
    })
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    if (locked.current) return
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    setConfirmed(false)
    setPreview(undefined)
    if (file) void perform('reading', 'malformed', async () => setPreview(await previewBackup(file)))
  }

  function restore() {
    if (!preview || !confirmed) return
    void perform('restoring', 'restoreFailed', async () => {
      await restoreBackup(database, preview)
      setPreview(undefined)
      setConfirmed(false)
      setNotice({ error: false, message: 'restored' })
      notifyRestore()
    })
  }

  return (
    <section className="panel mt-4" aria-labelledby="backup-heading">
      <h2 id="backup-heading">{t.title}</h2>
      <p className="mt-2 max-w-prose">{t.privacy}</p>
      <button type="button" disabled={Boolean(busy)} onClick={download}>{t.export}</button>
      <div className="mt-5 border-t border-stone-200 pt-4">
        <label className="grid max-w-md gap-1 text-sm font-semibold">
          {t.choose}
          <input className="registry-control" type="file" accept=".json,application/json" disabled={Boolean(busy)} onChange={selectFile} />
        </label>
        <p className="mt-2 text-sm">{t.size}</p>
      </div>
      {preview && (
        <div className="mt-5 rounded-md border border-stone-300 p-4">
          <h3 className="font-semibold text-pine">{t.preview}</h3>
          <p className="mt-2 text-sm">{t.compatible} {t.integrity}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
              <dt>{t.date}</dt>
              <dd><time dateTime={preview.exportedAt}>
                {new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(preview.exportedAt))}
              </time></dd>
            </div>
            <div><dt>{t.sizeLabel}</dt><dd>{sizeLabel(preview.size)}</dd></div>
            {([
              [t.animals, preview.counts.animals], [t.archived, preview.archived], [t.veterinary, preview.counts.healthEvents],
              [t.photosLabel, preview.counts.animalPhotos], [t.tasks, preview.counts.tasks],
            ] as const).map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd className="font-semibold">{value}</dd></div>
            ))}
          </dl>
          <p className="mt-4 text-sm font-semibold">{t.warning}</p>
          <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmed} disabled={Boolean(busy)}
              onChange={(event) => setConfirmed(event.currentTarget.checked)} />
            <span>{t.confirm}</span>
          </label>
          <button type="button" className="registry-action danger" disabled={!confirmed || Boolean(busy)} onClick={restore}>{t.restore}</button>
        </div>
      )}
      {busy && <p className="mt-3" role="status">{t[busy]}</p>}
      {notice && <p className={notice.error ? 'registry-error mt-3' : 'mt-3 text-pine'} role={notice.error ? 'alert' : 'status'}>
        {t[notice.message]}{notice.size !== undefined && ' · ' + sizeLabel(notice.size)}
      </p>}
    </section>
  )
}
