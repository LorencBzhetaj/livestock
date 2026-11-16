import type { Animal } from '../../db/models'

export const ageBands = ['underOne', 'oneToThree', 'fourPlus', 'ageUnknown'] as const

export function ageInYears(birthDate: string | undefined, today: string) {
  if (!birthDate || birthDate > today) return undefined
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4))
  return years - Number(today.slice(5) < birthDate.slice(5))
}

export function localToday() {
  const date = new Date()
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0')).join('-')
}

export const emptyFilters = { search: '', speciesId: '', breed: '', sex: '', age: '', status: '', groupId: '' }

export function filterAnimals(animals: Animal[], filters: typeof emptyFilters, today: string) {
  const query = filters.search.trim().toLowerCase()
  return animals.filter((animal) => {
    if (query && !animal.earTag.toLowerCase().includes(query) && !animal.name?.toLowerCase().includes(query)) return false
    if (filters.speciesId && animal.speciesId !== filters.speciesId) return false
    if (filters.breed && animal.breed !== filters.breed) return false
    if (filters.sex && animal.sex !== filters.sex) return false
    if (filters.status && animal.status !== filters.status) return false
    if (filters.groupId && animal.groupId !== filters.groupId) return false
    if (!filters.age) return true
    const age = ageInYears(animal.birthDate, today)
    const band = age === undefined ? 'ageUnknown' : age < 1 ? 'underOne' : age < 4 ? 'oneToThree' : 'fourPlus'
    return filters.age === band
  })
}
