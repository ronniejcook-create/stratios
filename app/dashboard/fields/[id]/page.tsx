import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { isDatabaseConfigured, withOrg } from '@/lib/db'
import { DATA_TYPES, fieldHasValues, listModifications } from '@/lib/fieldAdmin'
import { listFields, parentFieldOf } from '@/lib/fields'
import { normalizeOptions } from '@/lib/optionLists'
import { listScreens } from '@/lib/layout'
import { listLists } from '@/lib/lists'
import { RECORD_LABELS, isUuid } from '@/lib/records'
import { resetSettings, saveOptions } from '../actions'
import { FieldEditor } from './FieldEditor'
import { OptionsEditor } from './OptionsEditor'

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
      parent: parentFieldOf(fields, field),
      screens: await listScreens(client, orgId),
      lists: await listLists(client, orgId),
      hasValues: field.standard ? false : await fieldHasValues(client, id),
      modifications: await listModifications(client, orgId, id),
    }
  })
  if (!loaded) notFound()
  const { field, parent, screens, lists, modifications } = loaded
  // For the organization's version of a standard list: what Stratios itself lists.
  const standardList = field.standard ? (field.modifiedSettings.includes('options') ? normalizeOptions(field.standardValues.options) : field.optionList) : null

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
        <Link href="/dashboard/fields">Fields Library</Link>
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
            appliesTo: field.appliesTo,
            tracking: field.tracking,
            isListColumn: Boolean(field.listId),
            name: field.name,
            aiDescription: field.aiDescription ?? '',
            agentInstructions: field.agentInstructions ?? '',
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
          types={DATA_TYPES}
          typeLockedReason={
            field.standard ? 'The type of a standard field is set by Stratios.'
            : loaded.hasValues ? 'The type can no longer be changed because values have been entered for this field.'
            : null
          }
          modifications={modifications.map((item) => ({ setting: item.setting, modifiedAt: item.modifiedAt }))}
        />
      </section>

      {field.dataType === 'picklist' ? (
        <section className="panel">
          <h2>Options</h2>
          <p className="note">
            {field.standard
              ? 'The choices people pick from. Changing them gives your organization its own version of this list.'
              : 'The choices people pick from.'}
          </p>
          <OptionsEditor
            fieldId={field.id}
            fieldName={field.name}
            options={field.optionList.map(({ key, label, parent: belongsTo, countsAs, retired }) => ({ key, label, parent: belongsTo, countsAs, retired }))}
            parent={parent ? { name: parent.name, choices: parent.optionList.map((option) => ({ key: option.key, label: option.retired ? `${option.label} (Retired)` : option.label })) } : null}
            standardChoices={standardList ? standardList.filter((option) => !option.retired).map((option) => ({ key: option.key, label: option.label })) : null}
            isModified={field.standard && field.modifiedSettings.includes('options')}
            modifiedAt={modifications.find((item) => item.setting === 'options')?.modifiedAt ?? null}
            saveAction={saveOptions}
            resetAction={resetSettings}
          />
        </section>
      ) : null}
    </>
  )
}
