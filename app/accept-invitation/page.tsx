import { redirect } from 'next/navigation'

// Landing point for the link in an invitation email. Clerk adds a ticket and
// a status saying whether the person needs to sign up or sign in; pass both
// on to the right page, which completes the invitation.
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const status = typeof params.__clerk_status === 'string' ? params.__clerk_status : ''
  const ticket = typeof params.__clerk_ticket === 'string' ? params.__clerk_ticket : ''

  if (status === 'complete' || !ticket) redirect('/dashboard')

  const query = new URLSearchParams({ __clerk_ticket: ticket, __clerk_status: status }).toString()
  redirect(status === 'sign_in' ? `/sign-in?${query}` : `/sign-up?${query}`)
}
