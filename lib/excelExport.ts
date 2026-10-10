// Writing an Excel workbook (.xlsx) in the browser, for the download button
// on every list. No library: a workbook is a zip of a few small XML files,
// and the zip is written here without compression. Browser-safe, and it
// runs under Node too (tests).

export type CellFormat = 'whole' | 'cents' | 'money' | 'moneyCents' | 'percent' | 'date'
/** A cell: text, a plain number, nothing, or a number with the way Excel should show it. */
export type SheetCell = string | number | null | { value: number; format: CellFormat }

// Style numbers, in the order styles.xml lists them.
const STYLE: Record<CellFormat | 'header', number> = { header: 1, whole: 2, cents: 3, money: 4, moneyCents: 5, percent: 6, date: 7 }

const escapeXml = (text: string) =>
  text
    // Characters XML does not allow at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 0 -> A, 25 -> Z, 26 -> AA. */
function columnName(index: number): string {
  let name = ''
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) name = String.fromCharCode(65 + ((rest - 1) % 26)) + name
  return name
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** Excel counts days from the end of 1899. */
const excelDay = (year: number, month: number, day: number) => Date.UTC(year, month, day) / 86400000 + 25569

/**
 * Turns a cell as a list shows it into a cell Excel can add up and sort:
 * "$24,143" becomes the number 24143 shown as money, "81.8%" a percentage,
 * "(250.00)" a negative, "Jun 30, 2028" a date. Anything else stays text.
 * Only cells of columns that hold figures or dates are looked at, so a unit
 * number such as "0425" or a ZIP code is never changed.
 */
export function cellFromText(text: string, figures: boolean): SheetCell {
  const shown = text.trim()
  if (shown === '') return null
  if (!figures) return text
  const date = /^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})$/.exec(shown)
  if (date) {
    const month = MONTHS.indexOf(date[1].toLowerCase())
    if (month >= 0) return { value: excelDay(Number(date[3]), month, Number(date[2])), format: 'date' }
  }
  const number = /^(\()?(-)?(\$)?(-)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%)?(\))?$/.exec(shown)
  if (!number || Boolean(number[1]) !== Boolean(number[8])) return text
  const value = Number(`${number[5].replace(/,/g, '')}${number[6] ?? ''}`) * (number[1] || number[2] || number[4] ? -1 : 1)
  if (!Number.isFinite(value)) return text
  const decimals = (number[6]?.length ?? 1) - 1
  if (number[7]) return { value: value / 100, format: 'percent' }
  if (number[3]) return { value, format: decimals > 0 ? 'moneyCents' : 'money' }
  return decimals > 0 ? { value, format: 'cents' } : { value, format: 'whole' }
}

function cellXml(cell: SheetCell, reference: string, header = false): string {
  if (cell === null || cell === '') return ''
  if (typeof cell === 'string') return `<c r="${reference}" t="inlineStr"${header ? ` s="${STYLE.header}"` : ''}><is><t xml:space="preserve">${escapeXml(cell.slice(0, 32000))}</t></is></c>`
  if (typeof cell === 'number') return Number.isFinite(cell) ? `<c r="${reference}"><v>${cell}</v></c>` : ''
  return Number.isFinite(cell.value) ? `<c r="${reference}" s="${STYLE[cell.format]}"><v>${cell.value}</v></c>` : ''
}

/** How wide a column should be, in Excel's character units, from what it holds. */
function widthOf(header: string, cells: SheetCell[]): number {
  let longest = header.length
  for (const cell of cells) {
    const length = cell === null ? 0 : typeof cell === 'string' ? cell.length : typeof cell === 'number' ? String(cell).length : cell.format === 'date' ? 12 : String(Math.round(cell.value)).length + 6
    if (length > longest) longest = length
  }
  return Math.min(60, Math.max(8, longest + 2))
}

function sheetXml(header: string[], rows: SheetCell[][]): string {
  const columns = header.map((name, index) => `<col min="${index + 1}" max="${index + 1}" width="${widthOf(name, rows.map((row) => row[index] ?? null))}" customWidth="1"/>`).join('')
  const line = (cells: SheetCell[], number: number, isHeader = false) => `<row r="${number}">${cells.map((cell, index) => cellXml(cell, `${columnName(index)}${number}`, isHeader)).join('')}</row>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${line(header, 1, true)}${rows.map((row, index) => line(row.slice(0, header.length), index + 2)).join('')}</sheetData></worksheet>`
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0;-&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00;-&quot;$&quot;#,##0.00"/><numFmt numFmtId="166" formatCode="mmm d, yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

let crcTable: Uint32Array | null = null
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      crcTable[index] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A zip archive of the given files, stored without compression. */
function zip(files: { name: string; text: string }[]): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = encoder.encode(file.text)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // names are UTF-8
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, 0, true)
    local.setUint16(12, 0x21, true) // 1980-01-01
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(10, 0, true)
    entry.setUint16(12, 0, true)
    entry.setUint16(14, 0x21, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, data.length, true)
    entry.setUint32(24, data.length, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, offset, true)
    parts.push(new Uint8Array(local.buffer), name, data)
    directory.push(new Uint8Array(entry.buffer), name)
    offset += 30 + name.length + data.length
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, directorySize, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...directory, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of all) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** A workbook with one sheet: a bold header row that stays put, then the rows. */
export function buildWorkbook(sheetName: string, header: string[], rows: SheetCell[][]): Uint8Array {
  // Excel allows 31 characters in a sheet's name and none of \ / ? * [ ] :
  const name = sheetName.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet1'
  return zip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', text: STYLES_XML },
    { name: 'xl/worksheets/sheet1.xml', text: sheetXml(header, rows) },
  ])
}

/** A file name people can keep: letters, digits, spaces, dashes and dots only. */
export const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Stratios'

/** Builds the workbook and hands it to the browser as a download. */
export function downloadWorkbook(fileName: string, sheetName: string, header: string[], rows: SheetCell[][]): void {
  const bytes = buildWorkbook(sheetName, header, rows)
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFileName(fileName)}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
