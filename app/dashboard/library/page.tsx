import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema, withStratiosAdmin } from '@/lib/db'
import { DATA_TYPES, countCustomizations } from '@/lib/fieldAdmin'
import { listFields, type FieldDefinition } from '@/lib/fields'
import { listScreens, type Screen } from '@/lib/layout'
import { listLists, type ListDefinition } from '@/lib/lists'
import { RECORD_LABELS, RECORD_TYPES } from '@/lib/records'
import { isStratiosAdmin } from '@/lib/stratios'
import type { GridRow } from '@/components/DataGrid'
import { FieldsGrid } from '../fields/FieldsGrid'
import { addLibraryField } from './actions'

export const dynamic = 'force-dynamic'

const LEVELS = RECORD_TYPES.map((type) => ({ value: type, label: RECORD_LABELS[type] }))
const TYPE_LABELS = new Map(DATA_TYPES.map((type) => [type.value as string, type.label]))

export default async function LibraryPage() {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  // Stratios administrators only. Everyone else gets "not found", as if the page didn't exist.
  if (!isDatabaseConfigured() || !(await isStratiosAdmin(orgId, orgRole))) notFound()

  let fields: FieldDefinition[] = []
  let screens: Screen[] = []
  let lists: ListDefinition[] = []
  let customized = new Map<string, number>()
  try {
    ;[fields, screens, lists, customized] = await withStratiosAdmin(orgId, async (client) => [
      // null = the standard alone, exactly as Stratios defines it
      await listFields(client, null),
      await listScreens(client, null),
      await listLists(client, null),
      await countCustomizations(client),
    ] as [FieldDefinition[], Screen[], ListDefinition[], Map<string, number>])
  } catch (error) {
    console.error('LibraryPage failed', error)
    return (
      <>
        <h1>Fields Library</h1>
        <div className="panel notice">
          <h2>{isMissingSchema(error) ? 'Database Update Needed' : 'The Library Could Not Be Loaded'}</h2>
          <p>{isMissingSchema(error) ? 'Run the newest files in db/migrations against the database, then reload this page.' : 'Check the database connection and try again.'}</p>
        </div>
      </>
    )
  }

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
  const rows: GridRow[] = RECORD_TYPES.flatMap((type, level) =>
    fields
      .filter((field) => field.appliesTo === type)
      .sort((a, b) => shownIn(a).localeCompare(shownIn(b)) || a.sortOrder - b.sortOrder)
      .map((field) => {
        const orgs = customized.get(field.id) ?? 0
        return {
          id: field.id,
          href: `/dashboard/library/${field.id}`,
          cells: {
            name: field.name,
            belongsTo: RECORD_LABELS[type],
            fieldKey: field.key,
            type: `${TYPE_LABELS.get(field.dataType) ?? field.dataType}${field.tracking === 'monthly' ? ', Monthly' : ''}${field.calculated ? ', Calculated' : ''}`,
            shownIn: shownIn(field),
            status: orgs === 0 ? 'None' : orgs === 1 ? '1 organization' : `${orgs} organizations`,
          },
          order: { belongsTo: level, status: orgs },
          tones: { status: orgs === 0 ? 'muted' as const : 'modified' as const },
        }
      }),
  )

  return (
    <>
      <h1>Fields Library</h1>
      <p className="lede">
        The {fields.length} Stratios standard fields that every organization starts from. The standard screens and sections are in{' '}
        <Link href="/dashboard/layout-library">Layouts</Link>.
      </p>
      <div className="panel notice">
        <h2>Changes Here Reach Every Organization</h2>
        <p>
          A change is live for all organizations as soon as it is saved. The one exception: a setting an organization has modified for itself keeps
          its value. To change something for the Stratios organization only, use Fields Library under Admin Settings instead.
        </p>
      </div>

      <section className="panel">
        <h2>Standard Fields</h2>
        <FieldsGrid
          rows={rows}
          statusHeading="Customized By"
          addTitle="Add a Standard Field"
          addAction={addLibraryField}
          levels={LEVELS}
          types={DATA_TYPES.map((type) => ({ value: type.value, label: type.label }))}
          places={places}
        />
      </section>
    </>
  )
}
