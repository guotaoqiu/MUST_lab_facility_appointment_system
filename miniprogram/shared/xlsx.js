/**
 * Minimal .xlsx writer with no dependencies, so the same code runs in the
 * cloud function and on the phone (demo mode).
 *
 *   buildXlsx({ sheetName, columns: [{ header, width, type }], rows: [[cell, ...]] })
 *     -> Uint8Array
 *
 * Cells are strings or numbers; the header row is bold and frozen. A column's
 * `type` turns its text into real Excel values, so dates sort and filter:
 *   'date' ('2026-09-28'), 'time' ('10:30'), 'datetime' ('2026-09-28 10:30').
 * The file is a ZIP archive with stored (uncompressed) entries.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// UTF-8 bytes of a string; a lone surrogate becomes U+FFFD, like Buffer does.
function utf8(str) {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(str, 'utf8')
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.length)
  }
  // The mini program (demo mode) has no Buffer: size first, then fill.
  let size = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x80) size += 1
    else if (code < 0x800) size += 2
    else if (isPair(str, i)) {
      size += 4
      i++
    } else size += 3
  }
  const out = new Uint8Array(size)
  let p = 0
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (isPair(str, i)) {
      code = 0x10000 + ((code - 0xd800) << 10) + (str.charCodeAt(i + 1) - 0xdc00)
      i++
    } else if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd
    if (code < 0x80) out[p++] = code
    else if (code < 0x800) {
      out[p++] = 0xc0 | (code >> 6)
      out[p++] = 0x80 | (code & 63)
    } else if (code < 0x10000) {
      out[p++] = 0xe0 | (code >> 12)
      out[p++] = 0x80 | ((code >> 6) & 63)
      out[p++] = 0x80 | (code & 63)
    } else {
      out[p++] = 0xf0 | (code >> 18)
      out[p++] = 0x80 | ((code >> 12) & 63)
      out[p++] = 0x80 | ((code >> 6) & 63)
      out[p++] = 0x80 | (code & 63)
    }
  }
  return out
}

function isPair(str, i) {
  const code = str.charCodeAt(i)
  return code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && (str.charCodeAt(i + 1) & 0xfc00) === 0xdc00
}

function zip(files) {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1980-01-01
  const locals = []
  const centrals = []
  let offset = 0
  files.forEach((file) => {
    const name = utf8(file.name)
    const data = file.data
    const crc = crc32(data)

    const local = new Uint8Array(30 + name.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length
  })

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + end.length)
  let pos = 0
  locals.concat(centrals, [end]).forEach((part) => {
    out.set(part, pos)
    pos += part.length
  })
  return out
}

// XML 1.0 only allows tab, LF, CR, U+0020–U+D7FF, U+E000–U+FFFD and
// U+10000 and up; anything else (control characters, lone surrogates,
// U+FFFE/U+FFFF) would make Excel reject the whole file, so it is dropped.
function escapeXml(value) {
  let out = ''
  for (const ch of String(value)) {
    const c = ch.codePointAt(0)
    if (c === 0x26) out += '&amp;'
    else if (c === 0x3c) out += '&lt;'
    else if (c === 0x3e) out += '&gt;'
    else if (c === 0x22) out += '&quot;'
    else if (c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000) out += ch
  }
  return out
}

function columnName(index) {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30) // day 0 of Excel's date numbers
const DAY_MS = 24 * 60 * 60 * 1000
// Style index of each column type (see styles.xml below); 1 is the header.
const TYPE_STYLES = { date: 2, time: 3, datetime: 4 }

/** '2026-09-28', '10:30' or '2026-09-28 10:30' as an Excel date number, or null. */
function excelValue(value, type) {
  const m = /^(?:(\d{4})-(\d{2})-(\d{2}))? ?(?:(\d{2}):(\d{2}))?$/.exec(typeof value === 'string' ? value : '')
  if (!m || (type !== 'time') !== !!m[1] || (type !== 'date') !== !!m[4]) return null
  const days = m[1] ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - EXCEL_EPOCH) / DAY_MS : 0
  return days + (m[4] ? (+m[4] * 60 + +m[5]) / 1440 : 0)
}

function cellXml(value, ref, style, type) {
  if (TYPE_STYLES[type]) {
    const number = excelValue(value, type)
    if (number != null) return '<c r="' + ref + '" s="' + TYPE_STYLES[type] + '"><v>' + number + '</v></c>'
  }
  const s = style ? ' s="' + style + '"' : ''
  if (typeof value === 'number' && isFinite(value)) return '<c r="' + ref + '"' + s + '><v>' + value + '</v></c>'
  if (value == null || value === '') return ''
  return '<c r="' + ref + '" t="inlineStr"' + s + '><is><t xml:space="preserve">' + escapeXml(value) + '</t></is></c>'
}

function safeSheetName(name) {
  const cleaned = String(name || 'Sheet1').replace(/[\[\]:*?\/\\]/g, ' ').trim()
  return Array.from(cleaned).slice(0, 31).join('') || 'Sheet1'
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

function buildXlsx({ sheetName, columns, rows }) {
  const header = '<row r="1">' + columns.map((c, i) => cellXml(c.header, columnName(i) + '1', 1)).join('') + '</row>'
  const body = rows
    .map(
      (row, r) =>
        '<row r="' + (r + 2) + '">' + row.map((v, i) => cellXml(v, columnName(i) + (r + 2), 0, columns[i] && columns[i].type)).join('') + '</row>'
    )
    .join('')
  const cols =
    '<cols>' +
    columns.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 12) + '" customWidth="1"/>').join('') +
    '</cols>'

  const sheet =
    XML_HEAD +
    '<worksheet xmlns="' + NS_MAIN + '">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    cols +
    '<sheetData>' + header + body + '</sheetData>' +
    '</worksheet>'

  const files = [
    {
      name: '[Content_Types].xml',
      xml:
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      xml:
        '<Relationships xmlns="' + NS_PKG_REL + '">' +
        '<Relationship Id="rId1" Type="' + NS_REL + '/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      xml:
        '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
        '<sheets><sheet name="' + escapeXml(safeSheetName(sheetName)) + '" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      xml:
        '<Relationships xmlns="' + NS_PKG_REL + '">' +
        '<Relationship Id="rId1" Type="' + NS_REL + '/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="' + NS_REL + '/styles" Target="styles.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/styles.xml',
      xml:
        '<styleSheet xmlns="' + NS_MAIN + '">' +
        '<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="hh:mm"/>' +
        '<numFmt numFmtId="166" formatCode="yyyy-mm-dd hh:mm"/></numFmts>' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F1FA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>'
    },
    { name: 'xl/worksheets/sheet1.xml', xml: sheet }
  ]

  return zip(
    files.map((f) => ({ name: f.name, data: utf8(f.xml.indexOf('<?xml') === 0 ? f.xml : XML_HEAD + f.xml) }))
  )
}

module.exports = { buildXlsx, crc32, utf8, escapeXml, excelValue, safeSheetName }
