// Markdown for instruction text, both ways: Markdown to formatted HTML for the
// Reading View editor, and the edited page elements back to Markdown.
// Browser-safe. Covers headings, bullet and numbered lists, bold, italic,
// inline code, code blocks, quotes and paragraphs. Anything else (tables,
// links) stays as the plain text it was typed as.
//
// toHtml escapes every piece of text it is given, so pasted or saved text can
// never become live markup.

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }
  | { kind: 'paragraph'; text: string }

type ListItem = { text: string; depth: number; ordered: boolean }

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const NUMBERED = /^(\s*)\d{1,9}[.)]\s+(.*)$/
const FENCE = /^\s*(```|~~~)/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const MAX_DEPTH = 3

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }
    if (FENCE.test(line)) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index])) body.push(lines[index++])
      index += 1
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      index += 1
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const items: ListItem[] = []
      while (index < lines.length) {
        const bullet = lines[index].match(BULLET)
        const item = bullet ?? lines[index].match(NUMBERED)
        if (item) {
          const depth = Math.min(MAX_DEPTH, Math.floor(item[1].replace(/\t/g, '  ').length / 2))
          // A bullet straight after numbered steps (or the reverse) at the outer level starts a new list.
          if (depth === 0 && items.length > 0 && items[0].ordered !== !bullet) break
          items.push({ text: item[2], depth, ordered: !bullet })
        } else if (lines[index].trim() && /^\s+/.test(lines[index]) && items.length > 0) {
          // An indented line continues the item above it.
          items[items.length - 1].text += ' ' + lines[index].trim()
        } else {
          break
        }
        index += 1
      }
      blocks.push({ kind: 'list', items })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index])) body.push(lines[index++].replace(/^\s*>\s?/, ''))
      blocks.push({ kind: 'quote', text: body.join(' ') })
      continue
    }
    const body: string[] = []
    while (
      index < lines.length && lines[index].trim() &&
      !HEADING.test(lines[index]) && !BULLET.test(lines[index]) && !NUMBERED.test(lines[index]) && !FENCE.test(lines[index]) && !/^\s*>/.test(lines[index])
    ) {
      body.push(lines[index++].trim())
    }
    blocks.push({ kind: 'paragraph', text: body.join(' ') })
  }
  return blocks
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const INLINE = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(__[^_]+?__)|(\*[^*\s][^*]*?\*)|(\b_[^_\s][^_]*?_\b)/

/** Turns **bold**, *italic* and `code` inside a line into HTML. */
function inlineHtml(text: string): string {
  let out = ''
  let rest = text
  while (rest) {
    const match = rest.match(INLINE)
    if (!match || match.index === undefined) {
      out += escapeHtml(rest)
      break
    }
    out += escapeHtml(rest.slice(0, match.index))
    const token = match[0]
    if (token.startsWith('`')) out += `<code>${escapeHtml(token.slice(1, -1))}</code>`
    else if (token.startsWith('**') || token.startsWith('__')) out += `<strong>${inlineHtml(token.slice(2, -2))}</strong>`
    else out += `<em>${inlineHtml(token.slice(1, -1))}</em>`
    rest = rest.slice(match.index + token.length)
  }
  return out
}

/** Builds a list, with deeper items as lists nested inside the item above them. */
function listHtml(items: ListItem[], from: number, depth: number): { html: string; next: number } {
  const tag = items[from].ordered ? 'ol' : 'ul'
  let html = `<${tag}>`
  let index = from
  while (index < items.length && items[index].depth >= depth) {
    if (items[index].depth > depth) {
      // Deeper than this list with no item above it to sit under: give it its own list.
      const nested = listHtml(items, index, items[index].depth)
      html += nested.html
      index = nested.next
      continue
    }
    html += `<li>${inlineHtml(items[index].text)}`
    index += 1
    if (index < items.length && items[index].depth > depth) {
      const nested = listHtml(items, index, items[index].depth)
      html += nested.html
      index = nested.next
    }
    html += '</li>'
  }
  return { html: `${html}</${tag}>`, next: index }
}

/** Markdown as formatted HTML, for the Reading View editor. */
export function toHtml(source: string): string {
  return parse(source)
    .map((block) => {
      if (block.kind === 'heading') {
        const tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5'
        return `<${tag} data-level="${block.level}">${inlineHtml(block.text)}</${tag}>`
      }
      if (block.kind === 'list') return listHtml(block.items, 0, 0).html
      if (block.kind === 'code') return `<pre>${escapeHtml(block.text)}</pre>`
      if (block.kind === 'quote') return `<blockquote>${inlineHtml(block.text)}</blockquote>`
      if (block.kind === 'rule') return '<hr>'
      return `<p>${inlineHtml(block.text)}</p>`
    })
    .join('')
}

// ---------------------------------------------------------------------------
// Edited page elements back to Markdown
// ---------------------------------------------------------------------------

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'HR', 'LI'])
const TAG_LEVEL: Record<string, number> = { H1: 1, H2: 2, H3: 1, H4: 2, H5: 3, H6: 3 }

const isElement = (node: Node): node is HTMLElement => node.nodeType === 1
const isBlock = (node: Node) => isElement(node) && BLOCK_TAGS.has(node.tagName)

/** Puts markers around text, keeping any spaces at the ends outside them ("**word** next", never "**word **next"). */
function wrap(inner: string, marker: string): string {
  const core = inner.trim()
  if (!core) return inner
  const lead = inner.slice(0, inner.length - inner.trimStart().length)
  const trail = inner.slice(inner.trimEnd().length)
  return `${lead}${marker}${core}${marker}${trail}`
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === 3) return (node.nodeValue ?? '').replace(/ /g, ' ').replace(/[\n\t]+/g, ' ')
  if (!isElement(node)) return ''
  if (node.tagName === 'BR') return '\n'
  if (node.tagName === 'UL' || node.tagName === 'OL') return ''
  let inner = ''
  node.childNodes.forEach((child) => {
    inner += inlineMarkdown(child)
  })
  if (node.tagName === 'CODE') return inner.trim() ? `\`${inner.replace(/`/g, '')}\`` : inner
  const weight = node.style?.fontWeight ?? ''
  const bold = node.tagName === 'STRONG' || node.tagName === 'B' || weight === 'bold' || Number(weight) >= 600
  const italic = node.tagName === 'EM' || node.tagName === 'I' || node.style?.fontStyle === 'italic'
  if (italic) inner = wrap(inner, '*')
  if (bold) inner = wrap(inner, '**')
  return inner
}

const tidy = (text: string) => text.split('\n').map((line) => line.replace(/ {2,}/g, ' ').trim()).filter(Boolean).join('\n')

/** Lists every item of a list, with nested lists as deeper items. */
function listLines(list: HTMLElement, depth: number, lines: string[]) {
  let number = 0
  list.childNodes.forEach((child) => {
    if (!isElement(child)) return
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      listLines(child, Math.min(MAX_DEPTH, depth + 1), lines)
      return
    }
    if (child.tagName !== 'LI') return
    const text = tidy(inlineMarkdown(child)).replace(/\n/g, ' ')
    if (text) {
      number += 1
      lines.push(`${'  '.repeat(depth)}${list.tagName === 'OL' ? `${number}.` : '-'} ${text}`)
    }
    child.childNodes.forEach((nested) => {
      if (isElement(nested) && (nested.tagName === 'UL' || nested.tagName === 'OL')) listLines(nested, Math.min(MAX_DEPTH, depth + 1), lines)
    })
  })
}

function blocksOf(container: Node, out: string[]) {
  let run = ''
  const flush = () => {
    const text = tidy(run)
    if (text) out.push(text)
    run = ''
  }
  container.childNodes.forEach((node) => {
    if (!isBlock(node)) {
      run += inlineMarkdown(node)
      return
    }
    flush()
    const element = node as HTMLElement
    const tag = element.tagName
    if (tag === 'HR') {
      out.push('---')
    } else if (tag === 'UL' || tag === 'OL') {
      const lines: string[] = []
      listLines(element, 0, lines)
      if (lines.length) out.push(lines.join('\n'))
    } else if (tag === 'PRE') {
      const code = (element.textContent ?? '').replace(/\n+$/, '')
      if (code.trim()) out.push('```\n' + code + '\n```')
    } else if (tag in TAG_LEVEL) {
      const text = tidy(inlineMarkdown(element)).replace(/\n/g, ' ')
      const level = Math.min(6, Math.max(1, Number(element.dataset.level) || TAG_LEVEL[tag]))
      if (text) out.push(`${'#'.repeat(level)} ${text}`)
    } else if (tag === 'BLOCKQUOTE') {
      const text = tidy(inlineMarkdown(element))
      if (text) out.push(text.split('\n').map((line) => `> ${line}`).join('\n'))
    } else if (Array.from(element.childNodes).some(isBlock)) {
      blocksOf(element, out) // a wrapper the browser added around other blocks
    } else {
      const text = tidy(inlineMarkdown(element))
      if (text) out.push(text)
    }
  })
  flush()
}

/** Reads the Reading View editor's contents back as Markdown. */
export function fromDom(root: HTMLElement): string {
  const out: string[] = []
  blocksOf(root, out)
  return out.join('\n\n')
}
