'use client'

import { cellFromText, downloadWorkbook } from '@/lib/excelExport'
import { DownloadIcon } from './DataGrid'

/**
 * The Download to Excel button for a list that is a plain table rather than
 * a DataGrid. The page hands over the same text its table shows; `figures`
 * names the columns (counting from 0) that hold numbers, money, percentages
 * or dates, which are saved as real values.
 */
export function DownloadButton({ name, header, rows, figures = [] }: { name: string; header: string[]; rows: string[][]; figures?: number[] }) {
  return (
    <button
      type="button"
      className="icon-button grid-search-button"
      aria-label={`Download ${name} to Excel`}
      title="Download to Excel"
      disabled={rows.length === 0}
      onClick={() => downloadWorkbook(name, name, header, rows.map((row) => row.map((text, index) => cellFromText(text ?? '', figures.includes(index)))))}
    >
      <DownloadIcon />
    </button>
  )
}
