// Turns booking records from the server into what record-item shows.
const i18n = require('./i18n')
const instruments = require('../shared/instruments')

const STATUS_KEYS = { booked: 'statusBooked', completed: 'statusCompleted', cancelled: 'statusCancelled' }

/** Shorten an openid for display: oAbc…wxyz */
function shortId(openid) {
  if (!openid) return ''
  return openid.length > 12 ? openid.slice(0, 6) + '…' + openid.slice(-4) : openid
}

/** '（x）' in Chinese, ' (x)' in English */
function bracket(text, lang) {
  return lang === 'zh' ? '（' + text + '）' : ' (' + text + ')'
}

/** 'label：detail' / 'label: detail' */
function withDetail(label, detail, lang) {
  return detail ? label + (lang === 'zh' ? '：' : ': ') + detail : label
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
  const notes = []
  if (r.status === 'cancelled') {
    if (r.cancelledAt) notes.push(i18n.formatTimestamp(r.cancelledAt, lang))
    const who = r.cancelledBy === 'admin' ? t.cancelledByAdmin : r.cancelledBy === 'self' ? t.cancelledBySelf : ''
    if (who) notes.push(who + (options.admin && r.cancelledByName ? bracket(r.cancelledByName, lang) : ''))
    if (r.cancelReason === 'suspended') notes.push(withDetail(t.cancelledForSuspension, r.suspendReason, lang))
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
    cancelNote: notes.join(' · '),
    // A booking that still stands on an instrument that is now out of service.
    warning: r.suspended ? withDetail(t.outOfService, r.suspended.reason, lang) : ''
  }
}

module.exports = { viewRecord, shortId, bracket, withDetail }
