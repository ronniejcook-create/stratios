// Tenants, leases and units, built from rent rolls.
//
// A rent roll is a dated copy of a document's table and is never changed. This
// file works out the lasting records its rows stand for, and can always work
// them out again from the rows:
//
// - Units: every row's unit (what some rent rolls call a suite) becomes a
//   unit record under the property's building and floor.
// - Tenants: one per tenant across the organization. A name spelled exactly
//   as an existing tenant (capitals and punctuation aside) is that tenant; a
//   name that only looks like one waits as a question for a person; any other
//   name is a new tenant. Nothing is matched by guesswork.
// - Leases: one per tenant, unit and lease start at a property, holding the
//   terms from the latest rent roll that shows it. Active while the
//   property's latest rent roll shows it, past after that.
//
// Rents and tenants are not covered by field permissions, so everything here
// is for people who may add records, like the Rent Roll tab.
//
// Every function takes the database client of a transaction scoped to one
// organization (see withOrg in lib/db.ts).

import { slugify, type Queryable } from './records'
import type { LeaseMatch, RentStep } from './rentRolls'

// ---------------------------------------------------------------------------
// Comparing names (pure)
// ---------------------------------------------------------------------------

/** A name in a plain form for comparing: lower case, "&" as "and", no punctuation. "ACME Corp." -> "acme corp" */
export function nameKey(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

const LEGAL_WORDS = new Set([
  'inc', 'incorporated', 'llc', 'l', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'pllc', 'pc', 'pa', 'plc', 'na', 'n', 'a', 'c', 'p',
  'usa', 'us', 'holdings', 'group', 'the',
])

/** The name without legal endings and a leading "The": "The Acme Corporation, Inc." -> "acme" */
export function coreKey(name: string): string {
  const words = nameKey(name).split(' ').filter(Boolean)
  while (words.length > 1 && LEGAL_WORDS.has(words[words.length - 1])) words.pop()
  if (words.length > 1 && words[0] === 'the') words.shift()
  return words.join(' ')
}

/** How alike two strings are, from 0 to 1, by the edits needed to turn one into the other. */
export function likeness(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length)
}

/**
 * How strongly two names look like the same tenant, 0 when they don't: the
 * same once legal endings are dropped ("Acme Corp" and "Acme Corporation"),
 * one contained in the other ("Starbucks" and "Starbucks Coffee"), or nearly
 * the same letters ("Walgreens" and "Walgreen's Co").
 */
export function lookAlike(a: string, b: string): number {
  const coreA = coreKey(a)
  const coreB = coreKey(b)
  if (!coreA || !coreB) return 0
  if (coreA === coreB) return 1
  const [shorter, longer] = coreA.length <= coreB.length ? [coreA, coreB] : [coreB, coreA]
  const longerWords = new Set(longer.split(' '))
  if (shorter.length >= 5 && shorter.split(' ').every((word) => longerWords.has(word))) return 0.9
  const score = likeness(coreA, coreB)
  return shorter.length >= 5 && score >= 0.85 ? score : 0
}

export type TenantRef = { id: string; name: string; aliases: string[] }
export type TenantMatch = { kind: 'same'; tenant: TenantRef } | { kind: 'ask'; tenant: TenantRef } | { kind: 'new' }

/** Which tenant a written name is: the same one, one to ask a person about, or a new one. */
export function matchTenant(tenants: TenantRef[], written: string): TenantMatch {
  const key = nameKey(written)
  if (!key) return { kind: 'new' }
  const same = tenants.find((tenant) => [tenant.name, ...tenant.aliases].some((name) => nameKey(name) === key))
  if (same) return { kind: 'same', tenant: same }
  let best: { tenant: TenantRef; score: number } | null = null
  for (const tenant of tenants) {
    const score = Math.max(...[tenant.name, ...tenant.aliases].map((name) => lookAlike(name, written)))
    if (score > 0 && (!best || score > best.score)) best = { tenant, score }
  }
  return best ? { kind: 'ask', tenant: best.tenant } : { kind: 'new' }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const number = (value: unknown) => (value === null || value === undefined ? null : Number(value))
const list = (value: unknown): string[] => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
}

/** Whether tenants and leases are set up (migration 024), without spoiling the transaction it runs in. */
export async function tenantsReady(client: Queryable): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'rent_roll_rows' and column_name = 'lease_id'`,
  )
  return rows.length > 0
}

/**
 * The organization's tenants as the reading agent is shown them: "Acme Corp
 * (also: Acme Corporation)". Empty when tenants aren't set up yet, without
 * spoiling the transaction it runs in.
 */
export async function listTenantNames(client: Queryable, orgId: string): Promise<string[]> {
  try {
    await client.query('savepoint tenant_names')
  } catch {
    return []
  }
  try {
    const tenants = (await tenantsReady(client)) ? await listTenantRefs(client, orgId) : []
    await client.query('release savepoint tenant_names')
    return tenants.map((tenant) => (tenant.aliases.length > 0 ? `${tenant.name} (also: ${tenant.aliases.join('; ')})` : tenant.name)).sort((a, b) => a.localeCompare(b))
  } catch {
    await client.query('rollback to savepoint tenant_names').catch(() => {})
    return []
  }
}

async function listTenantRefs(client: Queryable, orgId: string): Promise<TenantRef[]> {
  const { rows } = await client.query('select id::text as id, name, aliases from tenants where org_id = $1 order by created_at', [orgId])
  return rows.map((row) => ({ id: row.id, name: row.name, aliases: list(row.aliases) }))
}

export type Lease = {
  id: string
  assetId: string
  assetName: string
  propertyId: string
  propertyName: string
  tenantId: string
  tenantName: string
  unitId: string | null
  unitName: string | null
  startDate: string | null
  endDate: string | null
  squareFeet: number | null
  rentPerSf: number | null
  annualRent: number | null
  monthlyRent: number | null
  recoveryType: string | null
  steps: RentStep[]
  status: 'active' | 'past'
  firstSeen: string
  lastSeen: string
}

const LEASE_COLUMNS = `l.id::text as id, l.asset_id::text as asset_id, a.name as asset_name, l.property_id::text as property_id, p.name as property_name,
  l.tenant_id::text as tenant_id, t.name as tenant_name, l.unit_id::text as unit_id, coalesce(u.name, l.unit_name) as unit_name,
  l.start_date::text as start_date, l.end_date::text as end_date, l.square_feet::float8 as square_feet, l.rent_per_sf::float8 as rent_per_sf,
  l.annual_rent::float8 as annual_rent, l.monthly_rent::float8 as monthly_rent, l.recovery_type, l.steps, l.status,
  l.first_seen::text as first_seen, l.last_seen::text as last_seen`
const LEASE_FROM = `from leases l join tenants t on t.id = l.tenant_id join properties p on p.id = l.property_id join assets a on a.id = l.asset_id left join units u on u.id = l.unit_id`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLease(row: any): Lease {
  const steps = typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps
  return {
    id: row.id,
    assetId: row.asset_id,
    assetName: row.asset_name,
    propertyId: row.property_id,
    propertyName: row.property_name,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    unitId: row.unit_id ?? null,
    unitName: row.unit_name ?? null,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    squareFeet: number(row.square_feet),
    rentPerSf: number(row.rent_per_sf),
    annualRent: number(row.annual_rent),
    monthlyRent: number(row.monthly_rent),
    recoveryType: row.recovery_type ?? null,
    steps: Array.isArray(steps) ? steps : [],
    status: row.status,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  }
}

/** The leases of one asset or one tenant: active ones first, then by lease end, soonest first. */
export async function listLeases(client: Queryable, orgId: string, of: { assetId: string } | { tenantId: string }): Promise<Lease[]> {
  const column = 'assetId' in of ? 'l.asset_id' : 'l.tenant_id'
  const { rows } = await client.query(
    `select ${LEASE_COLUMNS} ${LEASE_FROM}
     where l.org_id = $1 and ${column} = $2
     order by (l.status = 'past'), l.end_date nulls last, t.name, l.unit_name`,
    [orgId, 'assetId' in of ? of.assetId : of.tenantId],
  )
  return rows.map(toLease)
}

export type TenantSummary = {
  id: string
  key: string
  name: string
  aliases: string[]
  /** Active leases, with their totals. */
  leases: number
  squareFeet: number
  annualRent: number
  /** The soonest end among the active leases. */
  nextEnd: string | null
  /** The properties its active leases are in. */
  properties: string[]
  pastLeases: number
}

/** Every tenant of the organization, with what its active leases add up to. */
export async function listTenants(client: Queryable, orgId: string): Promise<TenantSummary[]> {
  const { rows } = await client.query(
    `select t.id::text as id, t.key, t.name, t.aliases,
            count(l.id) filter (where l.status = 'active')::int as leases,
            count(l.id) filter (where l.status = 'past')::int as past_leases,
            coalesce(sum(l.square_feet) filter (where l.status = 'active'), 0)::float8 as square_feet,
            coalesce(sum(l.annual_rent) filter (where l.status = 'active'), 0)::float8 as annual_rent,
            (min(l.end_date) filter (where l.status = 'active'))::text as next_end,
            coalesce(json_agg(distinct p.name) filter (where l.status = 'active'), '[]'::json) as properties
     from tenants t left join leases l on l.tenant_id = t.id and l.org_id = t.org_id left join properties p on p.id = l.property_id
     where t.org_id = $1
     group by t.id
     order by t.name`,
    [orgId],
  )
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    aliases: list(row.aliases),
    leases: Number(row.leases),
    squareFeet: Number(row.square_feet),
    annualRent: Number(row.annual_rent),
    nextEnd: row.next_end ?? null,
    properties: list(row.properties),
    pastLeases: Number(row.past_leases),
  }))
}

export async function getTenant(client: Queryable, orgId: string, tenantId: string): Promise<{ id: string; key: string; name: string; aliases: string[] } | null> {
  const { rows } = await client.query('select id::text as id, key, name, aliases from tenants where org_id = $1 and id = $2', [orgId, tenantId])
  return rows[0] ? { id: rows[0].id, key: rows[0].key, name: rows[0].name, aliases: list(rows[0].aliases) } : null
}

export type TenantQuestion = {
  id: string
  /** The name as the rent roll writes it. */
  writtenName: string
  suggestedTenantId: string
  suggestedTenantName: string
  /** Where the written name appears: "Unit 210, Knoll Trail Crossing". */
  seen: string[]
}

/** The names waiting for a person to say whether they are an existing tenant: all of them, or those in one asset's rent rolls. */
export async function listTenantQuestions(client: Queryable, orgId: string, assetId: string | null = null): Promise<TenantQuestion[]> {
  const questions = await client.query(
    `select q.id::text as id, q.written_name, q.name_key, q.suggested_tenant_id::text as tenant_id, t.name as tenant_name
     from tenant_questions q join tenants t on t.id = q.suggested_tenant_id
     where q.org_id = $1 and q.status = 'pending' order by q.created_at`,
    [orgId],
  )
  if (questions.rows.length === 0) return []
  const waiting = await client.query(
    `select w.tenant, w.suite, p.name as property_name, r.asset_id::text as asset_id
     from rent_roll_rows w join rent_rolls r on r.id = w.rent_roll_id join properties p on p.id = r.property_id
     where w.org_id = $1 and w.tenant_id is null and w.tenant is not null and w.status = 'leased'`,
    [orgId],
  )
  const found: TenantQuestion[] = []
  for (const question of questions.rows) {
    const rows = waiting.rows.filter((row) => nameKey(String(row.tenant)) === question.name_key)
    if (assetId && !rows.some((row) => row.asset_id === assetId)) continue
    const seen = [...new Set(rows.map((row) => `${row.suite ? `Unit ${row.suite}, ` : ''}${row.property_name}`))].slice(0, 6)
    found.push({ id: question.id, writtenName: question.written_name, suggestedTenantId: question.tenant_id, suggestedTenantName: question.tenant_name, seen })
  }
  return found
}

// ---------------------------------------------------------------------------
// Building units, tenants and leases from a rent roll
//
// Three judgment calls belong to the Reading a Rent Roll skill, which an
// organization can edit: which rows are tenants, which names look like a
// tenant on file (and whether to ask a person), and what makes a row the same
// lease as one on file. The agent makes them while it reads the rent roll and
// they are saved on the rent roll and its rows (migration 025); this code only
// applies them. A rent roll with no saved decisions (loaded earlier, or read
// when no skill covers it) falls back on the built-in rules below: a leased
// row with no rent is not a tenant where most tenants show rent, a look-alike
// name (lookAlike) is asked about, and a lease is a tenant, unit and start.
// ---------------------------------------------------------------------------

const UNASSIGNED_FLOOR = 'Unassigned'
const floorName = (floor: number) => (floor < 0 ? `Basement ${-floor}` : `Floor ${floor}`)
const positive = (value: unknown) => value !== null && value !== undefined && Number(value) > 0

/** A key not in `taken`, which it is then added to: "210", then "210-2". */
function freeKeyIn(taken: Set<string>, name: string, fallback: string): string {
  const base = slugify(name, fallback)
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`
  taken.add(key)
  return key
}

export type SyncResult = { units: number; tenants: number; leases: number; questions: number }

/**
 * Works out the units, tenants and leases of one rent roll and links its rows
 * to them. Safe to run again at any time: it only adds what is missing, and
 * the property's leases are rebuilt from every rent roll's rows.
 *
 * Which leased rows are tenants and which names are asked about follow the
 * agent's saved decisions when the rent roll has them, and the built-in rules
 * otherwise (see above). A row that is not a tenant still gets its unit.
 */
export async function syncRentRoll(client: Queryable, orgId: string, userId: string, rentRollId: string): Promise<SyncResult> {
  const result: SyncResult = { units: 0, tenants: 0, leases: 0, questions: 0 }
  // The decision columns are read this way so everything works before migration 025 is run.
  const header = await client.query(
    `select property_id::text as property_id, coalesce((to_jsonb(rent_rolls) ->> 'tenants_decided')::boolean, false) as decided from rent_rolls where org_id = $1 and id = $2`,
    [orgId, rentRollId],
  )
  if (header.rows.length === 0) return result
  const propertyId = header.rows[0].property_id as string
  const decided = header.rows[0].decided === true
  const { rows } = await client.query(
    `select id::text as id, suite, tenant, status, floor, rent_per_sf::float8 as rent_per_sf, annual_rent::float8 as annual_rent, monthly_rent::float8 as monthly_rent,
            unit_id::text as unit_id, tenant_id::text as tenant_id,
            to_jsonb(rent_roll_rows) ->> 'tenant_call' as tenant_call, to_jsonb(rent_roll_rows) ->> 'tenant_like' as tenant_like,
            coalesce((to_jsonb(rent_roll_rows) ->> 'tenant_like_sure')::boolean, false) as tenant_like_sure
     from rent_roll_rows where org_id = $1 and rent_roll_id = $2 order by position`,
    [orgId, rentRollId],
  )

  // --- Units -------------------------------------------------------------
  const buildings = await client.query('select id::text as id from buildings where org_id = $1 and property_id = $2 order by created_at, name', [orgId, propertyId])
  const unitOf = new Map<string, string | null>()
  if (buildings.rows.length > 0) {
    const buildingIds = buildings.rows.map((row) => row.id as string)
    const floors = await client.query('select id::text as id, building_id::text as building_id, name, key from floors where org_id = $1 and building_id = any($2::uuid[]) order by created_at', [orgId, buildingIds])
    const units = await client.query(
      'select u.id::text as id, u.floor_id::text as floor_id, u.name, u.key from units u where u.org_id = $1 and u.floor_id = any($2::uuid[]) order by u.created_at',
      [orgId, floors.rows.map((row) => row.id as string)],
    )
    const mainBuilding = buildingIds[0]
    const floorByName = new Map<string, string>()
    for (const floor of floors.rows) if (floor.building_id === mainBuilding && !floorByName.has(nameKey(floor.name))) floorByName.set(nameKey(floor.name), floor.id)
    const floorKeys = new Set(floors.rows.filter((floor) => floor.building_id === mainBuilding).map((floor) => String(floor.key)))
    const unitByName = new Map<string, { id: string; floorId: string }>()
    for (const unit of units.rows) if (!unitByName.has(nameKey(unit.name))) unitByName.set(nameKey(unit.name), { id: unit.id, floorId: unit.floor_id })
    const unitKeys = new Map<string, Set<string>>()
    for (const unit of units.rows) unitKeys.set(unit.floor_id, (unitKeys.get(unit.floor_id) ?? new Set()).add(String(unit.key)))

    const floorFor = async (floor: number | null): Promise<string> => {
      const name = floor === null ? UNASSIGNED_FLOOR : floorName(floor)
      const known = floorByName.get(nameKey(name))
      if (known) return known
      const created = await client.query(
        'insert into floors (org_id, building_id, name, key, created_by) values ($1, $2, $3, $4, $5) returning id::text as id',
        [orgId, mainBuilding, name, freeKeyIn(floorKeys, name, 'floor'), userId],
      )
      floorByName.set(nameKey(name), created.rows[0].id)
      return created.rows[0].id
    }
    const unassigned = floorByName.get(nameKey(UNASSIGNED_FLOOR)) ?? null

    for (const row of rows) {
      const suite = String(row.suite ?? '').trim().slice(0, 200)
      if (!suite || !nameKey(suite)) {
        unitOf.set(row.id, null)
        continue
      }
      const floor = row.floor === null || row.floor === undefined ? null : Number(row.floor)
      const known = unitByName.get(nameKey(suite))
      if (known) {
        // A unit first seen without a floor moves to its floor once a rent roll gives one.
        if (floor !== null && unassigned !== null && known.floorId === unassigned) {
          const target = await floorFor(floor)
          const taken = unitKeys.get(target) ?? new Set<string>()
          unitKeys.set(target, taken)
          await client.query('update units set floor_id = $3, key = $4 where org_id = $1 and id = $2', [orgId, known.id, target, freeKeyIn(taken, suite, 'unit')])
          known.floorId = target
        }
        unitOf.set(row.id, known.id)
        continue
      }
      const floorId = await floorFor(floor)
      const taken = unitKeys.get(floorId) ?? new Set<string>()
      unitKeys.set(floorId, taken)
      const created = await client.query(
        'insert into units (org_id, floor_id, name, key, created_by) values ($1, $2, $3, $4, $5) returning id::text as id',
        [orgId, floorId, suite, freeKeyIn(taken, suite, 'unit'), userId],
      )
      unitByName.set(nameKey(suite), { id: created.rows[0].id, floorId })
      unitOf.set(row.id, created.rows[0].id)
      result.units += 1
    }
  }

  // --- Tenants -----------------------------------------------------------
  const named = rows.filter((row) => row.status === 'leased' && nameKey(String(row.tenant ?? '')))
  const paying = (row: (typeof rows)[number]) => positive(row.rent_per_sf) || positive(row.annual_rent) || positive(row.monthly_rent)
  const rentsShown = named.length > 0 && named.filter(paying).length * 2 >= named.length
  const tenants = await listTenantRefs(client, orgId)
  const tenantKeys = new Set((await client.query('select key from tenants where org_id = $1', [orgId])).rows.map((row) => String(row.key)))
  const asked = new Map<string, string>(
    (await client.query('select name_key, status from tenant_questions where org_id = $1', [orgId])).rows.map((row) => [String(row.name_key), String(row.status)]),
  )
  const tenantOf = new Map<string, string | null>()
  for (const row of rows) {
    const written = String(row.tenant ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    // Is the row a tenant at all? The agent's call when it made one; with no decisions saved, the built-in rent rule.
    const notTenant = row.tenant_call === 'not_tenant' || (row.tenant_call !== 'tenant' && !decided && rentsShown && !paying(row))
    if (row.status !== 'leased' || !nameKey(written) || notTenant) {
      tenantOf.set(row.id, null)
      continue
    }
    // The same spelling is always the same tenant.
    const exact = matchTenant(tenants, written)
    if (exact.kind === 'same') {
      tenantOf.set(row.id, exact.tenant.id)
      continue
    }
    const key = nameKey(written)
    // Which tenant on file the name looks like: the agent's saved answer, or the built-in comparison when it gave none.
    const named = row.tenant_like ? matchTenant(tenants, String(row.tenant_like)) : null
    const like = named?.kind === 'same' ? named.tenant : !decided && exact.kind === 'ask' ? exact.tenant : null
    if (like && asked.get(key) !== 'different') {
      if (decided && row.tenant_like_sure === true && asked.get(key) !== 'pending') {
        // The skill lets the agent match this one itself: the spelling is kept as another name of the tenant, and the match is on record.
        like.aliases.push(written)
        await client.query('update tenants set aliases = $3::jsonb where org_id = $1 and id = $2', [orgId, like.id, JSON.stringify(like.aliases.slice(-50))])
        await client.query(
          `insert into tenant_questions (org_id, written_name, name_key, suggested_tenant_id, status, decided_by, decided_at)
           values ($1, $2, $3, $4, 'same', 'agent', now()) on conflict (org_id, name_key) do nothing`,
          [orgId, written, key, like.id],
        )
        asked.set(key, 'same')
        tenantOf.set(row.id, like.id)
        continue
      }
      // Waits for a person to say whether it is the same tenant.
      if (!asked.has(key)) {
        await client.query('insert into tenant_questions (org_id, written_name, name_key, suggested_tenant_id) values ($1, $2, $3, $4) on conflict (org_id, name_key) do nothing', [orgId, written, key, like.id])
        asked.set(key, 'pending')
        result.questions += 1
      }
      tenantOf.set(row.id, null)
      continue
    }
    const created = await client.query(
      'insert into tenants (org_id, key, name, created_by) values ($1, $2, $3, $4) returning id::text as id',
      [orgId, freeKeyIn(tenantKeys, written, 'tenant'), written, userId],
    )
    tenants.push({ id: created.rows[0].id, name: written, aliases: [] })
    tenantOf.set(row.id, created.rows[0].id)
    result.tenants += 1
  }

  // --- Link the rows -----------------------------------------------------
  const changed = rows.filter((row) => (unitOf.has(row.id) && (unitOf.get(row.id) ?? null) !== (row.unit_id ?? null)) || (tenantOf.get(row.id) ?? null) !== (row.tenant_id ?? null))
  const BATCH = 100
  for (let start = 0; start < changed.length; start += BATCH) {
    const batch = changed.slice(start, start + BATCH)
    const values: unknown[] = [orgId]
    const groups = batch.map((row) => {
      values.push(row.id, unitOf.has(row.id) ? unitOf.get(row.id) ?? null : row.unit_id ?? null, tenantOf.get(row.id) ?? null)
      return `($${values.length - 2}::uuid, $${values.length - 1}::uuid, $${values.length}::uuid)`
    })
    await client.query(
      `update rent_roll_rows w set unit_id = v.unit_id, tenant_id = v.tenant_id
       from (values ${groups.join(', ')}) as v (id, unit_id, tenant_id)
       where w.org_id = $1 and w.id = v.id`,
      values,
    )
  }

  result.leases = await refreshLeases(client, orgId, propertyId)
  return result
}

/**
 * Rebuilds a property's leases from the rows of all its rent rolls. Each
 * lease takes its terms from the latest rent roll that shows it; one no rent
 * roll shows any more is removed; and a lease is active when the property's
 * latest rent roll date shows it. Returns how many leases are new.
 */
export async function refreshLeases(client: Queryable, orgId: string, propertyId: string): Promise<number> {
  const { rows } = await client.query(
    `select w.id::text as id, w.tenant_id::text as tenant_id, w.unit_id::text as unit_id, w.suite, w.lease_id::text as lease_id,
            w.lease_start::text as lease_start, w.lease_end::text as lease_end, w.square_feet::float8 as square_feet,
            w.rent_per_sf::float8 as rent_per_sf, w.annual_rent::float8 as annual_rent, w.monthly_rent::float8 as monthly_rent,
            w.recovery_type, w.steps, r.id::text as rent_roll_id, r.as_of_date::text as as_of_date, r.asset_id::text as asset_id
     from rent_roll_rows w join rent_rolls r on r.id = w.rent_roll_id
     where w.org_id = $1 and r.property_id = $2 and w.tenant_id is not null and w.status = 'leased'
     order by r.as_of_date, r.created_at, w.position`,
    [orgId, propertyId],
  )
  const latest = (await client.query('select max(as_of_date)::text as latest from rent_rolls where org_id = $1 and property_id = $2', [orgId, propertyId])).rows[0]?.latest ?? null
  // What makes two rows the same lease is the skill's call, saved with each rent roll; the latest one that has it decides.
  const chosen = await client.query(
    `select to_jsonb(r) ->> 'lease_match' as lease_match from rent_rolls r
     where r.org_id = $1 and r.property_id = $2 and (to_jsonb(r) ->> 'lease_match') is not null
     order by r.as_of_date desc, r.created_at desc limit 1`,
    [orgId, propertyId],
  )
  const match: LeaseMatch = chosen.rows[0]?.lease_match === 'tenant_unit' ? 'tenant_unit' : 'tenant_unit_start'
  const existing = await client.query(
    `select id::text as id, tenant_id::text as tenant_id, unit_id::text as unit_id, unit_name, start_date::text as start_date from leases where org_id = $1 and property_id = $2`,
    [orgId, propertyId],
  )
  const identity = (tenantId: string, unitId: string | null, unitName: string | null, start: string | null) =>
    `${tenantId}|${unitId ?? `name:${nameKey(unitName ?? '')}`}|${match === 'tenant_unit' ? '' : start ?? ''}`
  const leaseByIdentity = new Map<string, string>(existing.rows.map((lease) => [identity(lease.tenant_id, lease.unit_id ?? null, lease.unit_name ?? null, lease.start_date ?? null), lease.id as string]))

  // Rows are in date order, so the last one of a group is the latest rent roll to show the lease.
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = identity(row.tenant_id, row.unit_id ?? null, row.suite ?? null, row.lease_start ?? null)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  let added = 0
  const kept = new Set<string>()
  for (const [key, group] of groups) {
    const last = group[group.length - 1]
    const terms = [
      last.lease_end ?? null, last.square_feet ?? null, last.rent_per_sf ?? null, last.annual_rent ?? null, last.monthly_rent ?? null, last.recovery_type ?? null,
      JSON.stringify(typeof last.steps === 'string' ? JSON.parse(last.steps) : last.steps ?? []),
      latest !== null && last.as_of_date === latest ? 'active' : 'past', group[0].as_of_date, last.as_of_date, last.rent_roll_id,
      String(last.suite ?? '').trim().slice(0, 200) || null, last.unit_id ?? null,
    ]
    let leaseId = leaseByIdentity.get(key)
    if (leaseId) {
      await client.query(
        `update leases set end_date = $3::date, square_feet = $4::numeric, rent_per_sf = $5::numeric, annual_rent = $6::numeric, monthly_rent = $7::numeric,
                recovery_type = $8, steps = $9::jsonb, status = $10, first_seen = $11::date, last_seen = $12::date, last_rent_roll_id = $13::uuid,
                unit_name = $14, unit_id = $15::uuid, start_date = $16::date
         where org_id = $1 and id = $2`,
        [orgId, leaseId, ...terms, last.lease_start ?? null],
      )
    } else {
      const created = await client.query(
        `insert into leases
           (org_id, asset_id, property_id, tenant_id, start_date, end_date, square_feet, rent_per_sf, annual_rent, monthly_rent, recovery_type, steps,
            status, first_seen, last_seen, last_rent_roll_id, unit_name, unit_id)
         values ($1, $2, $3, $4, $5::date, $6::date, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11, $12::jsonb, $13, $14::date, $15::date, $16::uuid, $17, $18::uuid)
         returning id::text as id`,
        [orgId, last.asset_id, propertyId, last.tenant_id, last.lease_start ?? null, ...terms],
      )
      leaseId = created.rows[0].id as string
      added += 1
    }
    kept.add(leaseId)
    const unlinked = group.filter((row) => row.lease_id !== leaseId).map((row) => row.id as string)
    if (unlinked.length > 0) await client.query('update rent_roll_rows set lease_id = $3::uuid where org_id = $1 and id = any($2::uuid[])', [orgId, unlinked, leaseId])
  }
  const gone = existing.rows.map((lease) => lease.id as string).filter((id) => !kept.has(id))
  if (gone.length > 0) await client.query('delete from leases where org_id = $1 and id = any($2::uuid[])', [orgId, gone])
  return added
}

/** Builds, or brings up to date, the units, tenants and leases of every rent roll of an asset, oldest first. */
export async function syncAsset(client: Queryable, orgId: string, userId: string, assetId: string): Promise<SyncResult> {
  const total: SyncResult = { units: 0, tenants: 0, leases: 0, questions: 0 }
  const rolls = await client.query('select id::text as id from rent_rolls where org_id = $1 and asset_id = $2 order by as_of_date, created_at', [orgId, assetId])
  for (const roll of rolls.rows) {
    const one = await syncRentRoll(client, orgId, userId, roll.id)
    total.units += one.units
    total.tenants += one.tenants
    total.leases += one.leases
    total.questions += one.questions
  }
  return total
}

/**
 * Answers a waiting name: it is the suggested tenant (the spelling is kept as
 * another name of that tenant), or it is a different one (a new tenant is
 * made). Every rent roll with rows that were waiting is then brought up to
 * date. Returns the tenant the name now belongs to, or null when the question
 * isn't this organization's or was already answered.
 */
export async function answerTenantQuestion(client: Queryable, orgId: string, userId: string, questionId: string, same: boolean): Promise<{ tenantId: string | null; tenantName: string } | null> {
  const found = await client.query(
    `select q.written_name, q.suggested_tenant_id::text as tenant_id, t.name as tenant_name, t.aliases
     from tenant_questions q join tenants t on t.id = q.suggested_tenant_id
     where q.org_id = $1 and q.id = $2 and q.status = 'pending' for update of q`,
    [orgId, questionId],
  )
  if (found.rows.length === 0) return null
  const question = found.rows[0]
  if (same) {
    const aliases = list(question.aliases)
    if (!aliases.some((alias) => nameKey(alias) === nameKey(question.written_name))) aliases.push(question.written_name)
    await client.query('update tenants set aliases = $3::jsonb where org_id = $1 and id = $2', [orgId, question.tenant_id, JSON.stringify(aliases.slice(-50))])
  }
  await client.query(`update tenant_questions set status = $3, decided_by = $4, decided_at = now() where org_id = $1 and id = $2`, [orgId, questionId, same ? 'same' : 'different', userId])
  // Rows that were waiting, in whichever rent rolls they are, now find their tenant (or have one made).
  const waiting = await client.query(
    `select distinct w.rent_roll_id::text as id, r.as_of_date, r.created_at
     from rent_roll_rows w join rent_rolls r on r.id = w.rent_roll_id
     where w.org_id = $1 and w.tenant_id is null and w.tenant is not null and w.status = 'leased'
     order by r.as_of_date, r.created_at`,
    [orgId],
  )
  for (const roll of waiting.rows) await syncRentRoll(client, orgId, userId, roll.id)
  if (same) return { tenantId: question.tenant_id, tenantName: question.tenant_name }
  const made = (await listTenantRefs(client, orgId)).find((tenant) => nameKey(tenant.name) === nameKey(question.written_name))
  return { tenantId: made?.id ?? null, tenantName: made?.name ?? question.written_name }
}

// ---------------------------------------------------------------------------
// Summaries (pure, and safe to use in the browser)
// ---------------------------------------------------------------------------

export type RolloverYear = { year: string; leases: number; squareFeet: number; share: number | null; annualRent: number }

/** Active leases grouped by the year they end, earliest first, with each year's share of the leased square feet. */
export function rollover(leases: Pick<Lease, 'status' | 'endDate' | 'squareFeet' | 'annualRent'>[]): RolloverYear[] {
  const active = leases.filter((lease) => lease.status === 'active')
  const total = active.reduce((sum, lease) => sum + (lease.squareFeet ?? 0), 0)
  const years = new Map<string, RolloverYear>()
  for (const lease of active) {
    const year = lease.endDate ? lease.endDate.slice(0, 4) : 'No End Date'
    const entry = years.get(year) ?? { year, leases: 0, squareFeet: 0, share: null, annualRent: 0 }
    entry.leases += 1
    entry.squareFeet += lease.squareFeet ?? 0
    entry.annualRent += lease.annualRent ?? 0
    years.set(year, entry)
  }
  return [...years.values()]
    .map((entry) => ({ ...entry, share: total > 0 ? Math.round((entry.squareFeet / total) * 1000) / 10 : null }))
    .sort((a, b) => (a.year === 'No End Date' ? 1 : b.year === 'No End Date' ? -1 : a.year.localeCompare(b.year)))
}

export type TenantShare = { tenantId: string; tenantName: string; leases: number; squareFeet: number; share: number | null; annualRent: number; rentShare: number | null; nextEnd: string | null }

/** Active leases grouped by tenant, the largest by square feet first, with each tenant's share of leased square feet and of rent. */
export function tenantShares(leases: Pick<Lease, 'status' | 'tenantId' | 'tenantName' | 'endDate' | 'squareFeet' | 'annualRent'>[]): TenantShare[] {
  const active = leases.filter((lease) => lease.status === 'active')
  const totalSf = active.reduce((sum, lease) => sum + (lease.squareFeet ?? 0), 0)
  const totalRent = active.reduce((sum, lease) => sum + (lease.annualRent ?? 0), 0)
  const tenants = new Map<string, TenantShare>()
  for (const lease of active) {
    const entry = tenants.get(lease.tenantId) ?? { tenantId: lease.tenantId, tenantName: lease.tenantName, leases: 0, squareFeet: 0, share: null, annualRent: 0, rentShare: null, nextEnd: null }
    entry.leases += 1
    entry.squareFeet += lease.squareFeet ?? 0
    entry.annualRent += lease.annualRent ?? 0
    if (lease.endDate && (!entry.nextEnd || lease.endDate < entry.nextEnd)) entry.nextEnd = lease.endDate
    tenants.set(lease.tenantId, entry)
  }
  return [...tenants.values()]
    .map((entry) => ({
      ...entry,
      share: totalSf > 0 ? Math.round((entry.squareFeet / totalSf) * 1000) / 10 : null,
      rentShare: totalRent > 0 ? Math.round((entry.annualRent / totalRent) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.squareFeet - a.squareFeet || b.annualRent - a.annualRent || a.tenantName.localeCompare(b.tenantName))
}
