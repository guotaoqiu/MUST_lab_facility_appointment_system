// Turns booking records from the server into what record-item shows.
const i18n = require('./i18n')
const instruments = require('../shared/instruments')

const STATUS_KEYS = { booked: 'statusBooked', completed: 'statusCompleted', cancelled: 'statusCancelled' }

/** Shorten an openid for display: oAbc…wxyz */
function shortId(openid) {
  if (!openid) return ''
  return openid.length > 12 ? openid.slice(0, 6) + '…' + openid.slice(-4) : openid
}

/**
 * options.title: 'instrument' (my bookings, several instruments) or 'date' (one instrument)
 * options.admin: show who booked it
 */
function viewRecord(r, lang, options) {
  const t = i18n.dict(lang)
  const inst = instruments.find((i) => i.id === r.instrumentId)
  const time = i18n.formatTimeRange(r.startMin, r.endMin) + ' · ' + i18n.formatDuration(r.endMin - r.startMin, lang)
  const date = i18n.formatDate(r.date, lang)
  const byInstrument = options.title === 'instrument'
  let cancelNote = ''
  if (r.status === 'cancelled') {
    cancelNote = i18n.formatTimestamp(r.cancelledAt, lang)
    const who = r.cancelledBy === 'admin' ? t.cancelledByAdmin : r.cancelledBy === 'self' ? t.cancelledBySelf : ''
    if (who) cancelNote += (cancelNote ? ' · ' : '') + who + (options.admin && r.cancelledByName ? '（' + r.cancelledByName + '）' : '')
  }
  return {
    id: r.id,
    instrumentId: r.instrumentId,
    date: r.date,
    status: r.status,
    statusText: t[STATUS_KEYS[r.status]] || '',
    title: byInstrument ? (inst ? i18n.instrumentName(inst, lang) : r.instrumentId) : date,
    when: byInstrument ? date + '  ' + time : time,
    name: r.name,
    purpose: r.purpose,
    canCancel: !!r.canCancel,
    user: options.admin ? { nickname: r.nickname, avatar: r.avatar, id: shortId(r.openid) } : null,
    bookedAt: options.admin ? i18n.formatTimestamp(r.createdAt, lang) : '',
    cancelNote
  }
}

module.exports = { viewRecord, shortId }
