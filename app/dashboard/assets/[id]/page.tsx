import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { PROPERTY_TYPES, getAssetContents, type AssetContents } from '@/lib/assets'
import { isDatabaseConfigured, isMissingSchema, withOrg } from '@/lib/db'
import { listDocuments, MAX_DOCUMENT_BYTES, type DocumentSummary } from '@/lib/documents'
import { EMPTY_VALUE } from '@/lib/fieldFormat'
import { listFields, listSourceTypes, listValues, type FieldDefinition, type FieldValue } from '@/lib/fields'
import { listScreens, type Screen, type Section } from '@/lib/layout'
import { listLists, listRows, sortRows, type ListDefinition, type ListRow } from '@/lib/lists'
import type { MapPin } from '@/components/PropertyMap'
import { typeAheadEnabled } from '@/lib/googlePlaces'
import { listRentRollRows, listRentRolls, type RentRollRow } from '@/lib/rentRolls'
import { loadAccess, type Access } from '@/lib/permissions'
import { formatAddress, getAssetTree, type Address, type AssetTree, type RecordType } from '@/lib/records'
import { AddAddressForm, AddChildForm, AddressList, RefreshLocationButton } from './AddForms'
import { AssetMap } from './AssetMap'
import { listPhotos, listPlanPages, PHOTO_CATEGORIES, PHOTO_CATEGORY_LABELS, type Photo, type PlanPage } from '@/lib/photos'
import { RentRollPanel, type RentRollChoice } from './RentRollPanel'
import { DocumentsPanel, type DocumentRow } from './DocumentsPanel'
import { PhotosPanel, type PhotoRow } from './PhotosPanel'
import { FieldGroup, type FieldView, type Target } from './FieldGroup'
import { ListSection } from './ListSection'
import { DeleteAssetButton } from './DeleteAssetButton'
import { ScreenTabs } from './ScreenTabs'

export const dynamic = 'force-dynamic'
// Adding or changing an address looks its surroundings up in several public sources before the page comes back.
export const maxDuration = 60

type Loaded = {
  tree: AssetTree
  fields: FieldDefinition[]
  values: FieldValue[]
  sourceNames: Map<string, string>
  screens: Screen[]
  lists: ListDefinition[]
  rows: ListRow[]
  access: Access
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

/** Addresses as plain rows for the browser component that lists them. */
const addressRows = (addresses: Address[]) =>
  addresses.map((address) => ({ id: address.id, text: formatAddress(address), latitude: address.latitude, longitude: address.longitude, hasStreet: Boolean(address.street) }))

export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ screen?: string; rentRoll?: string }>
}) {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null // the layout redirects before this renders
  const isAdmin = orgRole === 'org:admin'
  const { id } = await params
  const { screen: screenKey, rentRoll: rentRollParam } = await searchParams
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
      const access = await loadAccess(client, orgId, userId, orgRole === 'org:admin')
      return { tree, fields, values, sourceNames: new Map(sourceTypes.map((source) => [source.key, source.name])), screens, lists, rows, access }
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
              ? 'Run the newest files in db/migrations against the database, in number order, then reload this page.'
              : 'Check the database connection and try again.'}
          </p>
        </div>
      </>
    )
  }
  if (!loaded) notFound()
  const { tree, fields, values, sourceNames, screens, lists, rows, access } = loaded

  // What the asset holds, for the administrator's delete warning. The warning still works without the counts.
  let contents: AssetContents | null = null
  if (orgRole === 'org:admin') {
    try {
      contents = await withOrg(orgId, (client) => getAssetContents(client, orgId, tree.id))
    } catch (error) {
      console.error('Counting the asset contents failed', error)
    }
  }

  // Rent rolls, on their own as well. Like a document's file, a rent roll shows rents and tenants whatever a
  // role's field rules say, so only people who may add documents (administrators and roles that can edit) see it.
  let rentRollChoices: RentRollChoice[] = []
  let rentRollRows: RentRollRow[] = []
  let rentRollSelected: string | null = null
  let rentRollError: string | null = null
  if (access.canAddRecords) {
    try {
      const found = await withOrg(orgId, async (client) => {
        const all = await listRentRolls(client, orgId, tree.id)
        const chosen = all.find((rentRoll) => rentRoll.id === rentRollParam) ?? all[0] ?? null
        return { all, chosen, rows: chosen ? await listRentRollRows(client, orgId, chosen.id) : [] }
      })
      rentRollChoices = found.all.map((rentRoll) => ({
        id: rentRoll.id,
        asOfDate: rentRoll.asOfDate,
        asOfStated: rentRoll.asOfStated,
        propertyName: tree.properties.find((property) => property.id === rentRoll.propertyId)?.name ?? '',
        propertyType: tree.properties.find((property) => property.id === rentRoll.propertyId)?.propertyType ?? null,
        documentId: rentRoll.documentId,
        documentName: rentRoll.documentName,
        rowCount: rentRoll.rowCount,
        stated: rentRoll.stated,
      }))
      rentRollRows = found.rows
      rentRollSelected = found.chosen?.id ?? null
    } catch (error) {
      console.error('Listing rent rolls failed', error)
      rentRollError = isMissingSchema(error)
        ? 'Rent rolls need a database update: run db/migrations/019_rent_rolls.sql, then reload this page.'
        : 'The rent rolls could not be loaded. Try again.'
    }
  }

  // Photos are loaded on their own too, for the same reason.
  let photos: Photo[] = []
  let photosError: string | null = null
  try {
    photos = await withOrg(orgId, (client) => listPhotos(client, orgId, tree.id))
  } catch (error) {
    console.error('Listing photos failed', error)
    photosError = isMissingSchema(error)
      ? 'Photos need a database update: run db/migrations/013_photos.sql, then reload this page.'
      : 'The photos could not be loaded. Try again.'
  }
  const photoRows: PhotoRow[] = photos.map((photo) => ({
    id: photo.id,
    category: photo.category,
    categoryLabel: PHOTO_CATEGORY_LABELS[photo.category],
    caption: photo.caption,
    isMain: photo.isMain,
    source: photo.documentName ? `From ${photo.documentName}${photo.page ? `, page ${photo.page}` : ''}` : photo.page ? `From a document that was removed, page ${photo.page}` : 'Uploaded',
  }))
  const mainPhoto = photos.find((photo) => photo.isMain)
  // Pins for the Map tab: every property and building address that has a location.
  const places = tree.properties.flatMap((property) => [
    { title: property.name, subtitle: 'Property', addresses: property.addresses },
    ...property.buildings.map((building) => ({ title: building.name, subtitle: `Building at ${property.name}`, addresses: building.addresses })),
  ])
  const mapPins: MapPin[] = places.flatMap((place) =>
    place.addresses.flatMap((address) =>
      address.latitude !== null && address.longitude !== null
        ? [{ id: address.id, title: place.title, subtitle: place.subtitle, address: formatAddress(address), latitude: address.latitude, longitude: address.longitude }]
        : [],
    ),
  )
  const unpinned = places.reduce((sum, place) => sum + place.addresses.filter((address) => address.street && (address.latitude === null || address.longitude === null)).length, 0)

  // Suggestions while typing an address are on when a Google key is set (lib/googlePlaces.ts).
  const addressTypeAhead = typeAheadEnabled()

  // Pages the agent marked as plans or maps, for the Photos tab to offer. Missing notes are not an error.
  let planPages = new Map<string, PlanPage[]>()
  if (access.canAddRecords && !photosError) {
    try {
      planPages = await withOrg(orgId, (client) => listPlanPages(client, orgId, tree.id))
    } catch (error) {
      console.error('Listing plan pages failed', error)
    }
  }

  // Documents are loaded on their own, so the asset still opens if their tables aren't there yet.
  let documents: DocumentSummary[] = []
  let documentsError: string | null = null
  try {
    documents = await withOrg(orgId, (client) => listDocuments(client, orgId, tree.id))
  } catch (error) {
    console.error('Listing documents failed', error)
    documentsError = isMissingSchema(error)
      ? 'Documents need a database update: run db/migrations/008_documents.sql, then reload this page.'
      : 'The documents could not be loaded. Check the database connection and try again.'
  }
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const documentRows: DocumentRow[] = documents.map((document) => ({
    id: document.id,
    name: document.name,
    size: document.sizeBytes >= 1024 * 1024 ? `${(document.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(document.sizeBytes / 1024))} KB`,
    uploaded: new Date(document.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    status: document.status === 'uploading' ? 'uploaded' : document.status,
    stalled: document.stalled,
    error: document.error,
    documentType: document.documentType,
    found:
      [
        document.counts.filled > 0 ? `${document.counts.filled} filled in` : '',
        document.counts.replaced > 0 ? `${document.counts.replaced} replaced` : '',
        document.counts.confirmed > 0 ? `${document.counts.confirmed} confirmed` : '',
        document.counts.kept > 0 ? `${document.counts.kept} kept` : '',
        document.proposals > 0 && access.canAddRecords ? plural(document.proposals, 'proposed field', 'proposed fields') : '',
      ].filter(Boolean).join(' · ') || 'No values found',
    undecided: document.undecided,
  }))

  // "Made By" on a new comment starts as the signed-in person's name.
  const user = await currentUser()
  const currentUserName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.primaryEmailAddress?.emailAddress || ''

  const fieldById = new Map(fields.map((field) => [field.id, field]))
  const placed = new Set(screens.flatMap((candidate) => candidate.sections.flatMap((section) => section.fieldIds)))

  const viewOf = (field: FieldDefinition, record: RecordContext, canEdit: boolean): FieldView => {
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
      canEdit,
      description: field.aiDescription,
      agentInstructions: field.agentInstructions,
    }
  }

  const targetOf = (record: RecordContext): Target => ({
    assetId: tree.id,
    recordType: record.type,
    recordId: record.id,
    recordRef: record.ref,
    recordName: record.name,
  })

  /**
   * The fields of one record the person may see, each marked as editable or
   * not. Hidden fields are dropped here, so they never reach the browser.
   */
  const visibleViews = (candidates: FieldDefinition[], record: RecordContext, sectionId: string | null): FieldView[] =>
    candidates.flatMap((field) => {
      const level = access.fieldLevel(field.id, sectionId)
      return level === 'hidden' ? [] : [viewOf(field, record, level === 'edit')]
    })

  /**
   * What goes inside one section for one record: its fields, or its lists.
   * Null when the person may not see any of it, so the section is left out.
   */
  const sectionBody = (section: Section, record: RecordContext) => {
    if (section.displayStyle === 'list') {
      const level = access.sectionLevel(section.id)
      if (level === 'hidden') return null
      const sectionLists = lists.filter((list) => list.sectionId === section.id && list.appliesTo === record.type)
      if (sectionLists.length === 0) return access.admin ? <p className="note">No list is set up for this section yet.</p> : null
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
            canEdit={level === 'edit'}
          />
        )
      })
    }
    const sectionFields = section.fieldIds
      .map((fieldId) => fieldById.get(fieldId))
      .filter((field): field is FieldDefinition => Boolean(field) && field!.appliesTo === record.type && !field!.listId)
    const views = visibleViews(sectionFields, record, section.id)
    // An empty section is only worth showing to someone who can fill it.
    if (views.length === 0 && !access.admin) return null
    return <FieldGroup target={targetOf(record)} fields={views} style={section.displayStyle === 'tiles' ? 'tiles' : 'form'} canManageFields={isAdmin} />
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
    const assetUnplaced = visibleViews(unplacedFor('asset'), assetRecord, null)

    return (
      <>
        {assetSections.map((section) => {
          const body = sectionBody(section, assetRecord)
          return body ? (
            <section key={section.id} className="panel">
              <h2>{section.name}</h2>
              {body}
            </section>
          ) : null
        })}
        {assetUnplaced.length > 0 ? (
          <section className="panel">
            <h2>Other Fields</h2>
            <FieldGroup target={targetOf(assetRecord)} fields={assetUnplaced} canManageFields={isAdmin} />
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
              const propertyUnplaced = visibleViews(unplacedFor('property'), propertyRecord, null)
              return (
                <section key={property.id} className="panel record">
                  <div className="record-head">
                    <span className="record-kind">Property</span>
                    <h2>{property.name}</h2>
                    <span className="record-key" title="The permanent key used by agents and formulas">{propertyRecord.ref}</span>
                  </div>
                  {isFirstScreen ? (
                    <div className="record-addresses">
                      <AddressList addresses={addressRows(property.addresses)} canEdit={access.canAddRecords} />
                      {access.canAddRecords ? <AddAddressForm ownerType="property" ownerId={property.id} assetId={tree.id} typeAhead={addressTypeAhead} replacing={property.addresses.length > 0} /> : null}
                      {access.canAddRecords && [...property.addresses, ...property.buildings.flatMap((building) => building.addresses)].some((address) => address.latitude !== null && address.longitude !== null) ? (
                        <RefreshLocationButton propertyId={property.id} assetId={tree.id} />
                      ) : null}
                    </div>
                  ) : null}

                  {propertySections.map((section) => {
                    const body = sectionBody(section, propertyRecord)
                    return body ? (
                      <div key={section.id} className="record-group">
                        <h3>{section.name}</h3>
                        {body}
                      </div>
                    ) : null
                  })}
                  {propertyUnplaced.length > 0 ? (
                    <div className="record-group">
                      <h3>Other Fields</h3>
                      <FieldGroup target={targetOf(propertyRecord)} fields={propertyUnplaced} canManageFields={isAdmin} />
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
                        const buildingUnplaced = visibleViews(unplacedFor('building'), buildingRecord, null)
                        return (
                          <div key={building.id} className="subrecord">
                            <div className="record-head">
                              <span className="record-kind">Building</span>
                              <h3>{building.name}</h3>
                            </div>
                            {isFirstScreen ? (
                              <div className="record-addresses">
                                <AddressList addresses={addressRows(building.addresses)} canEdit={access.canAddRecords} />
                                {access.canAddRecords ? <AddAddressForm ownerType="building" ownerId={building.id} assetId={tree.id} typeAhead={addressTypeAhead} replacing={building.addresses.length > 0} /> : null}
                              </div>
                            ) : null}

                            {buildingSections.map((section) => {
                              const body = sectionBody(section, buildingRecord)
                              return body ? (
                                <div key={section.id} className="record-group">
                                  <h4>{section.name}</h4>
                                  {body}
                                </div>
                              ) : null
                            })}
                            {buildingUnplaced.length > 0 ? (
                              <div className="record-group">
                                <h4>Other Fields</h4>
                                <FieldGroup target={targetOf(buildingRecord)} fields={buildingUnplaced} canManageFields={isAdmin} />
                              </div>
                            ) : null}
                          </div>
                        )
                      })
                    : null}

                  {isFirstScreen && access.canAddRecords ? (
                    <div className="record-add">
                      <AddChildForm type="building" parentId={property.id} assetId={tree.id} />
                    </div>
                  ) : null}
                </section>
              )
            })
          : null}

        {isFirstScreen && access.canAddRecords ? (
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
      <div className="title-row">
        <div className="title-with-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {mainPhoto ? <img className="title-photo" src={`/api/photos/${mainPhoto.id}`} alt="" /> : null}
          <h1>{tree.name}</h1>
        </div>
        {orgRole === 'org:admin' ? <DeleteAssetButton assetId={tree.id} name={tree.name} contents={contents} /> : null}
      </div>
      <p className="lede">
        {propertyCount === 1 ? '1 property' : `${propertyCount} properties`}
        <span className="record-key" title="The permanent key used by agents and formulas">asset:{tree.key}</span>
      </p>

      <ScreenTabs
        screens={[
          ...screens.map((screen, index) => ({ key: screen.key, name: screen.name, content: screenContent(screen, index === 0) })),
          ...(access.canAddRecords
            ? [
                {
                  key: '_rentroll',
                  name: 'Rent Roll',
                  content: rentRollError ? (
                    <section className="panel notice">
                      <h2>Rent Roll</h2>
                      <p>{rentRollError}</p>
                    </section>
                  ) : (
                    <RentRollPanel
                      assetId={tree.id}
                      choices={rentRollChoices}
                      selectedId={rentRollSelected}
                      rows={rentRollRows}
                      canEdit={access.canAddRecords}
                      severalProperties={tree.properties.length > 1}
                    />
                  ),
                },
              ]
            : []),
          {
            key: '_map',
            name: 'Map',
            content: (
              <section className="panel">
                <h2>Map</h2>
                {mapPins.length === 0 ? (
                  <p className="empty">
                    No address on this asset has a map location yet.
                    {access.canAddRecords ? ' Add an address with the lookup, or use Find Location beside an address typed by hand.' : ''}
                  </p>
                ) : (
                  <>
                    <p className="note">
                      {mapPins.length === 1 ? 'One address is pinned.' : `${mapPins.length} addresses are pinned.`} Click a pin for its address. Scroll or use the + and − buttons to zoom.
                      {unpinned > 0 ? ` ${unpinned === 1 ? '1 address has' : `${unpinned} addresses have`} no map location yet${access.canAddRecords ? '; use Find Location beside it' : ''}.` : ''}
                    </p>
                    <AssetMap pins={mapPins} />
                  </>
                )}
              </section>
            ),
          },
          {
            key: '_photos',
            name: photos.length > 0 ? `Photos (${photos.length})` : 'Photos',
            content: (
              <PhotosPanel
                assetId={tree.id}
                photos={photoRows}
                canEdit={access.canAddRecords}
                categories={PHOTO_CATEGORIES.map((value) => ({ value, label: PHOTO_CATEGORY_LABELS[value] }))}
                documentCount={documents.length}
                pageSources={
                  access.canAddRecords
                    ? documents.map((document) => ({
                        id: document.id,
                        name: document.name,
                        // Leave out pages that are already among the photos as a page picture.
                        suggested: (planPages.get(document.id) ?? []).filter(
                          (entry) => !photos.some((photo) => photo.documentId === document.id && photo.page === entry.page && photo.fileName !== null),
                        ),
                      }))
                    : []
                }
                problem={photosError}
              />
            ),
          },
          {
            key: '_documents',
            name: 'Documents',
            content: documentsError ? (
              <section className="panel notice">
                <h2>Documents</h2>
                <p>{documentsError}</p>
              </section>
            ) : (
              <DocumentsPanel assetId={tree.id} documents={documentRows} canUpload={access.canAddRecords} maxMb={MAX_DOCUMENT_BYTES / 1024 / 1024} />
            ),
          },
        ]}
        initialKey={screenKey ?? ''}
        basePath={`/dashboard/assets/${tree.id}`}
      />
    </>
  )
}
