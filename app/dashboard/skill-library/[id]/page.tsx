import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, withStratiosAdmin } from '@/lib/db'
import { isUuid } from '@/lib/records'
import { getSkill } from '@/lib/skills'
import { isStratiosAdmin } from '@/lib/stratios'
import { SkillEditor } from '../../skills/SkillEditor'
import { addLibrarySkill, removeLibrarySkill, saveLibrarySkill } from '../actions'

export const dynamic = 'force-dynamic'

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  const { id } = await params
  if (!isDatabaseConfigured() || !isUuid(id) || !(await isStratiosAdmin(orgId, orgRole))) notFound()

  const skill = await withStratiosAdmin(orgId, (client) => getSkill(client, null, id)).catch((error) => {
    console.error('SkillPage failed', error)
    return null
  })
  if (!skill) notFound()

  return (
    <>
      <p className="crumbs">
        <Link href="/dashboard/skill-library">Skills Library</Link>
        <span aria-hidden="true"> / </span>
        <span>{skill.name}</span>
      </p>
      <h1>{skill.name}</h1>
      <p className="lede">
        {skill.enabled ? 'In use' : 'Turned off'}
        <span className="record-key" title="The permanent key for this skill">{skill.key}</span>
      </p>
      <section className="panel">
        <h2>Standard for Every Organization</h2>
        <p className="note">Saving changes this skill for all organizations, from the agents&apos; next task, except those that have their own version of it.</p>
        {/* The key makes the editor start fresh when a different skill is opened. */}
        <SkillEditor
          key={skill.id}
          skill={{ id: skill.id, name: skill.name, useWhen: skill.useWhen, instructions: skill.instructions, enabled: skill.enabled }}
          actions={{ add: addLibrarySkill, save: saveLibrarySkill, remove: removeLibrarySkill }}
          basePath="/dashboard/skill-library"
          removeNote="Removing deletes the standard skill for every organization. An organization's own version of it stays, as a skill of its own. To stop using it without deleting it, set its status to Turned Off."
        />
      </section>
    </>
  )
}
