import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { listFields, type FieldDefinition } from '@/lib/fields'
import { listScreens, type Screen } from '@/lib/layout'
import { listLists, type ListDefinition } from '@/lib/lists'
import { RECORD_LABELS, RECORD_TYPES } from '@/lib/records'
import { AddScreenForm, AddSectionForm } from '../fields/Forms'
import { LayoutTable } from './LayoutTable'

export const dynamic = 'force-dynamic'

const LEVELS = RECORD_TYPES.map((type) => ({ value: type, label: RECORD_LABELS[type] }))

export default async function LayoutsPage() {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  // Administration pages are for administrators only.
  if (orgRole !== 'org:admin') redirect('/dashboard')

  let fields: FieldDefinition[] = []
  let screens: Screen[] = []
  let lists: ListDefinition[] = []
  let problem: 'none' | 'update' | 'failed' = isDatabaseConfigured() ? 'none' : 'failed'
  if (problem === 'none') {
    try {
      ;[fields, screens, lists] = await withOrg(orgId, async (client) => [
        await listFields(client, orgId),
        await listScreens(client, orgId),
        await listLists(client, orgId),
      ] as [FieldDefinition[], Screen[], ListDefinition[]])
    } catch (error) {
      console.error('LayoutsPage failed', error)
      problem = isMissingSchema(error) ? 'update' : 'failed'
    }
  }
  if (problem !== 'none') {
    return (
      <>
        <h1>Layouts</h1>
        <div className="panel notice">
          <h2>{problem === 'update' ? 'Database Update Needed' : 'The Layout Could Not Be Loaded'}</h2>
          <p>{problem === 'update' ? 'Run the newest files in db/migrations against the database, then reload this page.' : 'Check the database connection and try again.'}</p>
        </div>
      </>
    )
  }
  const sectionCount = screens.reduce((total, screen) => total + screen.sections.length, 0)

  return (
    <>
      <h1>Layouts</h1>
      <p className="lede">
        {screens.length} {screens.length === 1 ? 'screen' : 'screens'} and {sectionCount} {sectionCount === 1 ? 'section' : 'sections'} on every asset.
      </p>

      <section className="panel">
        <h2>Screens and Sections</h2>
        <p className="note">
          Screens are the tabs on an asset. Each screen holds sections, and a section shows fields or a list. To move a field to a different section, open the field in{' '}
          <Link href="/dashboard/fields">Fields Library</Link> and change Shown In.
        </p>
        <LayoutTable screens={screens} lists={lists} fields={fields} />
      </section>

      <section className="panel">
        <h2>Add a Section or List</h2>
        <AddSectionForm levels={LEVELS} screens={screens.map((screen) => ({ value: screen.id, label: screen.name }))} />
      </section>

      <section className="panel">
        <h2>Add a Screen</h2>
        <AddScreenForm />
      </section>
    </>
  )
}
