// The booking cloud function against an in-memory stand-in for wx-server-sdk.
// The fake database follows the SDK's behaviour where it matters here:
// get() on a missing document resolves { data: null } (throwOnNotFound: false),
// add() with an existing _id fails, and a transaction whose document changed
// after it was read fails to commit and is retried by runTransaction.

const CONFLICT = { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'transaction conflict' }
const MISSING = { errCode: -502005, errMsg: 'database collection not exists' }

function createFakeCloud() {
  const state = {
    exists: true,
    docs: new Map(), // _id -> { data, version }
    openid: 'user-1',
    beforeCommit: null, // hook to simulate a concurrent write
    commits: 0,
    retries: 0
  }
  const copy = (v) => JSON.parse(JSON.stringify(v))
  const checkCollection = () => {
    if (!state.exists) throw MISSING
  }

  const matches = (doc, query) =>
    Object.keys(query).every((key) => {
      const cond = query[key]
      if (cond && cond.test) return cond.test(doc[key])
      return doc[key] === cond
    })

  const cmd = (test) => ({ test, and: (other) => cmd((v) => test(v) && other.test(v)) })
  const command = { gte: (x) => cmd((v) => v >= x), lte: (x) => cmd((v) => v <= x) }

  function collection(name, tx) {
    expect(name).toBe('schedules')
    return {
      doc(id) {
        return {
          async get() {
            checkCollection()
            const entry = state.docs.get(id)
            if (tx) tx.reads.set(id, entry ? entry.version : 0)
            return { data: entry ? Object.assign({ _id: id }, copy(entry.data)) : null }
          },
          async set({ data }) {
            checkCollection()
            if ('_id' in data) throw new Error('cannot set _id')
            if (tx) tx.writes.set(id, copy(data))
            else state.docs.set(id, { data: copy(data), version: ((state.docs.get(id) || {}).version || 0) + 1 })
            return {}
          }
        }
      },
      async add({ data }) {
        checkCollection()
        const id = data._id
        if (state.docs.has(id)) throw { errCode: -502001, errMsg: 'duplicate key' }
        const rest = copy(data)
        delete rest._id
        state.docs.set(id, { data: rest, version: 1 })
        return { _id: id }
      },
      where(query) {
        return {
          limit() {
            return this
          },
          async get() {
            checkCollection()
            const data = []
            state.docs.forEach((entry, id) => {
              if (matches(entry.data, query)) data.push(Object.assign({ _id: id }, copy(entry.data)))
            })
            return { data }
          }
        }
      }
    }
  }

  const db = {
    command,
    collection: (name) => collection(name, null),
    async createCollection() {
      state.exists = true
    },
    async runTransaction(callback, times = 3) {
      for (;;) {
        const tx = { reads: new Map(), writes: new Map() }
        tx.collection = (name) => collection(name, tx)
        try {
          const result = await callback(tx)
          if (state.beforeCommit) {
            const hook = state.beforeCommit
            state.beforeCommit = null
            await hook()
          }
          tx.reads.forEach((version, id) => {
            if (((state.docs.get(id) || {}).version || 0) !== version) throw CONFLICT
          })
          tx.writes.forEach((data, id) => {
            state.docs.set(id, { data, version: ((state.docs.get(id) || {}).version || 0) + 1 })
          })
          state.commits++
          return result
        } catch (err) {
          if (err === CONFLICT && times-- > 0) {
            state.retries++
            continue
          }
          throw err
        }
      }
    }
  }

  const cloud = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init: jest.fn(),
    database: () => db,
    getWXContext: () => ({ OPENID: state.openid }),
    openapi: { security: { msgSecCheck: jest.fn().mockResolvedValue({ errCode: 0, result: { suggest: 'pass' } }) } }
  }
  return { cloud, state }
}

const mockFake = createFakeCloud()
jest.mock('wx-server-sdk', () => mockFake.cloud, { virtual: true })

const { cloud, state } = mockFake
const fn = require('../cloudfunctions/booking/index')
const settings = require('../cloudfunctions/booking/settings')

const create = (extra) =>
  fn.main(
    Object.assign(
      { action: 'create', instrumentId: 'centrifuge', date: '2026-09-28', startMin: 600, endMin: 660, name: 'Maria', purpose: 'Pore solution extraction' },
      extra
    )
  )

beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-09-25T02:40:00Z') })
})

beforeEach(() => {
  state.exists = true
  state.docs.clear()
  state.openid = 'user-1'
  state.beforeCommit = null
  state.retries = 0
  settings.ADMIN_OPENIDS.length = 0
  settings.CONTENT_CHECK = true
  cloud.openapi.security.msgSecCheck.mockClear()
})

test('initialises the SDK so missing documents read as null', () => {
  expect(cloud.init).toHaveBeenCalledWith({ env: 'dynamic', throwOnNotFound: false })
})

test('creates a booking in the day document and lists it', async () => {
  const res = await create()
  expect(res).toMatchObject({ ok: true, booking: { instrumentId: 'centrifuge', date: '2026-09-28', startMin: 600, endMin: 660, mine: true } })

  const day = state.docs.get('centrifuge_2026-09-28').data
  expect(day).toMatchObject({ instrumentId: 'centrifuge', date: '2026-09-28', cancelled: [] })
  expect(day.bookings[0]).toMatchObject({ openid: 'user-1', name: 'Maria' })

  state.openid = 'user-2'
  const list = await fn.main({ action: 'list', instrumentId: 'centrifuge' })
  expect(list.ok).toBe(true)
  expect(list.bookings).toHaveLength(1)
  expect(list.bookings[0]).toMatchObject({ mine: false, canCancel: false, name: 'Maria' })
  expect(list.bookings[0].openid).toBeUndefined()
})

test('refuses an overlapping booking and leaves the day unchanged', async () => {
  await create()
  state.openid = 'user-2'
  expect(await create({ startMin: 630, endMin: 690 })).toEqual({ ok: false, code: 'CONFLICT' })
  expect(state.docs.get('centrifuge_2026-09-28').data.bookings).toHaveLength(1)
})

test('two people booking the same slot at once: the second one gets CONFLICT', async () => {
  // user-2 commits between user-1's read and user-1's commit.
  state.beforeCommit = async () => {
    state.openid = 'user-2'
    const other = await create({ startMin: 630, endMin: 690, name: 'Li' })
    expect(other.ok).toBe(true)
    state.openid = 'user-1'
  }
  const res = await create()
  expect(res).toEqual({ ok: false, code: 'CONFLICT' })
  expect(state.retries).toBe(1)
  const bookings = state.docs.get('centrifuge_2026-09-28').data.bookings
  expect(bookings).toHaveLength(1)
  expect(bookings[0].name).toBe('Li')
})

test('a concurrent booking of a different slot is kept after the retry', async () => {
  state.beforeCommit = async () => {
    state.openid = 'user-2'
    await create({ startMin: 900, endMin: 960, name: 'Li' })
    state.openid = 'user-1'
  }
  expect((await create()).ok).toBe(true)
  const bookings = state.docs.get('centrifuge_2026-09-28').data.bookings
  expect(bookings.map((b) => b.startMin)).toEqual([600, 900])
})

test('creates the collection on first use', async () => {
  state.exists = false
  expect(await fn.main({ action: 'list', instrumentId: 'centrifuge' })).toMatchObject({ ok: true, bookings: [] })
  expect((await create()).ok).toBe(true)
  expect(state.exists).toBe(true)
})

test('owner and admins can cancel; others cannot', async () => {
  const { booking } = await create()
  const cancel = { action: 'cancel', instrumentId: booking.instrumentId, date: booking.date, id: booking.id }

  state.openid = 'user-2'
  expect(await fn.main(cancel)).toEqual({ ok: false, code: 'FORBIDDEN' })

  settings.ADMIN_OPENIDS.push('user-2')
  const list = await fn.main({ action: 'list', instrumentId: 'centrifuge' })
  expect(list.isAdmin).toBe(true)
  expect(list.bookings[0].canCancel).toBe(true)
  expect(await fn.main(cancel)).toEqual({ ok: true })

  const day = state.docs.get('centrifuge_2026-09-28').data
  expect(day.bookings).toEqual([])
  expect(day.cancelled[0]).toMatchObject({ id: booking.id, cancelledBy: 'user-2' })
})

test('content check: risky text is refused, an unavailable check lets the booking through', async () => {
  cloud.openapi.security.msgSecCheck.mockResolvedValueOnce({ errCode: 0, result: { suggest: 'risky' } })
  expect(await create()).toEqual({ ok: false, code: 'CONTENT_REJECTED' })
  expect(cloud.openapi.security.msgSecCheck).toHaveBeenCalledWith({
    openid: 'user-1',
    scene: 1,
    version: 2,
    content: 'Maria\nPore solution extraction'
  })

  jest.spyOn(console, 'warn').mockImplementation(() => {})
  cloud.openapi.security.msgSecCheck.mockRejectedValueOnce(new Error('no permission'))
  expect((await create()).ok).toBe(true)
  console.warn.mockRestore()

  settings.CONTENT_CHECK = false
  cloud.openapi.security.msgSecCheck.mockClear()
  expect((await create({ startMin: 720, endMin: 780 })).ok).toBe(true)
  expect(cloud.openapi.security.msgSecCheck).not.toHaveBeenCalled()
})

test('unexpected database errors become a generic failure', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  const original = state.docs.get
  state.docs.get = () => {
    throw new Error('boom')
  }
  expect(await create()).toEqual({ ok: false, code: 'DEFAULT' })
  state.docs.get = original
  console.error.mockRestore()
})

test('calls without a WeChat user are refused', async () => {
  state.openid = undefined
  expect(await create()).toEqual({ ok: false, code: 'UNAUTHORIZED' })
})
