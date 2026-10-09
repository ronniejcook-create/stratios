import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { LEVEL_LABELS, listRoles, type Role } from '@/lib/permissions'
import { AddRoleForm } from './AddRoleForm'

export const dynamic = 'force-dynamic'

export default async function RolesPage() {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null // the layout redirects before this renders
  // Administration pages are for administrators only.
  if (orgRole !== 'org:admin') redirect('/dashboard')

  let roles: Role[] = []
  let problem: string | null = null
  if (!isDatabaseConfigured()) {
    problem = 'Set DATABASE_URL and run the migrations in db/migrations. See the README.'
  } else {
    try {
      roles = await withOrg(orgId, (client) => listRoles(client, orgId, userId))
    } catch (error) {
      console.error('RolesPage failed', error)
      problem = isMissingSchema(error)
        ? 'Run db/migrations/005_roles_and_permissions.sql against the database, then reload this page.'
        : 'The roles could not be loaded. Check the database connection and try again.'
    }
  }
  if (problem) {
    return (
      <>
        <h1>Roles and Permissions</h1>
        <div className="panel notice">
          <h2>Database Update Needed</h2>
          <p>{problem}</p>
        </div>
      </>
    )
  }

  return (
    <>
      <h1>Roles and Permissions</h1>
      <p className="lede">Roles decide who can see and change each field. A person with several roles gets the most generous access among them.</p>

      <section className="panel">
        <h2>Roles</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Default Access</th>
                <th scope="col">People</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Administrator</td>
                <td>Full access to everything, always</td>
                <td>Chosen on the Users page</td>
              </tr>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td><Link href={`/dashboard/roles/${role.id}`}>{role.name}</Link></td>
                  <td>{LEVEL_LABELS[role.defaultLevel]}</td>
                  <td>{role.isMember ? 'Everyone in the organization' : role.memberCount === 1 ? '1 person' : `${role.memberCount} people`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Click a role to change its default access, choose its people, and set its access to particular sections and fields.</p>
      </section>

      <section className="panel">
        <h2>Add a Role</h2>
        <AddRoleForm />
      </section>
    </>
  )
}
