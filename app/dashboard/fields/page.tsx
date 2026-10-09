import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { DATA_TYPES } from '@/lib/fieldAdmin'
import { listFields, type FieldDefinition } from '@/lib/fields'
import { listScreens, type Screen } from '@/lib/layout'
import { listLists, type ListDefinition } from '@/lib/lists'
import { RECORD_LABELS, RECORD_TYPES, type RecordType } from '@/lib/records'
import { AddFieldForm } from './Forms'

export const dynamic = 'force-dynamic'

const LEVELS = RECORD_TYPES.map((type) => ({ value: type, label: RECORD_LABELS[type] }))
const TYPE_LABELS = new Map(DATA_TYPES.map((type) => [type.value as string, type.label]))

function Status({ field }: { field: FieldDefinition }) {
  if (!field.standard) return <span className="chip chip-own">Added by You</span>
  if (field.modifiedSettings.length > 0) return <span className="chip chip-modified">Customized</span>
  return <span className="chip">Standard</span>
}

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
  const levelsInUse = RECORD_TYPES.filter((type) => fields.some((field) => field.appliesTo === type))
  const customized = fields.filter((field) => field.standard && field.modifiedSettings.length > 0).length
  const added = fields.filter((field) => !field.standard).length

  return (
    <>
      <h1>Fields Library</h1>
      <p className="lede">
        {fields.length} fields: {fields.length - added} Stratios standard ({customized} customized) and {added} added by your organization.
      </p>

      <section className="panel">
        <h2>Add a Field</h2>
        <AddFieldForm levels={LEVELS} types={DATA_TYPES.map((type) => ({ value: type.value, label: type.label }))} places={places} />
      </section>

      <section className="panel">
        <h2>Fields</h2>
        <p className="note">
          Click a field to change its settings. Changing a Stratios standard field marks only that setting as customized; everything else keeps
          following Stratios updates. Screens and sections are managed in <Link href="/dashboard/layouts">Layouts</Link>.
        </p>
        {levelsInUse.map((type: RecordType) => (
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
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fields
                    .filter((field) => field.appliesTo === type)
                    .sort((a, b) => shownIn(a).localeCompare(shownIn(b)) || a.sortOrder - b.sortOrder)
                    .map((field) => (
                      <tr key={field.id}>
                        <td><Link href={`/dashboard/fields/${field.id}`}>{field.name}</Link></td>
                        <td><code className="key">{field.key}</code></td>
                        <td>
                          {TYPE_LABELS.get(field.dataType) ?? field.dataType}
                          {field.tracking === 'monthly' ? ', Monthly' : ''}
                          {field.calculated ? ', Calculated' : ''}
                        </td>
                        <td>{shownIn(field)}</td>
                        <td><Status field={field} /></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    </>
  )
}
