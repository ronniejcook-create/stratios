import { ApiError, askClaude, claudeApiKey } from './claude'

/** What Stratios knows about a field when asking Claude to describe it. Only the name is required. */
export type FieldFacts = {
  name: string
  appliesTo?: string
  dataType?: string
  unit?: string
  options?: string[]
  tracking?: string
  calculated?: boolean
}

export type DescriptionResult = { ok: true; description: string } | { ok: false; error: string }

const LEVELS: Record<string, string> = {
  asset: 'an asset (the investment as a whole)',
  property: 'a property (a site within an asset)',
  building: 'a building',
  floor: 'a floor of a building',
  unit: 'a unit (a leasable space)',
  tenant: 'a tenant',
  lease: 'a lease',
}
const TYPES: Record<string, string> = {
  text: 'text',
  number: 'a number',
  money: 'a money amount',
  percent: 'a percentage',
  date: 'a date',
  boolean: 'yes or no',
  picklist: 'one choice from a list',
}

const clean = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * Asks Claude for a plain-words definition of a field, for the Description
 * box in Fields Library. Nothing is saved; the admin reviews the text and
 * saves it with the rest of the field.
 */
export async function generateFieldDescription(facts: FieldFacts): Promise<DescriptionResult> {
  const name = clean(facts.name, 100)
  if (!name) return { ok: false, error: 'Give the field a name first.' }
  const apiKey = claudeApiKey()
  if (!apiKey) return { ok: false, error: 'No Anthropic API key is set (ANTHROPIC_API_KEY).' }

  const details = [
    facts.appliesTo && LEVELS[facts.appliesTo] ? `It is recorded on ${LEVELS[facts.appliesTo]}.` : '',
    facts.dataType && TYPES[facts.dataType] ? `Its value is ${TYPES[facts.dataType]}${clean(facts.unit, 30) ? `, in ${clean(facts.unit, 30)}` : ''}.` : '',
    facts.options?.length ? `Its choices are: ${facts.options.slice(0, 30).map((option) => clean(option, 60)).filter(Boolean).join(', ')}.` : '',
    facts.tracking === 'monthly' ? 'It has a separate value for each month.' : '',
    facts.calculated ? 'It is calculated from other fields.' : '',
  ].filter(Boolean)

  const prompt = `Stratios is a commercial real estate portfolio system. Write the definition of this data field as it would appear in a data dictionary.

Field name: "${name}"
${details.join('\n')}

The definition is read by people and by AI agents that find this value in documents such as offering memorandums, rent rolls and operating statements, so it must make clear exactly what the field means and what it does not include.

Rules:
- One to three sentences, at most 60 words, in plain words and sentence case.
- Use the standard commercial real estate meaning of the term. Where the term is commonly confused with a similar one, say how it differs.
- Start with the meaning itself. Do not start with the field name, "This field" or "The".
- No bullet points, quotation marks or line breaks.
- If the name is too vague to define with confidence, give the most likely meaning for commercial real estate.`

  try {
    const answer = await askClaude(apiKey, prompt, {
      type: 'object',
      properties: { description: { type: 'string', description: 'The definition, one to three sentences' } },
      required: ['description'],
      additionalProperties: false,
    })
    const description = clean(answer.description, 1000)
    if (!description) return { ok: false, error: 'Claude returned an empty description. Try again.' }
    return { ok: true, description }
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message }
    console.error('Field description generation failed', error)
    const errorName = error instanceof Error ? error.name : ''
    return {
      ok: false,
      error:
        errorName === 'TimeoutError' ? 'The Claude API took too long to answer; try again.' :
        errorName === 'SyntaxError' ? 'Claude returned the description in an unexpected format.' :
        'Stratios could not reach the Claude API.',
    }
  }
}
