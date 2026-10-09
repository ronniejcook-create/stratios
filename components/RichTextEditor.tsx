'use client'

import { useEffect, useRef, type ClipboardEvent, type MouseEvent } from 'react'
import { fromDom, toHtml } from '@/lib/richText'

type Command = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList' | 'heading'

const TOOLS: { command: Command; label: string; title: string; className?: string }[] = [
  { command: 'bold', label: 'B', title: 'Bold (Ctrl+B)', className: 'tool-bold' },
  { command: 'italic', label: 'I', title: 'Italic (Ctrl+I)', className: 'tool-italic' },
  { command: 'insertUnorderedList', label: '• List', title: 'Bullet List' },
  { command: 'insertOrderedList', label: '1. List', title: 'Numbered List' },
  { command: 'heading', label: 'Heading', title: 'Heading' },
]

/**
 * Edits Markdown text as formatted text: what you see is how it reads, and
 * every change is handed back as Markdown through onChange.
 *
 * The text is loaded once, when the editor appears; after that the browser
 * owns what is on screen. Show it only while it is the active view.
 */
export function RichTextEditor({ value, onChange, placeholder, labelledBy }: { value: string; onChange: (markdown: string) => void; placeholder?: string; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = ref.current
    if (!box) return
    box.innerHTML = toHtml(value)
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p')
      document.execCommand('styleWithCSS', false, 'false')
    } catch {
      // Older browsers ignore these; the editor still works.
    }
    // Loaded once on purpose: see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const report = () => {
    if (ref.current) onChange(fromDom(ref.current))
  }

  const apply = (event: MouseEvent, command: Command) => {
    event.preventDefault() // keep the selection in the text
    ref.current?.focus()
    if (command === 'heading') {
      const current = String(document.queryCommandValue('formatBlock') ?? '').toLowerCase().replace(/[<>]/g, '')
      document.execCommand('formatBlock', false, /^h[1-6]$/.test(current) ? 'p' : 'h5')
    } else {
      document.execCommand(command)
    }
    report()
  }

  // Pasted text comes in as plain text, so formatting from other pages can't sneak in.
  // Several lines are read as Markdown, so pasted headings and bullets show formatted straight away.
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    if (/\n/.test(text.trim())) document.execCommand('insertHTML', false, toHtml(text))
    else if (text) document.execCommand('insertText', false, text)
    report()
  }

  return (
    <div className="rich-editor">
      <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
        {TOOLS.map((tool) => (
          <button key={tool.command} type="button" className={tool.className} title={tool.title} aria-label={tool.title} onMouseDown={(event) => apply(event, tool.command)}
            // Keyboard activation (Enter or Space) arrives as a click with no mouse press.
            onClick={(event) => { if (event.detail === 0) apply(event, tool.command) }}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="markdown rich-text"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        data-placeholder={placeholder}
        spellCheck
        onInput={report}
        onBlur={report}
        onPaste={paste}
      />
    </div>
  )
}
