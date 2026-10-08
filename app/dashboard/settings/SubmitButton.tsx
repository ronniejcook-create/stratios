'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

export function SubmitButton({ children, pendingText, className }: { children: ReactNode; pendingText: string; className: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  )
}
