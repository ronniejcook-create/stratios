// The Portfolio Analyst: the chat agent in the right-hand column.
//
// It talks with the person and can use a small set of tools. Every tool runs
// as the signed-in person, inside their organization and with their
// permissions, so the agent can never see or change more than they can.

import { documentsForAgent, leaseForAgent, listsForAgent, rebuildLeasesForAgent, rentRollForAgent, ruleTenantForAgent, searchPortfolio, tenantsForAgent, type Lookup } from './agentLookups'
import { setValueForAgent } from './agentValues'
import { buildAnalystPrompt, DEFAULT_ANALYST_INSTRUCTIONS, getAnalystInstructions } from './analystInstructions'
import { createAssetWithDefaults, fallbackPropertyType, listPropertyTypes, matchPropertyType } from './assets'
import { ApiError, claudeApiKey, converse, type ChatMessage, type ContentBlock, type ToolDefinition } from './claude'
import { withOrg } from './db'
import { createAssetFromDocument, readIntoAsset, readIntoLease, type ReadOutcome } from './documentReading'
import { findLease, leaseLabel, listLeases, tenantsReady } from './tenants'
import type { Caller } from './documentRequests'
import { sectionByField } from './extraction'
import { formatPeriod, formatValue } from './fieldFormat'
import { listFields, listSourceTypes, listValues } from './fields'
import { listScreens } from './layout'
import { loadAccess } from './permissions'
import { formatAddress, getAssetTree, isUuid, listAssets, RECORD_LABELS, type Address } from './records'
import { calculateKpis, describeKpiRuns } from './kpis'
import { CASH_FLOW_COLUMN_LABELS, CASH_FLOW_SECTION_LABELS, cashFlowsReady, columnSums, listCashFlowLines, listCashFlows, periodLabel, periodTotals } from './cashFlows'
import { loadSkillsForAgent, skillIndex, type Skill } from './skills'
import { isSurroundingTopic, lookUpSurroundings, SURROUNDING_TOPICS } from './surroundings'

export type AgentTurn = { role: 'user' | 'assistant'; text: string; attachments?: { id: string; name: string }[] }
export type AgentLink = { label: string; href: string }
/** Pages of a document for the browser to draw as pictures and add to an asset's photos (plans and maps). */
export type AgentPages = { assetId: string; documentId: string; pages: { page: number; caption: string | null }[] }
/** A document whose operating statement the browser asks to have copied as a cash flow, once the agent has answered. */
export type AgentStatement = { assetId: string; documentId: string }
export type AgentReply = { ok: true; text: string; links: AgentLink[]; changed: boolean; pages?: AgentPages[]; kpis?: string[]; statements?: AgentStatement[] } | { ok: false; error: string }

const MAX_TURNS = 40
const MAX_STEPS = 18
/** Leaves room inside the web host's five-minute limit for the conversation steps around a document reading. */
const TIME_BUDGET_MS = 285000

const TOOLS: ToolDefinition[] = [
  {
    name: 'create_asset_from_document',
    description:
      'Creates a new asset from an attached document (for example an Offering Memorandum): reads the document, creates the asset with one property and one building from its name, property type and city, fills in the fields the document gives values for, and builds a review list. Use when the person asks to create, add or set up an asset from a document they attached. Takes a few minutes.',
    input_schema: { type: 'object', properties: { document_id: { type: 'string', description: 'The id of the attached document' } }, required: ['document_id'], additionalProperties: false },
  },
  {
    name: 'read_document_into_asset',
    description:
      'Reads an attached document and fills in the fields of an asset that already exists, following each field\'s rules, and builds a review list. Use when the person attaches a document about an existing asset, or asks to update an asset from a document. Takes a few minutes.',
    input_schema: {
      type: 'object',
      properties: { document_id: { type: 'string', description: 'The id of the attached document' }, asset_id: { type: 'string', description: 'The id of the asset, from list_assets or the page the person is on' } },
      required: ['document_id', 'asset_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_asset',
    description: 'Creates a new, empty asset with one property and one building, when the person gives its details in words and no document. The property type must be one the organization lists; if the one given is not listed, the tool answers with the list.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, property_type: { type: 'string', description: 'For example Office, Industrial, Retail, Residential, Hotel or Other' }, city: { type: 'string', description: 'Empty if not given' } },
      required: ['name', 'property_type', 'city'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_assets',
    description: 'Lists the organization\'s assets with their ids, property types and cities. Use to find an asset the person names.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_asset',
    description: 'Returns one asset\'s properties and buildings, the street address of each and whether it has a map location, and the current value of every field the person is allowed to see. Use to answer questions about an asset.',
    input_schema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'], additionalProperties: false },
  },
  {
    name: 'look_up_surroundings',
    description:
      'Looks up what is around an asset\'s address from public sources, the same ones as the asset\'s Map tab: nearby schools and the school district, transit stops and routes, the FEMA flood zone, natural hazard ratings, jobs and commuting, and Census demographics within 1, 3 and 5 miles. Use for questions such as the closest school, the nearest rail station, whether a property is in a flood zone, or how many people live nearby. Ask only for the topics the question needs. Nothing is saved on the asset. The asset needs an address with a map location.',
    input_schema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        topics: { type: 'array', items: { type: 'string', enum: [...SURROUNDING_TOPICS] }, description: 'One or more topics' },
        record_name: { type: 'string', description: 'The property or building to look around, when the asset has several addresses. Leave out to use the first property with a map location.' },
      },
      required: ['asset_id', 'topics'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_field_value',
    description:
      'Sets or changes the value of one field on an asset, its property or a building, exactly as if the person typed it on the asset page. Use only when the person asks in this conversation for a value to be entered or changed, and only with the value they gave or one a tool returned. It is saved under their name as Manual Entry and recorded in the field\'s history. Calculated fields and list entries (comments, critical dates) cannot be set this way.',
    input_schema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        field: { type: 'string', description: 'The field\'s name exactly as get_asset lists it' },
        value: { type: 'string', description: 'The value as a person would type it: 52000 for a number or money, 5.25 for a percent, 2026-03-31 for a date, Yes or No, or the text. Empty only together with clear.' },
        record_name: { type: 'string', description: 'The name of the property or building, needed only when the asset has more than one the field could belong to' },
        month: { type: 'string', description: 'YYYY-MM, only for a field kept month by month' },
        clear: { type: 'boolean', description: 'True to empty the field when the person asks for that' },
      },
      required: ['asset_id', 'field', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_lease_document',
    description:
      'Reads an attached lease agreement, lease amendment, commencement date letter, assignment or guaranty for ONE tenant into that tenant\'s lease, filling in the lease\'s own fields (term, rent, options, recoveries, restrictions, security and so on) and adding its critical dates to the property. Use this, not read_document_into_asset, whenever the document is a lease or an amendment to one. Give the tenant\'s name and the suite or unit as far as the person or the file name tells you; if they are not known, give what you have and the tool lists the asset\'s leases to choose from. It can also be used on a document already read with read_document_into_asset that turned out to be a lease. Takes a few minutes.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'The id of the attached document' },
        asset_id: { type: 'string', description: 'The id of the asset the lease is in, from list_assets or the page the person is on' },
        tenant: { type: 'string', description: 'The tenant\'s name, or the part of it that is known; empty if not known' },
        unit: { type: 'string', description: 'The suite or unit number; empty if not known' },
      },
      required: ['document_id', 'asset_id', 'tenant', 'unit'],
      additionalProperties: false,
    },
  },
  {
    name: 'recalculate_kpis',
    description:
      'Calculates an asset\'s KPIs again from its stored leases and latest rent roll, following the KPI skill that fits each property\'s kind (commercial and residential properties have different KPIs). Use when the person asks to calculate, recalculate or refresh KPIs, for example after confirming tenant names. It takes up to a minute or two. A figure a document shows or a person entered is never overwritten; such values are reported as kept. After a rent roll is read this already runs by itself, so do not call it then.',
    input_schema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'], additionalProperties: false },
  },
  {
    name: 'rebuild_leases',
    description:
      'Rebuilds an asset\'s units, tenants and leases from its rent rolls, and reports what changed. Use it when a lease looks out of step with the rent rolls: marked Past although the latest rent roll shows the tenant, missing, or showing old terms. It changes nothing in the rent rolls themselves and is safe to run at any time. If it reports that nothing changed and the tenant still has no active lease, use set_tenant_ruling.',
    input_schema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'], additionalProperties: false },
  },
  {
    name: 'set_tenant_ruling',
    description:
      'Records the person\'s ruling that a name written in the rent rolls IS a tenant (for example a tenant on free rent, or one that pays only electricity, that a reading marked as space the owner uses) or is NOT a tenant (for example a management office that was given a lease). The ruling is kept, comes before the reading agent\'s own call in every rent roll loaded before or after, and the leases are brought up to date at once. Use it only when the person asks for the fix or agrees to it in this conversation. Give the name as the rent roll writes it (get_rent_roll shows it).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name as written in the rent roll' },
        is_tenant: { type: 'boolean', description: 'true: it is a tenant. false: it is not a tenant.' },
        asset_id: { type: 'string', description: 'The asset whose rent rolls write the name; empty to look in every asset' },
      },
      required: ['name', 'is_tenant', 'asset_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_portfolio',
    description:
      'Searches everything Stratios holds for a name or phrase: assets and properties, tenants and their leases, names written in rent rolls, documents, and the text of fields, comments and critical dates. Use it FIRST whenever the person asks whether something or someone is in the system, asks about a name you have not already seen in a tool result, or asks where to find something. Search for the distinctive word alone (for example "Keeks"), not a whole sentence. Each match says where it was found, and buttons to open those screens are shown under your reply.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'One or two distinctive words' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'list_tenants',
    description:
      'Returns the complete list of tenants with every lease each holds (unit, square feet, lease dates, rent, active or past), for one asset or, with no asset_id, for the whole organization, plus the names waiting to be confirmed. Use for any question about who the tenants are, how many there are, who leases a unit, lease expirations or rents by tenant. get_asset does not list tenants.',
    input_schema: { type: 'object', properties: { asset_id: { type: 'string', description: 'Leave out for every asset' } }, additionalProperties: false },
  },
  {
    name: 'get_lease',
    description:
      'Returns one lease in full: its terms from the rent roll, every lease field read from its lease agreement (term, rent, options, recoveries, restrictions, security and so on), and the documents loaded on it. Give the tenant, the unit, or both. Use for questions about a particular tenant\'s lease.',
    input_schema: {
      type: 'object',
      properties: { asset_id: { type: 'string', description: 'Leave out to look across every asset' }, tenant: { type: 'string', description: 'The tenant\'s name or part of it; empty if not known' }, unit: { type: 'string', description: 'The suite or unit; empty if not known' } },
      required: ['tenant', 'unit'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_rent_roll',
    description: 'Returns every row of an asset\'s latest rent roll as its document shows it (unit, floor, tenant as written, leased or vacant, square feet, lease dates, rents), and the dates of the other rent rolls on file. Use for questions about vacant space, a unit, or what the rent roll itself says.',
    input_schema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'], additionalProperties: false },
  },
  {
    name: 'get_dates_and_commentary',
    description: 'Returns the entries of an asset\'s lists: its critical dates, its comments, and any list the organization added, for the asset and each of its properties. get_asset does not include these.',
    input_schema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'], additionalProperties: false },
  },
  {
    name: 'list_documents',
    description: 'Lists the documents loaded on an asset, newest first: name, kind (offering memorandum, rent roll, lease and so on), when it was uploaded, whether it has been read, and its summary.',
    input_schema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'], additionalProperties: false },
  },
  {
    name: 'get_cash_flow',
    description:
      'Returns an asset\'s stored cash flow: an operating statement (for example a trailing twelve months) copied line by line from a document, with income, operating expenses and net operating income for each month and every line item. Use for questions about income, expenses or net operating income over time, or about one line such as utilities or real estate taxes. It lists the statements on file and returns the latest in full; give statement_number to get another from that list. Every figure is as the document shows it.',
    input_schema: {
      type: 'object',
      properties: { asset_id: { type: 'string' }, statement_number: { type: 'integer', description: 'Which statement from the list, 1 for the latest. Leave out for the latest.' } },
      required: ['asset_id'],
      additionalProperties: false,
    },
  },
]

type Session = { caller: Caller; links: AgentLink[]; changed: boolean; deadline: number; documentIds: Set<string>; skills: Skill[]; pages: AgentPages[]; kpis: string[]; statements: AgentStatement[] }

const READ_SKILL: ToolDefinition = {
  name: 'read_skill',
  description: 'Opens one skill from the Stratios skills library and returns its instructions. Use before doing or answering something a listed skill covers.',
  input_schema: { type: 'object', properties: { name: { type: 'string', description: 'The skill\'s name, copied from the list' } }, required: ['name'], additionalProperties: false },
}

const asText = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** How an address is shown to the analyst: the text, and whether the map lookups can use it. */
function describeAddress(address: Address) {
  return { address: formatAddress(address), has_map_location: address.latitude !== null && address.longitude !== null }
}

function describeReading(session: Session, result: ReadOutcome): string {
  if (!result.ok) return JSON.stringify({ ok: false, error: result.error })
  session.changed = true
  if (result.planPages.length > 0) session.pages.push({ assetId: result.assetId, documentId: result.documentId, pages: result.planPages })
  session.links.push({ label: `Open ${result.assetName}`, href: `/dashboard/assets/${result.assetId}` })
  session.links.push({ label: 'Review What Was Found', href: `/dashboard/assets/${result.assetId}/documents/${result.documentId}` })
  if (result.rentRollRows > 0) session.links.push({ label: 'Open Rent Roll', href: `/dashboard/assets/${result.assetId}?screen=_rentroll` })
  if (result.rentRollRows > 0 && result.tenantQuestions > 0) session.links.push({ label: 'Confirm Tenants', href: `/dashboard/assets/${result.assetId}?screen=_leases` })
  // The KPIs are calculated from the new leases next, by the browser, so this turn is not held up by it.
  if (result.rentRollRows > 0 && !session.kpis.includes(result.assetId)) session.kpis.push(result.assetId)
  // An operating statement is copied line by line as a cash flow next, by the browser too.
  if (result.operatingStatement) {
    if (!session.statements.some((entry) => entry.documentId === result.documentId)) session.statements.push({ assetId: result.assetId, documentId: result.documentId })
    session.links.push({ label: 'Open Cash Flow', href: `/dashboard/assets/${result.assetId}?screen=_cashflow` })
  }
  return JSON.stringify({
    ok: true,
    asset_created: result.created,
    asset_name: result.assetName,
    asset_id: result.assetId,
    document: result.documentName,
    document_type: result.documentType,
    document_summary: result.summary,
    values_filled_in: result.counts.filled,
    values_replaced: result.counts.replaced,
    values_confirmed: result.counts.confirmed,
    values_waiting_for_a_decision: result.counts.decision,
    values_kept_because_the_field_never_replaces: result.counts.kept,
    of_all_those_values_how_many_the_agent_calculated_rather_than_found_stated: result.calculated,
    new_fields_proposed: result.proposals,
    comments_and_critical_dates_added_to_lists: result.listRows,
    rent_roll_rows_saved_as_a_dated_snapshot: result.rentRollRows,
    ...(result.rentRollRows > 0
      ? {
          tenant_names_waiting_for_the_person_to_confirm: result.tenantQuestions,
          about_kpis: 'The property\'s KPIs are now being calculated from these leases, following the KPI skill for its kind of property; that finishes a minute or so after this reply, and the results are on the Leases tab. Say so; do not call recalculate_kpis for it.',
          about_tenants: 'Units, tenants and leases were built from the rent roll and are on the asset\'s Leases tab. Names that only look like an existing tenant are never matched by guesswork; tell the person how many are waiting there to be confirmed, if any.',
        }
      : {}),
    ...(result.operatingStatement
      ? { about_the_operating_statement: 'The document holds an operating statement. Its lines are now being copied, month by month, as a cash flow; that finishes a minute or two after this reply and shows on the asset\'s Cash Flow tab. Say so. Until then get_cash_flow will not have it.' }
      : {}),
    street_addresses_set_from_the_document: result.addresses,
    photos_added_to_the_asset: result.photos,
    plan_and_map_pages_being_added_as_pictures: result.planPages.length,
    values_the_agent_returned_that_did_not_fit_a_field: result.skipped,
  })
}

/** Runs one tool as the signed-in person and returns its result as text for Claude. */
async function runTool(session: Session, name: string, input: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
  const { caller } = session
  const { orgId, userId } = caller
  const remaining = session.deadline - Date.now() - 20000
  const fail = (error: string) => ({ content: JSON.stringify({ ok: false, error }), isError: true })
  try {
    if (name === 'read_skill') {
      const wanted = asText(input.name, 100).toLowerCase()
      const skill = session.skills.find((candidate) => candidate.name.toLowerCase() === wanted) ?? session.skills.find((candidate) => candidate.name.toLowerCase().includes(wanted) && wanted.length > 3)
      if (!skill) return fail('There is no skill with that name. Use a name from the list.')
      return { content: JSON.stringify({ ok: true, skill: skill.name, use_when: skill.useWhen, instructions: skill.instructions }), isError: false }
    }

    if (name === 'create_asset_from_document' || name === 'read_document_into_asset') {
      const documentId = asText(input.document_id, 60)
      if (!isUuid(documentId) || !session.documentIds.has(documentId)) return fail('That document is not attached to this conversation.')
      if (remaining < 60000) return fail('There is not enough time left in this turn to read a document. Ask the person to send the request again.')
      const timeoutMs = Math.min(240000, remaining)
      let result: ReadOutcome
      if (name === 'create_asset_from_document') {
        result = await createAssetFromDocument(caller, documentId, timeoutMs)
      } else {
        const assetId = asText(input.asset_id, 60)
        if (!isUuid(assetId)) return fail('That asset could not be found. Use list_assets to get its id.')
        result = await readIntoAsset(caller, documentId, assetId, timeoutMs)
      }
      // A lease read this way fills only the asset's fields. Its terms belong on the tenant's lease.
      if (result.ok && name === 'read_document_into_asset' && /lease|amendment|guarant/i.test(result.documentType ?? '') && !/rent roll|memorandum|abstract of title/i.test(result.documentType ?? '')) {
        return {
          content: JSON.stringify({ ...JSON.parse(describeReading(session, result)), this_is_a_lease: 'The document is a lease, so its terms belong on the tenant\'s lease, not on the asset. Call read_lease_document now with this same document_id, the asset_id, and the tenant and unit from the document summary. Do not tell the person the lease was loaded until that has been done.' }),
          isError: false,
        }
      }
      return { content: describeReading(session, result), isError: !result.ok }
    }

    if (name === 'read_lease_document') {
      const documentId = asText(input.document_id, 60)
      if (!isUuid(documentId) || !session.documentIds.has(documentId)) return fail('That document is not attached to this conversation.')
      const assetId = asText(input.asset_id, 60)
      if (!isUuid(assetId)) return fail('That asset could not be found. Use list_assets to get its id.')
      if (remaining < 60000) return fail('There is not enough time left in this turn to read a document. Ask the person to send the request again.')
      const found = await withOrg(orgId, async (client) => {
        const access = await loadAccess(client, orgId, userId, caller.isAdmin)
        if (!access.canAddRecords) return { error: 'The person\'s role does not allow loading documents.' }
        if (!(await tenantsReady(client))) return { error: 'Leases are not set up yet (database update 024 is needed).' }
        const leases = (await listLeases(client, orgId, { assetId })).map((lease) => ({ id: lease.id, tenantName: lease.tenantName, unitName: lease.unitName, status: lease.status, propertyName: lease.propertyName }))
        return { leases }
      })
      if ('error' in found) return fail(found.error ?? 'That could not be done.')
      if (found.leases.length === 0) return fail('This asset has no leases yet. Leases are built from rent rolls: ask the person to load a rent roll for the asset first, then load the lease.')
      const match = findLease(found.leases, asText(input.tenant, 200) || null, asText(input.unit, 50) || null)
      if (!('lease' in match)) {
        const listed = (match.candidates.length > 0 ? match.candidates : found.leases).slice(0, 60)
        return fail(`${match.candidates.length > 0 ? 'More than one lease could be meant' : 'No lease fits that tenant and unit'}. Ask the person which lease this document is for, then call again with that tenant and unit exactly as listed: ${listed.map((lease) => `${lease.tenantName} | unit ${lease.unitName ?? 'none'} | ${lease.status}`).join('; ')}.`)
      }
      const result = await readIntoLease(caller, documentId, match.lease.id, Math.min(240000, remaining))
      if (!result.ok) return fail(result.error)
      session.changed = true
      session.links.push({ label: 'Open the Lease', href: `/dashboard/leases/${match.lease.id}` })
      session.links.push({ label: 'Review What Was Found', href: `/dashboard/assets/${result.assetId}/documents/${result.documentId}` })
      return {
        content: JSON.stringify({
          ok: true,
          read_into_lease: `${leaseLabel(match.lease)} at ${match.lease.propertyName}`,
          document: result.documentName,
          document_type: result.documentType,
          document_summary: result.summary,
          lease_fields_filled_in: result.counts.filled,
          lease_fields_replaced: result.counts.replaced,
          lease_fields_confirmed: result.counts.confirmed,
          lease_fields_waiting_for_a_decision: result.counts.decision,
          lease_fields_kept_as_they_were: result.counts.kept,
          critical_dates_added_to_the_property: result.listRows,
          values_the_agent_returned_that_did_not_fit_a_field: result.skipped,
          where_to_see_it: 'The lease\'s page (Open the Lease) shows every term; the review list shows where each came from.',
        }),
        isError: false,
      }
    }

    if (name === 'create_asset') {
      const assetName = asText(input.name, 200)
      if (!assetName) return fail('The asset needs a name.')
      const wantedType = asText(input.property_type, 100)
      type Made = { made: true; assetId: string; propertyType: string } | { made: false; choices: string[] }
      const made = await withOrg(orgId, async (client): Promise<Made | null> => {
        const access = await loadAccess(client, orgId, userId, caller.isAdmin)
        if (!access.canAddRecords) return null
        const choices = await listPropertyTypes(client, orgId)
        // "Multifamily" and the like are not on every list; an empty answer falls back, a wrong one is sent back with the list.
        const type = matchPropertyType(choices, wantedType) ?? (wantedType ? null : fallbackPropertyType(choices))
        if (!type) return { made: false, choices }
        return { made: true, assetId: await createAssetWithDefaults(client, orgId, userId, { name: assetName, propertyType: type, city: asText(input.city, 200) || null }), propertyType: type }
      })
      if (!made) return fail("The person's role does not allow adding assets.")
      if (!made.made) return fail(`"${wantedType}" is not one of this organization's property types. Choose one of: ${made.choices.join(', ')}.`)
      const { assetId, propertyType } = made
      session.changed = true
      session.links.push({ label: `Open ${assetName}`, href: `/dashboard/assets/${assetId}` })
      return { content: JSON.stringify({ ok: true, asset_id: assetId, asset_name: assetName, property_type: propertyType }), isError: false }
    }

    if (name === 'list_assets') {
      const assets = await withOrg(orgId, (client) => listAssets(client, orgId))
      return {
        content: JSON.stringify({ ok: true, assets: assets.slice(0, 200).map((asset) => ({ asset_id: asset.id, name: asset.name, property_types: asset.propertyTypes, cities: asset.cities, properties: asset.propertyCount })) }),
        isError: false,
      }
    }

    if (name === 'get_asset') {
      const assetId = asText(input.asset_id, 60)
      if (!isUuid(assetId)) return fail('That asset could not be found. Use list_assets to get its id.')
      const found = await withOrg(orgId, async (client) => {
        const tree = await getAssetTree(client, orgId, assetId)
        if (!tree) return null
        const access = await loadAccess(client, orgId, userId, caller.isAdmin)
        const sections = sectionByField(await listScreens(client, orgId))
        // Hidden fields are dropped here, so the agent never learns their values.
        const fields = (await listFields(client, orgId)).filter((field) => !field.listId && access.fieldLevel(field.id, sections.get(field.id) ?? null) !== 'hidden')
        const records: { type: 'asset' | 'property' | 'building'; id: string; name: string; addresses: Address[] }[] = [
          { type: 'asset', id: tree.id, name: tree.name, addresses: [] },
          ...tree.properties.flatMap((property) => [
            { type: 'property' as const, id: property.id, name: property.name, addresses: property.addresses },
            ...property.buildings.map((building) => ({ type: 'building' as const, id: building.id, name: `${property.name} / ${building.name}`, addresses: building.addresses })),
          ]),
        ]
        const values = await listValues(client, orgId, records.map((record) => record.id))
        const sources = new Map((await listSourceTypes(client)).map((source) => [source.key, source.name]))
        return { tree, fields, records, values, sources }
      })
      if (!found) return fail('That asset could not be found.')
      const fieldById = new Map(found.fields.map((field) => [field.id, field]))
      const lines = found.records.map((record) => ({
        record: `${RECORD_LABELS[record.type]}: ${record.name}`,
        ...(record.type === 'property' ? { addresses: record.addresses.length > 0 ? record.addresses.map(describeAddress) : 'No address has been added' } : {}),
        ...(record.type === 'building' && record.addresses.length > 0 ? { addresses: record.addresses.map(describeAddress) } : {}),
        values: found.values
          .filter((value) => value.recordId === record.id && fieldById.has(value.fieldId))
          .slice(0, 300)
          .map((value) => {
            const field = fieldById.get(value.fieldId)!
            return { field: field.name, value: formatValue(field, value), ...(value.period ? { month: formatPeriod(value.period) } : {}), source: found.sources.get(value.sourceType) ?? value.sourceType }
          }),
        empty_fields: found.fields
          .filter((field) => field.appliesTo === record.type && !field.calculated && !found.values.some((value) => value.recordId === record.id && value.fieldId === field.id))
          .map((field) => field.name),
      }))
      session.links.push({ label: `Open ${found.tree.name}`, href: `/dashboard/assets/${found.tree.id}` })
      return { content: JSON.stringify({ ok: true, asset: found.tree.name, records: lines }).slice(0, 60000), isError: false }
    }
    if (name === 'look_up_surroundings') {
      const assetId = asText(input.asset_id, 60)
      if (!isUuid(assetId)) return fail('That asset could not be found. Use list_assets to get its id.')
      const topics = (Array.isArray(input.topics) ? input.topics : [input.topics]).filter(isSurroundingTopic)
      if (topics.length === 0) return fail(`Choose one or more topics: ${SURROUNDING_TOPICS.join(', ')}.`)
      const tree = await withOrg(orgId, (client) => getAssetTree(client, orgId, assetId))
      if (!tree) return fail('That asset could not be found.')
      // A property's own address comes before its buildings'.
      const places = tree.properties.flatMap((property) => [
        ...property.addresses.map((address) => ({ label: `${RECORD_LABELS.property}: ${property.name}`, names: [plain(property.name)], address })),
        ...property.buildings.flatMap((building) => building.addresses.map((address) => ({ label: `${RECORD_LABELS.building}: ${property.name} / ${building.name}`, names: [plain(building.name), plain(`${property.name} / ${building.name}`)], address }))),
      ])
      const wanted = plain(asText(input.record_name, 200))
      const candidates = wanted ? places.filter((place) => place.names.includes(wanted)) : places
      if (places.length === 0) return fail('This asset has no address yet. The person can add one on the asset\'s page with Add Address; then this can be looked up.')
      if (candidates.length === 0) return fail(`No address belongs to a property or building with that name. The addresses are on: ${[...new Set(places.map((place) => place.label))].join('; ')}.`)
      const place = candidates.find((candidate) => candidate.address.latitude !== null && candidate.address.longitude !== null)
      if (!place) {
        return fail(`The address (${formatAddress(candidates[0].address) || 'city only'}) has no map location yet, so nothing around it can be looked up. On the asset's page the person can press Find Location beside the address, or Change Address to enter the full street address.`)
      }
      const results = await lookUpSurroundings(place.address.latitude as number, place.address.longitude as number, topics, Math.max(5000, Math.min(25000, remaining)))
      session.links.push({ label: `Open ${tree.name}`, href: `/dashboard/assets/${tree.id}` })
      const others = [...new Set(places.filter((other) => other !== place && other.address.latitude !== null).map((other) => other.label))]
      return {
        content: JSON.stringify({
          ok: true,
          asset: tree.name,
          looked_up_around: { record: place.label, address: formatAddress(place.address) },
          ...(others.length > 0 ? { other_records_with_a_map_location: others } : {}),
          note: 'The map point sits along the street at this address. Distances are straight lines from it.',
          results,
        }).slice(0, 60000),
        isError: false,
      }
    }

    if (name === 'set_field_value') {
      const assetId = asText(input.asset_id, 60)
      if (!isUuid(assetId)) return fail('That asset could not be found. Use list_assets to get its id.')
      const result = await withOrg(orgId, (client) =>
        setValueForAgent(client, orgId, userId, caller.isAdmin, {
          assetId,
          field: asText(input.field, 200),
          recordName: asText(input.record_name, 200) || null,
          value: asText(input.value, 2100),
          month: asText(input.month, 10) || null,
          clear: input.clear === true,
        }),
      )
      if (!result.ok) return fail(result.error)
      if (result.changed) session.changed = true
      session.links.push({ label: 'Open the Asset', href: `/dashboard/assets/${assetId}` })
      return {
        content: JSON.stringify({ ok: true, saved: result.changed, ...(result.changed ? {} : { note: 'The field already held this value, so nothing changed.' }), field: result.field, record: result.record, value: result.value, ...(result.month ? { month: result.month } : {}) }),
        isError: false,
      }
    }
    if (name === 'recalculate_kpis') {
      const assetId = asText(input.asset_id, 60)
      if (!isUuid(assetId)) return fail('That asset could not be found. Use list_assets to get its id.')
      const left = session.deadline - Date.now()
      if (left < 45000) return fail('There is not enough time left in this turn to calculate. Ask the person to send the request again, or to press Recalculate KPIs on the asset\'s Leases tab.')
      const result = await calculateKpis(caller, assetId, { timeoutMs: left - 20000 })
      if (!result.ok) return fail(result.error)
      session.changed = true
      session.links.push({ label: 'Open the Leases Tab', href: `/dashboard/assets/${assetId}?screen=_leases` })
      return {
        content: JSON.stringify({
          ok: true,
          asset: result.assetName,
          summary: describeKpiRuns(result.runs, result.problems),
          properties: result.runs.map((run) => ({
            property: run.propertyName,
            as_of: run.asOfDate,
            skill_followed: run.skillName,
            values: run.results.map((value) => ({
              name: value.fieldName,
              calculated: value.display,
              result: value.outcome === 'kept' ? `not saved: the field holds ${value.current} from ${value.currentSource ?? 'another source'}, which was kept. The person can choose the calculated figure on the Leases tab.` : value.outcome === 'same' ? 'already held this value' : 'saved',
              working: value.working,
            })),
            notes: run.notes,
          })),
        }).slice(0, 30000),
        isError: false,
      }
    }
    const repairs: Record<string, () => Promise<Lookup>> = {
      rebuild_leases: () => rebuildLeasesForAgent(caller, asText(input.asset_id, 60)),
      set_tenant_ruling: () => ruleTenantForAgent(caller, { assetId: asText(input.asset_id, 60) || null, name: asText(input.name, 200), isTenant: input.is_tenant === true }),
    }
    if (repairs[name]) {
      if (name === 'set_tenant_ruling' && typeof input.is_tenant !== 'boolean') return fail('Say whether the name is a tenant: is_tenant true or false.')
      const done = await repairs[name]()
      if (!done.ok) return fail(done.error)
      session.changed = true
      session.links.push(...done.links)
      return { content: JSON.stringify({ ok: true, ...done.result }).slice(0, 30000), isError: false }
    }
    const lookups: Record<string, () => Promise<Lookup>> = {
      search_portfolio: () => searchPortfolio(caller, asText(input.query, 200)),
      list_tenants: () => tenantsForAgent(caller, asText(input.asset_id, 60) || null),
      get_lease: () => leaseForAgent(caller, { assetId: asText(input.asset_id, 60) || null, tenant: asText(input.tenant, 200), unit: asText(input.unit, 60) }),
      get_rent_roll: () => rentRollForAgent(caller, asText(input.asset_id, 60)),
      get_dates_and_commentary: () => listsForAgent(caller, asText(input.asset_id, 60)),
      list_documents: () => documentsForAgent(caller, asText(input.asset_id, 60)),
    }
    if (lookups[name]) {
      const found = await lookups[name]()
      if (!found.ok) return fail(found.error)
      session.links.push(...found.links)
      return { content: JSON.stringify({ ok: true, ...found.result }).slice(0, 60000), isError: false }
    }
    if (name === 'get_cash_flow') {
      const assetId = asText(input.asset_id, 60)
      if (!isUuid(assetId)) return fail('That asset could not be found. Use list_assets to get its id.')
      const found = await withOrg(orgId, async (client) => {
        const access = await loadAccess(client, orgId, userId, caller.isAdmin)
        // Like a document's file, a statement shows every figure whatever a role's field rules say.
        if (!access.canAddRecords) return { ok: false as const, error: 'This person\'s role does not allow opening cash flows. An administrator can give them a role that can edit.' }
        if (!(await cashFlowsReady(client))) return { ok: false as const, error: 'Cash flows are not set up yet: the database needs db/migrations/030_cash_flows.sql.' }
        const tree = await getAssetTree(client, orgId, assetId)
        if (!tree) return { ok: false as const, error: 'That asset could not be found. Use list_assets to get its id.' }
        const all = await listCashFlows(client, orgId, assetId)
        const wanted = Number.isInteger(input.statement_number) ? (input.statement_number as number) : 1
        const chosen = all.find((_entry, index) => index === wanted - 1) ?? null
        return { ok: true as const, tree, all, wanted, chosen, lines: chosen ? await listCashFlowLines(client, orgId, chosen.id, chosen.columns.length) : [] }
      })
      if (!found.ok) return fail(found.error)
      const { tree, all, chosen, lines } = found
      if (all.length === 0) return { content: JSON.stringify({ ok: true, asset: tree.name, statements_on_file: 0, note: 'No cash flow has been loaded for this asset. One is saved when an operating statement, such as a trailing twelve months, is read for it.' }), isError: false }
      if (!chosen) return fail(`There is no statement number ${found.wanted}. There ${all.length === 1 ? 'is 1 statement' : `are ${all.length} statements`} on file.`)
      const propertyName = (id: string) => tree.properties.find((property) => property.id === id)?.name ?? ''
      const figure = (amount: number | null) => (amount === null ? '' : String(Math.round(amount * 100) / 100))
      const sums = columnSums(lines, chosen.columns.length)
      const totals = periodTotals(chosen.columns, lines)
      session.links.push({ label: 'Open Cash Flow', href: `/dashboard/assets/${assetId}?screen=_cashflow&cashFlow=${chosen.id}` })
      const table = lines.map((line) => [CASH_FLOW_SECTION_LABELS[line.section], line.kind === 'item' ? '' : line.kind.replace(/_/g, ' '), line.code ?? '', line.name, line.category ?? '', ...line.amounts.map(figure)].join('\t'))
      const shown: string[] = []
      let length = 0
      for (const row of table) {
        if (length + row.length > 40000) break
        shown.push(row)
        length += row.length + 1
      }
      return {
        content: JSON.stringify({
          ok: true,
          asset: tree.name,
          statements_on_file: all.map((entry, index) => ({ statement_number: index + 1, period: periodLabel(entry.periodStart, entry.periodEnd), property: propertyName(entry.propertyId), title: entry.title, from_document: entry.documentName, lines: entry.lineCount })),
          statement: {
            statement_number: found.wanted,
            period: periodLabel(chosen.periodStart, chosen.periodEnd),
            property: propertyName(chosen.propertyId),
            title: chosen.title,
            basis: chosen.basis,
            from_document: chosen.documentName,
            notes_from_the_reading: chosen.notes,
            columns: chosen.columns.map((column) => `${column.label} (${CASH_FLOW_COLUMN_LABELS[column.kind]}${column.total ? ', a total of other columns' : column.months > 1 ? `, ${column.months} months from ${column.start}` : `, ${column.start}`})`),
            ...(totals ? { for_the_period: { covers: totals.from === 'months' ? `${totals.months} months added up` : `the column "${totals.label}"`, total_income: figure(totals.income.amount), operating_expenses: figure(totals.expenses.amount), net_operating_income: figure(totals.noi.amount) } } : {}),
            by_column: chosen.columns.map((column, index) => ({ column: column.label, total_income: figure(sums[index].income.amount), operating_expenses: figure(sums[index].expenses.amount), net_operating_income: figure(sums[index].noi.amount) })),
            about_the_figures: 'Total income, operating expenses and net operating income are the document\'s own total lines where it shows them; otherwise they are its item lines added up. Every line below is as the document shows it. Do not add up or average lines yourself unless the person asks, and say so when you do.',
            lines_header: ['part', 'kind of line (empty for an item)', 'account', 'name', 'category', ...chosen.columns.map((column) => column.label)].join('\t'),
            lines: shown,
            ...(shown.length < table.length ? { note: `Only the first ${shown.length} of ${table.length} lines are listed.` } : {}),
          },
        }),
        isError: false,
      }
    }
    return fail(`There is no tool called ${name}.`)
  } catch (error) {
    console.error(`Agent tool ${name} failed`, error)
    return fail('That step failed unexpectedly.')
  }
}

/**
 * Answers the latest message in a conversation. `pageAssetId` is the asset
 * the person is looking at, if any, and `references` are fields they clicked
 * to point the agent at.
 */
export async function runAgent(caller: Caller, input: { turns: AgentTurn[]; pageAssetId: string | null; references: string[] }): Promise<AgentReply> {
  const apiKey = claudeApiKey()
  if (!apiKey) return { ok: false, error: 'No Anthropic API key is set (ANTHROPIC_API_KEY).' }
  const turns = input.turns.slice(-MAX_TURNS)
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') return { ok: false, error: 'Type a message first.' }

  const session: Session = { caller, links: [], changed: false, deadline: Date.now() + TIME_BUDGET_MS, documentIds: new Set(), skills: [], pages: [], kpis: [], statements: [] }
  const messages: ChatMessage[] = []
  turns.forEach((turn, index) => {
    let content = asText(turn.text, 8000)
    const attachments = (turn.attachments ?? []).filter((attachment) => isUuid(String(attachment?.id ?? ''))).slice(0, 5)
    for (const attachment of attachments) session.documentIds.add(attachment.id)
    if (turn.role === 'user' && attachments.length > 0) {
      content += `\n\n[Attached ${attachments.length === 1 ? 'document' : 'documents'}: ${attachments.map((attachment) => `"${asText(attachment.name, 200)}" (document_id ${attachment.id})`).join(', ')}]`
    }
    if (turn.role === 'user' && index === turns.length - 1) {
      const context = [
        input.pageAssetId && isUuid(input.pageAssetId) ? `The person is looking at the asset with asset_id ${input.pageAssetId}.` : 'The person is not on an asset\'s page.',
        input.references.length > 0 ? `They pointed at these fields: ${input.references.slice(0, 20).map((reference) => asText(reference, 200)).join(', ')}.` : '',
      ].filter(Boolean).join(' ')
      content += `\n\n[Page context: ${context}]`
    }
    if (!content) return
    // Claude expects the two sides to alternate; join any that don't.
    const last = messages[messages.length - 1]
    if (last && last.role === turn.role) last.content = `${last.content as string}\n\n${content}`
    else messages.push({ role: turn.role, content })
  })
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift()
  if (messages.length === 0) return { ok: false, error: 'Type a message first.' }

  // The general instructions are written by Stratios administrators; fall back to the built-in ones if they can't be read.
  let instructions = DEFAULT_ANALYST_INSTRUCTIONS
  try {
    instructions = (await withOrg(caller.orgId, (client) => getAnalystInstructions(client))).instructions
  } catch (error) {
    console.error('Reading the analyst instructions failed; using the built-in ones', error)
  }
  // The skills library is read on its own, so a problem with one never hides the other.
  session.skills = await withOrg(caller.orgId, (client) => loadSkillsForAgent(client, caller.orgId)).catch(() => [])
  const system = buildAnalystPrompt(instructions, skillIndex(session.skills))
  const tools = session.skills.length > 0 ? [...TOOLS, READ_SKILL] : TOOLS

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const answer = await converse(apiKey, { system, messages, tools, timeoutMs: Math.max(10000, Math.min(60000, session.deadline - Date.now())) })
      const said = answer.content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map((block) => block.text).join('\n').trim()
      const requests = answer.content.filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
      if (answer.stopReason !== 'tool_use' || requests.length === 0) {
        return { ok: true, text: said || 'Done.', links: dedupe(session.links), changed: session.changed, pages: session.pages, kpis: session.kpis, statements: session.statements }
      }
      messages.push({ role: 'assistant', content: answer.content })
      const results: ContentBlock[] = []
      for (const request of requests) {
        const result = await runTool(session, request.name, request.input ?? {})
        results.push({ type: 'tool_result', tool_use_id: request.id, content: result.content, ...(result.isError ? { is_error: true } : {}) })
      }
      messages.push({ role: 'user', content: results })
    }
    return { ok: true, text: 'I did part of that but ran out of steps. Tell me what is still missing and I will carry on.', links: dedupe(session.links), changed: session.changed, pages: session.pages, kpis: session.kpis, statements: session.statements }
  } catch (error) {
    // Anything already done (an asset created, a document read) is still done; say so through the buttons.
    const reason =
      error instanceof ApiError ? error.message :
      error instanceof Error && error.name === 'TimeoutError' ? 'Claude took too long to answer.' :
      'Stratios could not reach the Claude API.'
    if (!(error instanceof ApiError)) console.error('Agent failed', error)
    if (session.changed) return { ok: true, text: `The work was done, but I could not write up the result (${reason}) Use the buttons below to see it.`, links: dedupe(session.links), changed: true, pages: session.pages, kpis: session.kpis, statements: session.statements }
    return { ok: false, error: reason }
  }
}

function dedupe(links: AgentLink[]): AgentLink[] {
  const seen = new Set<string>()
  return links.filter((link) => (seen.has(link.href) ? false : (seen.add(link.href), true))).slice(0, 6)
}
