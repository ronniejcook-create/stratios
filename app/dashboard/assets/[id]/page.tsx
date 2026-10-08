import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { PROPERTY_TYPES } from '@/lib/assets'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { EMPTY_VALUE } from '@/lib/fieldFormat'
import { listFields, listSourceTypes, listValues, type FieldDefinition, type FieldValue } from '@/lib/fields'
import { listScreens, type Screen, type Section } from '@/lib/layout'
import { listLists, listRows, sortRows, type ListDefinition, type ListRow } from '@/lib/lists'
import { formatAddress, getAssetTree, type Address, type AssetTree, type RecordType } from '@/lib/records'
import { AddAddressForm, AddChildForm } from './AddForms'
import { FieldGroup, type FieldView, type Target } from './FieldGroup'
import { ListSection } from './ListSection'
import { ScreenTabs } from './ScreenTabs'

export const dynamic = 'force-dynamic'

type Loaded = {
  tree: AssetTree
  fields: FieldDefinition[]
  values: FieldValue[]
  sourceNames: Map<string, string>
  screens: Screen[]
  lists: ListDefinition[]
  rows: ListRow[]
}

/** One record on the page, with what is needed to show and save its fields. */
type RecordContext = {
  type: RecordType
  id: string
  name: string
  /** Permanent address, e.g. property:120-main-st or property:120-main-st/building:main-building */
  ref: string
  core: { name: string; property_type?: string | null }
}

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

export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ screen?: string }>
}) {
  const { orgId } = await auth()
  if (!orgId) return null // the layout redirects before this renders
  const { id } = await params
  const { screen: screenKey } = await searchParams
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
      const fields = await listFields(client, orgId)
      const values = await listValues(client, orgId, recordIds)
      const sourceTypes = await listSourceTypes(client)
      const screens = await listScreens(client, orgId)
      const lists = await listLists(client, orgId)
      const rows = await listRows(client, orgId, recordIds)
      return { tree, fields, values, sourceNames: new Map(sourceTypes.map((source) => [source.key, source.name])), screens, lists, rows }
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
              ? 'Run db/migrations/004_sections_and_lists.sql against the database (and 003_fields.sql first, if that has not been run), then reload this page.'
              : 'Check the database connection and try again.'}
          </p>
        </div>
      </>
    )
  }
  if (!loaded) notFound()
  const { tree, fields, values, sourceNames, screens, lists, rows } = loaded

  // "Made By" on a new comment starts as the signed-in person's name.
  const user = await currentUser()
  const currentUserName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.primaryEmailAddress?.emailAddress || ''

  const fieldById = new Map(fields.map((field) => [field.id, field]))
  const placed = new Set(screens.flatMap((candidate) => candidate.sections.flatMap((section) => section.fieldIds)))

  const viewOf = (field: FieldDefinition, record: RecordContext): FieldView => {
    // Values arrive newest month first, so the first match is the latest.
    const stored = values.find((value) => value.recordId === record.id && value.fieldId === field.id)
    let value = stored ? { text: stored.text, number: stored.number, date: stored.date, bool: stored.bool } : null
    if (field.coreColumn) {
      const text = field.coreColumn === 'name' ? record.core.name : record.core.property_type ?? null
      value = text ? { ...EMPTY_VALUE, text } : null
    }
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
    }
  }

  const targetOf = (record: RecordContext): Target => ({
    assetId: tree.id,
    recordType: record.type,
    recordId: record.id,
    recordRef: record.ref,
    recordName: record.name,
  })

  /** What goes inside one section for one record: its fields, or its lists. */
  const sectionBody = (section: Section, record: RecordContext) => {
    if (section.displayStyle === 'list') {
      const sectionLists = lists.filter((list) => list.sectionId === section.id && list.appliesTo === record.type)
      if (sectionLists.length === 0) return <p className="note">No list is set up for this section yet.</p>
      return sectionLists.map((list) => {
        const columns = fields.filter((field) => field.listId === list.id)
        const sortField = columns.find((column) => column.key === list.sortFieldKey)
        const listRowsForRecord = sortRows(
          rows.filter((row) => row.listId === list.id && row.recordId === record.id),
          sortField?.id ?? null,
          list.sortDescending,
        )
        return (
          <ListSection
            key={list.id}
            target={targetOf(record)}
            list={{ id: list.id, key: list.key, name: list.name }}
            columns={columns.map((column) => ({
              id: column.id,
              key: column.key,
              name: column.name,
              dataType: column.dataType,
              unit: column.unit,
              options: column.options,
              defaultValue: column.defaultValue,
            }))}
            rows={listRowsForRecord.map((row) => ({ id: row.id, rowNumber: row.rowNumber, values: row.values }))}
            currentUserName={currentUserName}
          />
        )
      })
    }
    const sectionFields = section.fieldIds
      .map((fieldId) => fieldById.get(fieldId))
      .filter((field): field is FieldDefinition => Boolean(field) && field!.appliesTo === record.type && !field!.listId)
    return <FieldGroup target={targetOf(record)} fields={sectionFields.map((field) => viewOf(field, record))} style={section.displayStyle === 'tiles' ? 'tiles' : 'form'} />
  }

  const assetRecord: RecordContext = { type: 'asset', id: tree.id, name: tree.name, ref: `asset:${tree.key}`, core: { name: tree.name } }
  const propertyCount = tree.properties.length

  /** Everything one screen shows: its sections for the asset, each property and each building. */
  const screenContent = (screen: Screen, isFirstScreen: boolean) => {
    const sectionsFor = (type: RecordType) => screen.sections.filter((section) => section.appliesTo === type)
    /** Fields that aren't in any section yet (for example ones an organization added) show on the first screen. */
    const unplacedFor = (type: RecordType) =>
      isFirstScreen ? fields.filter((field) => field.appliesTo === type && !field.listId && !placed.has(field.id)) : []

    const assetSections = sectionsFor('asset')
    const propertySections = sectionsFor('property')
    const buildingSections = sectionsFor('building')
    const showProperties = isFirstScreen || propertySections.length > 0 || buildingSections.length > 0
    const showBuildings = isFirstScreen || buildingSections.length > 0
    const assetUnplaced = unplacedFor('asset')

    return (
      <>
        {assetSections.map((section) => (
          <section key={section.id} className="panel">
            <h2>{section.name}</h2>
            {sectionBody(section, assetRecord)}
          </section>
        ))}
        {assetUnplaced.length > 0 ? (
          <section className="panel">
            <h2>Other Fields</h2>
            <FieldGroup target={targetOf(assetRecord)} fields={assetUnplaced.map((field) => viewOf(field, assetRecord))} />
          </section>
        ) : null}

        {showProperties
          ? tree.properties.map((property) => {
              const propertyRecord: RecordContext = {
                type: 'property',
                id: property.id,
                name: property.name,
                ref: `property:${property.key}`,
                core: { name: property.name, property_type: property.propertyType },
              }
              const propertyUnplaced = unplacedFor('property')
              return (
                <section key={property.id} className="panel record">
                  <div className="record-head">
                    <span className="record-kind">Property</span>
                    <h2>{property.name}</h2>
                    <span className="record-key" title="The permanent key used by agents and formulas">{propertyRecord.ref}</span>
                  </div>
                  {isFirstScreen ? (
                    <div className="record-addresses">
                      <AddressList addresses={property.addresses} />
                      <AddAddressForm ownerType="property" ownerId={property.id} assetId={tree.id} />
                    </div>
                  ) : null}

                  {propertySections.map((section) => (
                    <div key={section.id} className="record-group">
                      <h3>{section.name}</h3>
                      {sectionBody(section, propertyRecord)}
                    </div>
                  ))}
                  {propertyUnplaced.length > 0 ? (
                    <div className="record-group">
                      <h3>Other Fields</h3>
                      <FieldGroup target={targetOf(propertyRecord)} fields={propertyUnplaced.map((field) => viewOf(field, propertyRecord))} />
                    </div>
                  ) : null}

                  {showBuildings
                    ? property.buildings.map((building) => {
                        const buildingRecord: RecordContext = {
                          type: 'building',
                          id: building.id,
                          name: building.name,
                          ref: `${propertyRecord.ref}/building:${building.key}`,
                          core: { name: building.name },
                        }
                        const buildingUnplaced = unplacedFor('building')
                        return (
                          <div key={building.id} className="subrecord">
                            <div className="record-head">
                              <span className="record-kind">Building</span>
                              <h3>{building.name}</h3>
                            </div>
                            {isFirstScreen ? (
                              <div className="record-addresses">
                                <AddressList addresses={building.addresses} />
                                <AddAddressForm ownerType="building" ownerId={building.id} assetId={tree.id} />
                              </div>
                            ) : null}

                            {buildingSections.map((section) => (
                              <div key={section.id} className="record-group">
                                <h4>{section.name}</h4>
                                {sectionBody(section, buildingRecord)}
                              </div>
                            ))}
                            {buildingUnplaced.length > 0 ? (
                              <div className="record-group">
                                <h4>Other Fields</h4>
                                <FieldGroup target={targetOf(buildingRecord)} fields={buildingUnplaced.map((field) => viewOf(field, buildingRecord))} />
                              </div>
                            ) : null}

                            {isFirstScreen ? (
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
                            ) : null}
                          </div>
                        )
                      })
                    : null}

                  {isFirstScreen ? (
                    <div className="record-add">
                      <AddChildForm type="building" parentId={property.id} assetId={tree.id} />
                    </div>
                  ) : null}
                </section>
              )
            })
          : null}

        {isFirstScreen ? (
          <div className="record-add">
            <AddChildForm type="property" parentId={tree.id} assetId={tree.id} propertyTypes={PROPERTY_TYPES} />
          </div>
        ) : null}
      </>
    )
  }

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

      <ScreenTabs
        screens={screens.map((screen, index) => ({ key: screen.key, name: screen.name, content: screenContent(screen, index === 0) }))}
        initialKey={screenKey ?? ''}
        basePath={`/dashboard/assets/${tree.id}`}
      />
    </>
  )
}
