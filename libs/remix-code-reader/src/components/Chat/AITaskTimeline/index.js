/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import React from 'react'

const STATUS = {
  planned: { icon: '○', label: 'Planned', color: '#6c757d' },
  running: { icon: '●', label: 'Running', color: '#0d6efd' },
  waiting_for_user: { icon: '◐', label: 'Waiting for input', color: '#b36b00' },
  incomplete: { icon: '◐', label: 'Incomplete', color: '#b36b00' },
  succeeded: { icon: '✓', label: 'Succeeded', color: '#198754' },
  failed: { icon: '×', label: 'Failed', color: '#dc3545' },
  cancelled: { icon: '■', label: 'Cancelled', color: '#6c757d' },
  uncertain: { icon: '?', label: 'State uncertain', color: '#b36b00' }
}

const needsContinuation = (status) => ['planned', 'running', 'waiting_for_user', 'incomplete', 'failed', 'uncertain'].includes(status)

const honestTaskStatus = (taskStatus, workflowStatus) => {
  if (taskStatus !== 'succeeded' || !workflowStatus || workflowStatus === 'completed') return taskStatus
  if (['failed', 'uncertain', 'cancelled'].includes(workflowStatus)) return workflowStatus
  return 'incomplete'
}

const safeExternalUrl = (ref) => {
  try {
    const url = new URL(ref)
    return url.protocol === 'https:' ? url.href : null
  } catch (_) {
    return null
  }
}

const TaskStatus = ({ status }) => {
  const info = STATUS[status] || STATUS.uncertain
  return <span style={{ color: info.color, fontWeight: 600 }}><span aria-hidden='true'>{info.icon}</span> {info.label}</span>
}

const WORKFLOW_STATUS = {
  completed: { label: 'Complete', color: '#198754' },
  incomplete: { label: 'Evidence incomplete', color: '#b36b00' },
  failed: { label: 'Failed', color: '#dc3545' },
  uncertain: { label: 'State uncertain', color: '#b36b00' },
  cancelled: { label: 'Cancelled', color: '#6c757d' }
}

const GoldenWorkflowResult = ({ result }) => {
  if (!result?.workflowId) return null
  const info = WORKFLOW_STATUS[result.status] || WORKFLOW_STATUS.incomplete
  return (
    <section data-id='aiTaskResultCard' data-workflow-id={result.workflowId} data-workflow-status={result.status} style={{ marginBottom: 8, padding: 8, border: '1px solid rgba(127,127,127,0.28)', borderLeft: `3px solid ${info.color}`, background: 'rgba(127,127,127,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{result.number} result · {result.title}</strong>
        <span style={{ color: info.color, fontWeight: 600 }}>{info.label}</span>
      </div>
      <div style={{ marginTop: 4 }}>{result.summary}</div>
      <ol style={{ margin: '6px 0', paddingLeft: 20 }}>
        {(result.evidence || []).map((item) => (
          <li key={item.phaseId} data-phase-status={item.status}>
            <strong>{item.title}</strong> · {item.status}{item.toolName ? <> · <code>{item.toolName}</code></> : null}
            {item.summary ? <div style={{ opacity: 0.85 }}>{item.summary}</div> : null}
          </li>
        ))}
      </ol>
      {result.resultFields?.length ? <div><strong>Result must include:</strong> {result.resultFields.join(', ')}</div> : null}
      {result.nextAction ? <div style={{ marginTop: 5 }}><strong>Next:</strong> {result.nextAction}</div> : null}
    </section>
  )
}

const AITaskTimeline = ({ history = [], onContinue, onExport }) => {
  const [includeEventLog, setIncludeEventLog] = React.useState({})
  const recent = history.slice(-5).reverse()
  if (!recent.length) return null

  return (
    <section data-id='aiTaskTimeline' aria-label='AI task timeline' style={{ margin: '8px 10px 0', border: '1px solid var(--bs-border-color, #495057)', borderRadius: 6, maxHeight: 'min(300px, 32vh)', overflowX: 'hidden', overflowY: 'auto', overscrollBehavior: 'contain', flexShrink: 0 }}>
      <div style={{ padding: '6px 9px', fontSize: 12, fontWeight: 600, background: 'rgba(127,127,127,0.08)' }}>
        Task history <span style={{ fontWeight: 400 }}>({history.length} local)</span>
      </div>
      {recent.map((record, index) => {
        const task = record.task || {}
        const taskKey = task.taskId || `task-${index}`
        const steps = record.steps || []
        const artifacts = record.artifacts || []
        const workflowResult = record.workflowResult || null
        // Older records may contain `task=succeeded` from the pre-fix model-
        // reply heuristic while their durable workflow evidence says otherwise.
        // Correct the label at render time so history is honest after refresh.
        const displayStatus = honestTaskStatus(task.status, workflowResult?.status)
        const open = index === 0 && ['running', 'waiting_for_user', 'incomplete', 'uncertain'].includes(displayStatus)
        return (
          <details key={taskKey} open={open} data-task-status={displayStatus} style={{ borderTop: '1px solid rgba(127,127,127,0.2)' }}>
            <summary style={{ cursor: 'pointer', padding: '7px 9px', fontSize: 12 }}>
              <TaskStatus status={displayStatus} />
              <span style={{ marginLeft: 8 }}>{task.goal || 'AI task'}</span>
            </summary>
            <div style={{ padding: '0 10px 9px', fontSize: 12 }}>
              <GoldenWorkflowResult result={workflowResult} />
              {steps.length ? (
                <ol style={{ margin: '2px 0 7px', paddingLeft: 20 }}>
                  {steps.map((step) => (
                    <li key={step.stepId} style={{ marginBottom: 4 }}>
                      <code>{step.toolName || 'tool'}</code> · <TaskStatus status={step.status} />
                      {step.riskLevel ? <span> · {step.riskLevel}</span> : null}
                      {step.result?.summary ? <div style={{ opacity: 0.85 }}>{step.result.summary}</div> : null}
                    </li>
                  ))}
                </ol>
              ) : <div style={{ marginBottom: 7, opacity: 0.75 }}>No tool steps recorded.</div>}
              {artifacts.length ? (
                <div style={{ marginBottom: 7 }}>
                  <strong>Artifacts:</strong>{' '}
                  {artifacts.map((artifact, artifactIndex) => {
                    const href = safeExternalUrl(artifact.ref)
                    const label = artifact.label || artifact.ref || artifact.type
                    return <React.Fragment key={`${artifact.type}-${artifact.ref}-${artifactIndex}`}>{artifactIndex ? ', ' : ''}{href ? <a href={href} target='_blank' rel='noopener noreferrer'>{label}</a> : <span title={artifact.ref}>{label}</span>}</React.Fragment>
                  })}
                </div>
              ) : null}
              {onExport ? (
                <div data-id='aiTaskDiagnosticExport' style={{ margin: '7px 0', paddingTop: 7, borderTop: '1px solid rgba(127,127,127,0.2)' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <button type='button' className='btn btn-sm btn-outline-secondary' data-id='aiTaskExportJson' onClick={() => onExport(record, 'json', { includeEventLog: includeEventLog[taskKey] === true })}>
                      Export JSON
                    </button>
                    <button type='button' className='btn btn-sm btn-outline-secondary' data-id='aiTaskExportMarkdown' onClick={() => onExport(record, 'markdown', { includeEventLog: includeEventLog[taskKey] === true })}>
                      Export Markdown
                    </button>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: 0 }}>
                      <input
                        type='checkbox'
                        data-id='aiTaskIncludeEventLog'
                        checked={includeEventLog[taskKey] === true}
                        onChange={(event) => setIncludeEventLog((current) => ({ ...current, [taskKey]: event.target.checked }))}
                      />
                      Include redacted event log
                    </label>
                  </div>
                  <div style={{ marginTop: 4, opacity: 0.72 }}>Prompts, source code, contract arguments and credentials are never exported.</div>
                </div>
              ) : null}
              {needsContinuation(displayStatus) && onContinue ? (
                <button type='button' className='btn btn-sm btn-outline-primary' data-id='aiTaskContinue' onClick={() => onContinue(record)}>
                  Continue in chat
                </button>
              ) : null}
            </div>
          </details>
        )
      })}
    </section>
  )
}

export default AITaskTimeline
