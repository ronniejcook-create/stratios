import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { isDatabaseConfigured, withOrg } from '@/lib/db'
import { listFields } from '@/lib/fields'
import { listScreens } from '@/lib/layout'
import { getRules, listRoleMembers, listRoles } from '@/lib/permissions'
import { RECORD_LABELS, isUuid } from '@/lib/records'
import { RoleEditor } from './RoleEditor'

export const dynamic = 'force-dynamic'

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null // the layout redirects before this renders
  if (orgRole !== 'org:admin') redirect('/dashboard')
  const { id } = await params
  if (!isDatabaseConfigured() || !isUuid(id)) notFound()

  const loaded = await withOrg(orgId, async (client) => {
    const role = (await listRoles(client, orgId, userId)).find((candidate) => candidate.id === id)
    if (!role) return null
    return {
      role,
      rules: await getRules(client, orgId, id),
      memberIds: await listRoleMembers(client, orgId, id),
      screens: await listScreens(client, orgId),
      fields: await listFields(client, orgId),
    }
  })
  if (!loaded) notFound()
  const { role, rules, memberIds, screens, fields } = loaded

  // Everyone in the organization, for choosing who holds the role.
  let people: { userId: string; name: string; email: string; admin: boolean }[] = []
  if (!role.isMember) {
    try {
      const client = await clerkClient()
      const memberships = await client.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 500 })
      people = memberships.data
        .map((membership) => {
          const person = membership.publicUserData
          return {
            userId: person?.userId ?? '',
            name: [person?.firstName, person?.lastName].filter(Boolean).join(' '),
            email: person?.identifier ?? '',
            admin: membership.role === 'org:admin',
          }
        })
        .filter((person) => person.userId)
        .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
    } catch (error) {
      console.error('RolePage: people could not be loaded', error)
    }
  }

  const fieldById = new Map(fields.map((field) => [field.id, field]))
  const layout = screens.map((screen) => ({
    id: screen.id,
    name: screen.name,
    sections: screen.sections.map((section) => ({
      id: section.id,
      name: section.name,
      level: RECORD_LABELS[section.appliesTo],
      isList: section.displayStyle === 'list',
      fields: section.fieldIds
        .map((fieldId) => fieldById.get(fieldId))
        .filter((field) => field !== undefined)
        .map((field) => ({ id: field.id, name: field.name })),
    })),
  }))

  return (
    <>
      <p className="crumbs">
        <Link href="/dashboard/roles">Roles and Permissions</Link>
        <span aria-hidden="true"> / </span>
        <span>{role.name}</span>
      </p>
      <h1>{role.name}</h1>
      <p className="lede">
        {role.isMember
          ? 'The built-in role that everyone in your organization holds. Administrators are not limited by it.'
          : 'A role your organization created. Administrators are not limited by roles.'}
      </p>
      <RoleEditor
        role={{ id: role.id, name: role.name, defaultLevel: role.defaultLevel, isMember: role.isMember }}
        rules={rules}
        memberIds={memberIds}
        people={people}
        layout={layout}
      />
    </>
  )
}
