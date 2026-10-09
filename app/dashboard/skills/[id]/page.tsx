import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, withOrg } from '@/lib/db'
import { isUuid } from '@/lib/records'
import { getSkill } from '@/lib/skills'
import { SkillEditor } from '../SkillEditor'
import { addOrgSkill, removeOrgSkill, resetOrgSkill, saveOrgSkill } from '../actions'

export const dynamic = 'force-dynamic'

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  if (orgRole !== 'org:admin') redirect('/dashboard')
  const { id } = await params
  if (!isDatabaseConfigured() || !isUuid(id)) notFound()

  const skill = await withOrg(orgId, (client) => getSkill(client, orgId, id)).catch((error) => {
    console.error('SkillPage failed', error)
    return null
  })
  if (!skill) notFound()
  // An address for the standard skill shows the organization's own version when it has one.
  if (skill.id !== id) redirect(`/dashboard/skills/${skill.id}`)

  const standard = skill.standard
  const differences = standard
    ? [
        standard.name !== skill.name ? 'name' : '',
        standard.useWhen !== skill.useWhen ? 'Use When' : '',
        standard.instructions.trim() !== skill.instructions.trim() ? 'instructions' : '',
        standard.enabled !== skill.enabled ? 'status' : '',
      ].filter(Boolean)
    : []

  return (
    <>
      <p className="crumbs">
        <Link href="/dashboard/skills">Skills Library</Link>
        <span aria-hidden="true"> / </span>
        <span>{skill.name}</span>
      </p>
      <h1>{skill.name}</h1>
      <p className="lede">
        {skill.enabled ? 'In use' : 'Turned off'}
        <span className="record-key" title="The permanent key for this skill">{skill.key}</span>
      </p>
      <section className="panel">
        <h2>{skill.source === 'own' ? 'Skill Added by Your Organization' : skill.source === 'modified' ? 'Stratios Standard Skill, Modified' : 'Stratios Standard Skill'}</h2>
        <p className="note">
          {skill.source === 'own'
            ? 'This skill belongs to your organization, so it is changed directly.'
            : skill.source === 'modified'
              ? `Your organization uses its own version of this skill (changed: ${differences.join(', ') || 'nothing'}), so it does not follow Stratios updates. Reset to Standard puts it back.`
              : 'Saving a change here makes a version for your organization only. It then stops following Stratios updates to this skill until you reset it. To stop using it, set its status to Turned Off.'}
        </p>
        {/* The key makes the editor start fresh when a different skill is opened. */}
        <SkillEditor
          key={skill.id}
          skill={{ id: skill.id, name: skill.name, useWhen: skill.useWhen, instructions: skill.instructions, enabled: skill.enabled }}
          actions={{
            add: addOrgSkill,
            save: saveOrgSkill,
            remove: skill.source === 'own' ? removeOrgSkill : undefined,
            reset: skill.source === 'modified' ? resetOrgSkill : undefined,
          }}
          basePath="/dashboard/skills"
        />
      </section>

      {standard && differences.includes('instructions') ? (
        <section className="panel">
          <h2>The Stratios Standard Instructions</h2>
          <p className="note">For comparison. This is what Reset to Standard would put back.</p>
          <pre className="standard-text">{standard.instructions}</pre>
        </section>
      ) : null}
    </>
  )
}
