import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, withOrg } from '@/lib/db'
import { DATA_TYPES, listModifications } from '@/lib/fieldAdmin'
import { listFields } from '@/lib/fields'
import { listScreens } from '@/lib/layout'
import { listLists } from '@/lib/lists'
import { RECORD_LABELS, isUuid } from '@/lib/records'
import { FieldEditor } from './FieldEditor'

export const dynamic = 'force-dynamic'

export default async function FieldPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId, orgRole } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  if (orgRole !== 'org:admin') redirect('/dashboard')
  const { id } = await params
  if (!isDatabaseConfigured() || !isUuid(id)) notFound()

  const loaded = await withOrg(orgId, async (client) => {
    const fields = await listFields(client, orgId)
    const field = fields.find((candidate) => candidate.id === id)
    if (!field) return null
    return {
      field,
      screens: await listScreens(client, orgId),
      lists: await listLists(client, orgId),
      sources: await client.query('select key, name from source_types where in_waterfall order by sort_order'),
      modifications: await listModifications(client, orgId, id),
    }
  })
  if (!loaded) notFound()
  const { field, screens, lists, modifications } = loaded

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
        <Link href="/dashboard/fields">Fields and Layout</Link>
        <span aria-hidden="true"> / </span>
        <span>{field.name}</span>
      </p>
      <h1>{field.name}</h1>
      <p className="lede">
        {RECORD_LABELS[field.appliesTo]} field · {typeLabel}
        {field.unit ? ` (${field.unit})` : ''} · {field.calculated ? 'Calculated' : field.tracking === 'monthly' ? 'A value per month' : 'One current value'}
        {list ? ` · Column of the ${list.name} list` : ''}
        <span className="record-key" title="The permanent key used by agents, formulas and feeds">{field.key}</span>
      </p>

      <section className="panel">
        <h2>{field.standard ? 'Stratios Standard Field' : 'Field Added by Your Organization'}</h2>
        <p className="note">
          {field.standard
            ? 'Changes here apply to your organization only. Each setting you change is marked Modified and stops following Stratios updates; the rest keep following them. Reset puts a setting back to the standard.'
            : 'This field belongs to your organization, so its settings are changed directly.'}
        </p>
        <FieldEditor
          field={{
            id: field.id,
            standard: field.standard,
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
            modifiedSettings: field.modifiedSettings,
            standardValues: field.standardValues,
          }}
          sections={sections.map((section) => ({ id: section.id, label: section.label }))}
          currentSectionId={sections.find((section) => section.hasField)?.id ?? null}
          sources={loaded.sources.rows.map((row) => ({ key: String(row.key), name: String(row.name) }))}
          modifications={modifications.map((item) => ({ setting: item.setting, modifiedAt: item.modifiedAt }))}
        />
      </section>
    </>
  )
}
