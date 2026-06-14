'use client'

import { useState } from 'react'
import { formatDate, type AccessRole, type AccessUser, type Ledger, type Me } from '../../../../lib/api'
import { ledgerDisplayName, ledgerPermissionSummary, type AccessPreset } from './helpers'

function AccessUserRow({
  user,
  me,
  busy,
  onChange,
  onRevoke,
  onReactivate,
}: {
  user: AccessUser
  me: Me
  busy: boolean
  onChange: (data: { role?: AccessRole; can_view?: boolean; can_add?: boolean }) => Promise<boolean>
  onRevoke: () => Promise<boolean>
  onReactivate: () => Promise<boolean>
}) {
  const isProtectedOwner = user.telegram_user_id === user.ledger_id || me.telegram_user_id === user.telegram_user_id
  const name = user.first_name || user.username || `Telegram ${user.telegram_user_id}`
  const username = user.username ? `@${user.username.replace(/^@/, '')}` : null

  return (
    <div className="statement-row access-row">
      <div>
        <strong>
          {name}
          <span className={`badge badge-${user.status}`}>{user.status}</span>
          {me.telegram_user_id === user.telegram_user_id ? <span className="badge badge-muted">you</span> : null}
          {user.can_view ? null : <span className="badge badge-muted">hidden</span>}
        </strong>
        <span>
          {user.telegram_user_id}
          {username ? ` · ${username}` : ''}
          {` · ${user.can_add ? 'can add' : 'view only'}`}
          {user.last_login_at ? ` · Last login ${formatDate(user.last_login_at)}` : ''}
        </span>
      </div>
      <div className="row-actions">
        <select
          value={user.role}
          onChange={(e) => void onChange({ role: e.target.value as AccessRole })}
          disabled={busy || isProtectedOwner || user.status !== 'active'}
          aria-label={`Role for ${name}`}
        >
          <option value="member">Member</option>
          <option value="owner">Owner</option>
        </select>
        <label className="access-toggle">
          <input
            type="checkbox"
            checked={user.can_view}
            onChange={(e) => void onChange({ can_view: e.target.checked })}
            disabled={busy || isProtectedOwner || user.status !== 'active'}
          />
          View
        </label>
        <label className="access-toggle">
          <input
            type="checkbox"
            checked={user.can_add}
            onChange={(e) => void onChange({ can_add: e.target.checked })}
            disabled={busy || isProtectedOwner || user.status !== 'active' || !user.can_view}
          />
          Add
        </label>
        {user.status === 'revoked' ? (
          <button type="button" onClick={() => void onReactivate()} disabled={busy}>
            Re-activate
          </button>
        ) : (
          <button type="button" className="danger" onClick={() => void onRevoke()} disabled={busy || isProtectedOwner}>
            Revoke
          </button>
        )}
      </div>
    </div>
  )
}

export default function LedgerAccessPanel({
  me,
  ledgers,
  accessUsers,
  busy,
  onSwitchLedger,
  onAddUser,
  onChangeUser,
  onRevokeUser,
  onReactivateUser,
}: {
  me: Me | null
  ledgers: Ledger[]
  accessUsers: AccessUser[]
  busy: boolean
  onSwitchLedger: (ledgerId: number) => void
  onAddUser: (data: {
    telegram_user_id: string
    first_name?: string
    username?: string
    role: AccessRole
    can_view: boolean
    can_add: boolean
  }) => Promise<boolean>
  onChangeUser: (user: AccessUser, data: { role?: AccessRole; can_view?: boolean; can_add?: boolean }) => Promise<boolean>
  onRevokeUser: (user: AccessUser) => Promise<boolean>
  onReactivateUser: (user: AccessUser) => Promise<boolean>
}) {
  const [newAccessTelegramId, setNewAccessTelegramId] = useState('')
  const [newAccessName, setNewAccessName] = useState('')
  const [newAccessUsername, setNewAccessUsername] = useState('')
  const [newAccessPreset, setNewAccessPreset] = useState<AccessPreset>('partner')
  const [newAccessRole, setNewAccessRole] = useState<AccessRole>('member')
  const [newAccessCanView, setNewAccessCanView] = useState(true)
  const [newAccessCanAdd, setNewAccessCanAdd] = useState(true)

  const selectedLedger = ledgers.find((ledger) => ledger.id === me?.selected_ledger_id)
  const householdLedger = ledgers.find((ledger) => ledger.kind === 'household')

  function applyAccessPreset(preset: AccessPreset) {
    setNewAccessPreset(preset)
    if (preset === 'owner') {
      setNewAccessRole('owner')
      setNewAccessCanView(true)
      setNewAccessCanAdd(true)
      return
    }
    setNewAccessRole('member')
    setNewAccessCanView(true)
    setNewAccessCanAdd(preset === 'partner')
  }

  async function addAccessUser() {
    const telegramId = newAccessTelegramId.trim()
    if (!telegramId) return
    const ok = await onAddUser({
      telegram_user_id: telegramId,
      first_name: newAccessName.trim() || undefined,
      username: newAccessUsername.trim().replace(/^@/, '') || undefined,
      role: newAccessRole,
      can_view: newAccessCanView,
      can_add: newAccessCanView && newAccessCanAdd,
    })
    if (ok) {
      setNewAccessTelegramId('')
      setNewAccessName('')
      setNewAccessUsername('')
      applyAccessPreset('partner')
    }
  }

  return (
    <section className="card workspace-card wide-card">
      <h3>Ledger Access</h3>
      <div className="access-summary-grid">
        <span>
          <strong>{me?.telegram_user_id ?? '...'}</strong>
          <small>Your Telegram ID</small>
        </span>
        <span>
          <strong>{me?.selected_ledger_name ?? '...'}</strong>
          <small>{me?.selected_ledger_kind === 'household' ? 'Shared ledger' : 'Personal ledger'}</small>
        </span>
        <span>
          <strong>{me?.role ?? '...'}</strong>
          <small>Your role</small>
        </span>
        <span>
          <strong>{me ? ledgerPermissionSummary(me) : '...'}</strong>
          <small>Current access</small>
        </span>
      </div>
      {ledgers.length > 0 ? (
        <div className="ledger-family-panel">
          <h4>Family Ledgers</h4>
          <div className="ledger-family-grid">
            {ledgers.map((ledger) => {
              const selected = ledger.id === me?.selected_ledger_id
              return (
                <button
                  key={ledger.id}
                  type="button"
                  className={`ledger-family-card ${selected ? 'selected' : ''}`}
                  onClick={() => onSwitchLedger(ledger.id)}
                  disabled={busy || selected}
                >
                  <strong>{ledgerDisplayName(ledger, me)}</strong>
                  <span>{ledger.kind === 'household' ? 'Shared household' : 'Personal'} · {ledgerPermissionSummary(ledger)}</span>
                  <small>{selected ? 'Selected' : 'Switch'}</small>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      {selectedLedger ? (
        <div className={`access-advisory ${selectedLedger.kind}`}>
          <span>
            {selectedLedger.kind === 'household'
              ? 'Household ledger selected · shared spending stays separate from personal ledgers.'
              : 'Personal ledger selected · invites here can see this personal ledger.'}
          </span>
          {selectedLedger.kind === 'personal' && householdLedger ? (
            <button type="button" onClick={() => onSwitchLedger(householdLedger.id)} disabled={busy}>
              Switch to Household
            </button>
          ) : null}
        </div>
      ) : null}
      {me?.can_manage ? (
        <>
          <p className="muted-copy access-note">
            Access changes apply only to the selected ledger in the top navigation.
          </p>
          <div className="inline-form access-form">
            <select
              value={newAccessPreset}
              onChange={(e) => applyAccessPreset(e.target.value as AccessPreset)}
              aria-label="Invite preset"
            >
              <option value="partner">Partner: view + add</option>
              <option value="viewer">Viewer: view only</option>
              <option value="owner">Owner: manage ledger</option>
            </select>
            <input
              inputMode="numeric"
              value={newAccessTelegramId}
              onChange={(e) => setNewAccessTelegramId(e.target.value)}
              placeholder="Telegram user ID"
              aria-label="Telegram user ID"
            />
            <input
              value={newAccessName}
              onChange={(e) => setNewAccessName(e.target.value)}
              placeholder="Display name"
              aria-label="Access display name"
            />
            <input
              value={newAccessUsername}
              onChange={(e) => setNewAccessUsername(e.target.value)}
              placeholder="@username"
              aria-label="Telegram username"
            />
            <select
              value={newAccessRole}
              onChange={(e) => {
                const role = e.target.value as AccessRole
                setNewAccessRole(role)
                if (role === 'owner') setNewAccessPreset('owner')
                else if (newAccessPreset === 'owner') setNewAccessPreset('partner')
              }}
              aria-label="Access role"
            >
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
            <label className="access-toggle">
              <input
                type="checkbox"
                checked={newAccessCanView}
                onChange={(e) => {
                  setNewAccessCanView(e.target.checked)
                  if (!e.target.checked) setNewAccessCanAdd(false)
                }}
              />
              View
            </label>
            <label className="access-toggle">
              <input
                type="checkbox"
                checked={newAccessCanAdd}
                onChange={(e) => setNewAccessCanAdd(e.target.checked)}
                disabled={!newAccessCanView}
              />
              Add
            </label>
            <button type="button" onClick={() => void addAccessUser()} disabled={busy || !newAccessTelegramId.trim()}>
              Add
            </button>
          </div>
          <div className="statement-list">
            {accessUsers.length === 0 ? <p>No access users yet.</p> : accessUsers.map((user) => (
              <AccessUserRow
                key={user.telegram_user_id}
                user={user}
                me={me}
                busy={busy}
                onChange={(data) => onChangeUser(user, data)}
                onRevoke={() => onRevokeUser(user)}
                onReactivate={() => onReactivateUser(user)}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="muted-copy">Only ledger owners can add, remove, or change visibility.</p>
      )}
    </section>
  )
}
