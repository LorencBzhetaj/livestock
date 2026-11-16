// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { App } from '../src/app/App'
import { database } from '../src/db/repositories'

afterEach(async () => {
  cleanup()
  await database.delete()
})

test('keeps the farm empty until the owner opts in to demo records', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><App /></MemoryRouter>)
  await screen.findByText('Nuk ka ende kafshë të regjistruara.')
  expect(await database.animals.count()).toBe(0)
  await user.click(screen.getByRole('link', { name: 'Cilësimet' }))
  await user.click(screen.getByRole('button', { name: 'Shto të dhënat DEMO' }))
  await screen.findByText('Të dhënat DEMO janë shtuar në këtë pajisje.')
  expect(await database.animals.count()).toBe(3)
})
