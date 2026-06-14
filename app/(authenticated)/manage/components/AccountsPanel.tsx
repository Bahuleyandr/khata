'use client'

import { useState } from 'react'
import type { Account, AccountType } from '../../../../lib/api'

export default function AccountsPanel({
  accounts,
  busy,
  onAdd,
  onSetDefault,
  onArchive,
}: {
  accounts: Account[]
  busy: boolean
  onAdd: (data: { name: string; type: AccountType; institution: string | null; last_four: string | null; is_default: boolean }) => Promise<boolean>
  onSetDefault: (accountId: string) => Promise<boolean>
  onArchive: (accountId: string) => Promise<boolean>
}) {
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountType, setNewAccountType] = useState<AccountType>('card')
  const [newAccountInstitution, setNewAccountInstitution] = useState('')
  const [newAccountLastFour, setNewAccountLastFour] = useState('')

  async function createNewAccount() {
    if (!newAccountName.trim()) return
    const ok = await onAdd({
      name: newAccountName,
      type: newAccountType,
      institution: newAccountInstitution.trim() || null,
      last_four: newAccountLastFour.trim() || null,
      is_default: accounts.length === 0,
    })
    if (ok) {
      setNewAccountName('')
      setNewAccountInstitution('')
      setNewAccountLastFour('')
    }
  }

  return (
    <section className="card workspace-card">
      <h3>Accounts</h3>
      <div className="inline-form">
        <input value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} placeholder="AmEx Platinum" />
        <select value={newAccountType} onChange={(e) => setNewAccountType(e.target.value as AccountType)}>
          <option value="card">Card</option>
          <option value="bank">Bank</option>
          <option value="upi">UPI</option>
          <option value="wallet">Wallet</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
        <input value={newAccountInstitution} onChange={(e) => setNewAccountInstitution(e.target.value)} placeholder="Institution" />
        <input value={newAccountLastFour} onChange={(e) => setNewAccountLastFour(e.target.value)} placeholder="Last 4" />
        <button type="button" onClick={() => void createNewAccount()} disabled={busy || !newAccountName.trim()}>Add</button>
      </div>
      <div className="statement-list">
        {accounts.length === 0 ? <p>No accounts yet.</p> : accounts.map((account) => (
          <div key={account.id} className="statement-row">
            <div>
              <strong>{account.name} {account.is_default ? <span className="badge badge-confirmed">default</span> : null}</strong>
              <span>{account.type}{account.institution ? ` · ${account.institution}` : ''}{account.last_four ? ` · **${account.last_four}` : ''}</span>
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => void onSetDefault(account.id)} disabled={busy || account.is_default}>
                Default
              </button>
              <button type="button" className="danger" onClick={() => void onArchive(account.id)} disabled={busy}>
                Archive
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
