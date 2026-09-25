// Reads back the .xlsx files the app writes, checking them strictly the way a
// spreadsheet program would: ZIP structure and CRCs, well-formed XML parts,
// and the parts Excel needs. Throws on anything wrong.
const zlib = require('zlib')
const { TextDecoder } = require('util')

const REQUIRED = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']

function unzip(bytes) {
  const buf = Buffer.from(bytes)
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0 || eocd !== buf.length - 22) throw new Error('no end-of-central-directory record at the end')
  const count = buf.readUInt16LE(eocd + 10)
  if (count !== buf.readUInt16LE(eocd + 8)) throw new Error('entry counts differ')
  const size = buf.readUInt32LE(eocd + 12)
  let pos = buf.readUInt32LE(eocd + 16)
  if (pos + size !== eocd) throw new Error('central directory is not where the end record says')
  const files = {}
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('bad central directory entry ' + i)
    const crc = buf.readUInt32LE(pos + 16)
    const length = buf.readUInt32LE(pos + 20)
    const nameLength = buf.readUInt16LE(pos + 28)
    const extra = buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32)
    const offset = buf.readUInt32LE(pos + 42)
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLength)
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error('bad local header for ' + name)
    if (buf.readUInt16LE(offset + 8) !== 0) throw new Error(name + ' is not stored')
    if (buf.readUInt32LE(offset + 14) !== crc || buf.readUInt32LE(offset + 22) !== length) throw new Error('headers of ' + name + ' differ')
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28)
    const data = buf.subarray(start, start + length)
    if (zlib.crc32(data) !== crc) throw new Error('CRC mismatch in ' + name)
    files[name] = data
    pos += 46 + nameLength + extra
  }
  return files
}

function parseXml(name, data) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error(name + ' is not well-formed XML')
  return doc
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

/** { sheetName, formats: { styleIndex: formatCode }, rows: [[{ ref, type, style, value }]] } */
function readXlsx(bytes) {
  const files = unzip(bytes)
  REQUIRED.forEach((name) => {
    if (!files[name]) throw new Error('missing ' + name)
  })
  const docs = {}
  Object.keys(files).forEach((name) => {
    docs[name] = parseXml(name, files[name])
  })
  const styles = docs['xl/styles.xml']
  const codes = {}
  Array.from(styles.getElementsByTagName('numFmt')).forEach((f) => {
    codes[f.getAttribute('numFmtId')] = f.getAttribute('formatCode')
  })
  const xfs = Array.from(styles.getElementsByTagName('cellXfs')[0].getElementsByTagName('xf'))
  const formats = xfs.map((xf) => codes[xf.getAttribute('numFmtId')] || '')

  const rows = Array.from(docs['xl/worksheets/sheet1.xml'].getElementsByTagName('row')).map((row) =>
    Array.from(row.getElementsByTagName('c')).map((c) => {
      const type = c.getAttribute('t') || 'n'
      const style = Number(c.getAttribute('s') || 0)
      if (style >= xfs.length) throw new Error('cell ' + c.getAttribute('r') + ' uses a missing style')
      const raw = type === 'inlineStr' ? c.getElementsByTagName('t')[0].textContent : c.getElementsByTagName('v')[0].textContent
      return { ref: c.getAttribute('r'), type, style, format: formats[style], value: type === 'n' ? Number(raw) : raw }
    })
  )
  return {
    sheetName: docs['xl/workbook.xml'].getElementsByTagName('sheet')[0].getAttribute('name'),
    rows
  }
}

/** A cell as the spreadsheet shows it: dates and times formatted, the rest as is. */
function shown(cell) {
  if (!cell) return ''
  if (cell.type !== 'n' || !cell.format) return cell.value
  const t = new Date(EXCEL_EPOCH + Math.round(cell.value * 86400000))
  const pad = (n) => (n < 10 ? '0' : '') + n
  const date = t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate())
  const time = pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes())
  return { 'yyyy-mm-dd': date, 'hh:mm': time, 'yyyy-mm-dd hh:mm': date + ' ' + time }[cell.format]
}

/** Rows of what the spreadsheet shows, keyed by the header row. */
function table(bytes) {
  const { rows } = readXlsx(bytes)
  const headers = rows[0].map((c) => c.value)
  return rows.slice(1).map((row) => {
    const out = {}
    row.forEach((cell) => {
      const column = cell.ref.replace(/\d+$/, '')
      const index = column.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
      out[headers[index]] = shown(cell)
    })
    return out
  })
}

module.exports = { unzip, readXlsx, table, shown }
