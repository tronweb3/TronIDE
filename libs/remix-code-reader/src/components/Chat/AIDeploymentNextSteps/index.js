/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import React from 'react'
import { DEPLOYMENT_NEXT_STEP_ENTRIES } from '../../../services/aiTaskEntries'
import './index.css'

const short = (value, start = 10, end = 8) => {
  const text = String(value || '')
  if (text.length <= start + end + 3) return text
  return `${text.slice(0, start)}…${text.slice(-end)}`
}

const AIDeploymentNextSteps = ({ deployment, busy = false, onStart, onDismiss }) => {
  if (!deployment?.contractAddress) return null
  return (
    <section className="ai-deploy-next" data-id="aiDeploymentNextSteps" aria-label="AI deployment next steps">
      <div className="ai-deploy-next-head">
        <div>
          <strong>AI next steps</strong>
          <div className="ai-deploy-next-context">
            {deployment.contractName || 'Contract'} · {short(deployment.contractAddress)} · {deployment.network || 'network pending'}
            {deployment.transactionHash ? ` · ${short(deployment.transactionHash)}` : ''}
          </div>
        </div>
        <button type="button" className="ai-deploy-next-dismiss" data-id="aiDeployNextDismiss" aria-label="Dismiss deployment next steps" onClick={onDismiss}>×</button>
      </div>
      <p>Actions start only when selected. Writes and wallet signatures still require approval.</p>
      <div className="ai-deploy-next-grid">
        {DEPLOYMENT_NEXT_STEP_ENTRIES.map((entry) => (
          <button
            type="button"
            key={entry.id}
            data-id={entry.dataId}
            disabled={busy}
            onClick={() => onStart && onStart(entry.id)}
          >
            <strong>{entry.title}</strong>
            <span>{entry.description}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default AIDeploymentNextSteps
