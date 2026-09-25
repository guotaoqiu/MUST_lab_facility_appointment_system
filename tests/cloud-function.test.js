// The booking cloud function against an in-memory stand-in for wx-server-sdk.
// The fake database follows the SDK's behaviour where it matters here:
// - get() on a missing document resolves { data: null } (throwOnNotFound: false)
// - add() with an existing _id fails
// - a write inside a transaction to a document that changed after the
//   transaction read it fails the way wx-server-sdk 3.x reports it: a plain
//   error with errCode -501001 and no `code`, which runTransaction does NOT
//   retry by itself. (A conflict reported at commit keeps its `code` and is
//   retried by runTransaction, as in @cloudbase/database.)

const COMMIT_CONFLICT = { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'transaction conflict' }
const writeConflict = () =>
  Object.assign(new Error('document.set:fail -501001 resource system error. [ResourceUnavailable.TransactionConflict]'), {
    errCode: -501001,
    errMsg: 'document.set:fail -501001 resource system error. [ResourceUnavailable.TransactionConflict]'
  })
const MISSING = { errCode: -502005, errMsg: 'database collection not exists' }

function createFakeCloud() {
  const state = {
    exists: true,
    docs: new Map(), // _id -> { data, version }
    openid: 'user-1',
    conflictAt: 'write', // where a concurrent change is detected: 'write' or 'commit'
    beforeWrite: null, // hook to simulate a concurrent write inside a transaction
    transactions: 0,
    projections: []
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
  const command = {
    gte: (x) => cmd((v) => v >= x),
    lte: (x) => cmd((v) => v <= x),
    in: (list) => cmd((v) => list.indexOf(v) !== -1)
  }
  const version = (id) => (state.docs.get(id) || {}).version || 0

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
            if (!tx) {
              state.docs.set(id, { data: copy(data), version: version(id) + 1 })
              return {}
            }
            if (state.beforeWrite) {
              const hook = state.beforeWrite
              state.beforeWrite = null
              await hook()
            }
            if (state.conflictAt === 'write' && tx.reads.has(id) && tx.reads.get(id) !== version(id)) throw writeConflict()
            tx.writes.set(id, copy(data))
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
        let projection = null
        return {
          field(p) {
            projection = p
            state.projections.push(p)
            return this
          },
          limit() {
            return this
          },
          async get() {
            checkCollection()
            const data = []
            state.docs.forEach((entry, id) => {
              const doc = Object.assign({ _id: id }, copy(entry.data))
              if (!matches(doc, query)) return
              if (projection) Object.keys(doc).forEach((k) => k === '_id' || projection[k] || delete doc[k])
              data.push(doc)
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
    // Like @cloudbase/database: retries only errors whose `code` is the conflict code.
    async runTransaction(callback, times = 3) {
      for (;;) {
        state.transactions++
        const tx = { reads: new Map(), writes: new Map() }
        tx.collection = (name) => collection(name, tx)
        try {
          const result = await callback(tx)
          tx.reads.forEach((v, id) => {
            if (version(id) !== v) throw COMMIT_CONFLICT
          })
          tx.writes.forEach((data, id) => {
            state.docs.set(id, { data, version: version(id) + 1 })
          })
          return result
        } catch (err) {
          if (err && err.code === 'DATABASE_TRANSACTION_CONFLICT' && times-- > 0) continue
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
  // Freeze the clock only; the conflict retry really waits a few ms.
  jest.useFakeTimers({
    now: new Date('2026-09-25T02:40:00Z'),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask']
  })
})

beforeEach(() => {
  state.exists = true
  state.docs.clear()
  state.openid = 'user-1'
  state.conflictAt = 'write'
  state.beforeWrite = null
  state.transactions = 0
  state.projections = []
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

describe.each(['write', 'commit'])('concurrent requests (conflict reported at %s)', (where) => {
  beforeEach(() => {
    state.conflictAt = where
  })

  test('two people booking the same slot at once: the second one gets CONFLICT', async () => {
    // user-2 commits between user-1's read and user-1's write.
    state.beforeWrite = async () => {
      state.openid = 'user-2'
      const other = await create({ startMin: 630, endMin: 690, name: 'Li' })
      expect(other.ok).toBe(true)
      state.openid = 'user-1'
    }
    const res = await create()
    expect(res).toEqual({ ok: false, code: 'CONFLICT' })
    const bookings = state.docs.get('centrifuge_2026-09-28').data.bookings
    expect(bookings).toHaveLength(1)
    expect(bookings[0].name).toBe('Li')
  })

  test('a concurrent booking of a different slot: both succeed after a retry', async () => {
    state.beforeWrite = async () => {
      state.openid = 'user-2'
      expect((await create({ startMin: 900, endMin: 960, name: 'Li' })).ok).toBe(true)
      state.openid = 'user-1'
    }
    expect((await create()).ok).toBe(true)
    expect(state.transactions).toBe(3) // user-1, user-2, user-1 again
    const bookings = state.docs.get('centrifuge_2026-09-28').data.bookings
    expect(bookings.map((b) => b.startMin)).toEqual([600, 900])
  })
})

test('gives up after repeated conflicts', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  let n = 0
  const again = async () => {
    state.openid = 'user-' + (++n + 1)
    await create({ startMin: 600 + n * 60, endMin: 630 + n * 60, name: 'X' + n })
    state.openid = 'user-1'
    state.beforeWrite = n < 10 ? again : null
  }
  state.beforeWrite = again
  expect(await create({ startMin: 1200, endMin: 1230 })).toEqual({ ok: false, code: 'DEFAULT' })
  console.error.mockRestore()
})

test('a retried request (same requestId) returns the booking it already made', async () => {
  const first = await create({ requestId: 'req-1' })
  const again = await create({ requestId: 'req-1' })
  expect(again).toEqual(first)
  expect(state.docs.get('centrifuge_2026-09-28').data.bookings).toHaveLength(1)
  // A retry after the user corrected the text keeps the latest text.
  const edited = await create({ requestId: 'req-1', name: 'Maria S.' })
  expect(edited.ok).toBe(true)
  expect(edited.booking.id).toBe(first.booking.id)
  expect(state.docs.get('centrifuge_2026-09-28').data.bookings.map((b) => b.name)).toEqual(['Maria S.'])
  // The same id for another slot is not a retry.
  expect(await create({ requestId: 'req-1', startMin: 720, endMin: 780 })).toEqual({ ok: false, code: 'BAD_REQUEST' })
  // Someone else reusing the id gets no special treatment.
  state.openid = 'user-2'
  expect(await create({ requestId: 'req-1' })).toEqual({ ok: false, code: 'CONFLICT' })
  expect(await create({ requestId: 'bad id!' })).toEqual({ ok: false, code: 'BAD_REQUEST' })
})

test('cancelling never creates day documents', async () => {
  const cancel = (date) => fn.main({ action: 'cancel', instrumentId: 'centrifuge', date, id: 'nope' })
  expect(await cancel('1999-01-01')).toEqual({ ok: false, code: 'NOT_FOUND' })
  expect(await cancel('2026-09-26')).toEqual({ ok: false, code: 'NOT_FOUND' })
  expect(await cancel('2030-01-01')).toEqual({ ok: false, code: 'NOT_FOUND' })
  expect(state.docs.size).toBe(0)
})

test('list looks days up by id and does not read the cancellation history', async () => {
  const { booking } = await create()
  await fn.main({ action: 'cancel', instrumentId: 'centrifuge', date: booking.date, id: booking.id })
  await create({ startMin: 720, endMin: 780 })
  state.docs.set('centrifuge_2026-11-01', { data: { instrumentId: 'centrifuge', date: '2026-11-01', bookings: [{ id: 'far' }] }, version: 1 })
  const list = await fn.main({ action: 'list', instrumentId: 'centrifuge' })
  expect(list.bookings.map((b) => b.startMin)).toEqual([720])
  expect(state.projections).toEqual([{ instrumentId: true, date: true, bookings: true }])
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
