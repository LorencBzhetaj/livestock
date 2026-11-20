import {getAccess} from '../auth/access'
import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { animalSexes, animalStatuses, type Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { strings } from '../../i18n/strings'
import { ageBands, emptyFilters, filterAnimals, localToday } from './registry'
import { Field, speciesName, useLocalQuery } from './shared'

async function readRegistry() {
  const [animals, species, groups] = await Promise.all([
    repositories.animals.list(), repositories.species.list(), repositories.groups.list(),
  ])
  return { animals, species, groups }
}

export function AnimalList({ language }: { language: Language }) {
  const t = animalStrings[language]
  const result = useLocalQuery(readRegistry)
  const [filters, setFilters] = useState(emptyFilters)
  const location = useLocation()
  const imported = location.state?.imported as number | undefined
  const today = localToday()
  const split = useMemo(() => {
    if (!result?.data) return
    const { animals, species, groups } = result.data
    return {
      visible: filterAnimals(animals, filters, today)
        .sort((left, right) => left.earTag.localeCompare(right.earTag, language, { numeric: true })),
      breeds: [...new Set(animals.flatMap(({ breed }) => breed ? [breed] : []))]
        .sort((left, right) => left.localeCompare(right, language)),
      names: new Map(species.map((item) => [item.id, speciesName(item, language)])),
      groups,
      total: animals.length,
    }
  }, [result, filters, today, language])

  const choices = (key: keyof typeof emptyFilters, label: string, options: [string, string][]) => (
    <Field label={label}>
      <select className="registry-control" value={filters[key]}
        onChange={(event) => setFilters({ ...filters, [key]: event.currentTarget.value })}>
        <option value="">{t.all}</option>
        {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select>
    </Field>
  )

  return (
    <div className="registry">
      <div className="registry-heading">
        <h1>{t.registry}</h1>
        {getAccess()?.role!=='VETERINARIAN'&&<div className="flex flex-wrap gap-2">
          <Link className="registry-action secondary" to="import">{t.csv}</Link>
          <Link className="registry-action" to="new">{t.add}</Link>
        </div>}
      </div>
      {imported !== undefined && <p className="mt-4 text-pine" role="status">{t.imported} · {imported}</p>}
      {result?.error && <p className="registry-error mt-5" role="alert">{strings[language].error}</p>}
      {!result && <p className="mt-5" role="status">{strings[language].loading}</p>}
      {split && (
        <>
          <section className="panel mt-6">
            <Field label={t.search}>
              <input className="registry-control" type="search" value={filters.search}
                onChange={(event) => setFilters({ ...filters, search: event.currentTarget.value })} />
            </Field>
            <div className={`mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 ${split.groups.length ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
              {choices('speciesId', t.species, [...split.names])}
              {choices('breed', t.breed, split.breeds.map((value) => [value, value]))}
              {choices('sex', t.sex, animalSexes.map((value) => [value, t[value]]))}
              {choices('age', t.age, ageBands.map((value) => [value, t[value]]))}
              {choices('status', t.status, animalStatuses.map((value) => [value, t[value]]))}
              {split.groups.length > 0 && choices('groupId', t.group, split.groups.map(({ id, name }) => [id, name]))}
            </div>
          </section>
          <div className="mt-4 flex min-h-11 flex-wrap items-center justify-between gap-2">
            <p className="text-sm tabular-nums text-stone-700" role="status">{t.results} · {split.visible.length} / {split.total}</p>
            {Object.values(filters).some(Boolean) &&
              <button className="registry-action secondary" onClick={() => setFilters(emptyFilters)}>{t.clear}</button>}
          </div>
          {split.visible.length ? (
            <ul className="mt-2 divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
              {split.visible.map((animal) => (
                <li key={animal.id}>
                  <Link to={animal.id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2.5 hover:bg-green-50 focus-visible:outline-offset-[-3px] sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_8rem]">
                    <span className="min-w-0 break-words font-semibold text-pine">{animal.earTag}
                      {animal.name && <span className="ml-1 font-normal text-stone-800">{' '}{animal.name}</span>}
                    </span>
                    <span className="col-start-1 row-start-2 min-w-0 break-words text-sm text-stone-700 sm:col-start-auto sm:row-start-auto">
                      {[split.names.get(animal.speciesId), animal.breed, t[animal.sex]].filter(Boolean).join(' · ')}
                    </span>
                    <span className="col-start-2 row-start-1 text-right text-sm sm:col-start-auto sm:row-start-auto">
                      {t[animal.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="panel mt-2">{split.total ? t.noResults : strings[language].empty}</p>}
        </>
      )}
    </div>
  )
}
