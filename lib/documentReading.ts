// Having the agent read a document: into an asset that exists, or into a new
// asset created from the document. Used by the Documents tab and by the chat
// agent, so both follow the same permissions and rules.
//
// Each reading takes three steps, so no database transaction is held open
// while Claude reads: claim the document, read it, then apply what was found.

import { getLease, leaseLabel, listTenantNames, listTenantQuestions, syncRentRoll, tenantsReady } from './tenants'
import { followAddressChange, pointOfProperty, type Point } from './locationFacts'
import { createAssetWithDefaults, fallbackPropertyType, propertyTypesOf } from './assets'
import { withOrg } from './db'
import { describeFailure, NO_PERMISSION, type Caller } from './documentRequests'
import { applyReading, attachDocument, failReading, getDocument, listCurrentValues, readDocumentFile, setDocumentLease, startReading, type Outcome } from './documents'
import { editText } from './fieldFormat'
import { extractableFields, extractableLists, NEW_RECORDS, newAssetRecords, readDocument, recordsOf, sectionByField, type DocumentAddress, type DocumentRentRoll, type Reading } from './extraction'
import { listFields } from './fields'
import { LOCATION_SOURCE, lookUpAddress } from './geocode'
import { listScreens } from './layout'
import { addDocumentRows, listLists, type DocumentRow } from './lists'
import { loadAccess } from './permissions'
import { extractPhotos } from './photoExtraction'
import { joinSpreads } from './photoJoin'
import { planPagesOf, saveDocumentPhotoNotes, savePhotosFromDocument, type PlanPage } from './photos'
import { getAssetTree, insertAddress, type Queryable } from './records'
import { listRentRollsIfAny, rivalRentRolls, saveRentRoll } from './rentRolls'
import { loadSkillsForAgent } from './skills'

export type ReadSuccess = {
  ok: true
  assetId: string
  assetName: string
  /** True when the asset was created by this reading. */
  created: boolean
  documentId: string
  documentName: string
  documentType: string | null
  summary: string | null
  counts: Record<Outcome, number>
  proposals: number
  skipped: number
  /** Entries added to lists: comments, critical dates and the like. */
  listRows: number
  /** Values the agent worked out from the document's figures, rather than found stated in it. */
  calculated: number
  /** Rows of the rent roll saved as a dated snapshot; 0 when the document has no rent roll. */
  rentRollRows: number
  /** Tenant names in the asset's rent rolls that look like an existing tenant and wait for a person to confirm. */
  tenantQuestions: number
  /** Street addresses set on properties and buildings from the document. */
  addresses: number
  /** Photos copied out of the document onto the asset. */
  photos: number
  /** Pages the agent marked as plans or maps. The browser draws these as pictures and adds them to the photos. */
  planPages: PlanPage[]
}
export type ReadOutcome = ReadSuccess | { ok: false; error: string; status: number }

const NOT_FOUND = 'That document could not be found.'
const busyMessage = (status: string) =>
  status === 'read' ? 'This document has already been read.' : 'This document is being read right now. Give it a few minutes.'

/**
 * Copies the document's photographs onto the asset, labeled with the agent's
 * notes. This is an extra: it runs after the reading has been saved, in its
 * own step, and a failure here (including the photos table not existing yet)
 * never fails the reading. Returns how many photos were added.
 */
async function addPhotos(caller: Caller, assetId: string, documentId: string, file: Buffer, reading: Reading, kind: string = 'pdf'): Promise<number> {
  if (kind !== 'pdf') return 0 // a workbook has no photographs to copy out
  // Kept on the document so plan pages can be added later too. On its own, because the column may not exist yet (migration 014).
  await withOrg(caller.orgId, (client) => saveDocumentPhotoNotes(client, caller.orgId, documentId, reading.photos)).catch((error) => console.error('Saving photo notes failed', error))
  try {
    const photos = await joinSpreads(await extractPhotos(file))
    if (photos.length === 0) return 0
    return await withOrg(caller.orgId, (client) =>
      savePhotosFromDocument(client, caller.orgId, caller.userId, { assetId, documentId, photos, notes: reading.photos, mainPage: reading.mainPhotoPage }),
    )
  } catch (error) {
    console.error('Saving photos from a document failed', error)
    return 0
  }
}

/**
 * Adds the list entries the agent found (comments, critical dates). Like the
 * photos this is an extra: if it fails, the entries are left out and the
 * values already saved in this step are kept.
 */
async function addListRows(client: Queryable, caller: Caller, document: { id: string; name: string }, rows: DocumentRow[]): Promise<number> {
  if (rows.length === 0) return 0
  try {
    await client.query('savepoint list_rows')
  } catch {
    return 0
  }
  try {
    const added = await addDocumentRows(client, caller.orgId, caller.userId, document, rows)
    await client.query('release savepoint list_rows')
    return added
  } catch (error) {
    console.error('Adding list entries from a document failed; continuing without them', error)
    await client.query('rollback to savepoint list_rows').catch(() => {})
    return 0
  }
}

/**
 * Saves the document's rent roll as a dated snapshot of its property. An
 * extra, like the list entries: behind a savepoint, so a failure here (or
 * migration 019 not run yet) never fails the reading. Returns the rows saved.
 */
async function addRentRoll(client: Queryable, caller: Caller, assetId: string, document: { id: string; name: string }, rentRoll: DocumentRentRoll | null): Promise<number> {
  if (!rentRoll || rentRoll.rows.length === 0) return 0
  try {
    await client.query('savepoint rent_roll')
  } catch {
    return 0
  }
  try {
    const owned = await client.query('select 1 as found from properties where id = $1 and org_id = $2 and asset_id = $3', [rentRoll.recordId, caller.orgId, assetId])
    if (owned.rows.length === 0) {
      await client.query('release savepoint rent_roll')
      return 0
    }
    await saveRentRoll(client, caller.orgId, caller.userId, {
      assetId,
      propertyId: rentRoll.recordId,
      document,
      asOfDate: rentRoll.asOfDate,
      stated: rentRoll.stated,
      rows: rentRoll.rows,
      tenantsDecided: rentRoll.tenantsDecided,
      leaseMatch: rentRoll.leaseMatch,
    })
    await client.query('release savepoint rent_roll')
    return rentRoll.rows.length
  } catch (error) {
    console.error('Saving a rent roll from a document failed; continuing without it', error)
    await client.query('rollback to savepoint rent_roll').catch(() => {})
    return 0
  }
}

/**
 * Works out the units, tenants and leases of the rent roll a document was
 * saved as. An extra, in its own step after the reading is saved: a failure
 * here (or migration 024 not run yet) never fails the reading. Returns how
 * many tenant names of the asset are waiting to be confirmed.
 */
async function addTenants(caller: Caller, assetId: string, documentId: string, rentRollRows: number): Promise<number> {
  if (rentRollRows === 0) return 0
  try {
    return await withOrg(caller.orgId, async (client) => {
      if (!(await tenantsReady(client))) return 0
      const saved = await client.query('select id::text as id from rent_rolls where org_id = $1 and document_id = $2', [caller.orgId, documentId])
      for (const rentRoll of saved.rows) await syncRentRoll(client, caller.orgId, caller.userId, rentRoll.id)
      return (await listTenantQuestions(client, caller.orgId, assetId)).length
    })
  } catch (error) {
    console.error('Building tenants and leases from a rent roll failed; the rent roll itself is saved', error)
    return 0
  }
}

const sameStreet = (a: string | null, b: string | null) => (a ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === (b ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Sets the street addresses the document states, each with its place on the
 * map when the lookup knows it. A property or building keeps a street address
 * it already has; only a missing one, or the city-only one a new asset starts
 * with, is filled in. A building's address is skipped when it is the same as
 * its property's. Like the photos this is an extra, in its own step: a
 * failure here never fails the reading. Returns how many were set.
 */
export async function addAddresses(caller: Caller, assetId: string, found: DocumentAddress[]): Promise<number> {
  if (found.length === 0) return 0
  try {
    // Look them up first, with no database transaction open. An address the lookup doesn't know is saved as the document wrote it.
    const located = await Promise.all(
      found.slice(0, 6).map(async (address) => {
        const line = [address.street, address.city, [address.state, address.postalCode?.slice(0, 5)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
        const result = await lookUpAddress(line, 6000)
        return { address, match: result.ok ? result.matches[0] ?? null : null }
      }),
    )
    const before = new Map<string, Point | null>()
    const added = await withOrg(caller.orgId, async (client) => {
      const tree = await getAssetTree(client, caller.orgId, assetId)
      if (!tree) return 0
      let added = 0
      // Properties first, so a building can be compared with its property's new address.
      const propertyStreet = new Map<string, string | null>()
      for (const type of ['property', 'building'] as const) {
        for (const { address, match } of located) {
          if (address.recordType !== type) continue
          const property = tree.properties.find((candidate) => (type === 'property' ? candidate.id === address.recordId : candidate.buildings.some((building) => building.id === address.recordId)))
          if (!property) continue
          const current = type === 'property' ? property.addresses : property.buildings.find((building) => building.id === address.recordId)!.addresses
          const street = match?.street ?? address.street
          if (type === 'property') propertyStreet.set(property.id, current.find((existing) => existing.street)?.street ?? street)
          if (current.some((existing) => existing.street)) continue
          if (type === 'building' && sameStreet(propertyStreet.get(property.id) ?? property.addresses.find((existing) => existing.street)?.street ?? null, street)) continue
          if (!before.has(property.id)) before.set(property.id, await pointOfProperty(client, caller.orgId, property.id))
          const saved = await insertAddress(client, caller.orgId, caller.userId, type, address.recordId, {
            street,
            suite: null,
            city: match?.city ?? address.city,
            state: match?.state ?? address.state,
            postalCode: match?.postalCode ?? address.postalCode,
            latitude: match?.latitude ?? null,
            longitude: match?.longitude ?? null,
            locationSource: match ? LOCATION_SOURCE : null,
          })
          if (saved) added += 1
        }
      }
      return added
    })
    // A property that now sits somewhere new on the map gets its Location fields looked up.
    for (const [propertyId, point] of before) await followAddressChange(caller.orgId, caller.userId, propertyId, point)
    return added
  } catch (error) {
    console.error('Setting addresses from a document failed', error)
    return 0
  }
}

async function giveUp(caller: Caller, documentId: string, error: string, status = 502): Promise<ReadOutcome> {
  await withOrg(caller.orgId, (client) => failReading(client, caller.orgId, documentId, error)).catch((failure) => console.error('Recording a failed reading failed', failure))
  return { ok: false, error, status }
}

/**
 * Reads a document into an asset that exists. The document must already
 * belong to that asset, or belong to none yet, in which case pass `assetId`
 * to tie it to one. The agent is only given the fields the person may change.
 */
export async function readIntoAsset(caller: Caller, documentId: string, assetId: string | null = null, timeoutMs?: number): Promise<ReadOutcome> {
  const { orgId, userId } = caller
  // A document that was loaded onto a lease is read into that lease, wherever the reading is started from.
  const leaseId = await withOrg(orgId, async (client) => (await getDocument(client, orgId, documentId))?.leaseId ?? null).catch(() => null)
  if (leaseId) return readIntoLease(caller, documentId, leaseId, timeoutMs)
  let prepared
  try {
    prepared = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, caller.isAdmin)
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION, status: 403 }
      const document = await getDocument(client, orgId, documentId)
      if (!document || document.status === 'uploading') return { ok: false as const, error: NOT_FOUND, status: 404 }
      const targetId = document.assetId ?? assetId
      if (!targetId) return { ok: false as const, error: 'Say which asset this document belongs to.', status: 400 }
      if (assetId && document.assetId && document.assetId !== assetId) return { ok: false as const, error: 'That document already belongs to a different asset.', status: 400 }
      const tree = await getAssetTree(client, orgId, targetId)
      if (!tree) return { ok: false as const, error: 'That asset could not be found.', status: 404 }
      if (!(await startReading(client, orgId, userId, documentId))) return { ok: false as const, error: busyMessage(document.status), status: 409 }
      if (!document.assetId) await attachDocument(client, orgId, documentId, targetId)
      const file = await readDocumentFile(client, orgId, documentId)
      const allFields = await listFields(client, orgId)
      const fields = extractableFields(allFields, sectionByField(await listScreens(client, orgId)), access.fieldLevel)
      const lists = extractableLists(await listLists(client, orgId), allFields, access.sectionLevel)
      const savedRentRolls = await listRentRollsIfAny(client, orgId, tree.id)
      // What the records hold now and where it came from, for the skills that say which source wins. Only fields the agent is offered.
      const offered = new Map(fields.map((field) => [field.id, field]))
      const current = (await listCurrentValues(client, orgId, recordsOf(tree).map((record) => record.id))).filter((value) => offered.has(value.fieldId))
      return { ok: true as const, document, tree, file, fields, lists, savedRentRolls, current, tenants: await listTenantNames(client, orgId), skills: await loadSkillsForAgent(client, orgId) }
    })
  } catch (error) {
    console.error('Preparing to read a document failed', error)
    return { ok: false, error: describeFailure(error, 'The document could not be opened. Try again.'), status: 500 }
  }
  if (!prepared.ok) return prepared
  const { document, tree } = prepared
  if (!prepared.file) return giveUp(caller, documentId, 'The file for this document is missing. Upload it again.', 500)

  const records = recordsOf(tree)
  // The rent rolls already saved for this asset, by the same record addresses the agent is given (the newest 30).
  const savedRentRolls = prepared.savedRentRolls.slice(0, 30).flatMap((saved) => {
    const record = records.find((entry) => entry.id === saved.propertyId)
    return record && saved.documentId !== documentId ? [{ record: record.ref, asOfDate: saved.asOfDate, asOfStated: saved.asOfStated, documentName: saved.documentName, rowCount: saved.rowCount }] : []
  })
  const currentValues = prepared.current.flatMap((value) => {
    const record = records.find((entry) => entry.id === value.recordId)
    const field = prepared.fields.find((entry) => entry.id === value.fieldId)
    return record && field ? [{ record: record.ref, fieldKey: field.key, month: value.period ? value.period.slice(0, 7) : null, value: editText(field, value.value), source: value.source }] : []
  })
  const result = await readDocument({ file: prepared.file, kind: document.kind, documentName: document.name, records, fields: prepared.fields, lists: prepared.lists, savedRentRolls, tenants: prepared.tenants, currentValues, skills: prepared.skills, timeoutMs })
  if (!result.ok) return giveUp(caller, documentId, result.error)

  try {
    const { counts, listRows, rentRollRows } = await withOrg(orgId, async (client) => {
      // A second rent roll for the same property and date: the one with the most rows supplies the property's values.
      const rentRoll = result.reading.rentRoll
      const byRows = rentRoll ? await rivalRentRolls(client, orgId, { propertyId: rentRoll.recordId, asOfDate: rentRoll.asOfDate, rowCount: rentRoll.rows.length, documentId }) : null
      // Which one is the main rent roll is the agent's answer under the rent roll skill; without one, the most rows.
      const others = byRows ? [...byRows.larger, ...byRows.smaller] : []
      const rivals = !byRows ? null : rentRoll?.role === 'main' ? { larger: [], smaller: others } : rentRoll?.role === 'secondary' ? { larger: others, smaller: [] } : byRows
      const applied = await applyReading(client, orgId, userId, { id: documentId, name: document.name }, result.reading, rivals)
      const entries = await addListRows(client, caller, { id: documentId, name: document.name }, result.reading.rows)
      return { counts: applied, listRows: entries, rentRollRows: await addRentRoll(client, caller, tree.id, { id: documentId, name: document.name }, result.reading.rentRoll) }
    })
    const addresses = await addAddresses(caller, tree.id, result.reading.addresses)
    const tenantQuestions = await addTenants(caller, tree.id, documentId, rentRollRows)
    const photos = await addPhotos(caller, tree.id, documentId, prepared.file, result.reading, document.kind)
    return {
      ok: true,
      assetId: tree.id,
      assetName: tree.name,
      created: false,
      documentId,
      documentName: document.name,
      documentType: result.reading.documentType,
      summary: result.reading.summary,
      counts,
      proposals: result.reading.proposals.length,
      skipped: result.reading.skipped,
      listRows,
      calculated: result.reading.candidates.filter((candidate) => candidate.basis === 'calculated').length,
      rentRollRows,
      tenantQuestions,
      addresses,
      photos,
      planPages: planPagesOf(result.reading.photos),
    }
  } catch (error) {
    console.error('Applying a reading failed', error)
    return giveUp(caller, documentId, describeFailure(error, 'The findings could not be saved. Try reading the document again.'), 500)
  }
}

/**
 * Reads a lease agreement (or an amendment, a commencement letter, a
 * guaranty) into one lease. The agent is given the lease's fields the person
 * may change, what they hold now, and the property's lists, so it can add the
 * lease's critical dates there. Nothing else is taken from the document: no
 * rent roll, address or photographs.
 */
export async function readIntoLease(caller: Caller, documentId: string, leaseId: string, timeoutMs?: number): Promise<ReadOutcome> {
  const { orgId, userId } = caller
  let prepared
  try {
    prepared = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, caller.isAdmin)
      if (!access.canAddRecords) return { ok: false as const, error: NO_PERMISSION, status: 403 }
      const document = await getDocument(client, orgId, documentId)
      if (!document || document.status === 'uploading') return { ok: false as const, error: NOT_FOUND, status: 404 }
      if (!(await tenantsReady(client))) return { ok: false as const, error: 'Leases need a database update: run db/migrations/024_tenants_and_leases.sql.', status: 409 }
      const lease = await getLease(client, orgId, leaseId)
      if (!lease) return { ok: false as const, error: 'That lease could not be found.', status: 404 }
      if (document.assetId && document.assetId !== lease.assetId) return { ok: false as const, error: 'That document belongs to a different asset.', status: 400 }
      if (document.leaseId && document.leaseId !== leaseId) return { ok: false as const, error: 'That document was loaded onto a different lease.', status: 400 }
      const tree = await getAssetTree(client, orgId, lease.assetId)
      if (!tree) return { ok: false as const, error: 'That asset could not be found.', status: 404 }
      const allFields = await listFields(client, orgId)
      const sections = sectionByField(await listScreens(client, orgId))
      const fields = allFields.filter((field) => field.appliesTo === 'lease' && !field.listId && access.fieldLevel(field.id, sections.get(field.id) ?? null) === 'edit')
      if (fields.length === 0) {
        return { ok: false as const, error: allFields.some((field) => field.appliesTo === 'lease') ? 'There are no lease fields you can change, so there is nothing to fill in.' : 'Lease fields need a database update: run db/migrations/028_lease_fields.sql.', status: 409 }
      }
      if (!(await startReading(client, orgId, userId, documentId))) return { ok: false as const, error: busyMessage(document.status), status: 409 }
      if (!document.assetId) await attachDocument(client, orgId, documentId, lease.assetId)
      if (!document.leaseId) await setDocumentLease(client, orgId, documentId, leaseId)
      const file = await readDocumentFile(client, orgId, documentId)
      // Critical dates from a lease go on the lease's property.
      const lists = extractableLists(await listLists(client, orgId), allFields, access.sectionLevel).filter((entry) => entry.list.appliesTo === 'property')
      const current = await listCurrentValues(client, orgId, [leaseId])
      return { ok: true as const, document, lease, tree, file, fields, lists, current, skills: await loadSkillsForAgent(client, orgId) }
    })
  } catch (error) {
    console.error('Preparing to read a lease document failed', error)
    return { ok: false, error: describeFailure(error, 'The document could not be opened. Try again.'), status: 500 }
  }
  if (!prepared.ok) return prepared
  const { document, lease, tree } = prepared
  if (!prepared.file) return giveUp(caller, documentId, 'The file for this document is missing. Upload it again.', 500)

  const leaseRef = `lease:${lease.id}`
  const property = recordsOf(tree).find((record) => record.id === lease.propertyId)
  const records = [
    { type: 'lease' as const, id: lease.id, ref: leaseRef, label: `Lease: ${leaseLabel(lease)} at ${lease.propertyName} (the lease this document was loaded onto; every value belongs here)` },
    ...(property && prepared.lists.length > 0 ? [property] : []),
  ]
  const currentValues = prepared.current.flatMap((value) => {
    const field = prepared.fields.find((entry) => entry.id === value.fieldId)
    return field ? [{ record: leaseRef, fieldKey: field.key, month: null, value: editText(field, value.value), source: value.source }] : []
  })
  const result = await readDocument({ file: prepared.file, kind: document.kind, documentName: document.name, records, fields: prepared.fields, lists: prepared.lists, currentValues, skills: prepared.skills, timeoutMs })
  if (!result.ok) return giveUp(caller, documentId, result.error)

  try {
    const { counts, listRows } = await withOrg(orgId, async (client) => {
      const reading = { ...result.reading, candidates: result.reading.candidates.filter((candidate) => candidate.recordType === 'lease' && candidate.recordId === lease.id), proposals: [] }
      const applied = await applyReading(client, orgId, userId, { id: documentId, name: document.name }, reading)
      return { counts: applied, listRows: await addListRows(client, caller, { id: documentId, name: document.name }, result.reading.rows) }
    })
    return {
      ok: true,
      assetId: tree.id,
      assetName: tree.name,
      created: false,
      documentId,
      documentName: document.name,
      documentType: result.reading.documentType,
      summary: result.reading.summary,
      counts,
      proposals: 0,
      skipped: result.reading.skipped,
      listRows,
      calculated: 0,
      rentRollRows: 0,
      tenantQuestions: 0,
      addresses: 0,
      photos: 0,
      planPages: [],
    }
  } catch (error) {
    console.error('Applying a lease reading failed', error)
    return giveUp(caller, documentId, describeFailure(error, 'The findings could not be saved. Try reading the document again.'), 500)
  }
}

/**
 * Creates an asset from a document that belongs to no asset yet: the agent
 * reads the document once, the asset (with one property and one building) is
 * created from its name, property type and city, and everything else it found
 * goes through the same rules and review list as any other reading.
 */
export async function createAssetFromDocument(caller: Caller, documentId: string, timeoutMs?: number): Promise<ReadOutcome> {
  const { orgId, userId } = caller
  let prepared
  try {
    prepared = await withOrg(orgId, async (client) => {
      const access = await loadAccess(client, orgId, userId, caller.isAdmin)
      if (!access.canAddRecords) return { ok: false as const, error: "You don't have permission to add assets. Ask an administrator for a role that can edit.", status: 403 }
      const document = await getDocument(client, orgId, documentId)
      if (!document || document.status === 'uploading') return { ok: false as const, error: NOT_FOUND, status: 404 }
      if (document.assetId) return { ok: false as const, error: 'That document already belongs to an asset.', status: 400 }
      if (!(await startReading(client, orgId, userId, documentId))) return { ok: false as const, error: busyMessage(document.status), status: 409 }
      const file = await readDocumentFile(client, orgId, documentId)
      const allFields = await listFields(client, orgId)
      const fields = extractableFields(allFields, sectionByField(await listScreens(client, orgId)), access.fieldLevel)
      const lists = extractableLists(await listLists(client, orgId), allFields, access.sectionLevel)
      return { ok: true as const, document, file, fields, lists, propertyTypes: propertyTypesOf(allFields), tenants: await listTenantNames(client, orgId), skills: await loadSkillsForAgent(client, orgId) }
    })
  } catch (error) {
    console.error('Preparing to read a document failed', error)
    return { ok: false, error: describeFailure(error, 'The document could not be opened. Try again.'), status: 500 }
  }
  if (!prepared.ok) return prepared
  const { document } = prepared
  if (!prepared.file) return giveUp(caller, documentId, 'The file for this document is missing. Upload it again.', 500)

  const result = await readDocument({ file: prepared.file, kind: document.kind, documentName: document.name, records: newAssetRecords(), fields: prepared.fields, lists: prepared.lists, newAsset: true, propertyTypes: prepared.propertyTypes, tenants: prepared.tenants, skills: prepared.skills, timeoutMs })
  if (!result.ok) return giveUp(caller, documentId, result.error)
  const described = result.newAsset
  const name = (described?.name || document.name.replace(/\.(pdf|xlsx|xlsm)$/i, '')).slice(0, 200)

  try {
    const created = await withOrg(orgId, async (client) => {
      const assetId = await createAssetWithDefaults(client, orgId, userId, { name, propertyType: described?.propertyType ?? fallbackPropertyType(prepared.propertyTypes), city: described?.city ?? null }, { id: documentId, name: document.name })
      const tree = await getAssetTree(client, orgId, assetId)
      const property = tree?.properties[0]
      const building = property?.buildings[0]
      if (!tree || !property || !building) throw new Error('The new asset could not be read back')
      await attachDocument(client, orgId, documentId, assetId)
      // Point everything the agent found at the records that now exist.
      const real: Record<string, string> = { [NEW_RECORDS.asset]: assetId, [NEW_RECORDS.property]: property.id, [NEW_RECORDS.building]: building.id }
      const reading = {
        ...result.reading,
        candidates: result.reading.candidates.map((candidate) => ({ ...candidate, recordId: real[candidate.recordId] ?? candidate.recordId })),
        proposals: result.reading.proposals.map((proposal) => ({ ...proposal, recordId: real[proposal.recordId] ?? proposal.recordId })),
        rows: result.reading.rows.map((row) => ({ ...row, recordId: real[row.recordId] ?? row.recordId })),
        addresses: result.reading.addresses.map((address) => ({ ...address, recordId: real[address.recordId] ?? address.recordId })),
        rentRoll: result.reading.rentRoll ? { ...result.reading.rentRoll, recordId: real[result.reading.rentRoll.recordId] ?? result.reading.rentRoll.recordId } : null,
      }
      const counts = await applyReading(client, orgId, userId, { id: documentId, name: document.name }, reading)
      const listRows = await addListRows(client, caller, { id: documentId, name: document.name }, reading.rows)
      const rentRollRows = await addRentRoll(client, caller, assetId, { id: documentId, name: document.name }, reading.rentRoll)
      return {
        ok: true as const,
        assetId,
        assetName: tree.name,
        created: true,
        documentId,
        documentName: document.name,
        documentType: reading.documentType,
        summary: reading.summary,
        counts,
        proposals: reading.proposals.length,
        skipped: reading.skipped,
        listRows,
        calculated: reading.candidates.filter((candidate) => candidate.basis === 'calculated').length,
        rentRollRows,
        tenantQuestions: 0,
        addresses: 0,
        found: reading.addresses,
        photos: 0,
        planPages: planPagesOf(reading.photos),
      }
    })
    const { found, ...success } = created
    const addresses = await addAddresses(caller, created.assetId, found)
    const tenantQuestions = await addTenants(caller, created.assetId, documentId, created.rentRollRows)
    return { ...success, addresses, tenantQuestions, photos: await addPhotos(caller, created.assetId, documentId, prepared.file, result.reading, document.kind) }
  } catch (error) {
    console.error('Creating an asset from a document failed', error)
    return giveUp(caller, documentId, describeFailure(error, 'The asset could not be created from this document. Try again.'), 500)
  }
}
