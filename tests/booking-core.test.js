const core = require('../miniprogram/shared/booking-core')
const { table, readXlsx } = require('./support/xlsx-reader')

// Friday 25 Sep 2026, 10:40 in Macau.
const NOW = Date.parse('2026-09-25T02:40:00Z')
const macau = (iso) => Date.parse(iso + '+08:00')

const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

function memoryStore() {
  const s = { days: {}, records: {}, users: {}, statuses: {} }
  return Object.assign(s, {
    async listDays(instrumentId, from, to) {
      return copy(Object.values(s.days).filter((d) => d.instrumentId === instrumentId && d.date >= from && d.date <= to))
    },
    async updateDay(instrumentId, date, mutate, options) {
      const key = instrumentId + '_' + date
      if (!s.days[key] && options && options.create === false) s.created = s.created || []
      const outcome = mutate(core.normalizeDay(copy(s.days[key] || null)))
      if (outcome.error) return outcome
      if (outcome.day) s.days[key] = Object.assign({ instrumentId, date }, copy(outcome.day))
      ;(outcome.records || []).forEach((r) => {
        s.records[r.id] = r.merge ? Object.assign({}, s.records[r.id], copy(r.data)) : copy(r.data)
      })
      return outcome
    },
    async getUser(openid) {
      return copy(s.users[openid] || null)
    },
    async updateUser(openid, mutate) {
      if (s.beforeUserUpdate) await s.beforeUserUpdate()
      const outcome = mutate(copy(s.users[openid] || null)) || {}
      if (outcome.error || !outcome.fields) return outcome
      s.users[openid] = Object.assign({}, s.users[openid], copy(outcome.fields))
      return outcome
    },
    async listRecords(q) {
      const records = Object.keys(s.records)
        .map((id) => Object.assign({}, copy(s.records[id]), { id }))
        .filter((r) => (q.openid ? r.openid === q.openid : r.instrumentId === q.instrumentId && (!q.from || (r.date >= q.from && r.date <= q.to))))
      return { records, truncated: !!s.truncated }
    },
    async getStatuses() {
      return copy(s.statuses)
    },
    async setStatus(id, status) {
      s.statuses[id] = copy(status)
    }
  })
}

// The configured admin account; changing `adminKey` is like changing its password.
let adminKey
let verifyCalls
beforeEach(() => {
  adminKey = 'key-1'
  verifyCalls = 0
})
const admins = {
  configured: true,
  verify: async (a, p) => {
    verifyCalls++
    return a === 'admin' && p === 'secret' ? adminKey : null
  },
  isActive: (session) => session.account === 'admin' && session.key === adminKey
}

function ctx(store, openid, extra) {
  return Object.assign(
    {
      store,
      openid,
      nowMs: NOW,
      admins,
      saveFile: async (bytes, name) => ({ path: '/tmp/' + name, bytes })
    },
    extra
  )
}

const act = (store, openid, event, extra) => core.handleAction(event, ctx(store, openid, extra))
const login = (store, openid, nickname = 'Nick-' + openid) => act(store, openid, { action: 'login', nickname })
const adminLogin = (store, openid, extra) => act(store, openid, { action: 'adminLogin', account: 'admin', password: 'secret' }, extra)

/** A store with users u1, u2, u3 logged in and 'admin' logged in as administrator. */
async function setupStore() {
  const store = memoryStore()
  await login(store, 'u1', '大文')
  await login(store, 'u2')
  await login(store, 'u3')
  await adminLogin(store, 'admin')
  return store
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

describe('login and profiles', () => {
  test('first login asks for a profile, later logins do not', async () => {
    const store = memoryStore()
    expect(await act(store, 'u1', { action: 'login' })).toMatchObject({ ok: true, needsProfile: true, me: { loggedIn: false } })
    expect(await act(store, 'u1', { action: 'login', nickname: '  ' })).toEqual({ ok: false, code: 'NICKNAME_REQUIRED' })
    expect(await act(store, 'u1', { action: 'login', nickname: 'x'.repeat(21) })).toEqual({ ok: false, code: 'NICKNAME_TOO_LONG' })
    const res = await act(store, 'u1', { action: 'login', nickname: ' 大文 ', avatar: 'cloud://a.jpg' })
    expect(res.me).toEqual({ loggedIn: true, nickname: '大文', avatar: 'cloud://a.jpg', isAdmin: false, account: '' })
    const again = await act(store, 'u1', { action: 'login' })
    expect(again.needsProfile).toBeUndefined()
    expect(again.me.nickname).toBe('大文')
    expect(store.users.u1.createdAt).toBe(NOW)
  })

  test('avatars must be of the allowed kind and nicknames pass the content check', async () => {
    const store = memoryStore()
    const strict = { isAvatarAllowed: (a) => a.indexOf('cloud://') === 0 }
    expect(await act(store, 'u1', { action: 'login', nickname: 'A', avatar: 'https://evil/pixel.png' }, strict)).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await act(store, 'u1', { action: 'login', nickname: 'A', avatar: 'a b' })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    const checkText = jest.fn().mockResolvedValue(false)
    expect(await act(store, 'u1', { action: 'login', nickname: 'Bad' }, { checkText })).toEqual({ ok: false, code: 'CONTENT_REJECTED' })
  })

  test('calls without a WeChat identity and unknown actions are refused', async () => {
    const store = memoryStore()
    expect(await act(store, '', { action: 'me' })).toEqual({ ok: false, code: 'UNAUTHORIZED' })
    expect(await act(store, 'u1', { action: 'drop' })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await act(store, 'u1', { action: 'constructor' })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await core.handleAction(null, ctx(store, 'u1'))).toEqual({ ok: false, code: 'BAD_REQUEST' })
  })
})

describe('administrator login', () => {
  test('right password: an admin for a week; logout ends it', async () => {
    const store = memoryStore()
    const res = await adminLogin(store, 'a1')
    expect(res).toMatchObject({ ok: true, me: { isAdmin: true, account: 'admin', loggedIn: false } })
    expect((await act(store, 'a1', { action: 'me' })).me.isAdmin).toBe(true)
    const weekLater = NOW + 7 * 24 * 3600 * 1000 + 1
    expect((await act(store, 'a1', { action: 'me' }, { nowMs: weekLater })).me.isAdmin).toBe(false)
    expect((await act(store, 'a1', { action: 'logout' })).me.isAdmin).toBe(false)
    expect((await act(store, 'a1', { action: 'me' })).me.isAdmin).toBe(false)
  })

  test('changing the password or removing the account ends existing admin sign-ins', async () => {
    const store = memoryStore()
    await adminLogin(store, 'a1')
    adminKey = 'key-2' // the password was changed
    expect((await act(store, 'a1', { action: 'me' })).me.isAdmin).toBe(false)
    expect(await act(store, 'a1', { action: 'adminRecords', instrumentId: 'ball-mill', month: '2026-09' })).toMatchObject({
      ok: false,
      code: 'ADMIN_REQUIRED',
      me: { isAdmin: false }
    })
    expect((await adminLogin(store, 'a1')).me.isAdmin).toBe(true) // signing in again works
    // No isActive check available: nobody counts as admin.
    expect((await act(store, 'a1', { action: 'me' }, { admins: { configured: true } })).me.isAdmin).toBe(false)
  })

  test('five wrong passwords lock the WeChat account for 15 minutes', async () => {
    const store = memoryStore()
    const wrong = () => act(store, 'a1', { action: 'adminLogin', account: 'admin', password: 'nope' })
    for (let left = 4; left >= 1; left--) expect(await wrong()).toEqual({ ok: false, code: 'INVALID_CREDENTIALS', attemptsLeft: left })
    expect(await wrong()).toEqual({ ok: false, code: 'TOO_MANY_ATTEMPTS', retryAfterMin: 15 })
    expect(await adminLogin(store, 'a1')).toEqual({ ok: false, code: 'TOO_MANY_ATTEMPTS', retryAfterMin: 15 })
    expect(verifyCalls).toBe(5) // no password is checked while locked
    expect((await adminLogin(store, 'a1', { nowMs: NOW + 16 * 60 * 1000 })).ok).toBe(true)
    // Other WeChat accounts are not affected.
    expect((await adminLogin(store, 'a2')).ok).toBe(true)
  })

  test('attempts are counted before the password is checked, so parallel ones cannot exceed the limit', async () => {
    const store = memoryStore()
    const results = await Promise.all(
      Array.from({ length: 12 }, () => act(store, 'a1', { action: 'adminLogin', account: 'admin', password: 'nope' }))
    )
    expect(verifyCalls).toBe(5)
    expect(results.filter((r) => r.code === 'INVALID_CREDENTIALS')).toHaveLength(4)
    expect(results.filter((r) => r.code === 'TOO_MANY_ATTEMPTS')).toHaveLength(8)
  })

  test('the fifth attempt is still checked: the right password then signs in', async () => {
    const store = memoryStore()
    for (let i = 0; i < 4; i++) await act(store, 'a1', { action: 'adminLogin', account: 'admin', password: 'nope' })
    expect((await adminLogin(store, 'a1')).ok).toBe(true)
    expect(store.users.a1.adminFail).toBeNull()
  })

  test('missing fields and unconfigured accounts', async () => {
    const store = memoryStore()
    expect(await act(store, 'a1', { action: 'adminLogin', account: '', password: 'x' })).toEqual({ ok: false, code: 'CREDENTIALS_REQUIRED' })
    expect(await act(store, 'a1', { action: 'adminLogin', account: 'admin' })).toEqual({ ok: false, code: 'CREDENTIALS_REQUIRED' })
    expect(await adminLogin(store, 'a1', { admins: { configured: false } })).toEqual({ ok: false, code: 'ADMIN_NOT_CONFIGURED' })
  })
})

describe('signing out', () => {
  test('a WeChat user who signed out cannot book until signing in again', async () => {
    const store = await setupStore()
    expect(await act(store, 'u1', { action: 'logout' })).toMatchObject({ ok: true, me: { loggedIn: false } })
    expect(await act(store, 'u1', request())).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN' })
    // WeChat sign-in again: the saved profile is used.
    expect((await act(store, 'u1', { action: 'login' })).me).toMatchObject({ loggedIn: true, nickname: '大文' })
    expect((await act(store, 'u1', request())).ok).toBe(true)
  })

  test('only the changed fields are written, so a slow export cannot undo a sign-out', async () => {
    const store = await setupStore()
    await act(store, 'u1', request())
    const saveFile = async () => {
      // Signed out on another device while the file was being made.
      await act(store, 'admin', { action: 'logout' })
      return { fileID: 'cloud://export-1' }
    }
    expect((await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill' }, { saveFile })).ok).toBe(true)
    expect(store.users.admin.admin).toBeNull()
    expect((await act(store, 'admin', { action: 'me' })).me.isAdmin).toBe(false)
  })

  test('signing out removes the last export from cloud storage', async () => {
    const store = await setupStore()
    await act(store, 'u1', request())
    const deleteFile = jest.fn()
    const saveFile = async () => ({ fileID: 'cloud://export-1' })
    await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill' }, { saveFile, deleteFile })
    await act(store, 'admin', { action: 'logout' }, { deleteFile })
    expect(deleteFile).toHaveBeenCalledWith('cloud://export-1')
    expect(store.users.admin.lastExport).toBeNull()
  })
})

describe('bookings', () => {
  test('booking needs a logged-in user or an admin', async () => {
    const store = memoryStore()
    expect(await act(store, 'u9', request())).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN', me: { loggedIn: false } })
    await adminLogin(store, 'a1')
    expect((await act(store, 'a1', request())).ok).toBe(true)
  })

  test('create then list; the booker sees it as theirs, others do not', async () => {
    const store = await setupStore()
    const created = await act(store, 'u1', request())
    expect(created.booking).toMatchObject({ instrumentId: 'ball-mill', date: '2026-09-28', startMin: 600, endMin: 720, mine: true, canCancel: true })

    const mine = await act(store, 'u1', { action: 'list', instrumentId: 'ball-mill' })
    const theirs = await act(store, 'u2', { action: 'list', instrumentId: 'ball-mill' })
    expect(mine.bookings[0].mine).toBe(true)
    expect(theirs.bookings[0]).toEqual({
      id: created.booking.id,
      instrumentId: 'ball-mill',
      date: '2026-09-28',
      startMin: 600,
      endMin: 720,
      name: '陳大文',
      purpose: '研磨粉煤灰',
      mine: false,
      canCancel: false
    })
    expect(theirs.serverTime).toBe(NOW)
    expect(theirs.me).toMatchObject({ loggedIn: true, isAdmin: false })
  })

  test('only administrators see which WeChat user made a booking', async () => {
    const store = await setupStore()
    await act(store, 'u1', request())
    const asUser = await act(store, 'u2', { action: 'list', instrumentId: 'ball-mill' })
    expect(asUser.bookings[0].openid).toBeUndefined()
    expect(asUser.bookings[0].nickname).toBeUndefined()
    expect(JSON.stringify(asUser)).not.toContain('"u1"')
    const asAdmin = await act(store, 'admin', { action: 'list', instrumentId: 'ball-mill' })
    expect(asAdmin.bookings[0]).toMatchObject({ openid: 'u1', nickname: '大文', createdAt: NOW, canCancel: true })
  })

  test('each booking is also kept as a record', async () => {
    const store = await setupStore()
    const { booking } = await act(store, 'u1', request())
    expect(store.records[booking.id]).toMatchObject({
      instrumentId: 'ball-mill',
      date: '2026-09-28',
      startMin: 600,
      endMin: 720,
      openid: 'u1',
      nickname: '大文',
      status: 'active',
      createdAt: NOW
    })
  })

  test('list is limited to the booking window and sorted', async () => {
    const store = await setupStore()
    store.days['ball-mill_2026-10-05'] = { instrumentId: 'ball-mill', date: '2026-10-05', bookings: [{ id: 'late', startMin: 600, endMin: 660 }] }
    store.days['ball-mill_2026-09-29'] = { instrumentId: 'ball-mill', date: '2026-09-29', bookings: [{ id: 'b', startMin: 900, endMin: 960 }, { id: 'a', startMin: 600, endMin: 660 }] }
    store.days['ball-mill_2026-09-22'] = { instrumentId: 'ball-mill', date: '2026-09-22', bookings: [{ id: 'past', startMin: 600, endMin: 660, openid: 'u1' }] }
    const res = await act(store, 'u1', { action: 'list', instrumentId: 'ball-mill' })
    expect(res.bookings.map((b) => b.id)).toEqual(['past', 'a', 'b'])
    expect(res.bookings[0]).toMatchObject({ mine: true, canCancel: false })
  })

  test('overlapping bookings are refused, touching ones are fine', async () => {
    const store = await setupStore()
    await act(store, 'u1', request())
    expect(await act(store, 'u2', request({ startMin: 690, endMin: 750 }))).toEqual({ ok: false, code: 'CONFLICT' })
    expect((await act(store, 'u2', request({ startMin: 720, endMin: 780 }))).ok).toBe(true)
    expect((await act(store, 'u2', request({ instrumentId: 'centrifuge' }))).ok).toBe(true)
    expect(store.days['ball-mill_2026-09-28'].bookings.map((b) => b.startMin)).toEqual([600, 720])
  })

  test('bad input is refused', async () => {
    const store = await setupStore()
    expect(await act(store, 'u1', request({ instrumentId: 'nope' }))).toEqual({ ok: false, code: 'BAD_INSTRUMENT' })
    expect(await act(store, 'u1', { action: 'list', instrumentId: 'nope' })).toEqual({ ok: false, code: 'BAD_INSTRUMENT' })
    expect(await act(store, 'u1', request({ purpose: ' ' }))).toEqual({ ok: false, code: 'PURPOSE_REQUIRED' })
    expect(await act(store, 'u1', request({ requestId: 'bad id' }))).toEqual({ ok: false, code: 'BAD_REQUEST' })
  })

  test('content check can reject a booking', async () => {
    const store = await setupStore()
    const checkText = jest.fn().mockResolvedValue(false)
    expect(await act(store, 'u1', request(), { checkText })).toEqual({ ok: false, code: 'CONTENT_REJECTED' })
    expect(checkText).toHaveBeenCalledWith('陳大文\n研磨粉煤灰')
    expect(store.days).toEqual({})
  })

  test('only the owner or an admin can cancel; the record keeps who did it', async () => {
    const store = await setupStore()
    const { booking } = await act(store, 'u1', request())
    const cancel = { action: 'cancel', instrumentId: 'ball-mill', date: booking.date, id: booking.id }
    expect(await act(store, 'u2', cancel)).toEqual({ ok: false, code: 'FORBIDDEN' })
    // An administrator whose sign-in has ended is told that, not "not yours".
    const later = NOW + 8 * 24 * 3600 * 1000
    expect(await act(store, 'admin', cancel, { nowMs: later })).toMatchObject({ ok: false, code: 'ADMIN_REQUIRED', me: { isAdmin: false } })
    expect(await act(store, 'admin', cancel)).toEqual({ ok: true })
    expect(await act(store, 'u1', cancel)).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(store.days['ball-mill_2026-09-28'].bookings).toEqual([])
    expect(store.records[booking.id]).toMatchObject({ status: 'cancelled', cancelledAt: NOW, cancelledBy: 'admin', cancelledByName: 'admin' })

    const again = await act(store, 'u3', request())
    await act(store, 'u3', { action: 'cancel', instrumentId: 'ball-mill', date: '2026-09-28', id: again.booking.id })
    expect(store.records[again.booking.id]).toMatchObject({ cancelledBy: 'self', cancelledByName: 'Nick-u3' })
  })

  test('a booking that has ended cannot be cancelled', async () => {
    const store = await setupStore()
    store.days['ball-mill_2026-09-25'] = {
      instrumentId: 'ball-mill',
      date: '2026-09-25',
      bookings: [{ id: 'old', startMin: 540, endMin: 600, openid: 'u1' }, { id: 'now', startMin: 600, endMin: 660, openid: 'u1' }]
    }
    const cancel = (id) => act(store, 'u1', { action: 'cancel', instrumentId: 'ball-mill', date: '2026-09-25', id })
    expect(await cancel('old')).toEqual({ ok: false, code: 'ALREADY_ENDED' })
    expect(await cancel('now')).toEqual({ ok: true })
  })

  test('malformed cancel requests are refused', async () => {
    const store = await setupStore()
    expect(await act(store, 'u1', { action: 'cancel', instrumentId: 'ball-mill', date: 'x', id: 'a' })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await act(store, 'u1', { action: 'cancel', instrumentId: 'ball-mill', date: '2026-09-28', id: 5 })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await act(store, 'u1', { action: 'cancel', instrumentId: 'ball-mill', date: '2030-01-01', id: 'a' })).toEqual({ ok: false, code: 'NOT_FOUND' })
  })
})

describe('my bookings', () => {
  test('upcoming (soonest first) and history (latest first, incl. cancelled)', async () => {
    const store = await setupStore()
    const a = (await act(store, 'u1', request({ date: '2026-09-30' }))).booking
    const b = (await act(store, 'u1', request({ date: '2026-09-28' }))).booking
    const c = (await act(store, 'u1', request({ date: '2026-09-29' }))).booking
    await act(store, 'u1', { action: 'cancel', instrumentId: 'ball-mill', date: c.date, id: c.id })
    await act(store, 'u2', request({ date: '2026-10-01' }))
    store.records.old = { instrumentId: 'centrifuge', date: '2026-09-01', startMin: 600, endMin: 660, openid: 'u1', status: 'active', name: 'X', purpose: 'Y' }

    const res = await act(store, 'u1', { action: 'myBookings' })
    expect(res.upcoming.map((r) => [r.id, r.status, r.canCancel])).toEqual([[b.id, 'booked', true], [a.id, 'booked', true]])
    expect(res.history.map((r) => [r.id, r.status, r.canCancel])).toEqual([[c.id, 'cancelled', false], ['old', 'completed', false]])
    expect(res.history[0].cancelledBy).toBe('self')
    expect(JSON.stringify(res)).not.toContain('openid')
  })
})

describe('administration', () => {
  test('records of an instrument by month, with who booked, including cancelled', async () => {
    const store = await setupStore()
    const a = (await act(store, 'u1', request())).booking
    const b = (await act(store, 'u2', request({ startMin: 780, endMin: 840 }))).booking
    await act(store, 'u2', { action: 'cancel', instrumentId: 'ball-mill', date: b.date, id: b.id })
    await act(store, 'u3', request({ date: '2026-10-01' }))
    await act(store, 'u3', request({ instrumentId: 'centrifuge' }))

    expect(await act(store, 'u1', { action: 'adminRecords', instrumentId: 'ball-mill', month: '2026-09' })).toMatchObject({ ok: false, code: 'ADMIN_REQUIRED' })
    expect(await act(store, 'admin', { action: 'adminRecords', instrumentId: 'ball-mill', month: '2026-9' })).toEqual({ ok: false, code: 'BAD_REQUEST' })

    const res = await act(store, 'admin', { action: 'adminRecords', instrumentId: 'ball-mill', month: '2026-09' })
    expect(res.records.map((r) => [r.id, r.status, r.openid, r.nickname])).toEqual([
      [a.id, 'booked', 'u1', '大文'],
      [b.id, 'cancelled', 'u2', 'Nick-u2']
    ])
    expect(res.summary).toEqual({ total: 2, active: 1, cancelled: 1, hours: 2 })
    expect(res.records[1]).toMatchObject({ cancelledBy: 'self', cancelledByName: 'Nick-u2' })
    const oct = await act(store, 'admin', { action: 'adminRecords', instrumentId: 'ball-mill', month: '2026-10' })
    expect(oct.records).toHaveLength(1)
  })

  test('suspending an instrument stops new bookings until it is resumed', async () => {
    const store = await setupStore()
    expect(await act(store, 'u1', { action: 'setSuspended', instrumentId: 'ball-mill', suspended: true })).toMatchObject({ ok: false, code: 'ADMIN_REQUIRED' })
    expect(await act(store, 'admin', { action: 'setSuspended', instrumentId: 'ball-mill', suspended: true, reason: 'x'.repeat(51) })).toEqual({ ok: false, code: 'REASON_TOO_LONG' })
    expect(await act(store, 'admin', { action: 'setSuspended', instrumentId: 'ball-mill', suspended: 'yes' })).toEqual({ ok: false, code: 'BAD_REQUEST' })

    expect(await act(store, 'admin', { action: 'setSuspended', instrumentId: 'ball-mill', suspended: true, reason: ' 維修中 ' })).toEqual({
      ok: true,
      suspended: { reason: '維修中', since: NOW },
      upcoming: 0
    })
    expect(store.statuses['ball-mill']).toMatchObject({ suspended: true, updatedBy: 'admin' })
    expect((await act(store, 'u1', { action: 'list', instrumentId: 'centrifuge' })).suspended).toEqual({ 'ball-mill': { reason: '維修中', since: NOW } })
    expect(await act(store, 'u1', request())).toEqual({ ok: false, code: 'SUSPENDED' })
    expect((await act(store, 'u1', request({ instrumentId: 'centrifuge' }))).ok).toBe(true)

    await act(store, 'admin', { action: 'setSuspended', instrumentId: 'ball-mill', suspended: false })
    expect((await act(store, 'u1', { action: 'list', instrumentId: 'ball-mill' })).suspended).toEqual({})
    expect((await act(store, 'u1', request())).ok).toBe(true)
  })

  test('export builds an Excel file of the month or of everything', async () => {
    const store = await setupStore()
    expect(await act(store, 'u1', { action: 'exportRecords', instrumentId: 'ball-mill', month: '2026-09' })).toMatchObject({ ok: false, code: 'ADMIN_REQUIRED' })
    expect(await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill', month: '2026-09' })).toEqual({ ok: false, code: 'NOTHING_TO_EXPORT' })

    const { booking } = await act(store, 'u1', request())
    await act(store, 'u1', { action: 'cancel', instrumentId: 'ball-mill', date: booking.date, id: booking.id })
    await act(store, 'u2', request({ startMin: 840, endMin: 930, purpose: 'A & B <test>' }))
    await act(store, 'u2', request({ date: '2026-10-02' }))

    let saved
    const saveFile = async (bytes, name) => {
      saved = { bytes, name }
      return { path: '/tmp/' + name }
    }
    const res = await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill', month: '2026-09', lang: 'zh' }, { saveFile })
    expect(res).toEqual({ ok: true, count: 2, file: { name: '立式行星球磨機_2026-09.xlsx', path: '/tmp/立式行星球磨機_2026-09.xlsx' } })
    const book = readXlsx(saved.bytes)
    expect(book.sheetName).toBe('2026-09')
    expect(book.rows[0].map((c) => c.value)).toEqual([
      '儀器', '日期', '星期', '開始', '結束', '時長（小時）', '姓名', '用途', '微信暱稱', '微信用戶 ID', '狀態', '提交時間', '取消時間', '取消人', '取消原因'
    ])
    expect(table(saved.bytes)).toEqual([
      {
        儀器: '立式行星球磨機',
        日期: '2026-09-28',
        星期: '一',
        開始: '10:00',
        結束: '12:00',
        '時長（小時）': 2,
        姓名: '陳大文',
        用途: '研磨粉煤灰',
        微信暱稱: '大文',
        '微信用戶 ID': 'u1',
        狀態: '已取消',
        提交時間: '2026-09-25 10:40',
        取消時間: '2026-09-25 10:40',
        取消人: '本人（大文）'
      },
      {
        儀器: '立式行星球磨機',
        日期: '2026-09-28',
        星期: '一',
        開始: '14:00',
        結束: '15:30',
        '時長（小時）': 1.5,
        姓名: '陳大文',
        用途: 'A & B <test>',
        微信暱稱: 'Nick-u2',
        '微信用戶 ID': 'u2',
        狀態: '已預約',
        提交時間: '2026-09-25 10:40'
      }
    ])
    // Dates and times are real spreadsheet values, not text.
    expect(book.rows[1][1]).toMatchObject({ type: 'n', value: 46293, format: 'yyyy-mm-dd' })

    const all = await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill', lang: 'en' }, { saveFile })
    expect(all.count).toBe(3)
    expect(all.file.name).toBe('VerticalPlanetaryBallMill_all.xlsx')
    const rows = table(saved.bytes)
    expect(rows[0]).toMatchObject({ Instrument: 'Vertical Planetary Ball Mill', Day: 'Mon', Status: 'Cancelled', 'Cancelled by': 'Booker (大文)' })
    expect(rows.map((r) => r.Date)).toEqual(['2026-09-28', '2026-09-28', '2026-10-02'])
  })

  test('text that XML cannot hold does not break the file', async () => {
    const store = await setupStore()
    store.records.odd = {
      instrumentId: 'ball-mill',
      date: '2026-09-28',
      startMin: 600,
      endMin: 660,
      openid: 'u1',
      status: 'active',
      name: 'A\u0001B\uFFFEC',
      purpose: 'lone \uD800 surrogate \u{1F600}',
      nickname: 'x\uFFFFy'
    }
    let saved
    const saveFile = async (bytes) => {
      saved = bytes
      return { path: '/tmp/x' }
    }
    expect((await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill' }, { saveFile })).ok).toBe(true)
    expect(table(saved)[0]).toMatchObject({ 姓名: 'ABC', 用途: 'lone  surrogate \u{1F600}', 微信暱稱: 'xy' })
  })

  test('an export too large to read at once asks for one month at a time', async () => {
    const store = await setupStore()
    await act(store, 'u1', request())
    store.truncated = true
    expect(await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill' })).toEqual({ ok: false, code: 'TOO_MANY_RECORDS' })
  })

  test('in the cloud the previous export of the same admin is deleted', async () => {
    const store = await setupStore()
    await act(store, 'u1', request())
    const deleteFile = jest.fn()
    let n = 0
    const saveFile = async () => ({ fileID: 'cloud://export-' + ++n })
    await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill' }, { saveFile, deleteFile })
    expect(deleteFile).not.toHaveBeenCalled()
    const res = await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill' }, { saveFile, deleteFile })
    expect(deleteFile).toHaveBeenCalledWith('cloud://export-1')
    expect(res.file.fileID).toBe('cloud://export-2')
    expect(store.users.admin.lastExport).toBe('cloud://export-2')
  })

  test('once downloaded, the export is removed from cloud storage', async () => {
    const store = await setupStore()
    await act(store, 'u1', request())
    const deleteFile = jest.fn()
    const saveFile = async () => ({ fileID: 'cloud://export-1' })
    await act(store, 'admin', { action: 'exportRecords', instrumentId: 'ball-mill' }, { saveFile, deleteFile })
    // Somebody else's file (or any other file) is left alone.
    expect(await act(store, 'u2', { action: 'discardExport', fileID: 'cloud://export-1' }, { deleteFile })).toEqual({ ok: true })
    expect(await act(store, 'admin', { action: 'discardExport', fileID: 'cloud://avatars/a.jpg' }, { deleteFile })).toEqual({ ok: true })
    expect(deleteFile).not.toHaveBeenCalled()
    expect(await act(store, 'admin', { action: 'discardExport', fileID: 'cloud://export-1' }, { deleteFile })).toEqual({ ok: true })
    expect(deleteFile).toHaveBeenCalledWith('cloud://export-1')
    expect(store.users.admin.lastExport).toBeNull()
    expect(await act(store, 'admin', { action: 'discardExport' })).toEqual({ ok: false, code: 'BAD_REQUEST' })
  })
})

describe('an instrument goes out of service', () => {
  async function withBookings() {
    const store = await setupStore()
    const past = (await act(store, 'u1', request({ date: '2026-09-25', startMin: 540, endMin: 600 }), { nowMs: NOW - 3 * 3600 * 1000 })).booking
    const running = (await act(store, 'u1', request({ date: '2026-09-25', startMin: 630, endMin: 720 }))).booking // 10:30–12:00, now 10:40
    const later = (await act(store, 'u2', request({ date: '2026-10-02' }))).booking
    const other = (await act(store, 'u2', request({ instrumentId: 'centrifuge' }))).booking
    return { store, past, running, later, other }
  }

  test('suspending reports how many bookings have not ended; their bookers see a notice', async () => {
    const { store } = await withBookings()
    const res = await act(store, 'admin', { action: 'setSuspended', instrumentId: 'ball-mill', suspended: true, reason: '轉子損壞' })
    expect(res).toMatchObject({ ok: true, upcoming: 2 })
    const mine = await act(store, 'u2', { action: 'myBookings' })
    expect(mine.upcoming.map((r) => [r.instrumentId, r.suspended])).toEqual([
      ['centrifuge', undefined],
      ['ball-mill', { reason: '轉子損壞' }]
    ])
  })

  test('the admin can cancel them all in one go; ended bookings stay', async () => {
    const { store, past, running, later, other } = await withBookings()
    await act(store, 'admin', { action: 'setSuspended', instrumentId: 'ball-mill', suspended: true, reason: '轉子損壞' })
    expect(await act(store, 'u1', { action: 'cancelUpcoming', instrumentId: 'ball-mill' })).toMatchObject({ ok: false, code: 'ADMIN_REQUIRED' })
    expect(await act(store, 'admin', { action: 'cancelUpcoming', instrumentId: 'ball-mill', reason: '轉子損壞' })).toEqual({ ok: true, cancelled: 2 })

    expect(store.records[past.id].status).toBe('active')
    ;[running, later].forEach((b) =>
      expect(store.records[b.id]).toMatchObject({ status: 'cancelled', cancelledBy: 'admin', cancelledByName: 'admin', cancelReason: 'suspended', suspendReason: '轉子損壞' })
    )
    expect(store.records[other.id].status).toBe('active')
    expect(store.days['ball-mill_2026-09-25'].bookings.map((b) => b.id)).toEqual([past.id])

    const history = (await act(store, 'u2', { action: 'myBookings' })).history
    expect(history[0]).toMatchObject({ id: later.id, cancelReason: 'suspended', suspendReason: '轉子損壞' })
    expect(await act(store, 'admin', { action: 'cancelUpcoming', instrumentId: 'ball-mill' })).toEqual({ ok: true, cancelled: 0 })
  })
})
