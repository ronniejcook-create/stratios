import type { ReactNode } from 'react'

// A small Markdown reader for instruction text: headings, bullet and numbered
// lists, bold, italic, inline code, code blocks and paragraphs. It builds page
// elements directly and never inserts raw HTML, so pasted text can't run code.

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: { text: string; depth: number }[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }
  | { kind: 'paragraph'; text: string }

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const NUMBERED = /^(\s*)\d{1,9}[.)]\s+(.*)$/
const FENCE = /^\s*(```|~~~)/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/

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
      const ordered = !BULLET.test(line)
      const items: { text: string; depth: number }[] = []
      while (index < lines.length) {
        const item = lines[index].match(BULLET) ?? lines[index].match(NUMBERED)
        if (item) {
          items.push({ text: item[2], depth: Math.min(3, Math.floor(item[1].replace(/\t/g, '  ').length / 2)) })
        } else if (lines[index].trim() && /^\s+/.test(lines[index]) && items.length > 0) {
          // An indented line continues the item above it.
          items[items.length - 1].text += ' ' + lines[index].trim()
        } else {
          break
        }
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
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

const INLINE = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(__[^_]+?__)|(\*[^*\s][^*]*?\*)|(\b_[^_\s][^_]*?_\b)/

/** Turns **bold**, *italic* and `code` inside a line into elements. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let count = 0
  while (rest) {
    const match = rest.match(INLINE)
    if (!match || match.index === undefined) {
      out.push(rest)
      break
    }
    if (match.index > 0) out.push(rest.slice(0, match.index))
    const token = match[0]
    const key = `${keyBase}-${count++}`
    if (token.startsWith('`')) out.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**') || token.startsWith('__')) out.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>)
    else out.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>)
    rest = rest.slice(match.index + token.length)
  }
  return out
}

/** Shows Markdown text the way it reads, not the way it is typed. */
export function Markdown({ source, empty }: { source: string; empty?: string }) {
  const blocks = parse(source)
  if (blocks.length === 0) return <div className="markdown markdown-empty">{empty ?? 'Nothing written yet.'}</div>
  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        const key = `b${index}`
        if (block.kind === 'heading') {
          const content = inline(block.text, key)
          if (block.level === 1) return <h3 key={key} className="md-h1">{content}</h3>
          if (block.level === 2) return <h4 key={key} className="md-h2">{content}</h4>
          return <h5 key={key} className="md-h3">{content}</h5>
        }
        if (block.kind === 'list') {
          const items = block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`} style={item.depth ? { marginLeft: item.depth * 18 } : undefined}>{inline(item.text, `${key}-${itemIndex}`)}</li>
          ))
          return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
        }
        if (block.kind === 'code') return <pre key={key}><code>{block.text}</code></pre>
        if (block.kind === 'quote') return <blockquote key={key}>{inline(block.text, key)}</blockquote>
        if (block.kind === 'rule') return <hr key={key} />
        return <p key={key}>{inline(block.text, key)}</p>
      })}
    </div>
  )
}
