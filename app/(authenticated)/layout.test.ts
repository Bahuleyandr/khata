// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthLayout from './layout'
import { getMe, logout } from '../../lib/api'

const replace = vi.fn()

vi.mock('next/link', () => ({ default: 'a' }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace }),
}))
vi.mock('../../lib/api', () => ({
  getMe: vi.fn(),
  logout: vi.fn(),
}))

describe('AuthLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the protected shell and clears the session on logout', async () => {
    const user = userEvent.setup()
    vi.mocked(getMe).mockResolvedValue({ telegram_user_id: 42, first_name: 'Ada' })
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
