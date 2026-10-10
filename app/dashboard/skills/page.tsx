import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { listSkills, type Skill } from '@/lib/skills'
import { SkillEditor } from './SkillEditor'
import { addOrgSkill, saveOrgSkill } from './actions'
import { DownloadButton } from '@/components/DownloadButton'

export const dynamic = 'force-dynamic'

const SOURCE_LABELS: Record<Skill['source'], string> = { standard: 'Stratios Standard', modified: 'Modified', own: 'Yours' }

export default async function SkillsPage() {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  if (orgRole !== 'org:admin') redirect('/dashboard')

  let skills: Skill[] = []
  let problem: 'none' | 'update' | 'failed' = isDatabaseConfigured() ? 'none' : 'failed'
  if (problem === 'none') {
    try {
      skills = await withOrg(orgId, (client) => listSkills(client, orgId))
    } catch (error) {
      console.error('SkillsPage failed', error)
      problem = isMissingSchema(error) ? 'update' : 'failed'
    }
  }
  if (problem !== 'none') {
    return (
      <>
        <h1>Skills Library</h1>
        <div className="panel notice">
          <h2>{problem === 'update' ? 'Database Update Needed' : 'The Skills Could Not Be Loaded'}</h2>
          <p>{problem === 'update' ? 'Run the newest files in db/migrations against the database, then reload this page.' : 'Check the database connection and try again.'}</p>
        </div>
      </>
    )
  }

  return (
    <>
      <h1>Skills Library</h1>
      <p className="lede">Know-how your organization&apos;s agents pick from: how to read a kind of document, or how to handle a kind of request.</p>
      <div className="panel notice">
        <h2>How Skills Are Used</h2>
        <p>
          When a document is read, the agent works out what kind of document it is, then follows every skill in use whose Use When fits. In a conversation, the analyst sees
          the list and opens the skills a request calls for. Stratios standard skills come with Stratios; you can change one or turn it off for your organization, and add
          skills of your own. Nothing here affects any other organization.
        </p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Your Organization&apos;s Skills</h2>
          <DownloadButton name="Skills" header={['Skill', 'Use When', 'From', 'Status']} rows={skills.map((skill) => [skill.name, skill.useWhen, SOURCE_LABELS[skill.source], skill.enabled ? 'In Use' : 'Turned Off'])} />
        </div>
        {skills.length === 0 ? (
          <p className="empty">No skills yet. Add the first one below.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Skill</th>
                  <th scope="col">Use When</th>
                  <th scope="col">From</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((skill) => (
                  <tr key={skill.id}>
                    <td><Link href={`/dashboard/skills/${skill.id}`}>{skill.name}</Link></td>
                    <td>{skill.useWhen}</td>
                    <td><span className={`chip${skill.source === 'modified' ? ' chip-modified' : skill.source === 'own' ? ' chip-own' : ''}`}>{SOURCE_LABELS[skill.source]}</span></td>
                    <td className={skill.enabled ? undefined : 'muted'}>{skill.enabled ? 'In Use' : 'Turned Off'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Add a Skill</h2>
        <p className="note">A skill you add belongs to your organization only.</p>
        <SkillEditor actions={{ add: addOrgSkill, save: saveOrgSkill }} basePath="/dashboard/skills" />
      </section>
    </>
  )
}
