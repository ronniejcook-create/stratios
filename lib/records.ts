// The asset hierarchy: Asset > Property > Building > Floor > Unit, plus addresses.
//
// Every function takes the database client of a transaction that is already
// scoped to one organization (see withOrg in lib/db.ts). Queries also filter
// by org_id explicitly, so a misconfigured database role cannot expose other
// organizations' rows.

export type Queryable = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>
}

export const RECORD_TYPES = ['asset', 'property', 'building', 'floor', 'unit'] as const
export type RecordType = (typeof RECORD_TYPES)[number]

export const RECORD_LABELS: Record<RecordType, string> = {
  asset: 'Asset',
  property: 'Property',
  building: 'Building',
  floor: 'Floor',
  unit: 'Unit',
}

// Table and column names come only from this fixed list, never from user input.
const TABLES: Record<RecordType, { table: string; parent: RecordType | null; parentColumn: string | null }> = {
  asset: { table: 'assets', parent: null, parentColumn: null },
  property: { table: 'properties', parent: 'asset', parentColumn: 'asset_id' },
  building: { table: 'buildings', parent: 'property', parentColumn: 'property_id' },
  floor: { table: 'floors', parent: 'building', parentColumn: 'building_id' },
  unit: { table: 'units', parent: 'floor', parentColumn: 'floor_id' },
}

export function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value)
}

export function tableFor(type: RecordType): string {
  return TABLES[type].table
}

export function parentTypeOf(type: RecordType): RecordType | null {
  return TABLES[type].parent
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(value: string): boolean {
  return UUID.test(value)
}

/** "120 Main St." -> "120-main-st" */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug || fallback
}

/**
 * A key that is free to use: unique in the organization for assets and
 * properties, and unique under its parent for buildings, floors and units.
 */
async function freeKey(client: Queryable, orgId: string, type: RecordType, parentId: string | null, name: string): Promise<string> {
  const { table, parentColumn } = TABLES[type]
  const base = slugify(name, type)
  const scopedToParent = type === 'building' || type === 'floor' || type === 'unit'
  const { rows } = scopedToParent
    ? await client.query(`select key from ${table} where org_id = $1 and ${parentColumn} = $2 and (key = $3 or key like $4)`, [orgId, parentId, base, `${base}-%`])
    : await client.query(`select key from ${table} where org_id = $1 and (key = $2 or key like $3)`, [orgId, base, `${base}-%`])
  const taken = new Set(rows.map((row) => String(row.key)))
  if (!taken.has(base)) return base
  for (let n = 2; n < 10000; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
  throw new Error('Could not find a free key')
}

/** True when the record exists and belongs to this organization. */
export async function recordExists(client: Queryable, orgId: string, type: RecordType, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const { rows } = await client.query(`select 1 as found from ${tableFor(type)} where id = $1 and org_id = $2`, [id, orgId])
  return rows.length > 0
}

export type AssetSummary = {
  id: string
  key: string
  name: string
  propertyCount: number
  propertyTypes: string[]
  cities: string[]
}

export async function listAssets(client: Queryable, orgId: string): Promise<AssetSummary[]> {
  const { rows } = await client.query(
    `select a.id::text as id, a.key, a.name,
            (select count(*)::int from properties p where p.asset_id = a.id and p.org_id = a.org_id) as property_count,
            coalesce((select json_agg(distinct p.property_type) from properties p
                      where p.asset_id = a.id and p.org_id = a.org_id and p.property_type is not null), '[]'::json) as property_types,
            coalesce((select json_agg(distinct d.city) from addresses d join properties p on p.id = d.property_id
                      where p.asset_id = a.id and d.org_id = a.org_id and d.city is not null), '[]'::json) as cities
     from assets a
     where a.org_id = $1
     order by a.created_at desc`,
    [orgId],
  )
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    propertyCount: Number(row.property_count),
    propertyTypes: row.property_types as string[],
    cities: row.cities as string[],
  }))
}

export type Address = {
  id: string
  street: string | null
  suite: string | null
  city: string | null
  state: string | null
  postalCode: string | null
}

export type UnitNode = { id: string; key: string; name: string; addresses: Address[] }
export type FloorNode = { id: string; key: string; name: string; units: UnitNode[] }
export type BuildingNode = { id: string; key: string; name: string; addresses: Address[]; floors: FloorNode[] }
export type PropertyNode = { id: string; key: string; name: string; propertyType: string | null; addresses: Address[]; buildings: BuildingNode[] }
export type AssetTree = { id: string; key: string; name: string; properties: PropertyNode[] }

function toAddress(row: Record<string, unknown>): Address {
  return {
    id: String(row.id),
    street: (row.street as string | null) ?? null,
    suite: (row.suite as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    postalCode: (row.postal_code as string | null) ?? null,
  }
}

/** One asset with everything beneath it, or null when it isn't this organization's. */
export async function getAssetTree(client: Queryable, orgId: string, assetId: string): Promise<AssetTree | null> {
  if (!isUuid(assetId)) return null
  const asset = await client.query('select id::text as id, key, name from assets where id = $1 and org_id = $2', [assetId, orgId])
  if (asset.rows.length === 0) return null

  const properties = await client.query(
    'select id::text as id, key, name, property_type from properties where asset_id = $1 and org_id = $2 order by created_at, name',
    [assetId, orgId],
  )
  const propertyIds = properties.rows.map((row) => row.id as string)
  const buildings = await client.query(
    'select id::text as id, property_id::text as parent_id, key, name from buildings where org_id = $1 and property_id = any($2::uuid[]) order by created_at, name',
    [orgId, propertyIds],
  )
  const buildingIds = buildings.rows.map((row) => row.id as string)
  const floors = await client.query(
    'select id::text as id, building_id::text as parent_id, key, name from floors where org_id = $1 and building_id = any($2::uuid[]) order by created_at, name',
    [orgId, buildingIds],
  )
  const floorIds = floors.rows.map((row) => row.id as string)
  const units = await client.query(
    'select id::text as id, floor_id::text as parent_id, key, name from units where org_id = $1 and floor_id = any($2::uuid[]) order by created_at, name',
    [orgId, floorIds],
  )
  const unitIds = units.rows.map((row) => row.id as string)
  const addresses = await client.query(
    `select id::text as id, property_id::text as property_id, building_id::text as building_id, unit_id::text as unit_id,
            street, suite, city, state, postal_code
     from addresses
     where org_id = $1 and (property_id = any($2::uuid[]) or building_id = any($3::uuid[]) or unit_id = any($4::uuid[]))
     order by created_at`,
    [orgId, propertyIds, buildingIds, unitIds],
  )

  const addressesFor = (column: 'property_id' | 'building_id' | 'unit_id', id: string) =>
    addresses.rows.filter((row) => row[column] === id).map(toAddress)

  return {
    id: asset.rows[0].id,
    key: asset.rows[0].key,
    name: asset.rows[0].name,
    properties: properties.rows.map((property) => ({
      id: property.id,
      key: property.key,
      name: property.name,
      propertyType: property.property_type ?? null,
      addresses: addressesFor('property_id', property.id),
      buildings: buildings.rows
        .filter((building) => building.parent_id === property.id)
        .map((building) => ({
          id: building.id,
          key: building.key,
          name: building.name,
          addresses: addressesFor('building_id', building.id),
          floors: floors.rows
            .filter((floor) => floor.parent_id === building.id)
            .map((floor) => ({
              id: floor.id,
              key: floor.key,
              name: floor.name,
              units: units.rows
                .filter((unit) => unit.parent_id === floor.id)
                .map((unit) => ({ id: unit.id, key: unit.key, name: unit.name, addresses: addressesFor('unit_id', unit.id) })),
            })),
        })),
    })),
  }
}

/** Adds an asset with nothing beneath it. Returns its id. */
export async function insertAsset(client: Queryable, orgId: string, userId: string, name: string): Promise<string> {
  const key = await freeKey(client, orgId, 'asset', null, name)
  const { rows } = await client.query(
    'insert into assets (org_id, name, key, created_by) values ($1, $2, $3, $4) returning id::text as id',
    [orgId, name, key, userId],
  )
  return rows[0].id
}

/**
 * Adds a property, building, floor or unit under its parent. Returns the new
 * id, or null when the parent isn't this organization's.
 */
export async function insertChild(
  client: Queryable,
  orgId: string,
  userId: string,
  type: Exclude<RecordType, 'asset'>,
  parentId: string,
  name: string,
  propertyType: string | null = null,
): Promise<string | null> {
  const { table, parent, parentColumn } = TABLES[type]
  if (!parent || !parentColumn) return null
  if (!(await recordExists(client, orgId, parent, parentId))) return null
  const key = await freeKey(client, orgId, type, parentId, name)
  if (type === 'property') {
    const { rows } = await client.query(
      'insert into properties (org_id, asset_id, name, key, property_type, created_by) values ($1, $2, $3, $4, $5, $6) returning id::text as id',
      [orgId, parentId, name, key, propertyType, userId],
    )
    return rows[0].id
  }
  const { rows } = await client.query(
    `insert into ${table} (org_id, ${parentColumn}, name, key, created_by) values ($1, $2, $3, $4, $5) returning id::text as id`,
    [orgId, parentId, name, key, userId],
  )
  return rows[0].id
}

export type AddressInput = {
  street: string | null
  suite: string | null
  city: string | null
  state: string | null
  postalCode: string | null
}

export type AddressOwner = 'property' | 'building' | 'unit'

/** Adds an address to a property, building or unit. False when the owner isn't this organization's. */
export async function insertAddress(
  client: Queryable,
  orgId: string,
  userId: string,
  ownerType: AddressOwner,
  ownerId: string,
  input: AddressInput,
): Promise<boolean> {
  if (!(await recordExists(client, orgId, ownerType, ownerId))) return false
  const column = ownerType === 'property' ? 'property_id' : ownerType === 'building' ? 'building_id' : 'unit_id'
  await client.query(
    `insert into addresses (org_id, ${column}, street, suite, city, state, postal_code, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [orgId, ownerId, input.street, input.suite, input.city, input.state, input.postalCode, userId],
  )
  return true
}

/** "100 Main St, Suite 200, Dallas, TX 75201" */
export function formatAddress(address: Address): string {
  const cityLine = [address.city, [address.state, address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [address.street, address.suite, cityLine].filter(Boolean).join(', ')
}
