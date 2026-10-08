import { redirect } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { changeRole, removeMember, revokeInvitation } from './actions'
import { InviteForm } from './InviteForm'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  'not-admin': 'Only administrators can manage members.',
  failed: 'That change could not be made. An organization must keep at least one administrator.',
}

function roleLabel(role: string): string {
  return role === 'org:admin' ? 'Administrator' : 'Member'
}

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return null // the layout redirects before this renders
  const isAdmin = orgRole === 'org:admin'
  // Administration pages are for administrators only.
  if (!isAdmin) redirect('/dashboard')
  const { error } = await searchParams

  const client = await clerkClient()
  const [memberships, invitations] = await Promise.all([
    client.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 200 }),
    isAdmin
      ? client.organizations.getOrganizationInvitationList({ organizationId: orgId, status: ['pending'], limit: 200 })
      : Promise.resolve(null),
  ])

  const members = memberships.data.map((m) => {
    const person = m.publicUserData
    const name = [person?.firstName, person?.lastName].filter(Boolean).join(' ')
    return { userId: person?.userId ?? '', name, email: person?.identifier ?? '', role: m.role }
  })

  return (
    <>
      <h1>Members</h1>
      <p className="lede">People join your organization by email invitation only.</p>

      {error && ERRORS[error] ? <p className="form-error" role="alert">{ERRORS[error]}</p> : null}

      {isAdmin ? (
        <section className="panel">
          <h2>Invite a colleague</h2>
          <InviteForm />
        </section>
      ) : null}

      <section className="panel">
        <h2>Members</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                {isAdmin ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.userId === userId
                const nextRole = member.role === 'org:admin' ? 'org:member' : 'org:admin'
                return (
                  <tr key={member.userId}>
                    <td>{member.name || '—'}{isSelf ? ' (you)' : ''}</td>
                    <td>{member.email}</td>
                    <td>{roleLabel(member.role)}</td>
                    {isAdmin ? (
                      <td>
                        {isSelf ? null : (
                          <div className="row-actions">
                            <form action={changeRole}>
                              <input type="hidden" name="userId" value={member.userId} />
                              <input type="hidden" name="role" value={nextRole} />
                              <button type="submit" className="link-button">
                                Make {roleLabel(nextRole).toLowerCase()}
                              </button>
                            </form>
                            <form action={removeMember}>
                              <input type="hidden" name="userId" value={member.userId} />
                              <button type="submit" className="link-button danger">Remove</button>
                            </form>
                          </div>
                        )}
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {invitations ? (
        <section className="panel">
          <h2>Pending invitations</h2>
          {invitations.data.length === 0 ? (
            <p className="empty">No invitations are waiting to be accepted.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.data.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>{invitation.emailAddress}</td>
                      <td>{roleLabel(invitation.role)}</td>
                      <td>
                        <form action={revokeInvitation}>
                          <input type="hidden" name="invitationId" value={invitation.id} />
                          <button type="submit" className="link-button danger">Revoke</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  )
}
