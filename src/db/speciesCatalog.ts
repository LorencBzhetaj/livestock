import type { Species } from './models'

export const speciesCatalog: Omit<Species, 'id'>[] = [
  { code: 'goat', displayNameSq: 'Dhi', displayNameEn: 'Goat', active: true },
  { code: 'sheep', displayNameSq: 'Dele', displayNameEn: 'Sheep', active: true },
  { code: 'cattle', displayNameSq: 'Gjedh', displayNameEn: 'Cattle', active: true },
  { code: 'other', displayNameSq: 'Tjetër', displayNameEn: 'Other', active: true },
]
