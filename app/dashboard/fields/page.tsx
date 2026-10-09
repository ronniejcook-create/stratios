import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { DATA_TYPES } from '@/lib/fieldAdmin'
import { listFields, type FieldDefinition } from '@/lib/fields'
import { listScreens, type Screen } from '@/lib/layout'
import { listLists, type ListDefinition } from '@/lib/lists'
import { RECORD_LABELS, RECORD_TYPES } from '@/lib/records'
import type { GridRow } from '@/components/DataGrid'
import { FieldsGrid } from './FieldsGrid'

export const dynamic = 'force-dynamic'

const LEVELS = RECORD_TYPES.map((type) => ({ value: type, label: RECORD_LABELS[type] }))
const TYPE_LABELS = new Map(DATA_TYPES.map((type) => [type.value as string, type.label]))

export default async function FieldsPage() {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  // Administration pages are for administrators only.
  if (orgRole !== 'org:admin') redirect('/dashboard')

  if (!isDatabaseConfigured()) {
    return (
      <>
        <h1>Fields Library</h1>
        <div className="panel notice">
          <h2>Database Not Connected</h2>
          <p>Set DATABASE_URL and run the migrations in db/migrations. See the README.</p>
        </div>
      </>
    )
  }

  let fields: FieldDefinition[] = []
  let screens: Screen[] = []
  let lists: ListDefinition[] = []
  try {
    ;[fields, screens, lists] = await withOrg(orgId, async (client) => [
      await listFields(client, orgId),
      await listScreens(client, orgId),
      await listLists(client, orgId),
    ] as [FieldDefinition[], Screen[], ListDefinition[]])
  } catch (error) {
    console.error('FieldsPage failed', error)
    return (
      <>
        <h1>Fields Library</h1>
        <div className="panel notice">
          <h2>{isMissingSchema(error) ? 'Database Update Needed' : 'The Fields Could Not Be Loaded'}</h2>
          <p>{isMissingSchema(error) ? 'Run the newest files in db/migrations against the database, then reload this page.' : 'Check the database connection and try again.'}</p>
        </div>
      </>
    )
  }

  // Where each field is shown: its section, or the list it is a column of.
  const sectionOf = new Map<string, string>()
  for (const screen of screens) {
    for (const section of screen.sections) {
      for (const fieldId of section.fieldIds) sectionOf.set(fieldId, `${screen.name} / ${section.name}`)
    }
  }
  const listById = new Map(lists.map((list) => [list.id, list]))
  const shownIn = (field: FieldDefinition) =>
    field.listId ? `List: ${listById.get(field.listId)?.name ?? 'Unknown'}` : sectionOf.get(field.id) ?? 'Other Fields'

  const places = [
    ...screens.flatMap((screen) =>
      screen.sections
        .filter((section) => section.displayStyle !== 'list')
        .map((section) => ({ value: `section:${section.id}`, label: `${screen.name} / ${section.name}`, appliesTo: section.appliesTo as string })),
    ),
    ...lists.map((list) => ({ value: `list:${list.id}`, label: `Column of List: ${list.name}`, appliesTo: list.appliesTo as string })),
  ]
  const customized = fields.filter((field) => field.standard && field.modifiedSettings.length > 0).length
  const added = fields.filter((field) => !field.standard).length

  const rows: GridRow[] = RECORD_TYPES.flatMap((type, level) =>
    fields
      .filter((field) => field.appliesTo === type)
      .sort((a, b) => shownIn(a).localeCompare(shownIn(b)) || a.sortOrder - b.sortOrder)
      .map((field) => {
        const modified = field.standard && field.modifiedSettings.length > 0
        return {
          id: field.id,
          href: `/dashboard/fields/${field.id}`,
          cells: {
            name: field.name,
            belongsTo: RECORD_LABELS[type],
            fieldKey: field.key,
            type: `${TYPE_LABELS.get(field.dataType) ?? field.dataType}${field.tracking === 'monthly' ? ', Monthly' : ''}${field.calculated ? ', Calculated' : ''}`,
            shownIn: shownIn(field),
            status: !field.standard ? 'Added by You' : modified ? 'Customized' : 'Standard',
          },
          order: { belongsTo: level, status: !field.standard ? 2 : modified ? 1 : 0 },
          tones: { status: !field.standard ? 'own' as const : modified ? 'modified' as const : 'plain' as const },
        }
      }),
  )

  return (
    <>
      <h1>Fields Library</h1>
      <p className="lede">
        {fields.length} fields: {fields.length - added} Stratios standard ({customized} customized) and {added} added by your organization.
      </p>

      <section className="panel">
        <h2>Fields</h2>
        <p className="note">
          Click a field to change its settings. Changing a Stratios standard field marks only that setting as customized; everything else keeps
          following Stratios updates. Screens and sections are managed in <Link href="/dashboard/layouts">Layouts</Link>.
        </p>
        <FieldsGrid
          rows={rows}
          statusHeading="Status"
          addTitle="Add a Field"
          levels={LEVELS}
          types={DATA_TYPES.map((type) => ({ value: type.value, label: type.label }))}
          places={places}
        />
      </section>
    </>
  )
}
