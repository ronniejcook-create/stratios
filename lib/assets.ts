import { listFields, saveManualValue } from './fields'
import { insertAddress, insertAsset, insertChild, type Queryable } from './records'

// Matches the Property Type pick list in the Stratios standard fields.
export const PROPERTY_TYPES = ['Office', 'Retail', 'Industrial', 'Multifamily', 'Mixed Use', 'Other'] as const

/**
 * Creates an asset with one property and one building, so a simple asset
 * needs no extra set-up. The property takes the asset's name and the chosen
 * type; a city, if given, becomes the property's first address.
 * Returns the new asset's id.
 */
export async function createAssetWithDefaults(
  client: Queryable,
  orgId: string,
  userId: string,
  input: { name: string; propertyType: string; city: string | null },
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
    const result = await saveManualValue(client, orgId, userId, { recordType: item.recordType, recordId: item.recordId, fieldId: id, raw: item.raw })
    if (!result.ok) throw new Error(result.error)
  }
  return assetId
}
