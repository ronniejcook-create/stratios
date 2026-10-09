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
import { AddFieldForm, AddScreenForm, AddSectionForm } from '../fields/Forms'
import { addLibraryField, addLibraryScreen, addLibrarySection } from './actions'

export const dynamic = 'force-dynamic'

const LEVELS = RECORD_TYPES.map((type) => ({ value: type, label: RECORD_LABELS[type] }))
const TYPE_LABELS = new Map(DATA_TYPES.map((type) => [type.value as string, type.label]))
const STYLE_LABELS: Record<string, string> = { form: 'Form', tiles: 'Tiles', list: 'List' }

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
        <h1>Master Library</h1>
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
  const levelsInUse = RECORD_TYPES.filter((type) => fields.some((field) => field.appliesTo === type))

  return (
    <>
      <h1>Master Library</h1>
      <p className="lede">The {fields.length} Stratios standard fields and the standard layout that every organization starts from.</p>
      <div className="panel notice">
        <h2>Changes Here Reach Every Organization</h2>
        <p>
          A change is live for all organizations as soon as it is saved. The one exception: a setting an organization has modified for itself keeps
          its value. To change something for the Stratios organization only, use Fields and Layout instead.
        </p>
      </div>

      <section className="panel">
        <h2>Add a Standard Field</h2>
        <AddFieldForm action={addLibraryField} levels={LEVELS} types={DATA_TYPES.map((type) => ({ value: type.value, label: type.label }))} places={places} />
      </section>

      <section className="panel">
        <h2>Standard Fields</h2>
        {levelsInUse.map((type) => (
          <div key={type} className="record-group">
            <h3>{RECORD_LABELS[type]}</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Key</th>
                    <th scope="col">Type</th>
                    <th scope="col">Shown In</th>
                    <th scope="col">Customized By</th>
                  </tr>
                </thead>
                <tbody>
                  {fields
                    .filter((field) => field.appliesTo === type)
                    .sort((a, b) => shownIn(a).localeCompare(shownIn(b)) || a.sortOrder - b.sortOrder)
                    .map((field) => {
                      const orgs = customized.get(field.id) ?? 0
                      return (
                        <tr key={field.id}>
                          <td><Link href={`/dashboard/library/${field.id}`}>{field.name}</Link></td>
                          <td><code className="key">{field.key}</code></td>
                          <td>
                            {TYPE_LABELS.get(field.dataType) ?? field.dataType}
                            {field.tracking === 'monthly' ? ', Monthly' : ''}
                            {field.calculated ? ', Calculated' : ''}
                          </td>
                          <td>{shownIn(field)}</td>
                          <td>{orgs === 0 ? <span className="muted">None</span> : <span className="chip chip-modified">{orgs === 1 ? '1 organization' : `${orgs} organizations`}</span>}</td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Standard Layout</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Screen</th>
                <th scope="col">Section</th>
                <th scope="col">Belongs To</th>
                <th scope="col">Shown As</th>
                <th scope="col">Contains</th>
              </tr>
            </thead>
            <tbody>
              {screens.flatMap((screen) =>
                screen.sections.length === 0
                  ? [
                      <tr key={screen.id}>
                        <td>{screen.name}</td>
                        <td colSpan={4} className="muted">No sections yet</td>
                      </tr>,
                    ]
                  : screen.sections.map((section, index) => {
                      const sectionLists = lists.filter((list) => list.sectionId === section.id)
                      const columns = fields.filter((field) => sectionLists.some((list) => list.id === field.listId)).length
                      return (
                        <tr key={section.id}>
                          <td>{index === 0 ? screen.name : ''}</td>
                          <td>{section.name}</td>
                          <td>{RECORD_LABELS[section.appliesTo]}</td>
                          <td>{STYLE_LABELS[section.displayStyle]}</td>
                          <td>{section.displayStyle === 'list' ? `${columns} ${columns === 1 ? 'column' : 'columns'}` : `${section.fieldIds.length} ${section.fieldIds.length === 1 ? 'field' : 'fields'}`}</td>
                        </tr>
                      )
                    }),
              )}
            </tbody>
          </table>
        </div>
        <div className="start-from">
          <h3>Add a Standard Section or List</h3>
          <AddSectionForm action={addLibrarySection} levels={LEVELS} screens={screens.map((screen) => ({ value: screen.id, label: screen.name }))} />
        </div>
        <div className="start-from">
          <h3>Add a Standard Screen</h3>
          <AddScreenForm action={addLibraryScreen} />
        </div>
      </section>
    </>
  )
}
