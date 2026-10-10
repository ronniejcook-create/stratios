'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { TenantQuestion } from '@/lib/tenants'
import { answerTenant } from './actions'

/**
 * Names from rent rolls that look like an existing tenant but are not spelled
 * the same. Stratios never decides these by itself: a person says whether it
 * is the same tenant or a different one.
 */
export function TenantQuestions({ questions, assetId = null }: { questions: TenantQuestion[]; assetId?: string | null }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [working, setWorking] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  if (questions.length === 0 && !message) return null

  const answer = (questionId: string, same: boolean) => {
    setMessage(null)
    setWorking(questionId)
    start(async () => {
      const result = await answerTenant({ questionId, same, assetId })
      setWorking(null)
      setMessage(result.ok ? { text: result.message, error: false } : { text: result.error, error: true })
      if (result.ok) router.refresh()
    })
  }

  return (
    <section className="panel notice tenant-questions" aria-label="Tenants to confirm">
      <h2>Tenants to Confirm</h2>
      {questions.length > 0 ? (
        <>
          <p className="note">
            {questions.length === 1 ? 'This name looks' : 'These names look'} like a tenant you already have, but {questions.length === 1 ? 'is' : 'are'} not spelled the same. Until you answer,
            {questions.length === 1 ? ' its lease is' : ' their leases are'} left out of the lists below.
          </p>
          <ul className="tenant-question-list">
            {questions.map((question) => (
              <li key={question.id}>
                <div>
                  <strong>{question.writtenName}</strong>
                  {question.seen.length > 0 ? <span className="doc-sub"> {question.seen.join('; ')}</span> : null}
                  <div>Is this the same tenant as <strong>{question.suggestedTenantName}</strong>?</div>
                </div>
                <div className="button-row">
                  <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => answer(question.id, true)}>
                    {working === question.id ? 'Saving…' : 'Same Tenant'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => answer(question.id, false)}>Different Tenant</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {message ? <p className={message.error ? 'form-error' : 'form-ok'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    </section>
  )
}
