import { listFields, saveManualValue, type FieldDefinition } from './fields'
import { insertAddress, insertAsset, insertChild, type Queryable } from './records'

/**
 * The property types offered when the Property Type field's own list can't be
 * read. The list people actually pick from is that field's, which Stratios and
 * each organization's administrators manage; see listPropertyTypes.
 */
export const DEFAULT_PROPERTY_TYPES: readonly string[] = ['Office', 'Industrial', 'Retail', 'Residential', 'Hotel', 'Self-Storage', 'Seniors Housing', 'Mixed Use', 'Other']

/** The property types of a list of fields: the choices of the Property Type field that can be picked now. */
export function propertyTypesOf(fields: FieldDefinition[]): string[] {
  const choices = fields.find((field) => field.key === 'propertyType' && field.appliesTo === 'property' && !field.listId)?.options ?? []
  return choices.length > 0 ? choices : [...DEFAULT_PROPERTY_TYPES]
}

/** The property types this organization picks from. */
export async function listPropertyTypes(client: Queryable, orgId: string): Promise<string[]> {
  return propertyTypesOf(await listFields(client, orgId))
}

/** The listed type a typed or spoken one means, whatever its capitals; null when it is none of them. */
export function matchPropertyType(choices: readonly string[], raw: string): string | null {
  const wanted = raw.trim().toLowerCase()
  return choices.find((choice) => choice.toLowerCase() === wanted) ?? null
}

/** The type to fall back on when a document or a person names none of the listed ones: "Other" if listed, else the last. */
export function fallbackPropertyType(choices: readonly string[]): string {
  return matchPropertyType(choices, 'Other') ?? choices[choices.length - 1] ?? 'Other'
}

/**
 * Creates an asset with one property and one building, so a simple asset
 * needs no extra set-up. The property takes the asset's name and the chosen
 * type; a city, if given, becomes the property's first address. The name and
 * type are written into each field's history as its first entry, saying who
 * created the asset and whether the values were typed or read from a document.
 * Returns the new asset's id.
 */
export async function createAssetWithDefaults(
  client: Queryable,
  orgId: string,
  userId: string,
  input: { name: string; propertyType: string; city: string | null },
  /** The document the asset was created from, when an agent read it out of one. Its starting values are then recorded as coming from that document. */
  fromDocument: { id: string; name: string } | null = null,
): Promise<string> {
  const assetId = await insertAsset(client, orgId, userId, input.name)
  const propertyId = await insertChild(client, orgId, userId, 'property', assetId, input.name, input.propertyType)
  if (!propertyId) throw new Error('The property could not be created')
  const buildingId = await insertChild(client, orgId, userId, 'building', propertyId, 'Main Building')
  if (!buildingId) throw new Error('The building could not be created')
  if (input.city) {
    await insertAddress(client, orgId, userId, 'property', propertyId, { street: null, suite: null, city: input.city, state: null, postalCode: null })
  }

  // Record the starting values in the golden record, so later changes have a
  // "before" to compare with.
  const fields = await listFields(client, orgId)
  const fieldId = (appliesTo: string, key: string) => fields.find((field) => field.appliesTo === appliesTo && field.key === key)?.id
  const starting: { recordType: 'asset' | 'property'; recordId: string; key: string; raw: string }[] = [
    { recordType: 'asset', recordId: assetId, key: 'assetName', raw: input.name },
    { recordType: 'property', recordId: propertyId, key: 'propertyName', raw: input.name },
    { recordType: 'property', recordId: propertyId, key: 'propertyType', raw: input.propertyType },
  ]
  for (const item of starting) {
    const id = fieldId(item.recordType, item.key)
    if (!id) continue
    const result = await saveManualValue(client, orgId, userId, { recordType: item.recordType, recordId: item.recordId, fieldId: id, raw: item.raw, starting: true, fromDocument })
    if (!result.ok) throw new Error(result.error)
  }
  return assetId
}

/** Every record that belongs to an asset: the asset itself and all properties, buildings, floors and units under it. */
const ASSET_RECORD_IDS = `
  select a.id from assets a where a.id = $2 and a.org_id = $1
  union all select p.id from properties p where p.asset_id = $2 and p.org_id = $1
  union all select b.id from buildings b join properties p on p.id = b.property_id where p.asset_id = $2 and b.org_id = $1
  union all select f.id from floors f join buildings b on b.id = f.building_id join properties p on p.id = b.property_id where p.asset_id = $2 and f.org_id = $1
  union all select u.id from units u join floors f on f.id = u.floor_id join buildings b on b.id = f.building_id join properties p on p.id = b.property_id where p.asset_id = $2 and u.org_id = $1`

export type AssetContents = { name: string; properties: number; buildings: number; documents: number; values: number; listRows: number }

/** What an asset holds, for the warning shown before it is deleted. Null when the asset isn't this organization's. */
export async function getAssetContents(client: Queryable, orgId: string, assetId: string): Promise<AssetContents | null> {
  const { rows } = await client.query(
    `select a.name,
            (select count(*)::int from properties p where p.asset_id = a.id and p.org_id = a.org_id) as properties,
            (select count(*)::int from buildings b join properties p on p.id = b.property_id where p.asset_id = a.id and b.org_id = a.org_id) as buildings,
            (select count(*)::int from documents d where d.asset_id = a.id and d.org_id = a.org_id) as documents,
            (select count(*)::int from field_values v where v.org_id = a.org_id and v.record_id in (${ASSET_RECORD_IDS})) as field_values,
            (select count(*)::int from field_list_rows r where r.org_id = a.org_id and r.record_id in (${ASSET_RECORD_IDS})) as list_rows
     from assets a where a.id = $2 and a.org_id = $1`,
    [orgId, assetId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    name: row.name,
    properties: Number(row.properties),
    buildings: Number(row.buildings),
    documents: Number(row.documents),
    values: Number(row.field_values),
    listRows: Number(row.list_rows),
  }
}

/**
 * Deletes an asset and everything under it, for good: its properties,
 * buildings, floors, units and addresses, every field value with its history
 * and per-source values, list rows (comments, critical dates), and its
 * documents with their files and review lists. Nothing is kept.
 *
 * Values and list rows point at their record by id without a database link,
 * so they are removed here first; the rest follows the asset through the
 * database's own cascades. Call inside the organization's transaction so a
 * failure part-way leaves nothing half deleted. Returns the asset's name, or
 * null when the asset isn't this organization's.
 */
export async function deleteAsset(client: Queryable, orgId: string, assetId: string): Promise<string | null> {
  const found = await client.query('select name from assets where id = $2 and org_id = $1', [orgId, assetId])
  if (!found.rows[0]) return null
  for (const table of ['field_value_history', 'field_source_values', 'field_values', 'field_list_rows']) {
    await client.query(`delete from ${table} where org_id = $1 and record_id in (${ASSET_RECORD_IDS})`, [orgId, assetId])
  }
  // Leases carry values too (read from lease agreements). Their table arrives with migration 024, so it is checked for first.
  const leases = await client.query(`select to_regclass(current_schema() || '.leases') is not null as ready`)
  if (leases.rows[0]?.ready === true) {
    for (const table of ['field_value_history', 'field_source_values', 'field_values', 'field_list_rows']) {
      await client.query(`delete from ${table} where org_id = $1 and record_id in (select l.id from leases l where l.asset_id = $2 and l.org_id = $1)`, [orgId, assetId])
    }
  }
  await client.query('delete from assets where id = $2 and org_id = $1', [orgId, assetId])
  return found.rows[0].name as string
}
