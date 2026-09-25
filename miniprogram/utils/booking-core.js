/**
 * Booking rules shared by the mini program and the `booking` cloud function.
 *
 * The same file lives at:
 *   miniprogram/utils/booking-core.js      (source of truth)
 *   cloudfunctions/booking/booking-core.js (copy, refresh with `npm run sync`)
 * `npm test` fails if the two copies differ.
 *
 * Dates are 'YYYY-MM-DD' strings in Macau local time. Times are minutes from
 * midnight (e.g. 570 = 09:30). A booking covers [startMin, endMin).
 */

const SLOT_MINUTES = 30
const DAY_START_MINUTES = 8 * 60 // first bookable slot starts 08:00
const DAY_END_MINUTES = 22 * 60 // last slot ends 22:00
const TZ_OFFSET_MINUTES = 8 * 60 // Macau is UTC+8 all year
const WEEKS_VISIBLE = 2 // this week + next week
const NAME_MAX = 30
const PURPOSE_MAX = 200
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

function makeId(nowMs) {
  return nowMs.toString(36) + Math.random().toString(36).slice(2, 10)
}

function byDateAndStart(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return a.startMin - b.startMin
}

function normalizeDay(day) {
  return {
    bookings: day && Array.isArray(day.bookings) ? day.bookings.slice() : [],
    cancelled: day && Array.isArray(day.cancelled) ? day.cancelled.slice() : []
  }
}

/** What clients may see: never the booker's openid. */
function publicBooking(b, instrumentId, date, ctx, now) {
  const mine = !!ctx.openid && b.openid === ctx.openid
  return {
    id: b.id,
    instrumentId,
    date,
    startMin: b.startMin,
    endMin: b.endMin,
    name: b.name,
    purpose: b.purpose,
    mine,
    canCancel: (mine || !!ctx.isAdmin) && !isPast(date, b.endMin, now)
  }
}

/*
 * Action handler shared by the cloud function and the offline demo.
 * `ctx` supplies the environment:
 *   store.listDays(instrumentId, fromDate, toDate) -> Promise<day[]>
 *     day = { instrumentId, date, bookings: [...], cancelled: [...] }
 *   store.updateDay(instrumentId, date, mutate, { create }) -> Promise<outcome>
 *     Runs mutate(day) atomically and resolves to its return value.
 *     mutate returns { day, ... } to save the day, { error } to leave it
 *     untouched, or an outcome without `day` when nothing needs saving.
 *     With create: false a missing day document is not created.
 *   openid, isAdmin, nowMs, isInstrument(id), checkText(text) (optional)
 */
async function handleAction(event, ctx) {
  const action = event && event.action
  if (action === 'list') return listAction(event, ctx)
  if (action === 'create') return createAction(event, ctx)
  if (action === 'cancel') return cancelAction(event, ctx)
  return fail('BAD_REQUEST')
}

async function listAction(event, ctx) {
  const { instrumentId } = event
  if (!ctx.isInstrument(instrumentId)) return fail('BAD_INSTRUMENT')
  const win = bookingWindow(ctx.nowMs)
  const now = { date: win.today, minutes: win.nowMinutes }
  const days = await ctx.store.listDays(instrumentId, win.firstDate, win.lastDate)
  const bookings = []
  ;(days || []).forEach((day) => {
    normalizeDay(day).bookings.forEach((b) => {
      bookings.push(publicBooking(b, instrumentId, day.date, ctx, now))
    })
  })
  bookings.sort(byDateAndStart)
  return { ok: true, bookings, isAdmin: !!ctx.isAdmin, serverTime: ctx.nowMs }
}

async function createAction(event, ctx) {
  if (!ctx.openid) return fail('UNAUTHORIZED')
  const { instrumentId, requestId } = event
  if (!ctx.isInstrument(instrumentId)) return fail('BAD_INSTRUMENT')
  if (requestId != null && !(typeof requestId === 'string' && /^[\w-]{1,64}$/.test(requestId))) return fail('BAD_REQUEST')
  const checked = validateBooking(event, ctx.nowMs)
  if (!checked.ok) return checked
  const v = checked.value

  if (ctx.checkText && !(await ctx.checkText(v.name + '\n' + v.purpose))) return fail('CONTENT_REJECTED')

  const booking = {
    id: makeId(ctx.nowMs),
    startMin: v.startMin,
    endMin: v.endMin,
    name: v.name,
    purpose: v.purpose,
    openid: ctx.openid,
    createdAt: ctx.nowMs
  }
  if (requestId) booking.requestId = requestId
  const outcome = await ctx.store.updateDay(instrumentId, v.date, (day) => {
    // A retry of a request that already went through (e.g. its response was lost).
    const earlier = requestId && day.bookings.find((b) => b.openid === ctx.openid && b.requestId === requestId)
    if (earlier) {
      if (earlier.startMin !== v.startMin || earlier.endMin !== v.endMin) return { error: 'BAD_REQUEST' }
      if (earlier.name === v.name && earlier.purpose === v.purpose) return { booking: earlier }
      // The user corrected the text before retrying: keep the latest.
      earlier.name = v.name
      earlier.purpose = v.purpose
      return { day, booking: earlier }
    }
    if (findConflict(day.bookings, v.startMin, v.endMin)) return { error: 'CONFLICT' }
    day.bookings.push(booking)
    day.bookings.sort((a, b) => a.startMin - b.startMin)
    return { day, booking }
  })
  if (outcome.error) return fail(outcome.error)
  const now = localNow(ctx.nowMs)
  return { ok: true, booking: publicBooking(outcome.booking, instrumentId, v.date, ctx, now) }
}

async function cancelAction(event, ctx) {
  if (!ctx.openid) return fail('UNAUTHORIZED')
  const { instrumentId, date, id } = event
  if (!ctx.isInstrument(instrumentId) || !isDateString(date) || typeof id !== 'string' || !id) {
    return fail('BAD_REQUEST')
  }
  const now = localNow(ctx.nowMs)
  if (date > bookingWindow(ctx.nowMs).lastDate) return fail('NOT_FOUND')
  const outcome = await ctx.store.updateDay(
    instrumentId,
    date,
    (day) => {
      const target = day.bookings.find((b) => b.id === id)
      if (!target) return { error: 'NOT_FOUND' }
      if (target.openid !== ctx.openid && !ctx.isAdmin) return { error: 'FORBIDDEN' }
      if (isPast(date, target.endMin, now)) return { error: 'ALREADY_ENDED' }
      day.bookings = day.bookings.filter((b) => b.id !== id)
      day.cancelled.push(Object.assign({}, target, { cancelledAt: ctx.nowMs, cancelledBy: ctx.openid }))
      return { day }
    },
    { create: false }
  )
  if (outcome.error) return fail(outcome.error)
  return { ok: true }
}

module.exports = {
  SLOT_MINUTES,
  DAY_START_MINUTES,
  DAY_END_MINUTES,
  TZ_OFFSET_MINUTES,
  WEEKS_VISIBLE,
  NAME_MAX,
  PURPOSE_MAX,
  pad2,
  isDateString,
  addDays,
  weekdayOf,
  mondayOf,
  localNow,
  bookingWindow,
  weekDates,
  minutesToText,
  overlaps,
  isPast,
  firstOpenStart,
  findConflict,
  cleanText,
  textLength,
  validateBooking,
  makeId,
  normalizeDay,
  handleAction
}
