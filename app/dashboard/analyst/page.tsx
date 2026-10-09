import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { DEFAULT_ANALYST_INSTRUCTIONS, FIXED_ANALYST_RULES, getAnalystInstructions, type AnalystInstructions } from '@/lib/analystInstructions'
import { isDatabaseConfigured, isMissingSchema, withStratiosAdmin } from '@/lib/db'
import { isStratiosAdmin } from '@/lib/stratios'
import { AnalystEditor } from './AnalystEditor'

export const dynamic = 'force-dynamic'

export default async function AnalystInstructionsPage() {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  // Stratios administrators only. Everyone else gets "not found", as if the page didn't exist.
  if (!isDatabaseConfigured() || !(await isStratiosAdmin(orgId, orgRole))) notFound()

  let current: AnalystInstructions = { instructions: DEFAULT_ANALYST_INSTRUCTIONS, custom: false, updatedAt: null }
  let needsUpdate = false
  try {
    current = await withStratiosAdmin(orgId, (client) => getAnalystInstructions(client))
  } catch (error) {
    console.error('AnalystInstructionsPage failed', error)
    if (!isMissingSchema(error)) {
      return (
        <>
          <h1>Analyst Instructions</h1>
          <div className="panel notice">
            <h2>The Instructions Could Not Be Loaded</h2>
            <p>Check the database connection and try again.</p>
          </div>
        </>
      )
    }
    needsUpdate = true
  }
  const updated = current.updatedAt ? new Date(current.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

  return (
    <>
      <h1>Analyst Instructions</h1>
      <p className="lede">
        How the Portfolio Analyst works and writes in every conversation, for every organization. Know-how for a particular task or kind of document belongs in
        the <Link href="/dashboard/skill-library">Skills Library</Link>.
      </p>

      {needsUpdate ? (
        <div className="panel notice">
          <h2>Database Update Needed</h2>
          <p>Run db/migrations/010_analyst_instructions.sql against the database before saving. Until then the analyst uses the built-in instructions shown below.</p>
        </div>
      ) : null}

      <section className="panel">
        <h2>Instructions</h2>
        <p className="note">
          Written like a skill, in plain words. Saving changes the analyst for every organization from its next reply.{' '}
          {current.custom ? `Last changed ${updated}.` : 'These are the instructions built into Stratios; nothing has been changed yet.'}
        </p>
        <AnalystEditor instructions={current.instructions} builtIn={DEFAULT_ANALYST_INSTRUCTIONS} custom={current.custom} />
      </section>

      <section className="panel">
        <h2>Always Applied</h2>
        <p className="note">These rules are added after your instructions and can&apos;t be edited here. They win if the instructions disagree with them.</p>
        <ul className="fixed-rules">
          {FIXED_ANALYST_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="note">
          Instructions shape how the analyst behaves; they can&apos;t give it new abilities. What it can do is set by its tools (create an asset, read a document, list assets, look up
          an asset), and it always works with the permissions of the person chatting.
        </p>
      </section>
    </>
  )
}
