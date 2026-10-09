import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, withStratiosAdmin } from '@/lib/db'
import { DATA_TYPES, countCustomizations } from '@/lib/fieldAdmin'
import { listFields } from '@/lib/fields'
import { listScreens } from '@/lib/layout'
import { listLists } from '@/lib/lists'
import { RECORD_LABELS, isUuid } from '@/lib/records'
import { isStratiosAdmin } from '@/lib/stratios'
import { FieldEditor } from '../../fields/[id]/FieldEditor'
import { retireLibraryField, saveLibraryField } from '../actions'

export const dynamic = 'force-dynamic'

export default async function LibraryFieldPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  const { id } = await params
  if (!isDatabaseConfigured() || !isUuid(id) || !(await isStratiosAdmin(orgId, orgRole))) notFound()

  const loaded = await withStratiosAdmin(orgId, async (client) => {
    // null = the standard alone, without the Stratios organization's own changes
    const field = (await listFields(client, null)).find((candidate) => candidate.id === id)
    if (!field) return null
    return {
      field,
      screens: await listScreens(client, null),
      lists: await listLists(client, null),
      sources: await client.query('select key, name from source_types where in_waterfall order by sort_order'),
      customized: (await countCustomizations(client)).get(id) ?? 0,
    }
  })
  if (!loaded) notFound()
  const { field, screens, lists, customized } = loaded

  const sections = screens.flatMap((screen) =>
    screen.sections
      .filter((section) => section.appliesTo === field.appliesTo && section.displayStyle !== 'list')
      .map((section) => ({ id: section.id, label: `${screen.name} / ${section.name}`, hasField: section.fieldIds.includes(field.id) })),
  )
  const list = field.listId ? lists.find((candidate) => candidate.id === field.listId) : null
  const typeLabel = DATA_TYPES.find((type) => type.value === field.dataType)?.label ?? field.dataType

  return (
    <>
      <p className="crumbs">
        <Link href="/dashboard/library">Master Library</Link>
        <span aria-hidden="true"> / </span>
        <span>{field.name}</span>
      </p>
      <h1>{field.name}</h1>
      <p className="lede">
        Standard {RECORD_LABELS[field.appliesTo].toLowerCase()} field · {typeLabel}
        {field.unit ? ` (${field.unit})` : ''} · {field.calculated ? 'Calculated' : field.tracking === 'monthly' ? 'A value per month' : 'One current value'}
        {list ? ` · Column of the ${list.name} list` : ''}
        <span className="record-key" title="The permanent key used by agents, formulas and feeds">{field.key}</span>
      </p>

      <section className="panel">
        <h2>Standard for Every Organization</h2>
        <p className="note">
          Saving changes this field for all organizations at once.{' '}
          {customized === 0
            ? 'No organization has customized it.'
            : `${customized === 1 ? '1 organization has' : `${customized} organizations have`} customized it; the settings they modified keep their own values.`}
        </p>
        <FieldEditor
          saveAction={saveLibraryField}
          removeAction={retireLibraryField}
          backHref="/dashboard/library"
          noSectionLabel="Other Fields (No Section)"
          removeLabel="Retire Field"
          removeNote="Retiring hides the field for every organization. Values already entered are kept in the database."
          canRemove={!field.coreColumn}
          field={{
            id: field.id,
            // Edited directly here, so the editor treats it like a field of its own.
            standard: false,
            calculated: field.calculated,
            dataType: field.dataType,
            isListColumn: Boolean(field.listId),
            name: field.name,
            aiDescription: field.aiDescription ?? '',
            otherNames: field.otherNames,
            extractionHints: field.extractionHints ?? '',
            sourcePriority: field.sourcePriority,
            whenEmpty: field.whenEmpty,
            whenDifferent: field.whenDifferent,
            manualOverride: field.manualOverride,
            unit: field.unit ?? '',
            options: field.options ?? [],
            modifiedSettings: [],
            standardValues: {},
          }}
          sections={sections.map((section) => ({ id: section.id, label: section.label }))}
          currentSectionId={sections.find((section) => section.hasField)?.id ?? null}
          sources={loaded.sources.rows.map((row) => ({ key: String(row.key), name: String(row.name) }))}
          modifications={[]}
        />
      </section>
    </>
  )
}
