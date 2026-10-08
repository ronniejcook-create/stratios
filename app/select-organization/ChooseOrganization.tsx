'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useOrganizationList } from '@clerk/nextjs'

/** Lists the organizations a person belongs to and the invitations waiting for them. */
export function ChooseOrganization() {
  const { isLoaded, setActive, userMemberships, userInvitations } = useOrganizationList({
    userMemberships: { infinite: true },
    userInvitations: { infinite: true },
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const memberships = userMemberships?.data ?? []
  const invitations = userInvitations?.data ?? []
  const listsReady = isLoaded && !userMemberships?.isLoading && !userInvitations?.isLoading

  async function open(organizationId: string) {
    if (!setActive) return
    setBusy(true)
    setError(null)
    try {
      await setActive({ organization: organizationId })
      window.location.assign('/dashboard')
    } catch {
      setBusy(false)
      setError('That organization could not be opened. Try again.')
    }
  }

  // With exactly one organization and nothing to accept, go straight in.
  const onlyOrganizationId =
    listsReady && memberships.length === 1 && invitations.length === 0 ? memberships[0].organization.id : null
  useEffect(() => {
    if (onlyOrganizationId) void open(onlyOrganizationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyOrganizationId])

  if (!listsReady || onlyOrganizationId) return <p>Loading your organization…</p>

  if (memberships.length === 0 && invitations.length === 0) {
    return (
      <>
        <h1>No organization yet</h1>
        <p>You are not a member of an organization and have no invitations waiting.</p>
        <Link href="/onboarding" className="btn btn-primary">Continue</Link>
      </>
    )
  }

  return (
    <>
      <h1>Choose your organization</h1>
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {invitations.length > 0 ? (
        <div className="stack">
          <p>You have been invited to:</p>
          {invitations.map((invitation) => (
            <div key={invitation.id} className="choice">
              <span>{invitation.publicOrganizationData.name}</span>
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await invitation.accept()
                    await open(invitation.publicOrganizationData.id)
                  } catch {
                    setBusy(false)
                    setError('The invitation could not be accepted. Try again.')
                  }
                }}
              >
                Accept and join
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {memberships.length > 0 ? (
        <div className="stack">
          <p>Your organizations:</p>
          {memberships.map((membership) => (
            <div key={membership.id} className="choice">
              <span>{membership.organization.name}</span>
              <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => open(membership.organization.id)}>
                Open
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
