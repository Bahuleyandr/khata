// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthLayout from './layout'
import { getLedgers, getMe, logout } from '../../lib/api'

const replace = vi.fn()

vi.mock('next/link', () => ({ default: 'a' }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace }),
}))
vi.mock('../../lib/api', () => ({
  getLedgers: vi.fn(),
  getMe: vi.fn(),
  getSelectedLedgerId: vi.fn(() => null),
  logout: vi.fn(),
  setSelectedLedgerId: vi.fn(),
}))

describe('AuthLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the protected shell and clears the session on logout', async () => {
    const user = userEvent.setup()
    vi.mocked(getMe).mockResolvedValue({
      telegram_user_id: 42,
      ledger_user_id: 42,
      personal_ledger_id: 42,
      first_name: 'Ada',
      role: 'owner',
      is_owner: true,
      selected_ledger_id: 42,
      selected_ledger_name: 'Personal',
      selected_ledger_kind: 'personal',
      can_view: true,
      can_add: true,
      can_manage: true,
    })
    vi.mocked(getLedgers).mockResolvedValue({
      selected_ledger_id: 42,
      ledgers: [{
        id: 42,
        name: 'Personal',
        kind: 'personal',
        owner_telegram_user_id: 42,
        role: 'owner',
        can_view: true,
        can_add: true,
        can_manage: true,
      }],
    })
    vi.mocked(logout).mockResolvedValue()

    render(React.createElement(AuthLayout, null, React.createElement('main', null, 'Secure area')))

    expect(await screen.findByText('Secure area')).toBeTruthy()
    expect(screen.getByText('Hi, Ada')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Logout' }))

    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(replace).toHaveBeenCalledWith('/login')
  })

  it('redirects anonymous users to login', async () => {
    vi.mocked(getMe).mockRejectedValue(new Error('not authenticated'))

    render(React.createElement(AuthLayout, null, React.createElement('main', null, 'Secure area')))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
  })
})
