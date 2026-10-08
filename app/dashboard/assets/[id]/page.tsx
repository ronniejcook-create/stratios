import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { PROPERTY_TYPES } from '@/lib/assets'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { EMPTY_VALUE } from '@/lib/fieldFormat'
import { listFields, listSourceTypes, listValues, type FieldDefinition, type FieldValue } from '@/lib/fields'
import { formatAddress, getAssetTree, type Address, type AssetTree, type RecordType } from '@/lib/records'
import { AddAddressForm, AddChildForm } from './AddForms'
import { FieldGroup, type FieldView } from './FieldGroup'

export const dynamic = 'force-dynamic'

// The order groups appear in. Sections and screens will replace this list
// when they become configurable.
const GROUP_ORDER = ['Asset Details', 'Debt', 'Property Details', 'KPIs', 'Building Details']

type Loaded = { tree: AssetTree; fields: FieldDefinition[]; values: FieldValue[]; sourceNames: Map<string, string> }

function AddressList({ addresses }: { addresses: Address[] }) {
  if (addresses.length === 0) return null
  return (
    <ul className="address-list">
      {addresses.map((address) => (
        <li key={address.id}>{formatAddress(address)}</li>
      ))}
    </ul>
  )
}

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  const { id } = await params
  if (!isDatabaseConfigured()) notFound()

  let loaded: Loaded | null = null
  try {
    loaded = await withOrg(orgId, async (client) => {
      const tree = await getAssetTree(client, orgId, id)
      if (!tree) return null
      const recordIds = [
        tree.id,
        ...tree.properties.flatMap((property) => [property.id, ...property.buildings.map((building) => building.id)]),
      ]
      const [fields, values, sourceTypes] = [
        await listFields(client, orgId),
        await listValues(client, orgId, recordIds),
        await listSourceTypes(client),
      ]
      return { tree, fields, values, sourceNames: new Map(sourceTypes.map((source) => [source.key, source.name])) }
    })
  } catch (error) {
    console.error('AssetPage failed', error)
    return (
      <>
        <h1>Asset</h1>
        <div className="panel notice">
          <h2>{isMissingSchema(error) ? 'Database Update Needed' : 'This Asset Could Not Be Loaded'}</h2>
          <p>
            {isMissingSchema(error)
              ? 'Run db/migrations/003_fields.sql against the database, then reload this page.'
              : 'Check the database connection and try again.'}
          </p>
        </div>
      </>
    )
  }
  if (!loaded) notFound()
  const { tree, fields, values, sourceNames } = loaded

  /** The fields for one record, grouped and in order, each with its current value. */
  const groupsFor = (recordType: RecordType, recordId: string, core: { name: string; property_type?: string | null }) => {
    const groups = new Map<string, FieldView[]>()
    for (const field of fields) {
      if (field.appliesTo !== recordType) continue
      // Values arrive newest month first, so the first match is the latest.
      const stored = values.find((value) => value.recordId === recordId && value.fieldId === field.id)
      let value = stored ? { text: stored.text, number: stored.number, date: stored.date, bool: stored.bool } : null
      if (field.coreColumn) {
        const text = field.coreColumn === 'name' ? core.name : core.property_type ?? null
        value = text ? { ...EMPTY_VALUE, text } : null
      }
      const view: FieldView = {
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
      }
      groups.set(field.groupName, [...(groups.get(field.groupName) ?? []), view])
    }
    const rank = (name: string) => (GROUP_ORDER.includes(name) ? GROUP_ORDER.indexOf(name) : GROUP_ORDER.length)
    return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  }

  const assetGroups = groupsFor('asset', tree.id, { name: tree.name })
  const propertyCount = tree.properties.length

  return (
    <>
      <p className="crumbs">
        <Link href="/dashboard">Assets</Link>
        <span aria-hidden="true"> / </span>
        <span>{tree.name}</span>
      </p>
      <h1>{tree.name}</h1>
      <p className="lede">
        {propertyCount === 1 ? '1 property' : `${propertyCount} properties`}
        <span className="record-key" title="The permanent key used by agents and formulas">asset:{tree.key}</span>
      </p>

      {assetGroups.map(([group, groupFields]) => (
        <section key={group} className="panel">
          <h2>{group}</h2>
          <FieldGroup target={{ assetId: tree.id, recordType: 'asset', recordId: tree.id }} fields={groupFields} />
        </section>
      ))}

      {tree.properties.map((property) => (
        <section key={property.id} className="panel record">
          <div className="record-head">
            <span className="record-kind">Property</span>
            <h2>{property.name}</h2>
            <span className="record-key" title="The permanent key used by agents and formulas">property:{property.key}</span>
          </div>
          <div className="record-addresses">
            <AddressList addresses={property.addresses} />
            <AddAddressForm ownerType="property" ownerId={property.id} assetId={tree.id} />
          </div>

          {groupsFor('property', property.id, { name: property.name, property_type: property.propertyType }).map(([group, groupFields]) => (
            <div key={group} className="record-group">
              <h3>{group}</h3>
              <FieldGroup target={{ assetId: tree.id, recordType: 'property', recordId: property.id }} fields={groupFields} />
            </div>
          ))}

          {property.buildings.map((building) => (
            <div key={building.id} className="subrecord">
              <div className="record-head">
                <span className="record-kind">Building</span>
                <h3>{building.name}</h3>
              </div>
              <div className="record-addresses">
                <AddressList addresses={building.addresses} />
                <AddAddressForm ownerType="building" ownerId={building.id} assetId={tree.id} />
              </div>

              {groupsFor('building', building.id, { name: building.name }).map(([group, groupFields]) => (
                <div key={group} className="record-group">
                  <h4>{group}</h4>
                  <FieldGroup target={{ assetId: tree.id, recordType: 'building', recordId: building.id }} fields={groupFields} />
                </div>
              ))}

              <div className="record-group">
                <h4>Floors and Units</h4>
                {building.floors.length === 0 ? <p className="note">No floors added yet. Add them only if you need unit-level detail.</p> : null}
                <ul className="floor-list">
                  {building.floors.map((floor) => (
                    <li key={floor.id}>
                      <span className="floor-name">{floor.name}</span>
                      <span className="unit-chips">
                        {floor.units.map((unit) => (
                          <span key={unit.id} className="unit-chip" title={unit.addresses.map(formatAddress).join('; ') || undefined}>{unit.name}</span>
                        ))}
                      </span>
                      <AddChildForm type="unit" parentId={floor.id} assetId={tree.id} />
                    </li>
                  ))}
                </ul>
                <AddChildForm type="floor" parentId={building.id} assetId={tree.id} />
              </div>
            </div>
          ))}

          <div className="record-add">
            <AddChildForm type="building" parentId={property.id} assetId={tree.id} />
          </div>
        </section>
      ))}

      <div className="record-add">
        <AddChildForm type="property" parentId={tree.id} assetId={tree.id} propertyTypes={PROPERTY_TYPES} />
      </div>
    </>
  )
}
