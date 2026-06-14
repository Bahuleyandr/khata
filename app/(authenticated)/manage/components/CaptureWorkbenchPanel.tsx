'use client'

import { useState } from 'react'
import { formatDate, type CaptureCountSummary, type CaptureEvent, type CaptureFailureSummary } from '../../../../lib/api'
import { CAPTURE_FAILURE_KINDS, CAPTURE_SOURCES, captureLabel, captureRulePattern, type CaptureStatusFilter } from './helpers'
import type { RuleDraft } from './SmartRulesPanel'

export default function CaptureWorkbenchPanel({
  captures,
  captureStatusCounts,
  captureSourceCounts,
  captureFailures,
  captureStatus,
  captureSource,
  captureFailureKind,
  captureSearch,
  busy,
  onSetCaptureStatus,
  onSetCaptureSource,
  onSetCaptureFailureKind,
  onSetCaptureSearch,
  onReplay,
  onIgnore,
  onMakeRule,
}: {
  captures: CaptureEvent[]
  captureStatusCounts: CaptureCountSummary[]
  captureSourceCounts: CaptureCountSummary[]
  captureFailures: CaptureFailureSummary[]
  captureStatus: CaptureStatusFilter
  captureSource: string
  captureFailureKind: string
  captureSearch: string
  busy: boolean
  onSetCaptureStatus: (value: CaptureStatusFilter) => void
  onSetCaptureSource: (value: string) => void
  onSetCaptureFailureKind: (value: string) => void
  onSetCaptureSearch: (value: string) => void
  onReplay: (captureId: string) => Promise<void>
  onIgnore: (captureId: string) => Promise<void>
  onMakeRule: (draft: RuleDraft) => void
}) {
  const [captureActionResult, setCaptureActionResult] = useState<string | null>(null)

  function draftRuleFromCapture(capture: CaptureEvent) {
    const draft: RuleDraft = {
      name: `${captureLabel(capture.source)} correction`,
      scope: 'raw_text',
      matchType: 'contains',
      pattern: captureRulePattern(capture),
      reviewStatus: 'reviewed',
    }
    setCaptureActionResult('Rule draft populated. Pick category/account/tags in Smart Rules, then Add.')
    onMakeRule(draft)
    window.location.hash = 'smart-rules'
  }

  return (
    <section className="card workspace-card wide-card" id="capture-workbench">
      <div className="chart-card-heading">
        <div>
          <span>Replay, diagnose, teach</span>
          <h3>Capture Workbench</h3>
        </div>
      </div>
      <div className="inline-form">
        <select value={captureStatus} onChange={(e) => onSetCaptureStatus(e.target.value as CaptureStatusFilter)} aria-label="Capture status">
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="processed">Processed</option>
          <option value="ignored">Ignored</option>
        </select>
        <select value={captureSource} onChange={(e) => onSetCaptureSource(e.target.value)} aria-label="Capture source">
          <option value="">All sources</option>
          {CAPTURE_SOURCES.map((source) => (
            <option key={source} value={source}>{captureLabel(source)}</option>
          ))}
        </select>
        <select value={captureFailureKind} onChange={(e) => onSetCaptureFailureKind(e.target.value)} aria-label="Failure kind">
          <option value="">All failures</option>
          {CAPTURE_FAILURE_KINDS.map((kind) => (
            <option key={kind} value={kind}>{captureLabel(kind)}</option>
          ))}
        </select>
        <input
          value={captureSearch}
          onChange={(e) => onSetCaptureSearch(e.target.value)}
          placeholder="Search raw text or error"
          aria-label="Search captures"
        />
        <button
          type="button"
          onClick={() => {
            onSetCaptureSource('')
            onSetCaptureFailureKind('')
            onSetCaptureSearch('')
          }}
        >
          Clear
        </button>
      </div>
      {captureActionResult ? <div className="success-msg">{captureActionResult}</div> : null}
      <div className="failure-summary-grid">
        {captureStatusCounts.map((status) => (
          <button key={status.key} type="button" onClick={() => onSetCaptureStatus(status.key as CaptureStatusFilter)}>
            <strong>{status.count}</strong>
            <small>{captureLabel(status.key)}</small>
          </button>
        ))}
        {captureSourceCounts.slice(0, 4).map((source) => (
          <button key={source.key} type="button" onClick={() => onSetCaptureSource(source.key)}>
            <strong>{source.count}</strong>
            <small>{captureLabel(source.key)}</small>
          </button>
        ))}
      </div>
      {captureFailures.length > 0 ? (
        <div className="failure-summary-grid">
          {captureFailures.map((failure) => (
            <button key={failure.failure_kind} type="button" onClick={() => onSetCaptureFailureKind(failure.failure_kind)}>
              <strong>{failure.count}</strong>
              <small>{captureLabel(failure.failure_kind)}</small>
            </button>
          ))}
        </div>
      ) : null}
      <div className="statement-list">
        {captures.length === 0 ? <p>No captures for this filter.</p> : captures.map((capture) => (
          <div key={capture.id} className="statement-row capture-row">
            <div>
              <strong>
                {capture.source}
                <span className={`badge badge-${capture.status}`}>{capture.status}</span>
                {capture.failure_kind ? <span className="badge badge-muted">{captureLabel(capture.failure_kind)}</span> : null}
              </strong>
              <span>{capture.diagnosis?.title ?? capture.error_reason ?? capture.parsed_expense_label ?? 'No detail'}</span>
              <small>
                {formatDate(capture.created_at)}
                {capture.replay_count ? ` · replayed ${capture.replay_count}x` : ''}
                {capture.last_replayed_at ? ` · last replay ${formatDate(capture.last_replayed_at)}` : ''}
                {typeof capture.confidence?.overall === 'number' ? ` · confidence ${capture.confidence.overall}%` : ''}
              </small>
              {capture.raw_text ? <small>{capture.raw_text.slice(0, 240)}</small> : null}
              <details className="capture-diagnostics">
                <summary>Diagnostics</summary>
                <span>{capture.diagnosis?.detail ?? capture.error_reason ?? 'No diagnostic detail stored.'}</span>
                <em>{capture.diagnosis?.next_action ?? 'Inspect the raw capture and decide whether to replay or ignore.'}</em>
                {capture.parsed_expense_label ? <small>Parsed as: {capture.parsed_expense_label}</small> : null}
                {capture.metadata && Object.keys(capture.metadata).length > 0 ? (
                  <pre>{JSON.stringify(capture.metadata, null, 2)}</pre>
                ) : null}
              </details>
            </div>
            <div className="row-actions">
              <button
                type="button"
                onClick={() => void onReplay(capture.id)}
                disabled={busy || !capture.raw_text || capture.status === 'processed' || capture.status === 'ignored' || capture.diagnosis?.replayable === false}
              >
                Replay
              </button>
              <button type="button" onClick={() => draftRuleFromCapture(capture)} disabled={busy || !capture.raw_text}>
                Make Rule
              </button>
              <button type="button" onClick={() => void onIgnore(capture.id)} disabled={busy || capture.status === 'ignored' || capture.status === 'processed'}>
                Ignore
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
