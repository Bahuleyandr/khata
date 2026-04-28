// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReceiptsPage from './page'
import {
  getCategories,
  getReceipts,
  updateExpense,
  type Expense,
  type Receipt,
} from '../../../lib/api'

vi.mock('../../../lib/api', () => ({
  getCategories: vi.fn(),
  getReceipts: vi.fn(),
  updateExpense: vi.fn(),
  formatCents: (cents: string | number, currency = 'INR') => `${currency} ${(Number(cents) / 100).toFixed(2)}`,
  formatDate: (iso: string) => iso.slice(0, 10),
}))

const receipt: Receipt = {
  id: 'receipt-1',
  amount_cents: '120000',
  currency: 'INR',
  description: 'Receipt OCR note',
  merchant: 'Corner Store',
  category_id: null,
  category: 'Uncategorized',
  occurred_at: '2026-04-18T09:30:00.000Z',
  image_key: 'receipts/corner-store.jpg',
  receipt_url: '/api/receipts/receipt-1/image',
}

const secondReceipt: Receipt = {
  ...receipt,
  id: 'receipt-2',
  amount_cents: '8000',
  merchant: 'Bakery',
  description: 'Breakfast',
  image_key: 'receipts/bakery.jpg',
  receipt_url: '/api/receipts/receipt-2/image',
}

const updatedExpense: Expense = {
  ...receipt,
  amount_cents: '15500',
  merchant: 'Corner Store Fixed',
  category_id: 'cat-groceries',
  category: 'Groceries',
  source: 'receipt',
}

describe('ReceiptsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })
    vi.mocked(getCategories).mockResolvedValue([{ id: 'cat-groceries', name: 'Groceries' }])
    vi.mocked(getReceipts).mockResolvedValue({
      data: [receipt, secondReceipt],
      total: 2,
      page: 1,
      totalPages: 1,
    })
    vi.mocked(updateExpense).mockResolvedValue(updatedExpense)
  })

  it('opens the receipt review modal and saves corrected fields', async () => {
    const user = userEvent.setup()
    render(React.createElement(ReceiptsPage))

    await user.click(await screen.findByRole('button', { name: /Corner Store/ }))
    const dialog = screen.getByRole('dialog', { name: 'Review Receipt' })
    expect(within(dialog).getByText('Receipt 1 of 2')).toBeTruthy()

    await user.clear(within(dialog).getByLabelText('Amount'))
    await user.type(within(dialog).getByLabelText('Amount'), '155')
    await user.clear(within(dialog).getByLabelText('Merchant'))
    await user.type(within(dialog).getByLabelText('Merchant'), 'Corner Store Fixed')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'cat-groceries')
    await user.click(within(dialog).getByRole('button', { name: 'Save & Next' }))

    await waitFor(() =>
      expect(updateExpense).toHaveBeenCalledWith(
        'receipt-1',
        expect.objectContaining({
          amount_cents: 15500,
          merchant: 'Corner Store Fixed',
          category_id: 'cat-groceries',
        }),
      ),
    )
    expect(await within(dialog).findByText(/Bakery/)).toBeTruthy()
  })
})
