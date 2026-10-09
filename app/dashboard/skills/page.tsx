import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema, withStratiosAdmin } from '@/lib/db'
import { listSkills, type Skill } from '@/lib/skills'
import { isStratiosAdmin } from '@/lib/stratios'
import { SkillEditor } from './SkillEditor'

export const dynamic = 'force-dynamic'

export default async function SkillsPage() {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  // Stratios administrators only. Everyone else gets "not found", as if the page didn't exist.
  if (!isDatabaseConfigured() || !(await isStratiosAdmin(orgId, orgRole))) notFound()

  let skills: Skill[] = []
  try {
    skills = await withStratiosAdmin(orgId, (client) => listSkills(client))
  } catch (error) {
    console.error('SkillsPage failed', error)
    return (
      <>
        <h1>Skills Library</h1>
        <div className="panel notice">
          <h2>{isMissingSchema(error) ? 'Database Update Needed' : 'The Library Could Not Be Loaded'}</h2>
          <p>{isMissingSchema(error) ? 'Run db/migrations/011_skills.sql against the database, then reload this page.' : 'Check the database connection and try again.'}</p>
        </div>
      </>
    )
  }
  const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <>
      <h1>Skills Library</h1>
      <p className="lede">Know-how the agents pick from, for every organization: how to read a kind of document, or how to handle a kind of request.</p>
      <div className="panel notice">
        <h2>How Skills Are Used</h2>
        <p>
          When a document is read, the agent first works out what kind of document it is, then follows every skill whose Use When fits. In a conversation, the analyst sees the
          list and opens the skills a request calls for. How the analyst behaves in every conversation is set in{' '}
          <Link href="/dashboard/analyst">Analyst Instructions</Link>. A skill changes how an agent does something; a new ability, such as looking something up on the web,
          needs a new tool.
        </p>
      </div>

      <section className="panel">
        <h2>Skills</h2>
        {skills.length === 0 ? (
          <p className="empty">No skills yet. Add the first one below.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Skill</th>
                  <th scope="col">Use When</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last Changed</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((skill) => (
                  <tr key={skill.id}>
                    <td><Link href={`/dashboard/skills/${skill.id}`}>{skill.name}</Link></td>
                    <td>{skill.useWhen}</td>
                    <td><span className={`chip${skill.enabled ? ' chip-own' : ''}`}>{skill.enabled ? 'In Use' : 'Turned Off'}</span></td>
                    <td>{when(skill.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Add a Skill</h2>
        <SkillEditor />
      </section>
    </>
  )
}
