import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema, withStratiosAdmin } from '@/lib/db'
import { listFields, type FieldDefinition } from '@/lib/fields'
import { listScreens, type Screen } from '@/lib/layout'
import { listLists, type ListDefinition } from '@/lib/lists'
import { RECORD_LABELS, RECORD_TYPES } from '@/lib/records'
import { isStratiosAdmin } from '@/lib/stratios'
import { AddScreenForm, AddSectionForm } from '../fields/Forms'
import { LayoutTable } from '../layouts/LayoutTable'
import { addLibraryScreen, addLibrarySection } from '../library/actions'

export const dynamic = 'force-dynamic'

const LEVELS = RECORD_TYPES.map((type) => ({ value: type, label: RECORD_LABELS[type] }))

export default async function MasterLayoutsPage() {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  // Stratios administrators only. Everyone else gets "not found", as if the page didn't exist.
  if (!isDatabaseConfigured() || !(await isStratiosAdmin(orgId, orgRole))) notFound()

  let fields: FieldDefinition[] = []
  let screens: Screen[] = []
  let lists: ListDefinition[] = []
  try {
    ;[fields, screens, lists] = await withStratiosAdmin(orgId, async (client) => [
      // null = the standard alone, exactly as Stratios defines it
      await listFields(client, null),
      await listScreens(client, null),
      await listLists(client, null),
    ] as [FieldDefinition[], Screen[], ListDefinition[]])
  } catch (error) {
    console.error('MasterLayoutsPage failed', error)
    return (
      <>
        <h1>Master Layouts</h1>
        <div className="panel notice">
          <h2>{isMissingSchema(error) ? 'Database Update Needed' : 'The Layout Could Not Be Loaded'}</h2>
          <p>{isMissingSchema(error) ? 'Run the newest files in db/migrations against the database, then reload this page.' : 'Check the database connection and try again.'}</p>
        </div>
      </>
    )
  }
  const sectionCount = screens.reduce((total, screen) => total + screen.sections.length, 0)

  return (
    <>
      <h1>Master Layouts</h1>
      <p className="lede">
        The standard layout every organization starts from: {screens.length} {screens.length === 1 ? 'screen' : 'screens'} and {sectionCount}{' '}
        {sectionCount === 1 ? 'section' : 'sections'}.
      </p>
      <div className="panel notice">
        <h2>Changes Here Reach Every Organization</h2>
        <p>
          A screen, section or list added here appears for all organizations as soon as it is saved. To add one for the Stratios organization only, use Layouts under Admin
          Settings instead. Standard fields are managed in the <Link href="/dashboard/library">Master Library</Link>.
        </p>
      </div>

      <section className="panel">
        <h2>Standard Screens and Sections</h2>
        <LayoutTable screens={screens} lists={lists} fields={fields} />
      </section>

      <section className="panel">
        <h2>Add a Standard Section or List</h2>
        <AddSectionForm action={addLibrarySection} levels={LEVELS} screens={screens.map((screen) => ({ value: screen.id, label: screen.name }))} />
      </section>

      <section className="panel">
        <h2>Add a Standard Screen</h2>
        <AddScreenForm action={addLibraryScreen} />
      </section>
    </>
  )
}
