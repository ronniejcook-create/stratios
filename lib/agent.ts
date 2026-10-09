// The Portfolio Analyst: the chat agent in the right-hand column.
//
// It talks with the person and can use a small set of tools. Every tool runs
// as the signed-in person, inside their organization and with their
// permissions, so the agent can never see or change more than they can.

import { buildAnalystPrompt, DEFAULT_ANALYST_INSTRUCTIONS, getAnalystInstructions } from './analystInstructions'
import { createAssetWithDefaults, PROPERTY_TYPES } from './assets'
import { ApiError, claudeApiKey, converse, type ChatMessage, type ContentBlock, type ToolDefinition } from './claude'
import { withOrg } from './db'
import { createAssetFromDocument, readIntoAsset, type ReadOutcome } from './documentReading'
import type { Caller } from './documentRequests'
import { sectionByField } from './extraction'
import { formatPeriod, formatValue } from './fieldFormat'
import { listFields, listSourceTypes, listValues } from './fields'
import { listScreens } from './layout'
import { loadAccess } from './permissions'
import { getAssetTree, isUuid, listAssets, RECORD_LABELS } from './records'
import { loadSkillsForAgent, skillIndex, type Skill } from './skills'

export type AgentTurn = { role: 'user' | 'assistant'; text: string; attachments?: { id: string; name: string }[] }
export type AgentLink = { label: string; href: string }
/** Pages of a document for the browser to draw as pictures and add to an asset's photos (plans and maps). */
export type AgentPages = { assetId: string; documentId: string; pages: { page: number; caption: string | null }[] }
export type AgentReply = { ok: true; text: string; links: AgentLink[]; changed: boolean; pages?: AgentPages[] } | { ok: false; error: string }

const MAX_TURNS = 40
const MAX_STEPS = 6
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
    description: 'Creates a new, empty asset with one property and one building, when the person gives its details in words and no document.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, property_type: { type: 'string', enum: [...PROPERTY_TYPES] }, city: { type: 'string', description: 'Empty if not given' } },
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
    description: 'Returns one asset\'s properties and buildings and the current value of every field the person is allowed to see. Use to answer questions about an asset.',
    input_schema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'], additionalProperties: false },
  },
]

type Session = { caller: Caller; links: AgentLink[]; changed: boolean; deadline: number; documentIds: Set<string>; skills: Skill[]; pages: AgentPages[] }

const READ_SKILL: ToolDefinition = {
  name: 'read_skill',
  description: 'Opens one skill from the Stratios skills library and returns its instructions. Use before doing or answering something a listed skill covers.',
  input_schema: { type: 'object', properties: { name: { type: 'string', description: 'The skill\'s name, copied from the list' } }, required: ['name'], additionalProperties: false },
}

const asText = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

function describeReading(session: Session, result: ReadOutcome): string {
  if (!result.ok) return JSON.stringify({ ok: false, error: result.error })
  session.changed = true
  if (result.planPages.length > 0) session.pages.push({ assetId: result.assetId, documentId: result.documentId, pages: result.planPages })
  session.links.push({ label: `Open ${result.assetName}`, href: `/dashboard/assets/${result.assetId}` })
  session.links.push({ label: 'Review What Was Found', href: `/dashboard/assets/${result.assetId}/documents/${result.documentId}` })
  if (result.rentRollRows > 0) session.links.push({ label: 'Open Rent Roll', href: `/dashboard/assets/${result.assetId}?screen=_rentroll` })
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
      return { content: describeReading(session, result), isError: !result.ok }
    }

    if (name === 'create_asset') {
      const assetName = asText(input.name, 200)
      const propertyType = (PROPERTY_TYPES as readonly string[]).find((type) => type.toLowerCase() === asText(input.property_type, 40).toLowerCase()) ?? 'Other'
      if (!assetName) return fail('The asset needs a name.')
      const assetId = await withOrg(orgId, async (client) => {
        const access = await loadAccess(client, orgId, userId, caller.isAdmin)
        if (!access.canAddRecords) return null
        return createAssetWithDefaults(client, orgId, userId, { name: assetName, propertyType, city: asText(input.city, 200) || null })
      })
      if (!assetId) return fail("The person's role does not allow adding assets.")
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
        const records = [
          { type: 'asset' as const, id: tree.id, name: tree.name },
          ...tree.properties.flatMap((property) => [
            { type: 'property' as const, id: property.id, name: property.name },
            ...property.buildings.map((building) => ({ type: 'building' as const, id: building.id, name: `${property.name} / ${building.name}` })),
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

  const session: Session = { caller, links: [], changed: false, deadline: Date.now() + TIME_BUDGET_MS, documentIds: new Set(), skills: [], pages: [] }
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
        return { ok: true, text: said || 'Done.', links: dedupe(session.links), changed: session.changed, pages: session.pages }
      }
      messages.push({ role: 'assistant', content: answer.content })
      const results: ContentBlock[] = []
      for (const request of requests) {
        const result = await runTool(session, request.name, request.input ?? {})
        results.push({ type: 'tool_result', tool_use_id: request.id, content: result.content, ...(result.isError ? { is_error: true } : {}) })
      }
      messages.push({ role: 'user', content: results })
    }
    return { ok: true, text: 'I did part of that but ran out of steps. Tell me what is still missing and I will carry on.', links: dedupe(session.links), changed: session.changed, pages: session.pages }
  } catch (error) {
    // Anything already done (an asset created, a document read) is still done; say so through the buttons.
    const reason =
      error instanceof ApiError ? error.message :
      error instanceof Error && error.name === 'TimeoutError' ? 'Claude took too long to answer.' :
      'Stratios could not reach the Claude API.'
    if (!(error instanceof ApiError)) console.error('Agent failed', error)
    if (session.changed) return { ok: true, text: `The work was done, but I could not write up the result (${reason}) Use the buttons below to see it.`, links: dedupe(session.links), changed: true, pages: session.pages }
    return { ok: false, error: reason }
  }
}

function dedupe(links: AgentLink[]): AgentLink[] {
  const seen = new Set<string>()
  return links.filter((link) => (seen.has(link.href) ? false : (seen.add(link.href), true))).slice(0, 6)
}
