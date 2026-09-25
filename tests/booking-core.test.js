const core = require('../miniprogram/utils/booking-core')

// Friday 25 Sep 2026, 10:40 in Macau.
const NOW = Date.parse('2026-09-25T02:40:00Z')
const macau = (iso) => Date.parse(iso + '+08:00')

function memoryStore() {
  const days = {}
  return {
    days,
    async listDays(instrumentId, from, to) {
      return Object.values(days).filter((d) => d.instrumentId === instrumentId && d.date >= from && d.date <= to)
    },
    async updateDay(instrumentId, date, mutate) {
      const key = instrumentId + '_' + date
      const outcome = mutate(core.normalizeDay(JSON.parse(JSON.stringify(days[key] || null))))
      if (outcome.error) return outcome
      days[key] = Object.assign({ instrumentId, date }, outcome.day)
      return outcome
    }
  }
}

function ctx(store, openid, extra) {
  return Object.assign(
    { store, openid, isAdmin: false, nowMs: NOW, isInstrument: (id) => id === 'ball-mill' || id === 'centrifuge' },
    extra
  )
}

const request = (extra) =>
  Object.assign(
    { action: 'create', instrumentId: 'ball-mill', date: '2026-09-28', startMin: 600, endMin: 720, name: '陳大文', purpose: '研磨粉煤灰' },
    extra
  )

describe('dates and time zone', () => {
  test('localNow uses Macau time regardless of the UTC date', () => {
    expect(core.localNow(Date.parse('2026-09-24T16:30:00Z'))).toEqual({ date: '2026-09-25', minutes: 30 })
    expect(core.localNow(NOW)).toEqual({ date: '2026-09-25', minutes: 640 })
  })

  test('weeks run Monday to Sunday', () => {
    expect(core.mondayOf('2026-09-21')).toBe('2026-09-21')
    expect(core.mondayOf('2026-09-27')).toBe('2026-09-21')
    expect(core.mondayOf('2026-10-01')).toBe('2026-09-28')
    expect(core.weekDates('2026-09-28')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'
    ])
  })

  test('booking window covers this week and next week', () => {
    expect(core.bookingWindow(NOW)).toEqual({
      today: '2026-09-25',
      nowMinutes: 640,
      weekStarts: ['2026-09-21', '2026-09-28'],
      firstDate: '2026-09-21',
      lastDate: '2026-10-04'
    })
    // Sunday 23:59 is still the old week; one minute later a new one starts.
    expect(core.bookingWindow(macau('2026-09-27T23:59:00')).weekStarts).toEqual(['2026-09-21', '2026-09-28'])
    expect(core.bookingWindow(macau('2026-09-28T00:00:00')).weekStarts).toEqual(['2026-09-28', '2026-10-05'])
  })

  test('date helpers handle month and year ends', () => {
    expect(core.addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(core.addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(core.isDateString('2026-02-30')).toBe(false)
    expect(core.isDateString('2026-9-5')).toBe(false)
    expect(core.isDateString(20260925)).toBe(false)
  })

  test('minutesToText pads hours and minutes', () => {
    expect(core.minutesToText(480)).toBe('08:00')
    expect(core.minutesToText(1290)).toBe('21:30')
  })

  test('firstOpenStart counts the slot that contains now', () => {
    const now = { date: '2026-09-25', minutes: 640 }
    expect(core.firstOpenStart('2026-09-25', now)).toBe(630)
    expect(core.firstOpenStart('2026-09-26', now)).toBe(core.DAY_START_MINUTES)
    expect(core.firstOpenStart('2026-09-24', now)).toBe(core.DAY_END_MINUTES)
    expect(core.firstOpenStart('2026-09-25', { date: '2026-09-25', minutes: 300 })).toBe(core.DAY_START_MINUTES)
  })
})

describe('validateBooking', () => {
  const valid = { date: '2026-09-25', startMin: 660, endMin: 720, name: ' 陳大文 ', purpose: ' 測試\n  導熱係數 ' }
  const check = (extra) => core.validateBooking(Object.assign({}, valid, extra), NOW)

  test('accepts a good request and cleans the text', () => {
    expect(check()).toEqual({
      ok: true,
      value: { date: '2026-09-25', startMin: 660, endMin: 720, name: '陳大文', purpose: '測試 導熱係數' }
    })
  })

  test.each([
    ['impossible date', { date: '2026-02-30' }, 'INVALID_DATE'],
    ['missing date', { date: undefined }, 'INVALID_DATE'],
    ['start not on a half hour', { startMin: 665 }, 'INVALID_TIME'],
    ['start as a string', { startMin: '660' }, 'INVALID_TIME'],
    ['empty range', { endMin: 660 }, 'INVALID_TIME'],
    ['before opening', { startMin: 450, endMin: 540 }, 'INVALID_TIME'],
    ['after closing', { startMin: 1290, endMin: 1350 }, 'INVALID_TIME'],
    ['week after next', { date: '2026-10-05' }, 'OUT_OF_RANGE'],
    ['yesterday', { date: '2026-09-24' }, 'IN_PAST'],
    ['earlier today', { startMin: 600, endMin: 630 }, 'IN_PAST'],
    ['blank name', { name: '   ' }, 'NAME_REQUIRED'],
    ['31-character name', { name: 'x'.repeat(31) }, 'NAME_TOO_LONG'],
    ['empty purpose', { purpose: '' }, 'PURPOSE_REQUIRED'],
    ['201-character purpose', { purpose: '測'.repeat(201) }, 'PURPOSE_TOO_LONG']
  ])('%s', (label, extra, code) => {
    expect(check(extra)).toEqual({ ok: false, code })
  })

  test('the slot containing now can still be booked', () => {
    expect(check({ startMin: 630, endMin: 690 }).ok).toBe(true)
  })

  test('limits count characters, not UTF-16 units', () => {
    expect(check({ name: '😀'.repeat(30) }).ok).toBe(true)
    expect(check({ purpose: '測'.repeat(200) }).ok).toBe(true)
  })

  test('the whole last day of next week is bookable', () => {
    expect(check({ date: '2026-10-04', startMin: 1290, endMin: 1320 }).ok).toBe(true)
  })
})

describe('findConflict', () => {
  const bookings = [{ id: 'a', startMin: 600, endMin: 660 }]
  test('touching bookings do not conflict', () => {
    expect(core.findConflict(bookings, 660, 720)).toBeNull()
    expect(core.findConflict(bookings, 540, 600)).toBeNull()
  })
  test('overlaps are found', () => {
    expect(core.findConflict(bookings, 630, 690)).toBe(bookings[0])
    expect(core.findConflict(bookings, 540, 720)).toBe(bookings[0])
  })
})

describe('handleAction', () => {
  test('create then list; the booker sees it as theirs, others do not', async () => {
    const store = memoryStore()
    const created = await core.handleAction(request(), ctx(store, 'u1'))
    expect(created.ok).toBe(true)
    expect(created.booking).toMatchObject({ instrumentId: 'ball-mill', date: '2026-09-28', startMin: 600, endMin: 720, mine: true, canCancel: true })

    const mine = await core.handleAction({ action: 'list', instrumentId: 'ball-mill' }, ctx(store, 'u1'))
    const theirs = await core.handleAction({ action: 'list', instrumentId: 'ball-mill' }, ctx(store, 'u2'))
    expect(mine.bookings).toHaveLength(1)
    expect(mine.bookings[0].mine).toBe(true)
    expect(theirs.bookings[0]).toMatchObject({ name: '陳大文', purpose: '研磨粉煤灰', mine: false, canCancel: false })
    expect(theirs.serverTime).toBe(NOW)
  })

  test('list never exposes openids', async () => {
    const store = memoryStore()
    await core.handleAction(request(), ctx(store, 'secret-openid'))
    const res = await core.handleAction({ action: 'list', instrumentId: 'ball-mill' }, ctx(store, 'u2'))
    expect(JSON.stringify(res)).not.toContain('secret-openid')
  })

  test('list is limited to the booking window and sorted', async () => {
    const store = memoryStore()
    store.days['ball-mill_2026-10-05'] = { instrumentId: 'ball-mill', date: '2026-10-05', bookings: [{ id: 'late', startMin: 600, endMin: 660 }] }
    store.days['ball-mill_2026-09-29'] = { instrumentId: 'ball-mill', date: '2026-09-29', bookings: [{ id: 'b', startMin: 900, endMin: 960 }, { id: 'a', startMin: 600, endMin: 660 }] }
    store.days['ball-mill_2026-09-22'] = { instrumentId: 'ball-mill', date: '2026-09-22', bookings: [{ id: 'past', startMin: 600, endMin: 660, openid: 'u1' }] }
    const res = await core.handleAction({ action: 'list', instrumentId: 'ball-mill' }, ctx(store, 'u1'))
    expect(res.bookings.map((b) => b.id)).toEqual(['past', 'a', 'b'])
    expect(res.bookings.find((b) => b.id === 'past')).toMatchObject({ mine: true, canCancel: false })
  })

  test('overlapping bookings are refused, touching ones are fine', async () => {
    const store = memoryStore()
    await core.handleAction(request(), ctx(store, 'u1'))
    expect(await core.handleAction(request({ startMin: 690, endMin: 750 }), ctx(store, 'u2'))).toEqual({ ok: false, code: 'CONFLICT' })
    expect((await core.handleAction(request({ startMin: 720, endMin: 780 }), ctx(store, 'u2'))).ok).toBe(true)
    // Same time on another instrument is independent.
    expect((await core.handleAction(request({ instrumentId: 'centrifuge' }), ctx(store, 'u2'))).ok).toBe(true)
    expect(store.days['ball-mill_2026-09-28'].bookings.map((b) => b.startMin)).toEqual([600, 720])
  })

  test('requests without an openid or with unknown instruments are refused', async () => {
    const store = memoryStore()
    expect(await core.handleAction(request(), ctx(store, ''))).toEqual({ ok: false, code: 'UNAUTHORIZED' })
    expect(await core.handleAction(request({ instrumentId: 'nope' }), ctx(store, 'u1'))).toEqual({ ok: false, code: 'BAD_INSTRUMENT' })
    expect(await core.handleAction({ action: 'list', instrumentId: 'nope' }, ctx(store, 'u1'))).toEqual({ ok: false, code: 'BAD_INSTRUMENT' })
    expect(await core.handleAction({ action: 'drop' }, ctx(store, 'u1'))).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await core.handleAction(null, ctx(store, 'u1'))).toEqual({ ok: false, code: 'BAD_REQUEST' })
  })

  test('validation errors are passed through', async () => {
    const res = await core.handleAction(request({ purpose: ' ' }), ctx(memoryStore(), 'u1'))
    expect(res).toEqual({ ok: false, code: 'PURPOSE_REQUIRED' })
  })

  test('content check can reject a booking', async () => {
    const store = memoryStore()
    const checkText = jest.fn().mockResolvedValue(false)
    expect(await core.handleAction(request(), ctx(store, 'u1', { checkText }))).toEqual({ ok: false, code: 'CONTENT_REJECTED' })
    expect(checkText).toHaveBeenCalledWith('陳大文\n研磨粉煤灰')
    expect(store.days).toEqual({})
  })

  test('only the owner or an admin can cancel, and only before the booking ends', async () => {
    const store = memoryStore()
    const { booking } = await core.handleAction(request(), ctx(store, 'u1'))
    const cancel = { action: 'cancel', instrumentId: 'ball-mill', date: booking.date, id: booking.id }

    expect(await core.handleAction(cancel, ctx(store, 'u2'))).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await core.handleAction(cancel, ctx(store, 'admin', { isAdmin: true }))).toEqual({ ok: true })
    expect(await core.handleAction(cancel, ctx(store, 'u1'))).toEqual({ ok: false, code: 'NOT_FOUND' })

    const day = store.days['ball-mill_2026-09-28']
    expect(day.bookings).toEqual([])
    expect(day.cancelled[0]).toMatchObject({ id: booking.id, openid: 'u1', cancelledBy: 'admin', cancelledAt: NOW })

    // The slot is free again.
    expect((await core.handleAction(request(), ctx(store, 'u3'))).ok).toBe(true)
  })

  test('a booking that has ended cannot be cancelled', async () => {
    const store = memoryStore()
    store.days['ball-mill_2026-09-25'] = {
      instrumentId: 'ball-mill',
      date: '2026-09-25',
      bookings: [{ id: 'old', startMin: 540, endMin: 600, openid: 'u1' }, { id: 'now', startMin: 600, endMin: 660, openid: 'u1' }]
    }
    const cancel = (id) => core.handleAction({ action: 'cancel', instrumentId: 'ball-mill', date: '2026-09-25', id }, ctx(store, 'u1'))
    expect(await cancel('old')).toEqual({ ok: false, code: 'ALREADY_ENDED' })
    expect(await cancel('now')).toEqual({ ok: true })
  })

  test('malformed cancel requests are refused', async () => {
    const store = memoryStore()
    const c = ctx(store, 'u1')
    expect(await core.handleAction({ action: 'cancel', instrumentId: 'ball-mill', date: 'x', id: 'a' }, c)).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await core.handleAction({ action: 'cancel', instrumentId: 'ball-mill', date: '2026-09-28', id: 5 }, c)).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await core.handleAction({ action: 'cancel', instrumentId: 'ball-mill', date: '2026-09-28' }, ctx(store, ''))).toEqual({ ok: false, code: 'UNAUTHORIZED' })
  })
})
