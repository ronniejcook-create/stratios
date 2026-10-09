// Reads an Excel workbook (.xlsx) and turns it into plain text the agent can
// read: one block per sheet, one line per row, cells separated by tabs.
//
// An .xlsx file is a zip of XML files. Both are read here with what Node
// already has (zlib), so no spreadsheet library had to be added. It reads
// values, not formulas: Excel stores each formula's last result beside it.
// Dates and percentages are written the way a person sees them; other number
// formats (currency symbols, thousands separators) are left as plain numbers.
// The old .xls format is a different kind of file and is not read.

import { inflateRawSync } from 'node:zlib'

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** The most text passed on from one workbook, so a huge sheet can't crowd out everything else. */
const MAX_TEXT = 300_000
const MAX_ROWS_PER_SHEET = 5000
const MAX_SHEETS = 20
/** The largest any one file inside the workbook may unpack to. */
const MAX_PART_BYTES = 60 * 1024 * 1024

/** An .xlsx file starts like every zip file. */
export function looksLikeZip(head: Buffer | string): boolean {
  const text = typeof head === 'string' ? head : head.subarray(0, 4).toString('latin1')
  return text.startsWith('PK\x03\x04')
}

/** The files inside a zip, by name. Only what a workbook needs: stored and deflated entries. */
function unzip(file: Buffer): Map<string, () => Buffer> {
  const parts = new Map<string, () => Buffer>()
  // The directory of entries sits at the end of the file.
  let end = -1
  for (let at = file.length - 22; at >= Math.max(0, file.length - 22 - 65535); at -= 1) {
    if (file.readUInt32LE(at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error('Not a zip file')
  const count = file.readUInt16LE(end + 10)
  let at = file.readUInt32LE(end + 16)
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > file.length || file.readUInt32LE(at) !== 0x02014b50) break
    const method = file.readUInt16LE(at + 10)
    const packed = file.readUInt32LE(at + 20)
    const nameLength = file.readUInt16LE(at + 28)
    const extraLength = file.readUInt16LE(at + 30)
    const commentLength = file.readUInt16LE(at + 32)
    const local = file.readUInt32LE(at + 42)
    const name = file.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    parts.set(name, () => {
      if (local + 30 > file.length || file.readUInt32LE(local) !== 0x04034b50) throw new Error('Damaged zip entry')
      const start = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28)
      const data = file.subarray(start, start + packed)
      if (method === 0) return data
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES })
      throw new Error('Unsupported zip compression')
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return parts
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[body] ?? whole
  })
}

const attribute = (tag: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1] ?? null
/** The text of every <t> inside a piece of XML, joined (a cell's text can be split into runs). Phonetic guides are left out. */
const textOf = (xml: string) => decode([...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(''))

/** Whether a number format shows a date or time. */
function isDateFormat(id: number, code: string | undefined): boolean {
  if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true
  if (!code) return false
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
  // A date format has day, month, year or time letters and none of the digit marks a number format has.
  return /[dmyhs]/i.test(bare) && !/[0#]/.test(bare)
}
const isPercentFormat = (id: number, code: string | undefined) => id === 9 || id === 10 || Boolean(code && /%/.test(code.replace(/"[^"]*"/g, '')))

/** Excel's day number as a date. Whole days become YYYY-MM-DD; a time of day is added when there is one. */
function serialToDate(serial: number, from1904: boolean): string {
  const days = Math.floor(serial)
  const epoch = from1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const date = new Date(epoch + days * 86400000)
  if (Number.isNaN(date.getTime())) return String(serial)
  const day = date.toISOString().slice(0, 10)
  const seconds = Math.round((serial - days) * 86400)
  if (seconds === 0) return day
  if (days === 0) return new Date(seconds * 1000).toISOString().slice(11, 16)
  return `${day} ${new Date(seconds * 1000).toISOString().slice(11, 16)}`
}

/** A stored number without the stray digits binary arithmetic leaves behind (0.30000000000000004). */
const tidyNumber = (value: number) => String(Number(value.toPrecision(12)))

/** "C7" -> 2 (the column's position, counting from zero). */
function columnOf(reference: string | null, fallback: number): number {
  const letters = /^[A-Z]+/.exec(reference ?? '')?.[0]
  if (!letters) return fallback
  let column = 0
  for (const letter of letters) column = column * 26 + (letter.charCodeAt(0) - 64)
  return column - 1
}

export type Workbook = { text: string; sheets: number; truncated: boolean }

/**
 * The workbook as text. Each sheet starts with a line "### Sheet N: name";
 * each row is "row number, tab, cells separated by tabs", with empty cells
 * kept so columns line up. Hidden sheets are included. Throws when the file
 * is not a readable .xlsx workbook.
 */
export function readWorkbook(file: Buffer): Workbook {
  const parts = unzip(file)
  const read = (name: string) => parts.get(name)?.().toString('utf8') ?? null
  const workbook = read('xl/workbook.xml')
  if (!workbook) throw new Error('Not an Excel workbook')
  const from1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(workbook)

  // Sheet names, and the file each one lives in.
  const targets = new Map<string, string>()
  for (const match of (read('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attribute(match[0], 'Id')
    const target = attribute(match[0], 'Target')
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`)
  }
  const sheets = [...workbook.matchAll(/<sheet\s[^>]*>/g)].map((match, index) => ({
    name: decode(attribute(match[0], 'name') ?? `Sheet ${index + 1}`),
    path: targets.get(attribute(match[0], 'r:id') ?? '') ?? `xl/worksheets/sheet${index + 1}.xml`,
  }))

  const strings = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((match) => textOf(match[1] ?? ''))

  // Which cell styles show a date or a percentage.
  const styles = read('xl/styles.xml') ?? ''
  const formats = new Map<number, string>()
  for (const match of styles.matchAll(/<numFmt\s[^>]*>/g)) {
    const id = Number(attribute(match[0], 'numFmtId'))
    if (Number.isFinite(id)) formats.set(id, decode(attribute(match[0], 'formatCode') ?? ''))
  }
  const cellStyles = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '').matchAll(/<xf\s[^>]*>/g)].map((match) => {
    const id = Number(attribute(match[0], 'numFmtId') ?? 0)
    return { date: isDateFormat(id, formats.get(id)), percent: isPercentFormat(id, formats.get(id)) }
  })

  const blocks: string[] = []
  let length = 0
  let truncated = sheets.length > MAX_SHEETS
  for (const [index, sheet] of sheets.slice(0, MAX_SHEETS).entries()) {
    const xml = read(sheet.path)
    if (xml === null) continue
    const lines: string[] = [`### Sheet ${index + 1}: ${sheet.name}`]
    let rowCount = 0
    for (const row of xml.matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      let next = 0
      for (const cell of row[2].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = cell[1] ?? ''
        const column = columnOf(attribute(tag, 'r'), next)
        next = column + 1
        const body = cell[2] ?? ''
        const type = attribute(tag, 't')
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? null
        let value = ''
        if (type === 's') value = raw === null ? '' : strings[Number(raw)] ?? ''
        else if (type === 'inlineStr') value = textOf(body)
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
        else if (type === 'str' || type === 'e') value = decode(raw ?? '')
        else if (raw !== null && raw !== '') {
          const number = Number(raw)
          const style = cellStyles[Number(attribute(tag, 's') ?? 0)]
          if (!Number.isFinite(number)) value = decode(raw)
          else if (style?.date) value = serialToDate(number, from1904)
          else if (style?.percent) value = `${tidyNumber(number * 100)}%`
          else value = tidyNumber(number)
        }
        if (value === '' || column > 500) continue
        while (cells.length < column) cells.push('')
        cells[column] = value.replace(/[\t\r\n]+/g, ' ').trim()
      }
      if (cells.every((cell) => cell === '')) continue
      if (rowCount >= MAX_ROWS_PER_SHEET) {
        truncated = true
        break
      }
      rowCount += 1
      lines.push(`${attribute(row[1] ?? '', 'r') ?? rowCount}\t${cells.join('\t')}`)
    }
    if (rowCount === 0) lines.push('(empty)')
    const block = lines.join('\n')
    if (length + block.length > MAX_TEXT) {
      blocks.push(block.slice(0, Math.max(0, MAX_TEXT - length)))
      truncated = true
      break
    }
    blocks.push(block)
    length += block.length + 2
  }
  return { text: blocks.join('\n\n'), sheets: sheets.length, truncated }
}
