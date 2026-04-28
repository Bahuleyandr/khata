// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionsPage from './page'
import {
  deleteExpense,
  getCategories,
  getExpenses,
  mergeExpense,
  updateExpense,
  type Expense,
} from '../../../lib/api'

vi.mock('../../../lib/api', () => ({
  deleteExpense: vi.fn(),
  getCategories: vi.fn(),
  getExpenses: vi.fn(),
  mergeExpense: vi.fn(),
  updateExpense: vi.fn(),
  formatCents: (cents: string | number, currency = 'INR') => `${currency} ${(Number(cents) / 100).toFixed(2)}`,
  formatDate: (iso: string) => iso.slice(0, 10),
}))

const baseExpense: Expense = {
  id: 'expense-1',
  amount_cents: '125000',
  currency: 'INR',
  description: 'Lunch with team',
  merchant: 'OpenAI Cafe',
  category_id: 'cat-food',
  category: 'Food',
  source: 'receipt',
  occurred_at: '2026-04-20T10:00:00.000Z',
  image_key: 'receipt.jpg',
}

const duplicateExpense: Expense = {
  ...baseExpense,
  id: 'expense-2',
  amount_cents: '125000',
  merchant: 'OPENAI CAFE',
  source: 'statement',
  image_key: null,
}

describe('TransactionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })
    Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), writable: true })
    vi.mocked(getCategories).mockResolvedValue([{ id: 'cat-food', name: 'Food' }])
    vi.mocked(getExpenses).mockResolvedValue({
      data: [baseExpense, duplicateExpense],
      total: 2,
      page: 1,
      totalPages: 1,
    })
    vi.mocked(updateExpense).mockResolvedValue({ ...baseExpense, amount_cents: '19900', merchant: 'OpenAI' })
    vi.mocked(deleteExpense).mockResolvedValue()
    vi.mocked(mergeExpense).mockResolvedValue(baseExpense)
  })

  it('loads, filters, edits, merges, and deletes transactions', async () => {
    const user = userEvent.setup()
    render(React.createElement(TransactionsPage))

    expect(await screen.findByText('OpenAI Cafe')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download Excel' }).getAttribute('href')).toContain(
      '/api/export/xlsx?year=',
    )

    await user.click(screen.getByLabelText('Receipt'))
    await waitFor(() => expect(getExpenses).toHaveBeenCalledWith(expect.objectContaining({ source: 'receipt' })))

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    const editDialog = screen.getByRole('dialog', { name: 'Edit Transaction' })
    await user.clear(within(editDialog).getByLabelText('Amount'))
    await user.type(within(editDialog).getByLabelText('Amount'), '199')
    await user.clear(within(editDialog).getByLabelText('Merchant'))
    await user.type(within(editDialog).getByLabelText('Merchant'), 'OpenAI')
    await user.click(within(editDialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateExpense).toHaveBeenCalledWith(
        'expense-1',
        expect.objectContaining({
          amount_cents: 19900,
          merchant: 'OpenAI',
          category_id: 'cat-food',
        }),
      ),
    )

    await user.click(screen.getAllByRole('button', { name: 'Merge' })[0])
    const mergeDialog = screen.getByRole('dialog', { name: 'Merge Duplicate' })
    await user.selectOptions(within(mergeDialog).getByLabelText('Duplicate to remove'), 'expense-2')
    await user.click(within(mergeDialog).getByRole('button', { name: 'Merge' }))

    await waitFor(() => expect(mergeExpense).toHaveBeenCalledWith('expense-1', 'expense-2'))

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => expect(deleteExpense).toHaveBeenCalledWith('expense-1'))
  })
})
