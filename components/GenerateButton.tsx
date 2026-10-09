import { AiIcon } from './AiIcon'

/** The small "Generate" button, with the AI sparkle, that sits beside a box Claude can fill in. */
export function GenerateButton({ busy, disabled, onClick, title }: { busy: boolean; disabled?: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" className="generate-button" disabled={busy || disabled} onClick={onClick} title={title} aria-busy={busy}>
      <AiIcon />
      {busy ? 'Generating…' : 'Generate'}
    </button>
  )
}
