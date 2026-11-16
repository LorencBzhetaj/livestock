import type { PwaState } from '../app/pwa'

const sq = {
  preparing: 'Duke përgatitur aplikacionin për përdorim pa internet…',
  ready: 'Aplikacioni është gati për përdorim pa internet.',
  waiting: 'Një përditësim është gati. Ruani punën, prisni të përfundojë çdo rikthim, pastaj mbyllni të gjitha skedat dhe hapeni përsëri aplikacionin.',
  insecure: 'Për instalim dhe përdorim pa internet, hapeni aplikacionin me HTTPS.',
  unavailable: 'Aplikacioni nuk u përgatit për përdorim pa internet. Provojeni përsëri në linjë me një shfletues të mbështetur.',
  development: 'Për të testuar instalimin dhe përdorimin pa internet, hapni versionin e ndërtuar.',
  peerRestore: 'Të dhënat u rikthyen në një skedë tjetër. Kopjoni shënimet e paruajtura që ju duhen dhe rihapeni këtë skedë përpara se të ruani ndryshime.',
}

const en: typeof sq = {
  preparing: 'Preparing the app for offline use…',
  ready: 'The app is ready for offline use.',
  waiting: 'An update is ready. Save your work and let any restore finish, then close every LivestockOS tab or window and reopen the app.',
  insecure: 'Open the app over HTTPS to install it and use it offline.',
  unavailable: 'The app could not prepare for offline use. Try again online in a supported browser.',
  development: 'Open the production build to test installation and offline use.',
  peerRestore: 'Data was restored in another tab. Copy any unsaved notes you need, then reopen this tab before saving changes.',
}

export const pwaStrings: Record<'sq' | 'en', Record<PwaState | 'peerRestore', string>> = { sq, en }
