/**
 * Booking rules and actions shared by the mini program and the `booking`
 * cloud function.
 *
 * miniprogram/shared/ is the source of truth; `npm run sync` copies it to
 * cloudfunctions/booking/shared/ and `npm test` fails if the copies differ.
 *
 * Dates are 'YYYY-MM-DD' strings in Macau local time. Times are minutes from
 * midnight (e.g. 570 = 09:30). A booking covers [startMin, endMin).
 */

const xlsx = require('./xlsx')
const instruments = require('./instruments')

const SLOT_MINUTES = 30
const DAY_START_MINUTES = 8 * 60 // first bookable slot starts 08:00
const DAY_END_MINUTES = 22 * 60 // last slot ends 22:00
const TZ_OFFSET_MINUTES = 8 * 60 // Macau is UTC+8 all year
const WEEKS_VISIBLE = 2 // this week + next week
const NAME_MAX = 30
const PURPOSE_MAX = 200
const NICKNAME_MAX = 20
const SUSPEND_REASON_MAX = 50
const ADMIN_SESSION_MS = 7 * 24 * 60 * 60 * 1000 // admin login lasts a week
const ADMIN_MAX_FAILURES = 5 // then the WeChat account is locked out for a while
const ADMIN_LOCK_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function pad2(n) {
  return (n < 10 ? '0' : '') + n
}

function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

function dateToUTC(date) {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function formatUTCDate(ms) {
  const t = new Date(ms)
  return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate())
}

function addDays(date, n) {
  return formatUTCDate(dateToUTC(date) + n * DAY_MS)
}

/** 0 = Sunday … 6 = Saturday */
function weekdayOf(date) {
  return new Date(dateToUTC(date)).getUTCDay()
}

/** Monday of the week containing `date` (weeks run Monday–Sunday). */
function mondayOf(date) {
  return addDays(date, -((weekdayOf(date) + 6) % 7))
}

/** Current date and minute-of-day in Macau time. */
function localNow(nowMs) {
  const shifted = nowMs + TZ_OFFSET_MINUTES * 60 * 1000
  const t = new Date(shifted)
  return {
    date: formatUTCDate(shifted),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes()
  }
}

/** The bookable window: this week (Mon–Sun) and next week. */
function bookingWindow(nowMs) {
  const now = localNow(nowMs)
  const first = mondayOf(now.date)
  const weekStarts = []
  for (let i = 0; i < WEEKS_VISIBLE; i++) weekStarts.push(addDays(first, i * 7))
  return {
    today: now.date,
    nowMinutes: now.minutes,
    weekStarts,
    firstDate: first,
    lastDate: addDays(first, WEEKS_VISIBLE * 7 - 1)
  }
}

function weekDates(weekStart) {
  const out = []
  for (let i = 0; i < 7; i++) out.push(addDays(weekStart, i))
  return out
}

function minutesToText(min) {
  return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60)
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

/** A slot ending at `endMin` on `date` is past once that moment has arrived. */
function isPast(date, endMin, now) {
  return date < now.date || (date === now.date && endMin <= now.minutes)
}

/** Earliest bookable start on `date`: the slot that contains "now" still counts. */
function firstOpenStart(date, now) {
  if (date < now.date) return DAY_END_MINUTES
  if (date > now.date) return DAY_START_MINUTES
  const current = Math.floor(now.minutes / SLOT_MINUTES) * SLOT_MINUTES
  return Math.min(DAY_END_MINUTES, Math.max(DAY_START_MINUTES, current))
}

function findConflict(bookings, startMin, endMin) {
  return bookings.find((b) => overlaps(startMin, endMin, b.startMin, b.endMin)) || null
}

function textLength(s) {
  return Array.from(s).length
}

/** Collapse whitespace so names and purposes display on one tidy line. */
function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
}

function isSlotAligned(min) {
  return Number.isInteger(min) && min % SLOT_MINUTES === 0
}

function fail(code) {
  return { ok: false, code }
}

/**
 * Check a booking request. Returns { ok: true, value } with cleaned fields,
 * or { ok: false, code }.
 */
function validateBooking(input, nowMs) {
  const { date, startMin, endMin } = input || {}
  if (!isDateString(date)) return fail('INVALID_DATE')
  if (!isSlotAligned(startMin) || !isSlotAligned(endMin)) return fail('INVALID_TIME')
  if (startMin < DAY_START_MINUTES || endMin > DAY_END_MINUTES || startMin >= endMin) return fail('INVALID_TIME')

  const win = bookingWindow(nowMs)
  if (date > win.lastDate) return fail('OUT_OF_RANGE')
  if (isPast(date, startMin + SLOT_MINUTES, { date: win.today, minutes: win.nowMinutes })) return fail('IN_PAST')

  const name = cleanText(input.name)
  const purpose = cleanText(input.purpose)
  if (!name) return fail('NAME_REQUIRED')
  if (textLength(name) > NAME_MAX) return fail('NAME_TOO_LONG')
  if (!purpose) return fail('PURPOSE_REQUIRED')
  if (textLength(purpose) > PURPOSE_MAX) return fail('PURPOSE_TOO_LONG')

  return { ok: true, value: { date, startMin, endMin, name, purpose } }
}

function isInstrument(id) {
  return instruments.some((i) => i.id === id)
}

function instrumentLabel(id, lang) {
  const inst = instruments.find((i) => i.id === id)
  return inst ? inst.name[lang] || inst.name.zh : id
}

function makeId(nowMs) {
  return nowMs.toString(36) + Math.random().toString(36).slice(2, 10)
}

function byDateAndStart(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return a.startMin - b.startMin
}

function normalizeDay(day) {
  return { bookings: day && Array.isArray(day.bookings) ? day.bookings.slice() : [] }
}

/** 'YYYY-MM-DD HH:MM' in Macau time. */
function formatTimestamp(ms) {
  if (typeof ms !== 'number' || !ms) return ''
  const t = localNow(ms)
  return t.date + ' ' + minutesToText(t.minutes)
}

function isMonthString(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

function monthRange(month) {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? y + 1 + '-01' : y + '-' + pad2(m + 1)
  return { from: month + '-01', to: addDays(next + '-01', -1) }
}

/** booked (not ended yet) | completed | cancelled */
function recordStatus(r, now) {
  if (r.status === 'cancelled') return 'cancelled'
  return isPast(r.date, r.endMin, now) ? 'completed' : 'booked'
}

/*
 * ---------------------------------------------------------------------------
 * Actions, shared by the cloud function and the offline demo.
 *
 * `ctx` supplies the environment:
 *   openid           the caller's WeChat openid (trusted: from the platform)
 *   nowMs            current time
 *   checkText(text)  optional content check -> Promise<boolean>
 *   admins           { configured: boolean, verify(account, password) -> Promise<boolean> }
 *   isAvatarAllowed(avatar) optional
 *   saveFile(bytes, name) -> Promise<{ fileID } | { path }>, deleteFile(file) optional
 *   store:
 *     listDays(instrumentId, fromDate, toDate) -> day[]  (day = { instrumentId, date, bookings })
 *     updateDay(instrumentId, date, mutate, { create }) -> outcome
 *       Runs mutate(day) atomically. mutate returns { day } to save the day,
 *       `records: [{ id, data, merge }]` to write booking records in the same
 *       transaction, { error } to change nothing, or neither to change nothing.
 *       With create: false a missing day document is not created.
 *     getUser(openid) -> user | null, saveUser(openid, user)
 *     listRecords({ openid } | { instrumentId, from, to }) -> records by date
 *     getStatuses() -> { [instrumentId]: status }, setStatus(instrumentId, status)
 *
 * Collections: day documents (active bookings, used for conflict checks),
 * booking records (full history incl. cancelled), users, instrument status.
 * ---------------------------------------------------------------------------
 */

const ACTIONS = {
  me: meAction,
  login: loginAction,
  logout: logoutAction,
  adminLogin: adminLoginAction,
  list: listAction,
  create: createAction,
  cancel: cancelAction,
  myBookings: myBookingsAction,
  adminRecords: adminRecordsAction,
  exportRecords: exportRecordsAction,
  setSuspended: setSuspendedAction
}

async function handleAction(event, ctx) {
  const action = event && ACTIONS[event.action]
  if (!action || !Object.prototype.hasOwnProperty.call(ACTIONS, event.action)) return fail('BAD_REQUEST')
  if (!ctx.openid) return fail('UNAUTHORIZED')
  const user = await ctx.store.getUser(ctx.openid)
  const isAdmin = !!(user && user.admin && user.admin.expiresAt > ctx.nowMs)
  return action(event, Object.assign({}, ctx, { user, isAdmin }))
}

function meOf(ctx) {
  const u = ctx.user || {}
  return {
    loggedIn: !!u.nickname,
    nickname: u.nickname || '',
    avatar: u.avatar || '',
    isAdmin: ctx.isAdmin,
    account: ctx.isAdmin ? u.admin.account : ''
  }
}

async function meAction(event, ctx) {
  return { ok: true, me: meOf(ctx) }
}

async function loginAction(event, ctx) {
  const now = ctx.nowMs
  const existing = ctx.user || {}
  if (event.nickname == null) {
    if (!existing.nickname) return { ok: true, needsProfile: true, me: meOf(ctx) }
    const user = Object.assign({}, existing, { lastLoginAt: now })
    await ctx.store.saveUser(ctx.openid, user)
    return { ok: true, me: meOf(Object.assign({}, ctx, { user })) }
  }
  const nickname = cleanText(event.nickname)
  if (!nickname) return fail('NICKNAME_REQUIRED')
  if (textLength(nickname) > NICKNAME_MAX) return fail('NICKNAME_TOO_LONG')
  const avatar = event.avatar == null ? existing.avatar || '' : event.avatar
  if (typeof avatar !== 'string' || avatar.length > 512 || /\s/.test(avatar)) return fail('BAD_REQUEST')
  if (avatar && ctx.isAvatarAllowed && !ctx.isAvatarAllowed(avatar)) return fail('BAD_REQUEST')
  if (ctx.checkText && !(await ctx.checkText(nickname))) return fail('CONTENT_REJECTED')
  const user = Object.assign({}, existing, { nickname, avatar, lastLoginAt: now, createdAt: existing.createdAt || now })
  await ctx.store.saveUser(ctx.openid, user)
  return { ok: true, me: meOf(Object.assign({}, ctx, { user })) }
}

async function logoutAction(event, ctx) {
  if (ctx.user && ctx.user.admin) {
    const user = Object.assign({}, ctx.user, { admin: null })
    await ctx.store.saveUser(ctx.openid, user)
    return { ok: true, me: meOf(Object.assign({}, ctx, { user, isAdmin: false })) }
  }
  return { ok: true, me: meOf(ctx) }
}

async function adminLoginAction(event, ctx) {
  const now = ctx.nowMs
  if (!ctx.admins || !ctx.admins.configured) return fail('ADMIN_NOT_CONFIGURED')
  const { account, password } = event
  if (typeof account !== 'string' || typeof password !== 'string' || !account.trim() || !password) {
    return fail('CREDENTIALS_REQUIRED')
  }
  if (account.length > 64 || password.length > 128) return fail('INVALID_CREDENTIALS')
  const existing = ctx.user || {}
  const failure = existing.adminFail || {}
  if (failure.lockedUntil > now) return lockedOut(failure.lockedUntil, now)

  if (!(await ctx.admins.verify(account.trim(), password))) {
    const count = (failure.lockedUntil ? 0 : failure.count || 0) + 1
    const adminFail = count >= ADMIN_MAX_FAILURES ? { count: 0, lockedUntil: now + ADMIN_LOCK_MS } : { count, lockedUntil: 0 }
    await ctx.store.saveUser(ctx.openid, Object.assign({}, existing, { adminFail, createdAt: existing.createdAt || now }))
    if (adminFail.lockedUntil) return lockedOut(adminFail.lockedUntil, now)
    return Object.assign(fail('INVALID_CREDENTIALS'), { attemptsLeft: ADMIN_MAX_FAILURES - count })
  }
  const user = Object.assign({}, existing, {
    admin: { account: account.trim(), since: now, expiresAt: now + ADMIN_SESSION_MS },
    adminFail: null,
    createdAt: existing.createdAt || now
  })
  await ctx.store.saveUser(ctx.openid, user)
  return { ok: true, me: meOf(Object.assign({}, ctx, { user, isAdmin: true })) }
}

function lockedOut(until, now) {
  return Object.assign(fail('TOO_MANY_ATTEMPTS'), { retryAfterMin: Math.ceil((until - now) / 60000) })
}

function requireAdmin(ctx) {
  return ctx.isAdmin ? null : fail('ADMIN_REQUIRED')
}

async function suspendedMap(ctx) {
  const statuses = (await ctx.store.getStatuses()) || {}
  const out = {}
  Object.keys(statuses).forEach((id) => {
    if (statuses[id] && statuses[id].suspended) out[id] = { reason: statuses[id].reason || '', since: statuses[id].updatedAt || 0 }
  })
  return out
}

/** What a booking looks like on the calendar. Only admins see who made it. */
function calendarBooking(b, instrumentId, date, ctx, now) {
  const mine = b.openid === ctx.openid
  const out = {
    id: b.id,
    instrumentId,
    date,
    startMin: b.startMin,
    endMin: b.endMin,
    name: b.name,
    purpose: b.purpose,
    mine,
    canCancel: (mine || ctx.isAdmin) && !isPast(date, b.endMin, now)
  }
  if (ctx.isAdmin) Object.assign(out, adminFields(b))
  return out
}

function adminFields(r) {
  return {
    openid: r.openid || '',
    nickname: r.nickname || '',
    avatar: r.avatar || '',
    createdAt: r.createdAt || 0
  }
}

/** A booking record as shown in "my bookings" and the admin list. */
function recordView(r, ctx, now) {
  const status = recordStatus(r, now)
  const out = {
    id: r.id,
    instrumentId: r.instrumentId,
    date: r.date,
    startMin: r.startMin,
    endMin: r.endMin,
    name: r.name,
    purpose: r.purpose,
    status,
    createdAt: r.createdAt || 0,
    cancelledAt: r.cancelledAt || 0,
    cancelledBy: r.cancelledBy || '',
    canCancel: status === 'booked' && (r.openid === ctx.openid || ctx.isAdmin)
  }
  if (ctx.isAdmin) Object.assign(out, adminFields(r), { cancelledByName: r.cancelledByName || '' })
  return out
}

async function listAction(event, ctx) {
  const { instrumentId } = event
  if (!isInstrument(instrumentId)) return fail('BAD_INSTRUMENT')
  const win = bookingWindow(ctx.nowMs)
  const now = { date: win.today, minutes: win.nowMinutes }
  const [days, suspended] = await Promise.all([ctx.store.listDays(instrumentId, win.firstDate, win.lastDate), suspendedMap(ctx)])
  const bookings = []
  ;(days || []).forEach((day) => {
    normalizeDay(day).bookings.forEach((b) => bookings.push(calendarBooking(b, instrumentId, day.date, ctx, now)))
  })
  bookings.sort(byDateAndStart)
  return { ok: true, bookings, suspended, me: meOf(ctx), serverTime: ctx.nowMs }
}

async function createAction(event, ctx) {
  const me = meOf(ctx)
  if (!me.loggedIn && !me.isAdmin) return fail('NOT_LOGGED_IN')
  const { instrumentId, requestId } = event
  if (!isInstrument(instrumentId)) return fail('BAD_INSTRUMENT')
  if (requestId != null && !(typeof requestId === 'string' && /^[\w-]{1,64}$/.test(requestId))) return fail('BAD_REQUEST')
  const checked = validateBooking(event, ctx.nowMs)
  if (!checked.ok) return checked
  const v = checked.value
  if ((await suspendedMap(ctx))[instrumentId]) return fail('SUSPENDED')

  if (ctx.checkText && !(await ctx.checkText(v.name + '\n' + v.purpose))) return fail('CONTENT_REJECTED')

  const booking = {
    id: makeId(ctx.nowMs),
    startMin: v.startMin,
    endMin: v.endMin,
    name: v.name,
    purpose: v.purpose,
    openid: ctx.openid,
    nickname: me.nickname || (me.isAdmin ? me.account : ''),
    avatar: me.avatar,
    createdAt: ctx.nowMs
  }
  if (requestId) booking.requestId = requestId
  const record = Object.assign({ instrumentId, date: v.date, status: 'active' }, booking)
  delete record.requestId

  const outcome = await ctx.store.updateDay(instrumentId, v.date, (day) => {
    // A retry of a request that already went through (e.g. its response was lost).
    const earlier = requestId && day.bookings.find((b) => b.openid === ctx.openid && b.requestId === requestId)
    if (earlier) {
      if (earlier.startMin !== v.startMin || earlier.endMin !== v.endMin) return { error: 'BAD_REQUEST' }
      if (earlier.name === v.name && earlier.purpose === v.purpose) return { booking: earlier }
      // The user corrected the text before retrying: keep the latest.
      earlier.name = v.name
      earlier.purpose = v.purpose
      return { day, booking: earlier, records: [{ id: earlier.id, data: { name: v.name, purpose: v.purpose }, merge: true }] }
    }
    if (findConflict(day.bookings, v.startMin, v.endMin)) return { error: 'CONFLICT' }
    day.bookings.push(booking)
    day.bookings.sort((a, b) => a.startMin - b.startMin)
    return { day, booking, records: [{ id: booking.id, data: record, merge: false }] }
  })
  if (outcome.error) return fail(outcome.error)
  return { ok: true, booking: calendarBooking(outcome.booking, instrumentId, v.date, ctx, localNow(ctx.nowMs)) }
}

async function cancelAction(event, ctx) {
  const { instrumentId, date, id } = event
  if (!isInstrument(instrumentId) || !isDateString(date) || typeof id !== 'string' || !id) {
    return fail('BAD_REQUEST')
  }
  const now = localNow(ctx.nowMs)
  if (date > bookingWindow(ctx.nowMs).lastDate) return fail('NOT_FOUND')
  const me = meOf(ctx)
  const outcome = await ctx.store.updateDay(
    instrumentId,
    date,
    (day) => {
      const target = day.bookings.find((b) => b.id === id)
      if (!target) return { error: 'NOT_FOUND' }
      const own = target.openid === ctx.openid
      if (!own && !ctx.isAdmin) return { error: 'FORBIDDEN' }
      if (isPast(date, target.endMin, now)) return { error: 'ALREADY_ENDED' }
      day.bookings = day.bookings.filter((b) => b.id !== id)
      const cancelled = {
        status: 'cancelled',
        cancelledAt: ctx.nowMs,
        cancelledBy: own ? 'self' : 'admin',
        cancelledByName: own ? me.nickname : me.account
      }
      return { day, records: [{ id, data: cancelled, merge: true }] }
    },
    { create: false }
  )
  if (outcome.error) return fail(outcome.error)
  return { ok: true }
}

async function myBookingsAction(event, ctx) {
  const now = localNow(ctx.nowMs)
  const records = (await ctx.store.listRecords({ openid: ctx.openid })) || []
  const views = records.map((r) => recordView(r, ctx, now))
  const upcoming = views.filter((r) => r.status === 'booked').sort(byDateAndStart)
  const history = views
    .filter((r) => r.status !== 'booked')
    .sort((a, b) => -byDateAndStart(a, b))
    .slice(0, 100)
  return { ok: true, upcoming, history, me: meOf(ctx), serverTime: ctx.nowMs }
}

function summarize(views) {
  const active = views.filter((r) => r.status !== 'cancelled')
  return {
    total: views.length,
    active: active.length,
    cancelled: views.length - active.length,
    hours: Math.round((active.reduce((n, r) => n + (r.endMin - r.startMin), 0) / 60) * 10) / 10
  }
}

async function adminRecordsAction(event, ctx) {
  const denied = requireAdmin(ctx)
  if (denied) return denied
  const { instrumentId, month } = event
  if (!isInstrument(instrumentId) || !isMonthString(month)) return fail('BAD_REQUEST')
  const now = localNow(ctx.nowMs)
  const range = monthRange(month)
  const [records, suspended] = await Promise.all([
    ctx.store.listRecords({ instrumentId, from: range.from, to: range.to }),
    suspendedMap(ctx)
  ])
  const views = (records || []).map((r) => recordView(r, ctx, now)).sort(byDateAndStart)
  return { ok: true, month, records: views, summary: summarize(views), suspended: suspended[instrumentId] || null, me: meOf(ctx) }
}

const EXPORT_TEXT = {
  zh: {
    headers: ['日期', '星期', '開始', '結束', '時長（小時）', '姓名', '用途', '微信暱稱', '微信用戶 ID', '狀態', '預約時間', '取消時間', '取消人'],
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    status: { booked: '已預約', completed: '已完成', cancelled: '已取消' },
    by: { self: '本人', admin: '管理員' },
    all: '全部'
  },
  en: {
    headers: ['Date', 'Day', 'Start', 'End', 'Hours', 'Name', 'Purpose', 'WeChat nickname', 'WeChat user ID', 'Status', 'Booked at', 'Cancelled at', 'Cancelled by'],
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    status: { booked: 'Booked', completed: 'Completed', cancelled: 'Cancelled' },
    by: { self: 'Booker', admin: 'Admin' },
    all: 'all'
  }
}
const EXPORT_WIDTHS = [12, 6, 8, 8, 12, 14, 36, 16, 32, 10, 18, 18, 14]

async function exportRecordsAction(event, ctx) {
  const denied = requireAdmin(ctx)
  if (denied) return denied
  const { instrumentId, month } = event
  const text = EXPORT_TEXT[event.lang] || EXPORT_TEXT.zh
  if (!isInstrument(instrumentId) || (month != null && !isMonthString(month))) return fail('BAD_REQUEST')
  const query = month ? Object.assign({ instrumentId }, monthRange(month)) : { instrumentId }
  const now = localNow(ctx.nowMs)
  const views = ((await ctx.store.listRecords(query)) || []).map((r) => recordView(r, ctx, now)).sort(byDateAndStart)
  if (!views.length) return fail('NOTHING_TO_EXPORT')

  const rows = views.map((r) => [
    r.date,
    text.weekdays[weekdayOf(r.date)],
    minutesToText(r.startMin),
    minutesToText(r.endMin),
    (r.endMin - r.startMin) / 60,
    r.name,
    r.purpose,
    r.nickname,
    r.openid,
    text.status[r.status],
    formatTimestamp(r.createdAt),
    formatTimestamp(r.cancelledAt),
    r.cancelledBy ? text.by[r.cancelledBy] + (r.cancelledByName ? '（' + r.cancelledByName + '）' : '') : ''
  ])
  const label = instrumentLabel(instrumentId, event.lang === 'en' ? 'en' : 'zh').replace(/[\\/:*?"<>|\s]+/g, '')
  const period = month || text.all
  const bytes = xlsx.buildXlsx({
    sheetName: period,
    columns: text.headers.map((header, i) => ({ header, width: EXPORT_WIDTHS[i] })),
    rows
  })
  const file = await ctx.saveFile(bytes, label + '_' + period + '.xlsx')
  // Keep only the latest export per admin in cloud storage.
  const previous = ctx.user && ctx.user.lastExport
  if (previous && ctx.deleteFile) await Promise.resolve(ctx.deleteFile(previous)).catch(() => {})
  if (file.fileID) await ctx.store.saveUser(ctx.openid, Object.assign({}, ctx.user, { lastExport: file.fileID }))
  return { ok: true, file: Object.assign({ name: label + '_' + period + '.xlsx' }, file), count: views.length }
}

async function setSuspendedAction(event, ctx) {
  const denied = requireAdmin(ctx)
  if (denied) return denied
  const { instrumentId } = event
  if (!isInstrument(instrumentId) || typeof event.suspended !== 'boolean') return fail('BAD_REQUEST')
  const reason = cleanText(event.reason)
  if (textLength(reason) > SUSPEND_REASON_MAX) return fail('REASON_TOO_LONG')
  const status = {
    suspended: event.suspended,
    reason: event.suspended ? reason : '',
    updatedAt: ctx.nowMs,
    updatedBy: ctx.user.admin.account
  }
  await ctx.store.setStatus(instrumentId, status)
  return { ok: true, suspended: event.suspended ? { reason: status.reason, since: status.updatedAt } : null }
}

module.exports = {
  SLOT_MINUTES,
  DAY_START_MINUTES,
  DAY_END_MINUTES,
  TZ_OFFSET_MINUTES,
  WEEKS_VISIBLE,
  NAME_MAX,
  PURPOSE_MAX,
  NICKNAME_MAX,
  SUSPEND_REASON_MAX,
  ADMIN_MAX_FAILURES,
  pad2,
  isDateString,
  isMonthString,
  monthRange,
  addDays,
  weekdayOf,
  mondayOf,
  localNow,
  bookingWindow,
  weekDates,
  minutesToText,
  formatTimestamp,
  overlaps,
  isPast,
  firstOpenStart,
  findConflict,
  cleanText,
  textLength,
  validateBooking,
  makeId,
  normalizeDay,
  recordStatus,
  isInstrument,
  handleAction
}
