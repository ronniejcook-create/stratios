import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { FieldGroup, type FieldView, type Target } from '@/app/dashboard/assets/[id]/FieldGroup'
import { isDatabaseConfigured, withOrg } from '@/lib/db'
import { listDocuments, MAX_DOCUMENT_BYTES } from '@/lib/documents'
import { currentLabel } from '@/lib/optionLists'
import { listFields, listSourceTypes, listValues, type FieldDefinition } from '@/lib/fields'
import { listScreens } from '@/lib/layout'
import { loadAccess } from '@/lib/permissions'
import { isUuid } from '@/lib/records'
import { getLease, leaseLabel, tenantsReady } from '@/lib/tenants'
import { LeaseDocuments, type LeaseDocumentRow } from './LeaseDocuments'

export const dynamic = 'force-dynamic'
// Saving a field and loading a document both come back to this page.
export const maxDuration = 60

const whole = (value: number | null) => (value === null ? '' : Math.round(value).toLocaleString('en-US'))
const money = (value: number | null, cents = false) =>
  value === null ? '' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })
function day(value: string | null): string {
  if (!value) return ''
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/**
 * One lease: what the rent rolls say about it, the documents loaded onto it,
 * and the terms read from the lease agreement, as fields. The fields are
 * ordinary Stratios fields (Fields Library, "Belongs To" Lease), so an
 * organization can add its own and set who may see or change them.
 */
export default async function LeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null // the layout redirects before this renders
  const { id } = await params
  if (!isDatabaseConfigured() || !isUuid(id)) notFound()
  const isAdmin = orgRole === 'org:admin'

  const loaded = await withOrg(orgId, async (client) => {
    // Like the Leases tab: rents and tenants are shown only to people who may add documents.
    const access = await loadAccess(client, orgId, userId, isAdmin)
    if (!access.canAddRecords || !(await tenantsReady(client))) return null
    const lease = await getLease(client, orgId, id)
    if (!lease) return null
    return {
      lease,
      access,
      fields: (await listFields(client, orgId)).filter((field) => field.appliesTo === 'lease' && !field.listId),
      values: await listValues(client, orgId, [id]),
      screens: await listScreens(client, orgId),
      sources: await listSourceTypes(client),
      documents: (await listDocuments(client, orgId, lease.assetId)).filter((document) => document.leaseId === id),
    }
  })
  if (!loaded) notFound()
  const { lease, access, fields, values, screens, sources, documents } = loaded!
  const sourceNames = new Map(sources.map((source) => [source.key, source.name]))

  const viewOf = (field: FieldDefinition, canEdit: boolean): FieldView => {
    const stored = values.find((value) => value.fieldId === field.id)
    let value = stored ? { text: stored.text, number: stored.number, date: stored.date, bool: stored.bool } : null
    if (value && field.dataType === 'picklist' && value.text) value = { ...value, text: currentLabel(field.optionList, value.text) }
    return {
      id: field.id,
      key: field.key,
      name: field.name,
      dataType: field.dataType,
      unit: field.unit,
      options: field.options,
      monthly: field.tracking === 'monthly',
      calculated: field.calculated,
      formula: field.formula,
      value,
      period: stored?.period ?? null,
      sourceName: stored ? sourceNames.get(stored.sourceType) ?? null : null,
      canEdit,
      description: field.aiDescription,
      agentInstructions: field.agentInstructions,
    }
  }
  /** The fields of a section the person may see; hidden ones never reach the browser. */
  const viewsOf = (candidates: FieldDefinition[], sectionId: string | null): FieldView[] =>
    candidates.flatMap((field) => {
      const level = access.fieldLevel(field.id, sectionId)
      return level === 'hidden' ? [] : [viewOf(field, level === 'edit')]
    })

  const byId = new Map(fields.map((field) => [field.id, field]))
  const sections = screens.flatMap((screen) => screen.sections).filter((section) => section.appliesTo === 'lease' && section.displayStyle !== 'list')
  const placed = new Set(sections.flatMap((section) => section.fieldIds))
  const groups = [
    ...sections.map((section) => ({ id: section.id, name: section.name, tiles: section.displayStyle === 'tiles', views: viewsOf(section.fieldIds.flatMap((fieldId) => byId.get(fieldId) ?? []), section.id) })),
    { id: '_other', name: 'Other Fields', tiles: false, views: viewsOf(fields.filter((field) => !placed.has(field.id)), null) },
  ].filter((group) => group.views.length > 0)
  const filled = groups.reduce((sum, group) => sum + group.views.filter((view) => view.value !== null).length, 0)

  const name = leaseLabel(lease)
  const target: Target = { assetId: lease.assetId, recordType: 'lease', recordId: lease.id, recordRef: `lease:${lease.id}`, recordName: name }
  const tiles = [
    { label: 'Lease Start', value: day(lease.startDate) },
    { label: 'Lease End', value: day(lease.endDate) },
    { label: 'Square Feet', value: whole(lease.squareFeet) },
    { label: 'Rent per SF', value: money(lease.rentPerSf, true) },
    { label: 'Annual Rent', value: money(lease.annualRent) },
    { label: 'Recovery', value: lease.recoveryType ?? '' },
  ]
  const documentRows: LeaseDocumentRow[] = documents.map((document) => {
    const set = document.counts.filled + document.counts.replaced
    return {
      id: document.id,
      name: document.name,
      status: document.stalled ? 'failed' : (document.status as LeaseDocumentRow['status']),
      documentType: document.documentType,
      error: document.stalled ? 'The reading stopped before it finished.' : document.error,
      uploaded: day(document.uploadedAt),
      found: [set > 0 ? `${set} filled in` : '', document.counts.confirmed > 0 ? `${document.counts.confirmed} confirmed` : '', document.counts.kept > 0 ? `${document.counts.kept} kept as they were` : ''].filter(Boolean).join(', '),
      undecided: document.undecided,
    }
  })

  return (
    <>
      <p className="crumbs">
        <Link href="/dashboard/tenants">Tenants</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/dashboard/tenants/${lease.tenantId}`}>{lease.tenantName}</Link>
        <span aria-hidden="true"> / </span>
        <span>{lease.unitName ? `Unit ${lease.unitName}` : 'Lease'}</span>
      </p>
      <h1>{name}</h1>
      <p className="lede">
        Lease at <Link href={`/dashboard/assets/${lease.assetId}?screen=_leases`}>{lease.propertyName}</Link>
        {lease.assetName !== lease.propertyName ? ` (${lease.assetName})` : ''} <span className={`chip${lease.status === 'active' ? '' : ' chip-own'}`}>{lease.status === 'active' ? 'Active' : 'Past'}</span>
      </p>

      <section className="panel">
        <h2>From the Rent Roll</h2>
        <div className="field-list tiles rent-roll-tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className="field-card rent-roll-tile">
              <span className="field-card-label">{tile.label}</span>
              <span className={tile.value ? 'field-card-value' : 'field-card-value field-unset'}>{tile.value || 'Not shown'}</span>
            </div>
          ))}
        </div>
        <p className="doc-sub">
          What the latest rent roll to show this lease says ({day(lease.lastSeen)}). These follow the rent rolls and can&apos;t be changed here. The terms below come from the lease
          agreement itself; where the two differ, both are shown.
        </p>
      </section>

      <LeaseDocuments leaseId={lease.id} assetId={lease.assetId} documents={documentRows} maxMb={MAX_DOCUMENT_BYTES / 1024 / 1024} />

      {groups.length === 0 ? (
        <section className="panel notice">
          <h2>Lease Terms</h2>
          <p>{fields.length === 0 ? 'Lease fields need a database update: run db/migrations/028_lease_fields.sql, then reload this page.' : 'Your role does not let you see any lease fields.'}</p>
        </section>
      ) : (
        <>
          {filled === 0 ? <p className="note">Nothing has been filled in yet. Load the lease agreement above and the agent fills in these terms, or click a field to type it in.</p> : null}
          {groups.map((group) => (
            <section key={group.id} className="panel">
              <h2>{group.name}</h2>
              <FieldGroup target={target} fields={group.views} style={group.tiles ? 'tiles' : 'form'} canManageFields={isAdmin} />
            </section>
          ))}
        </>
      )}
    </>
  )
}
