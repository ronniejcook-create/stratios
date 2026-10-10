// Rent rolls: dated snapshots of a property's suites, tenants, rents and
// lease dates. Each rent roll that is loaded becomes its own snapshot; an
// earlier one is never changed by a later one.
//
// Every function takes the database client of a transaction scoped to one
// organization (see withOrg in lib/db.ts).

import type { Queryable } from './records'

export type RentRollStatus = 'leased' | 'vacant' | 'other'
export const RENT_ROLL_STATUS_LABELS: Record<RentRollStatus, string> = { leased: 'Leased', vacant: 'Vacant', other: 'Not for Lease' }

/** A rent change that takes effect later in a lease. */
export type RentStep = { date: string | null; rentPerSf: number | null; annualRent: number | null }

export type RentRollRowInput = {
  suite: string | null
  tenant: string | null
  status: RentRollStatus
  squareFeet: number | null
  leaseStart: string | null
  leaseEnd: string | null
  /** Base rent per square foot per year. */
  rentPerSf: number | null
  annualRent: number | null
  monthlyRent: number | null
  recoveryType: string | null
  note: string | null
  steps: RentStep[]
  page: number | null
  /** The level the suite is on: 1 is the ground floor, basements are negative. Null when not known. */
  floor?: number | null
  /** True when the document does not show the floor and the agent worked it out, for example from the suite number. */
  floorInferred?: boolean
  /** The agent's call, under the rent roll skill, on whether this row is a tenant; null or left out when it made none. */
  tenantCall?: 'tenant' | 'not_tenant' | null
  /** The tenant on file the agent says this name looks like, and whether the skill lets it be matched without asking a person. */
  tenantLike?: string | null
  tenantLikeSure?: boolean
}

/** What makes a row the same lease as one on file: the same tenant, unit and lease start, or the same tenant and unit (a renewal carries the lease on). */
export type LeaseMatch = 'tenant_unit_start' | 'tenant_unit'

export type RentRollTotals = { totalSf: number | null; leasedSf: number | null; vacantSf: number | null }

export type RentRollInput = {
  assetId: string
  propertyId: string
  document: { id: string; name: string } | null
  /** YYYY-MM-DD, or null when the document gives no date: the day it is loaded is used and marked as assumed. */
  asOfDate: string | null
  /** The totals the document itself shows, when it shows them. */
  stated: RentRollTotals
  rows: RentRollRowInput[]
  /** True when the agent gave its decisions about tenants and leases, so they are used in place of the built-in rules. */
  tenantsDecided?: boolean
  leaseMatch?: LeaseMatch | null
}

/**
 * Saves a rent roll as a new snapshot and returns its id. If the same
 * document was saved before, that snapshot is replaced, so reading a
 * document again never leaves two copies.
 */
export async function saveRentRoll(client: Queryable, orgId: string, userId: string, input: RentRollInput): Promise<string> {
  if (input.document) await client.query('delete from rent_rolls where org_id = $1 and document_id = $2', [orgId, input.document.id])
  const created = await client.query(
    `insert into rent_rolls
       (org_id, asset_id, property_id, document_id, document_name, as_of_date, as_of_stated, stated_total_sf, stated_leased_sf, stated_vacant_sf, created_by)
     values ($1, $2, $3, $4, $5, coalesce($6::date, current_date), $7::boolean, $8::numeric, $9::numeric, $10::numeric, $11)
     returning id::text as id`,
    [
      orgId, input.assetId, input.propertyId, input.document?.id ?? null, input.document?.name.slice(0, 200) ?? null,
      input.asOfDate, input.asOfDate !== null, input.stated.totalSf, input.stated.leasedSf, input.stated.vacantSf, userId,
    ],
  )
  const id = created.rows[0].id as string
  // The floor columns arrive with migration 021 and the tenant decisions with 025; until each is run, rows are saved without them.
  const present = new Set(
    (
      await client.query(
        `select column_name from information_schema.columns
         where table_schema = current_schema() and table_name = 'rent_roll_rows' and column_name in ('floor', 'tenant_call')`,
      )
    ).rows.map((row) => String(row.column_name)),
  )
  const floors = present.has('floor')
  const calls = present.has('tenant_call')
  if (calls) {
    await client.query('update rent_rolls set tenants_decided = $3::boolean, lease_match = $4 where org_id = $1 and id = $2', [orgId, id, input.tenantsDecided === true, input.leaseMatch ?? null])
  }
  const width = 16 + (floors ? 2 : 0) + (calls ? 3 : 0)
  // Rows go in a few at a time, as one statement each time, to keep a long rent roll quick to save.
  const BATCH = 40
  for (let start = 0; start < input.rows.length; start += BATCH) {
    const batch = input.rows.slice(start, start + BATCH)
    const values: unknown[] = []
    const groups = batch.map((row, index) => {
      values.push(
        orgId, id, start + index + 1, row.suite, row.tenant, row.status, row.squareFeet, row.leaseStart, row.leaseEnd,
        row.rentPerSf, row.annualRent, row.monthlyRent, row.recoveryType, row.note, JSON.stringify(row.steps), row.page,
      )
      if (floors) values.push(row.floor ?? null, row.floor != null && row.floorInferred === true)
      if (calls) values.push(row.tenantCall ?? null, row.tenantLike?.slice(0, 200) ?? null, row.tenantLike ? row.tenantLikeSure === true : false)
      const at = index * width
      let next = at + 16
      const extra = [
        ...(floors ? [`$${(next += 1)}::int`, `$${(next += 1)}::boolean`] : []),
        ...(calls ? [`$${(next += 1)}`, `$${(next += 1)}`, `$${(next += 1)}::boolean`] : []),
      ]
      return `($${at + 1}, $${at + 2}::uuid, $${at + 3}, $${at + 4}, $${at + 5}, $${at + 6}, $${at + 7}::numeric, $${at + 8}::date, $${at + 9}::date, $${at + 10}::numeric, $${at + 11}::numeric, $${at + 12}::numeric, $${at + 13}, $${at + 14}, $${at + 15}::jsonb, $${at + 16}${extra.map((slot) => `, ${slot}`).join('')})`
    })
    await client.query(
      `insert into rent_roll_rows
         (org_id, rent_roll_id, position, suite, tenant, status, square_feet, lease_start, lease_end,
          rent_per_sf, annual_rent, monthly_rent, recovery_type, note, steps, page${floors ? ', floor, floor_inferred' : ''}${calls ? ', tenant_call, tenant_like, tenant_like_sure' : ''})
       values ${groups.join(', ')}`,
      values,
    )
  }
  return id
}

export type RentRollHeader = {
  id: string
  assetId: string
  propertyId: string
  documentId: string | null
  documentName: string | null
  asOfDate: string
  /** False when the document gave no date and the day it was loaded was used. */
  asOfStated: boolean
  stated: RentRollTotals
  rowCount: number
  createdBy: string
  createdAt: string
}

const number = (value: unknown) => (value === null || value === undefined ? null : Number(value))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toHeader(row: any): RentRollHeader {
  return {
    id: row.id,
    assetId: row.asset_id,
    propertyId: row.property_id,
    documentId: row.document_id ?? null,
    documentName: row.document_name ?? null,
    asOfDate: row.as_of_date,
    asOfStated: Boolean(row.as_of_stated),
    stated: { totalSf: number(row.stated_total_sf), leasedSf: number(row.stated_leased_sf), vacantSf: number(row.stated_vacant_sf) },
    rowCount: Number(row.row_count),
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

const HEADER_COLUMNS = `r.id::text as id, r.asset_id::text as asset_id, r.property_id::text as property_id, r.document_id::text as document_id,
  r.document_name, r.as_of_date::text as as_of_date, r.as_of_stated,
  r.stated_total_sf::float8 as stated_total_sf, r.stated_leased_sf::float8 as stated_leased_sf, r.stated_vacant_sf::float8 as stated_vacant_sf,
  (select count(*)::int from rent_roll_rows w where w.rent_roll_id = r.id) as row_count, r.created_by,
  to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at`

/** The same list, or nothing when rent rolls aren't set up yet (migration 019), without spoiling the transaction it runs in. */
export async function listRentRollsIfAny(client: Queryable, orgId: string, assetId: string): Promise<RentRollHeader[]> {
  try {
    await client.query('savepoint rent_roll_list')
  } catch {
    return []
  }
  try {
    const found = await listRentRolls(client, orgId, assetId)
    await client.query('release savepoint rent_roll_list')
    return found
  } catch {
    await client.query('rollback to savepoint rent_roll_list').catch(() => {})
    return []
  }
}

/** An asset's rent rolls, the latest date first; for one date, the one with the most rows first (the main one of a mixed-use building). */
export async function listRentRolls(client: Queryable, orgId: string, assetId: string): Promise<RentRollHeader[]> {
  const { rows } = await client.query(
    `select ${HEADER_COLUMNS} from rent_rolls r where r.org_id = $1 and r.asset_id = $2 order by r.as_of_date desc, row_count desc, r.created_at desc`,
    [orgId, assetId],
  )
  return rows.map(toHeader)
}

export async function getRentRoll(client: Queryable, orgId: string, rentRollId: string): Promise<RentRollHeader | null> {
  const { rows } = await client.query(`select ${HEADER_COLUMNS} from rent_rolls r where r.org_id = $1 and r.id = $2`, [orgId, rentRollId])
  return rows[0] ? toHeader(rows[0]) : null
}

/** The snapshot a document was saved as, if it held a rent roll. Null also when rent rolls aren't set up yet (migration 019). */
export async function rentRollOfDocument(client: Queryable, orgId: string, documentId: string): Promise<RentRollHeader | null> {
  try {
    await client.query('savepoint rent_roll_lookup')
  } catch {
    return null
  }
  try {
    const { rows } = await client.query(`select ${HEADER_COLUMNS} from rent_rolls r where r.org_id = $1 and r.document_id = $2 limit 1`, [orgId, documentId])
    await client.query('release savepoint rent_roll_lookup')
    return rows[0] ? toHeader(rows[0]) : null
  } catch {
    await client.query('rollback to savepoint rent_roll_lookup').catch(() => {})
    return null
  }
}

/**
 * The other rent rolls already saved for a property on one date, split by
 * whether they have at least as many rows as a rent roll about to be saved
 * (`rowCount`) or fewer. A mixed-use building can have two rent rolls for one
 * date, say retail and residential; the one with the most rows is the main
 * one and supplies the property's values. A date left out means today, as it
 * will when saved. Empty when rent rolls aren't set up yet.
 */
export async function rivalRentRolls(
  client: Queryable,
  orgId: string,
  input: { propertyId: string; asOfDate: string | null; rowCount: number; documentId: string },
): Promise<{ larger: string[]; smaller: string[] }> {
  const none = { larger: [], smaller: [] }
  try {
    await client.query('savepoint rent_roll_rivals')
  } catch {
    return none
  }
  try {
    const { rows } = await client.query(
      `select r.document_id::text as document_id, (select count(*)::int from rent_roll_rows w where w.rent_roll_id = r.id) as row_count
       from rent_rolls r
       where r.org_id = $1 and r.property_id = $2 and r.as_of_date = coalesce($3::date, current_date)
         and r.document_id is not null and r.document_id <> $4::uuid`,
      [orgId, input.propertyId, input.asOfDate, input.documentId],
    )
    await client.query('release savepoint rent_roll_rivals')
    return {
      larger: rows.filter((row) => Number(row.row_count) >= input.rowCount).map((row) => row.document_id as string),
      smaller: rows.filter((row) => Number(row.row_count) < input.rowCount).map((row) => row.document_id as string),
    }
  } catch {
    await client.query('rollback to savepoint rent_roll_rivals').catch(() => {})
    return none
  }
}

export type RentRollRow = RentRollRowInput & { id: string; position: number }

/** The rows of one rent roll, in the document's order. */
export async function listRentRollRows(client: Queryable, orgId: string, rentRollId: string): Promise<RentRollRow[]> {
  const { rows } = await client.query(
    `select id::text as id, position, suite, tenant, status, square_feet::float8 as square_feet,
            lease_start::text as lease_start, lease_end::text as lease_end,
            rent_per_sf::float8 as rent_per_sf, annual_rent::float8 as annual_rent, monthly_rent::float8 as monthly_rent,
            recovery_type, note, steps, page,
            (to_jsonb(rent_roll_rows) ->> 'floor')::int as floor,
            coalesce((to_jsonb(rent_roll_rows) ->> 'floor_inferred')::boolean, false) as floor_inferred
     from rent_roll_rows where org_id = $1 and rent_roll_id = $2 order by position`,
    [orgId, rentRollId],
  )
  return rows.map((row) => {
    const steps = typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps
    return {
      id: row.id,
      position: Number(row.position),
      suite: row.suite ?? null,
      tenant: row.tenant ?? null,
      status: row.status,
      squareFeet: number(row.square_feet),
      leaseStart: row.lease_start ?? null,
      leaseEnd: row.lease_end ?? null,
      rentPerSf: number(row.rent_per_sf),
      annualRent: number(row.annual_rent),
      monthlyRent: number(row.monthly_rent),
      recoveryType: row.recovery_type ?? null,
      note: row.note ?? null,
      steps: Array.isArray(steps) ? (steps as RentStep[]) : [],
      page: row.page ?? null,
      floor: number(row.floor),
      floorInferred: Boolean(row.floor_inferred),
    }
  })
}

/** Changes the date a rent roll is as of (and marks it as set by a person). False when it isn't this organization's. */
export async function setRentRollDate(client: Queryable, orgId: string, rentRollId: string, asOfDate: string): Promise<boolean> {
  const { rows } = await client.query(
    'update rent_rolls set as_of_date = $3::date, as_of_stated = true where org_id = $1 and id = $2 returning id::text as id',
    [orgId, rentRollId, asOfDate],
  )
  return rows.length > 0
}

/** Removes a rent roll and its rows. False when it isn't this organization's. */
export async function deleteRentRoll(client: Queryable, orgId: string, rentRollId: string): Promise<boolean> {
  const { rows } = await client.query('delete from rent_rolls where org_id = $1 and id = $2 returning id::text as id', [orgId, rentRollId])
  return rows.length > 0
}

export type RentRollSummary = {
  suites: number
  totalSf: number
  leasedSf: number
  vacantSf: number
  otherSf: number
  /** Leased square feet as a share of all square feet, in percent; null when there are none. */
  leasedPercent: number | null
  /** Different tenant names among the leased rows. */
  tenants: number
  annualRent: number
}

/** Plain sums over a rent roll's rows. Pure, and safe to use in the browser. */
export function summarize(rows: Pick<RentRollRowInput, 'status' | 'squareFeet' | 'annualRent' | 'tenant'>[]): RentRollSummary {
  const sf = (status: RentRollStatus) => rows.filter((row) => row.status === status).reduce((sum, row) => sum + (row.squareFeet ?? 0), 0)
  const leasedSf = sf('leased')
  const vacantSf = sf('vacant')
  const otherSf = sf('other')
  const totalSf = leasedSf + vacantSf + otherSf
  const names = new Set(rows.filter((row) => row.status === 'leased' && row.tenant).map((row) => row.tenant!.trim().toLowerCase()))
  return {
    suites: rows.length,
    totalSf,
    leasedSf,
    vacantSf,
    otherSf,
    leasedPercent: totalSf > 0 ? Math.round((leasedSf / totalSf) * 1000) / 10 : null,
    tenants: names.size,
    annualRent: rows.reduce((sum, row) => sum + (row.status === 'leased' ? row.annualRent ?? 0 : 0), 0),
  }
}
