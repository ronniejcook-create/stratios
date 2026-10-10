// What the Portfolio Analyst can look up beyond an asset's own fields:
// a search across everything Stratios holds, tenants and their leases, a
// lease's terms, the rent roll, comments and critical dates, and documents.
//
// Every lookup runs as the signed-in person. Tenants, leases, rent rolls and
// documents are open to the same people as their screens (roles that can
// edit, and administrators); field values follow each field's own rule, so
// a hidden field is never returned. Nothing here changes anything.

import { withOrg } from './db'
import type { Caller } from './documentRequests'
import { listDocuments } from './documents'
import { sectionByField } from './extraction'
import { formatValue } from './fieldFormat'
import { listFields, listSourceTypes, listValues, type FieldDefinition } from './fields'
import { listScreens } from './layout'
import { listLists, listRows, sortRows } from './lists'
import { loadAccess, type Access } from './permissions'
import { getAssetTree, isUuid, listAssets, RECORD_LABELS, type Queryable } from './records'
import { listRentRollRows, listRentRolls, RENT_ROLL_STATUS_LABELS } from './rentRolls'
import { findLease, leaseLabel, listLeases, listTenantQuestions, listTenants, ruleTenant, syncAsset, tenantsReady, type Lease } from './tenants'

export type LookupLink = { label: string; href: string }
export type Lookup = { ok: true; result: Record<string, unknown>; links: LookupLink[] } | { ok: false; error: string }

const NOT_ALLOWED = 'This person\'s role does not allow opening tenants, leases, rent rolls or documents. An administrator can give them a role that can edit.'
const NO_ASSET = 'That asset could not be found. Use list_assets or search_portfolio to get its id.'

/** Runs a query that may meet a table from a migration not yet run, giving `fallback` then, without spoiling the transaction. */
async function attempt<T>(client: Queryable, fallback: T, work: () => Promise<T>): Promise<T> {
  try {
    await client.query('savepoint agent_lookup')
  } catch {
    return fallback
  }
  try {
    const result = await work()
    await client.query('release savepoint agent_lookup')
    return result
  } catch (error) {
    console.error('An analyst lookup failed; continuing without it', error)
    await client.query('rollback to savepoint agent_lookup').catch(() => {})
    return fallback
  }
}

const figure = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100)

function describeLease(lease: Lease) {
  return {
    tenant: lease.tenantName,
    unit: lease.unitName,
    asset: lease.assetName,
    property: lease.propertyName,
    status: lease.status === 'active' ? 'Active (the latest rent roll shows it)' : 'Past (no longer in the latest rent roll)',
    square_feet: figure(lease.squareFeet),
    lease_start: lease.startDate,
    lease_end: lease.endDate,
    rent_per_square_foot_per_year: figure(lease.rentPerSf),
    annual_rent: figure(lease.annualRent),
    monthly_rent: figure(lease.monthlyRent),
    recovery_type: lease.recoveryType,
    last_rent_roll_showing_it: lease.lastSeen,
  }
}

/** Every lease of an asset, or of every asset when none is given. */
async function leasesOf(client: Queryable, orgId: string, assetId: string | null): Promise<Lease[]> {
  if (!(await tenantsReady(client))) return []
  if (assetId) return listLeases(client, orgId, { assetId })
  const all: Lease[] = []
  for (const asset of (await listAssets(client, orgId)).slice(0, 100)) all.push(...(await listLeases(client, orgId, { assetId: asset.id })))
  return all
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** The words of a search as patterns for "contains", with the characters that mean something to LIKE made plain. */
function patternsOf(query: string): string[] {
  return query
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}&'.-]/gu, ''))
    .filter((word) => word.length >= 2)
    .slice(0, 6)
    .map((word) => `%${word.replace(/[\\%_]/g, '\\$&')}%`)
}

/** Whether the person may see a field's values: a list column follows its list's section. */
function visible(access: Access, field: FieldDefinition, sections: Map<string, string>, listSections: Map<string, string | null>): boolean {
  if (field.listId) {
    const section = listSections.get(field.listId)
    return section ? access.sectionLevel(section) !== 'hidden' : access.admin
  }
  return access.fieldLevel(field.id, sections.get(field.id) ?? null) !== 'hidden'
}

/**
 * Looks for a name or phrase across everything Stratios holds: assets and
 * properties, tenants and their leases, names in rent rolls, documents, and
 * the text of fields, comments and critical dates. Each match says where it
 * was found, so the analyst can answer or open the right screen.
 */
export async function searchPortfolio(caller: Caller, query: string): Promise<Lookup> {
  const patterns = patternsOf(query)
  if (patterns.length === 0) return { ok: false, error: 'Give a name or a word of at least two letters to search for.' }
  const { orgId, userId } = caller
  return withOrg(orgId, async (client) => {
    const access = await loadAccess(client, orgId, userId, caller.isAdmin)
    const links: LookupLink[] = []
    const result: Record<string, unknown> = { searched_for: query }

    const assets = await client.query(
      `select a.id::text as id, a.name from assets a where a.org_id = $1 and a.name ilike all($2::text[]) order by a.name limit 15`,
      [orgId, patterns],
    )
    const properties = await client.query(
      `select p.name, a.id::text as asset_id, a.name as asset_name, p.property_type
       from properties p join assets a on a.id = p.asset_id
       where p.org_id = $1 and p.name ilike all($2::text[]) order by p.name limit 15`,
      [orgId, patterns],
    )
    result.assets = assets.rows.map((row) => ({ asset: row.name, asset_id: row.id }))
    result.properties = properties.rows.map((row) => ({ property: row.name, type: row.property_type, asset: row.asset_name, asset_id: row.asset_id }))
    for (const row of assets.rows.slice(0, 2)) links.push({ label: `Open ${row.name}`, href: `/dashboard/assets/${row.id}` })

    if (access.canAddRecords) {
      // Tenants on file, by name or by a spelling a person confirmed, with their leases.
      const tenants = await attempt(client, [] as { id: string; name: string; aliases: unknown }[], async () =>
        (await client.query(
          `select t.id::text as id, t.name, t.aliases from tenants t
           where t.org_id = $1 and (t.name || ' ' || coalesce(t.aliases::text, '')) ilike all($2::text[]) order by t.name limit 10`,
          [orgId, patterns],
        )).rows,
      )
      const tenantHits = []
      for (const tenant of tenants) {
        const leases = await attempt(client, [] as Lease[], () => listLeases(client, orgId, { tenantId: tenant.id }))
        tenantHits.push({ tenant: tenant.name, other_spellings: tenant.aliases, leases: leases.slice(0, 20).map(describeLease) })
        links.push({ label: `Open ${tenant.name}`, href: `/dashboard/tenants/${tenant.id}` })
        for (const lease of leases.filter((entry) => entry.status === 'active').slice(0, 2)) links.push({ label: `Open the Lease: ${leaseLabel(lease)}`, href: `/dashboard/leases/${lease.id}` })
      }
      result.tenants = tenantHits

      // Names a rent roll writes that are not a tenant on file: waiting to be confirmed, or ruled out as not a tenant.
      const written = await attempt(client, [] as Record<string, unknown>[], async () =>
        (await client.query(
          `select distinct on (w.tenant, r.asset_id) w.tenant, w.suite, w.status, a.name as asset_name, r.asset_id::text as asset_id, r.as_of_date::text as as_of
           from rent_roll_rows w join rent_rolls r on r.id = w.rent_roll_id join assets a on a.id = r.asset_id
           where w.org_id = $1 and w.tenant ilike all($2::text[]) and w.tenant_id is null
           order by w.tenant, r.asset_id, r.as_of_date desc limit 15`,
          [orgId, patterns],
        )).rows,
      )
      result.names_in_rent_rolls_that_are_not_a_tenant_on_file = written.map((row) => ({
        name_as_written: row.tenant,
        unit: row.suite,
        marked: RENT_ROLL_STATUS_LABELS[row.status as keyof typeof RENT_ROLL_STATUS_LABELS] ?? row.status,
        asset: row.asset_name,
        asset_id: row.asset_id,
        rent_roll_as_of: row.as_of,
        note: 'This name is in a rent roll but has no tenant record: it is waiting to be confirmed on the asset\'s Leases tab, is vacant or not-for-lease space, or was judged not to be a tenant.',
      }))
      for (const row of written.slice(0, 1)) links.push({ label: 'Open Rent Roll', href: `/dashboard/assets/${row.asset_id}?screen=_rentroll` })

      const documents = await client.query(
        `select d.id::text as id, d.name, d.document_type, d.status, d.asset_id::text as asset_id, a.name as asset_name,
                to_char(d.uploaded_at at time zone 'UTC', 'YYYY-MM-DD') as uploaded
         from documents d left join assets a on a.id = d.asset_id
         where d.org_id = $1 and d.status <> 'uploading'
           and (d.name || ' ' || coalesce(d.document_type, '') || ' ' || coalesce(d.summary, '')) ilike all($2::text[])
         order by d.uploaded_at desc limit 10`,
        [orgId, patterns],
      )
      result.documents = documents.rows.map((row) => ({ document: row.name, kind: row.document_type, uploaded: row.uploaded, asset: row.asset_name, asset_id: row.asset_id, read: row.status === 'read' }))
      for (const row of documents.rows.filter((entry) => entry.asset_id).slice(0, 2)) links.push({ label: `Open ${row.name}`.slice(0, 60), href: `/dashboard/assets/${row.asset_id}/documents/${row.id}` })
    } else {
      result.not_searched = 'Tenants, leases, rent rolls and documents were not searched: this person\'s role cannot open them.'
    }

    // The text of fields, comments and critical dates, for fields the person may see.
    const fields = await listFields(client, orgId)
    const sections = sectionByField(await listScreens(client, orgId))
    const listSections = new Map((await listLists(client, orgId)).map((list) => [list.id, list.sectionId]))
    const allowed = new Map(fields.filter((field) => visible(access, field, sections, listSections)).map((field) => [field.id, field]))
    const values = await attempt(client, [] as Record<string, unknown>[], async () =>
      (await client.query(
        `select v.field_id::text as field_id, v.record_type, v.value_text, v.row_id is not null as in_list,
                coalesce(a.id, p.asset_id, bp.asset_id, l.asset_id)::text as asset_id,
                coalesce(a.name, p.name, b.name, lt.name) as record_name
         from field_values v
         left join assets a on v.record_type = 'asset' and a.id = v.record_id
         left join properties p on v.record_type = 'property' and p.id = v.record_id
         left join buildings b on v.record_type = 'building' and b.id = v.record_id
         left join properties bp on bp.id = b.property_id
         left join leases l on v.record_type = 'lease' and l.id = v.record_id
         left join tenants lt on lt.id = l.tenant_id
         where v.org_id = $1 and v.status = 'approved' and v.value_text ilike all($2::text[])
         order by v.updated_at desc limit 60`,
        [orgId, patterns],
      )).rows,
    )
    const assetNames = new Map((await listAssets(client, orgId)).map((asset) => [asset.id, asset.name]))
    result.mentions_in_fields_comments_and_dates = values
      .filter((row) => allowed.has(String(row.field_id)) && row.asset_id && (row.record_type !== 'lease' || access.canAddRecords))
      .slice(0, 20)
      .map((row) => ({
        asset: assetNames.get(String(row.asset_id)) ?? null,
        asset_id: row.asset_id,
        on: `${RECORD_LABELS[row.record_type as keyof typeof RECORD_LABELS] ?? row.record_type}: ${row.record_name ?? ''}`,
        field: allowed.get(String(row.field_id))!.name,
        kind: row.in_list ? 'an entry in a list (Dates and Commentary tab)' : 'a field',
        text: String(row.value_text ?? '').replace(/\s+/g, ' ').slice(0, 300),
      }))

    const counts = ['assets', 'properties', 'tenants', 'names_in_rent_rolls_that_are_not_a_tenant_on_file', 'documents', 'mentions_in_fields_comments_and_dates']
      .map((key) => (Array.isArray(result[key]) ? (result[key] as unknown[]).length : 0))
    if (counts.every((count) => count === 0)) result.nothing_found = 'Nothing in Stratios matches. Try a shorter or differently spelled word before telling the person it is not there.'
    return { ok: true as const, result, links }
  })
}

// ---------------------------------------------------------------------------
// Tenants and leases
// ---------------------------------------------------------------------------

/** Every tenant with its leases, for one asset or the whole organization. */
export async function tenantsForAgent(caller: Caller, assetId: string | null): Promise<Lookup> {
  const { orgId, userId } = caller
  if (assetId !== null && !isUuid(assetId)) return { ok: false, error: NO_ASSET }
  return withOrg(orgId, async (client) => {
    const access = await loadAccess(client, orgId, userId, caller.isAdmin)
    if (!access.canAddRecords) return { ok: false as const, error: NOT_ALLOWED }
    if (!(await tenantsReady(client))) return { ok: false as const, error: 'Tenants and leases are not set up yet: the database needs db/migrations/024_tenants_and_leases.sql.' }
    const tree = assetId ? await getAssetTree(client, orgId, assetId) : null
    if (assetId && !tree) return { ok: false as const, error: NO_ASSET }
    const leases = await leasesOf(client, orgId, assetId)
    const waiting = await listTenantQuestions(client, orgId, assetId)
    const names = new Map((await listTenants(client, orgId)).map((tenant) => [tenant.id, tenant.aliases]))
    const byTenant = new Map<string, Lease[]>()
    for (const lease of leases) byTenant.set(lease.tenantId, [...(byTenant.get(lease.tenantId) ?? []), lease])
    const tenants = [...byTenant.entries()]
      .map(([tenantId, own]) => ({
        tenant: own[0].tenantName,
        other_spellings: names.get(tenantId) ?? [],
        active_leases: own.filter((lease) => lease.status === 'active').length,
        leases: own.map((lease) => {
          const { tenant: _tenant, ...rest } = describeLease(lease)
          void _tenant
          return rest
        }),
      }))
      .sort((a, b) => a.tenant.localeCompare(b.tenant))
    return {
      ok: true as const,
      result: {
        scope: tree ? `The asset ${tree.name}` : 'Every asset in the organization',
        tenants_with_a_lease: tenants.length,
        tenants: tenants.slice(0, 400),
        names_waiting_to_be_confirmed: waiting.map((question) => question.writtenName),
        about: 'Tenants and leases are built from the rent rolls. This is the complete list: a name that is not here, and not waiting to be confirmed, has no lease on file. Use search_portfolio to see whether the name appears anywhere else, such as in a rent roll row or a document.',
      },
      links: tree ? [{ label: 'Open the Leases Tab', href: `/dashboard/assets/${tree.id}?screen=_leases` }] : [{ label: 'Open Tenants', href: '/dashboard/tenants' }],
    }
  })
}

/** One lease in full: its terms from the rent roll, the fields read from its lease agreement, and its documents. */
export async function leaseForAgent(caller: Caller, input: { assetId: string | null; tenant: string; unit: string }): Promise<Lookup> {
  const { orgId, userId } = caller
  if (input.assetId !== null && !isUuid(input.assetId)) return { ok: false, error: NO_ASSET }
  if (!input.tenant.trim() && !input.unit.trim()) return { ok: false, error: 'Give the tenant\'s name, the unit, or both.' }
  return withOrg(orgId, async (client) => {
    const access = await loadAccess(client, orgId, userId, caller.isAdmin)
    if (!access.canAddRecords) return { ok: false as const, error: NOT_ALLOWED }
    const leases = await leasesOf(client, orgId, input.assetId)
    const found = findLease(leases, input.tenant.trim() || null, input.unit.trim() || null)
    if (!('lease' in found)) {
      return {
        ok: false as const,
        error: found.candidates.length === 0
          ? 'No lease on file fits that tenant or unit. Use list_tenants for the full list, or search_portfolio to see whether the name appears anywhere else.'
          : `More than one lease could be meant. Ask the person which, or call again with both the tenant and the unit: ${found.candidates.slice(0, 12).map((lease) => `${leaseLabel(lease)} at ${lease.propertyName} (${lease.status})`).join('; ')}.`,
      }
    }
    const lease = found.lease
    const sections = sectionByField(await listScreens(client, orgId))
    const fields = (await listFields(client, orgId)).filter((field) => field.appliesTo === 'lease' && !field.listId && access.fieldLevel(field.id, sections.get(field.id) ?? null) !== 'hidden')
    const values = await listValues(client, orgId, [lease.id])
    const sources = new Map((await listSourceTypes(client)).map((source) => [source.key, source.name]))
    const documents = await attempt(client, [] as Record<string, unknown>[], async () =>
      (await client.query(
        `select d.name, d.document_type, d.status, to_char(d.uploaded_at at time zone 'UTC', 'YYYY-MM-DD') as uploaded
         from documents d where d.org_id = $1 and d.lease_id = $2 order by d.uploaded_at desc limit 20`,
        [orgId, lease.id],
      )).rows,
    )
    const held = fields.flatMap((field) => {
      const value = values.find((entry) => entry.fieldId === field.id)
      return value ? [{ field: field.name, value: formatValue(field, value).slice(0, 1500), source: sources.get(value.sourceType) ?? value.sourceType }] : []
    })
    return {
      ok: true as const,
      result: {
        lease: leaseLabel(lease),
        from_the_rent_roll: describeLease(lease),
        rent_steps: lease.steps,
        from_the_lease_agreement: held,
        lease_fields_still_empty: fields.filter((field) => !held.some((entry) => entry.field === field.name)).map((field) => field.name),
        lease_documents: documents.map((row) => ({ document: row.name, kind: row.document_type, uploaded: row.uploaded, read: row.status === 'read' })),
        about: 'The rent roll\'s dates, area and rent and the lease agreement\'s own terms are kept apart and can differ; say which one a figure comes from. Lease fields are filled when a lease agreement is loaded on the lease\'s page.',
      },
      links: [{ label: `Open the Lease: ${leaseLabel(lease)}`.slice(0, 60), href: `/dashboard/leases/${lease.id}` }],
    }
  })
}

// ---------------------------------------------------------------------------
// Rent roll, lists and documents
// ---------------------------------------------------------------------------

/** The rows of an asset's latest rent roll, as the document shows them. */
export async function rentRollForAgent(caller: Caller, assetId: string): Promise<Lookup> {
  const { orgId, userId } = caller
  if (!isUuid(assetId)) return { ok: false, error: NO_ASSET }
  return withOrg(orgId, async (client) => {
    const access = await loadAccess(client, orgId, userId, caller.isAdmin)
    if (!access.canAddRecords) return { ok: false as const, error: NOT_ALLOWED }
    const tree = await getAssetTree(client, orgId, assetId)
    if (!tree) return { ok: false as const, error: NO_ASSET }
    const all = await attempt(client, [], () => listRentRolls(client, orgId, assetId))
    if (all.length === 0) return { ok: true as const, result: { asset: tree.name, rent_rolls_on_file: 0, note: 'No rent roll has been loaded for this asset.' }, links: [] }
    const latest = all[0]
    const rows = await listRentRollRows(client, orgId, latest.id)
    const cell = (value: string | number | null | undefined) => (value === null || value === undefined ? '' : String(value))
    return {
      ok: true as const,
      result: {
        asset: tree.name,
        rent_rolls_on_file: all.map((entry) => ({ as_of: entry.asOfDate, rows: entry.rowCount, from_document: entry.documentName })),
        latest: {
          as_of: latest.asOfDate,
          date_was_stated_in_the_document: latest.asOfStated,
          from_document: latest.documentName,
          totals_the_document_states: { total_square_feet: latest.stated.totalSf, leased_square_feet: latest.stated.leasedSf, vacant_square_feet: latest.stated.vacantSf },
          rows_header: ['unit', 'floor', 'tenant as written', 'status', 'square feet', 'lease start', 'lease end', 'rent per square foot per year', 'annual rent', 'monthly rent', 'recovery type'].join('\t'),
          rows: rows.slice(0, 400).map((row) =>
            [row.suite, row.floor, row.tenant, RENT_ROLL_STATUS_LABELS[row.status], figure(row.squareFeet), row.leaseStart, row.leaseEnd, figure(row.rentPerSf), figure(row.annualRent), figure(row.monthlyRent), row.recoveryType].map(cell).join('\t'),
          ),
        },
        about: 'Every row is as the document shows it. Do not add rows up yourself unless the person asks, and say so when you do.',
      },
      links: [{ label: 'Open Rent Roll', href: `/dashboard/assets/${assetId}?screen=_rentroll&rentRoll=${latest.id}` }],
    }
  })
}

/** The entries of every list on an asset and its properties: comments, critical dates and any the organization added. */
export async function listsForAgent(caller: Caller, assetId: string): Promise<Lookup> {
  const { orgId, userId } = caller
  if (!isUuid(assetId)) return { ok: false, error: NO_ASSET }
  return withOrg(orgId, async (client) => {
    const access = await loadAccess(client, orgId, userId, caller.isAdmin)
    const tree = await getAssetTree(client, orgId, assetId)
    if (!tree) return { ok: false as const, error: NO_ASSET }
    const records = [
      { id: tree.id, type: 'asset', label: `Asset: ${tree.name}` },
      ...tree.properties.flatMap((property) => [
        { id: property.id, type: 'property', label: `Property: ${property.name}` },
        ...property.buildings.map((building) => ({ id: building.id, type: 'building', label: `Building: ${building.name}` })),
      ]),
    ]
    const fields = await listFields(client, orgId)
    const rows = await listRows(client, orgId, records.map((record) => record.id))
    const lists = (await listLists(client, orgId)).filter((list) => list.sectionId !== null && access.sectionLevel(list.sectionId) !== 'hidden')
    const out = lists.flatMap((list) => {
      const columns = fields.filter((field) => field.listId === list.id)
      const sortField = columns.find((column) => column.key === list.sortFieldKey)
      return records
        .filter((record) => record.type === list.appliesTo)
        .map((record) => ({
          list: list.name,
          on: record.label,
          entries: sortRows(rows.filter((row) => row.listId === list.id && row.recordId === record.id), sortField?.id ?? null, list.sortDescending)
            .slice(0, 150)
            .map((row) => Object.fromEntries(columns.flatMap((column) => (row.values[column.id] ? [[column.name, formatValue(column, row.values[column.id]).slice(0, 1200)]] : [])))),
        }))
        .filter((entry) => entry.entries.length > 0)
    })
    return {
      ok: true as const,
      result: { asset: tree.name, lists: out, ...(out.length === 0 ? { note: 'There are no comments, critical dates or other list entries on this asset.' } : {}) },
      links: [{ label: 'Open Dates and Commentary', href: `/dashboard/assets/${assetId}?screen=datesAndCommentary` }],
    }
  })
}

/** The documents loaded on an asset, newest first, with what kind each is and its summary. */
export async function documentsForAgent(caller: Caller, assetId: string): Promise<Lookup> {
  const { orgId, userId } = caller
  if (!isUuid(assetId)) return { ok: false, error: NO_ASSET }
  return withOrg(orgId, async (client) => {
    const access = await loadAccess(client, orgId, userId, caller.isAdmin)
    const tree = await getAssetTree(client, orgId, assetId)
    if (!tree) return { ok: false as const, error: NO_ASSET }
    const documents = await listDocuments(client, orgId, assetId)
    return {
      ok: true as const,
      result: {
        asset: tree.name,
        documents: documents.slice(0, 100).map((document) => ({
          document: document.name,
          kind: document.documentType,
          uploaded: document.uploadedAt.slice(0, 10),
          status: document.status === 'read' ? 'Read' : document.status === 'failed' ? 'Could not be read' : document.status === 'reading' ? 'Being read' : 'Not read yet',
          // A document's own summary can quote any figure in it, so it follows the same rule as opening the file.
          ...(access.canAddRecords && document.summary ? { summary: document.summary.slice(0, 600) } : {}),
          values_waiting_for_a_decision: document.undecided,
          loaded_onto_a_lease: document.leaseId !== null,
        })),
        ...(documents.length === 0 ? { note: 'No documents have been loaded for this asset.' } : {}),
      },
      links: [{ label: 'Open Documents', href: `/dashboard/assets/${assetId}?screen=_documents` }],
    }
  })
}

// ---------------------------------------------------------------------------
// Repairs: the two things the analyst may put right about tenants and leases.
// Both need the same permission as the Leases tab.
// ---------------------------------------------------------------------------

/** Rebuilds an asset's units, tenants and leases from its rent rolls, as the Leases tab does. */
export async function rebuildLeasesForAgent(caller: Caller, assetId: string): Promise<Lookup> {
  const { orgId, userId } = caller
  if (!isUuid(assetId)) return { ok: false, error: NO_ASSET }
  return withOrg(orgId, async (client) => {
    const access = await loadAccess(client, orgId, userId, caller.isAdmin)
    if (!access.canAddRecords) return { ok: false as const, error: NOT_ALLOWED }
    if (!(await tenantsReady(client))) return { ok: false as const, error: 'Tenants and leases are not set up yet: the database needs db/migrations/024_tenants_and_leases.sql.' }
    const tree = await getAssetTree(client, orgId, assetId)
    if (!tree) return { ok: false as const, error: NO_ASSET }
    const before = await listLeases(client, orgId, { assetId })
    const built = await syncAsset(client, orgId, userId, assetId)
    const after = await listLeases(client, orgId, { assetId })
    const was = new Map(before.map((lease) => [lease.id, lease.status]))
    const changed = after.filter((lease) => was.get(lease.id) !== lease.status)
    const gone = before.filter((lease) => !after.some((now) => now.id === lease.id))
    return {
      ok: true as const,
      result: {
        asset: tree.name,
        leases_now: after.length,
        active_leases: after.filter((lease) => lease.status === 'active').length,
        new_or_changed: changed.map((lease) => ({ ...describeLease(lease), was: was.get(lease.id) ?? 'not on file' })),
        removed: gone.map((lease) => leaseLabel(lease)),
        names_now_waiting_to_be_confirmed: built.questions,
        about: changed.length + gone.length === 0
          ? 'Nothing changed: the leases already matched the rent rolls. If a tenant in the latest rent roll still has no active lease, its row was probably marked as not a tenant when the rent roll was read; use set_tenant_ruling for that name.'
          : 'The leases were rebuilt from the rent rolls. KPIs are not recalculated by this; offer recalculate_kpis.',
      },
      links: [{ label: 'Open the Leases Tab', href: `/dashboard/assets/${assetId}?screen=_leases` }],
    }
  })
}

/** Records the person's ruling that a name in the rent rolls is, or is not, a tenant, and brings the leases up to date. */
export async function ruleTenantForAgent(caller: Caller, input: { assetId: string | null; name: string; isTenant: boolean }): Promise<Lookup> {
  const { orgId, userId } = caller
  if (input.assetId !== null && !isUuid(input.assetId)) return { ok: false, error: NO_ASSET }
  return withOrg(orgId, async (client) => {
    const access = await loadAccess(client, orgId, userId, caller.isAdmin)
    if (!access.canAddRecords) return { ok: false as const, error: NOT_ALLOWED }
    if (!(await tenantsReady(client))) return { ok: false as const, error: 'Tenants and leases are not set up yet: the database needs db/migrations/024_tenants_and_leases.sql.' }
    if (input.assetId && !(await getAssetTree(client, orgId, input.assetId))) return { ok: false as const, error: NO_ASSET }
    const ruled = await ruleTenant(client, orgId, userId, { name: input.name, isTenant: input.isTenant, assetId: input.assetId })
    if (!ruled.ok) return { ok: false as const, error: ruled.candidates ? `${ruled.error} Names that fit: ${ruled.candidates.join('; ')}` : ruled.error }
    const links: LookupLink[] = ruled.leases.slice(0, 2).map((lease) => ({ label: `Open the Lease: ${leaseLabel(lease)}`.slice(0, 80), href: `/dashboard/leases/${lease.id}` }))
    for (const assetId of ruled.assetIds.slice(0, 1)) links.push({ label: 'Open the Leases Tab', href: `/dashboard/assets/${assetId}?screen=_leases` })
    return {
      ok: true as const,
      result: {
        ruled: ruled.names,
        as: ruled.isTenant ? 'a tenant' : 'not a tenant',
        rent_rolls_brought_up_to_date: ruled.rentRolls,
        leases_now: ruled.leases.map(describeLease),
        about: `This ruling is kept and applies to every rent roll, including ones loaded later. ${ruled.isTenant ? '' : 'A lease that holds values from its lease agreement, or documents, is kept as a past lease rather than removed. '}KPIs are not recalculated by this; offer recalculate_kpis.`,
      },
      links,
    }
  })
}
