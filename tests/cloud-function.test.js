// The booking cloud function against an in-memory stand-in for wx-server-sdk.
// The fake database follows the SDK's behaviour where it matters here:
// - get() on a missing document resolves { data: null } (throwOnNotFound: false)
// - add() with an existing _id fails; a missing collection fails with -502005
// - a write inside a transaction to a document that changed after the
//   transaction read it fails the way wx-server-sdk 3.x reports it: a plain
//   error with errCode -501001 and no `code`, which runTransaction does NOT
//   retry by itself. (A conflict reported at commit keeps its `code` and is
//   retried by runTransaction, as in @cloudbase/database.)
const crypto = require('crypto')

const COMMIT_CONFLICT = { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'transaction conflict' }
const writeConflict = () =>
  Object.assign(new Error('document.set:fail -501001 resource system error. [ResourceUnavailable.TransactionConflict]'), {
    errCode: -501001,
    errMsg: 'document.set:fail -501001 resource system error. [ResourceUnavailable.TransactionConflict]'
  })
const MISSING = { errCode: -502005, errMsg: 'database collection not exists' }

function createFakeCloud() {
  const state = {
    collections: new Map(), // name -> Map(_id -> { data, version })
    openid: 'user-1',
    conflictAt: 'write', // where a concurrent change is detected: 'write' or 'commit'
    beforeWrite: null, // hook to simulate a concurrent write inside a transaction
    transactions: 0,
    uploads: [],
    deleted: []
  }
  const copy = (v) => JSON.parse(JSON.stringify(v))
  const docs = (name) => {
    if (!state.collections.has(name)) throw MISSING
    return state.collections.get(name)
  }
  const version = (name, id) => ((state.collections.get(name) || new Map()).get(id) || {}).version || 0

  const cmd = (test) => ({ test, and: (other) => cmd((v) => test(v) && other.test(v)) })
  const command = {
    gte: (x) => cmd((v) => v >= x),
    lte: (x) => cmd((v) => v <= x),
    in: (list) => cmd((v) => list.indexOf(v) !== -1)
  }
  const matches = (doc, query) =>
    Object.keys(query).every((key) => (query[key] && query[key].test ? query[key].test(doc[key]) : doc[key] === query[key]))

  function query(name, where) {
    const order = []
    let skip = 0
    let limit = 100
    const q = {
      orderBy(field, dir) {
        order.push([field, dir])
        return q
      },
      skip(n) {
        skip = n
        return q
      },
      limit(n) {
        limit = n
        return q
      },
      async get() {
        const out = []
        docs(name).forEach((entry, id) => {
          const doc = Object.assign({ _id: id }, copy(entry.data))
          if (matches(doc, where)) out.push(doc)
        })
        out.sort((a, b) => {
          for (const [f, dir] of order) if (a[f] !== b[f]) return (a[f] < b[f] ? -1 : 1) * (dir === 'desc' ? -1 : 1)
          return 0
        })
        return { data: out.slice(skip, skip + limit) }
      }
    }
    return q
  }

  function collection(name, tx) {
    return {
      doc(id) {
        const key = name + '/' + id
        const conflictCheck = async () => {
          if (state.beforeWrite) {
            const hook = state.beforeWrite
            state.beforeWrite = null
            await hook()
          }
          if (state.conflictAt === 'write' && tx.reads.has(key) && tx.reads.get(key) !== version(name, id)) throw writeConflict()
        }
        return {
          async get() {
            const entry = docs(name).get(id)
            if (tx) tx.reads.set(key, entry ? entry.version : 0)
            return { data: entry ? Object.assign({ _id: id }, copy(entry.data)) : null }
          },
          async set({ data }) {
            docs(name)
            if ('_id' in data) throw new Error('cannot set _id')
            if (!tx) {
              docs(name).set(id, { data: copy(data), version: version(name, id) + 1 })
              return {}
            }
            await conflictCheck()
            tx.writes.push({ name, id, data: copy(data) })
            return {}
          },
          async update({ data }) {
            docs(name)
            if (!tx) throw new Error('update outside a transaction is not used')
            await conflictCheck()
            tx.writes.push({ name, id, data: copy(data), merge: true })
            return {}
          }
        }
      },
      async add({ data }) {
        const id = data._id
        if (docs(name).has(id)) throw { errCode: -502001, errMsg: 'duplicate key' }
        const rest = copy(data)
        delete rest._id
        docs(name).set(id, { data: rest, version: 1 })
        return { _id: id }
      },
      where(where) {
        return query(name, where)
      },
      limit(n) {
        return query(name, {}).limit(n)
      }
    }
  }

  const db = {
    command,
    collection: (name) => collection(name, null),
    async createCollection(name) {
      if (state.collections.has(name)) throw new Error('collection already exists')
      state.collections.set(name, new Map())
    },
    // Like @cloudbase/database: retries only errors whose `code` is the conflict code.
    async runTransaction(callback, times = 3) {
      for (;;) {
        state.transactions++
        const tx = { reads: new Map(), writes: [] }
        tx.collection = (name) => collection(name, tx)
        try {
          const result = await callback(tx)
          tx.reads.forEach((v, key) => {
            const [name, id] = key.split('/')
            if (version(name, id) !== v) throw COMMIT_CONFLICT
          })
          tx.writes.forEach(({ name, id, data, merge }) => {
            const current = docs(name).get(id)
            if (merge && !current) return
            docs(name).set(id, { data: merge ? Object.assign(current.data, data) : data, version: version(name, id) + 1 })
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
    openapi: { security: { msgSecCheck: jest.fn().mockResolvedValue({ errCode: 0, result: { suggest: 'pass' } }) } },
    uploadFile: jest.fn(async ({ cloudPath, fileContent }) => {
      state.uploads.push({ cloudPath, fileContent })
      return { fileID: 'cloud://env/' + cloudPath }
    }),
    deleteFile: jest.fn(async ({ fileList }) => {
      state.deleted.push(...fileList)
      return {}
    })
  }
  return { cloud, state }
}

const mockFake = createFakeCloud()
jest.mock('wx-server-sdk', () => mockFake.cloud, { virtual: true })

const { cloud, state } = mockFake
const fn = require('../cloudfunctions/booking/index')
const settings = require('../cloudfunctions/booking/settings')

function hash(password) {
  const salt = crypto.randomBytes(16)
  const key = crypto.pbkdf2Sync(password, salt, 1000, 32, 'sha256')
  return ['pbkdf2_sha256', 1000, salt.toString('base64'), key.toString('base64')].join('$')
}
const ADMIN = { account: 'labadmin', passwordHash: hash('correct horse') }

const as = async (openid, event) => {
  const previous = state.openid
  state.openid = openid
  try {
    return await fn.main(event)
  } finally {
    state.openid = previous
  }
}
const booking = (extra) =>
  Object.assign(
    { action: 'create', instrumentId: 'centrifuge', date: '2026-09-28', startMin: 600, endMin: 660, name: 'Maria', purpose: 'Pore solution extraction' },
    extra
  )
const create = (extra) => fn.main(booking(extra))
const docsOf = (name) => state.collections.get(name) || new Map()
const day = (id = 'centrifuge_2026-09-28') => docsOf('schedules').get(id).data

beforeAll(() => {
  // Freeze the clock only; the conflict retry really waits a few ms.
  jest.useFakeTimers({
    now: new Date('2026-09-25T02:40:00Z'),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask']
  })
})

beforeEach(async () => {
  state.collections = new Map()
  ;['schedules', 'bookings', 'users', 'instrument_status'].forEach((n) => state.collections.set(n, new Map()))
  state.openid = 'user-1'
  state.conflictAt = 'write'
  state.beforeWrite = null
  state.uploads = []
  state.deleted = []
  settings.ADMIN_ACCOUNTS.length = 0
  settings.ADMIN_ACCOUNTS.push(ADMIN)
  settings.CONTENT_CHECK = true
  cloud.openapi.security.msgSecCheck.mockClear()
  for (const u of ['user-1', 'user-2', 'user-3']) await as(u, { action: 'login', nickname: 'N-' + u })
  state.transactions = 0
})

test('initialises the SDK so missing documents read as null', () => {
  expect(cloud.init).toHaveBeenCalledWith({ env: 'dynamic', throwOnNotFound: false })
})

test('creates a booking in the day document and in the booking records, and lists it', async () => {
  const res = await create()
  expect(res).toMatchObject({ ok: true, booking: { instrumentId: 'centrifuge', date: '2026-09-28', startMin: 600, endMin: 660, mine: true } })
  expect(day()).toMatchObject({ instrumentId: 'centrifuge', date: '2026-09-28' })
  expect(day().bookings[0]).toMatchObject({ openid: 'user-1', name: 'Maria', nickname: 'N-user-1' })
  expect(docsOf('bookings').get(res.booking.id).data).toMatchObject({ instrumentId: 'centrifuge', openid: 'user-1', status: 'active' })

  const list = await as('user-2', { action: 'list', instrumentId: 'centrifuge' })
  expect(list.bookings).toHaveLength(1)
  expect(list.bookings[0]).toMatchObject({ mine: false, canCancel: false, name: 'Maria' })
  expect(list.bookings[0].openid).toBeUndefined()
})

test('users must log in before booking', async () => {
  expect(await as('stranger', booking())).toEqual({ ok: false, code: 'NOT_LOGGED_IN' })
})

test('refuses an overlapping booking and leaves the day unchanged', async () => {
  await create()
  expect(await as('user-2', booking({ startMin: 630, endMin: 690 }))).toEqual({ ok: false, code: 'CONFLICT' })
  expect(day().bookings).toHaveLength(1)
})

describe.each(['write', 'commit'])('concurrent requests (conflict reported at %s)', (where) => {
  beforeEach(() => {
    state.conflictAt = where
  })

  test('two people booking the same slot at once: the second one gets CONFLICT', async () => {
    // user-2 commits between user-1's read and user-1's write.
    state.beforeWrite = async () => {
      expect((await as('user-2', booking({ startMin: 630, endMin: 690, name: 'Li' }))).ok).toBe(true)
    }
    expect(await create()).toEqual({ ok: false, code: 'CONFLICT' })
    expect(day().bookings.map((b) => b.name)).toEqual(['Li'])
    expect([...docsOf('bookings').values()].map((r) => r.data.name)).toEqual(['Li'])
  })

  test('a concurrent booking of a different slot: both succeed after a retry', async () => {
    state.beforeWrite = async () => {
      expect((await as('user-2', booking({ startMin: 900, endMin: 960, name: 'Li' }))).ok).toBe(true)
    }
    expect((await create()).ok).toBe(true)
    expect(state.transactions).toBe(3) // user-1, user-2, user-1 again
    expect(day().bookings.map((b) => b.startMin)).toEqual([600, 900])
    expect(docsOf('bookings').size).toBe(2)
  })
})

test('gives up after repeated conflicts', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  let n = 0
  const again = async () => {
    n++
    await as('user-' + ((n % 2) + 2), booking({ startMin: 600 + n * 60, endMin: 630 + n * 60, name: 'X' + n }))
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
  expect(day().bookings).toHaveLength(1)
  const edited = await create({ requestId: 'req-1', name: 'Maria S.' })
  expect(edited.booking.id).toBe(first.booking.id)
  expect(day().bookings.map((b) => b.name)).toEqual(['Maria S.'])
  expect(docsOf('bookings').get(first.booking.id).data.name).toBe('Maria S.')
  expect(await create({ requestId: 'req-1', startMin: 720, endMin: 780 })).toEqual({ ok: false, code: 'BAD_REQUEST' })
})

test('cancelling never creates day documents', async () => {
  const cancel = (date) => fn.main({ action: 'cancel', instrumentId: 'centrifuge', date, id: 'nope' })
  expect(await cancel('1999-01-01')).toEqual({ ok: false, code: 'NOT_FOUND' })
  expect(await cancel('2026-09-26')).toEqual({ ok: false, code: 'NOT_FOUND' })
  expect(await cancel('2030-01-01')).toEqual({ ok: false, code: 'NOT_FOUND' })
  expect(docsOf('schedules').size).toBe(0)
})

test('creates the collections on first use', async () => {
  state.collections = new Map()
  expect(await fn.main({ action: 'list', instrumentId: 'centrifuge' })).toMatchObject({ ok: true, bookings: [], me: { loggedIn: false } })
  expect((await fn.main({ action: 'login', nickname: 'First' })).ok).toBe(true)
  expect((await create()).ok).toBe(true)
  expect([...state.collections.keys()].sort()).toEqual(['bookings', 'instrument_status', 'schedules', 'users'])
})

test('owner and admins can cancel; others cannot; the record shows who cancelled', async () => {
  const { booking: b } = await create()
  const cancel = { action: 'cancel', instrumentId: b.instrumentId, date: b.date, id: b.id }
  expect(await as('user-2', cancel)).toEqual({ ok: false, code: 'FORBIDDEN' })

  expect((await as('user-2', { action: 'adminLogin', account: 'labadmin', password: 'correct horse' })).me.isAdmin).toBe(true)
  const list = await as('user-2', { action: 'list', instrumentId: 'centrifuge' })
  expect(list.bookings[0]).toMatchObject({ canCancel: true, openid: 'user-1', nickname: 'N-user-1' })
  expect(await as('user-2', cancel)).toEqual({ ok: true })
  expect(day().bookings).toEqual([])
  expect(docsOf('bookings').get(b.id).data).toMatchObject({ status: 'cancelled', cancelledBy: 'admin', cancelledByName: 'labadmin' })
})

describe('administrator login', () => {
  test('checks the PBKDF2 hash; wrong passwords count towards a lockout', async () => {
    expect(await as('a1', { action: 'adminLogin', account: 'labadmin', password: 'wrong' })).toEqual({ ok: false, code: 'INVALID_CREDENTIALS', attemptsLeft: 4 })
    expect(await as('a1', { action: 'adminLogin', account: 'nobody', password: 'correct horse' })).toEqual({ ok: false, code: 'INVALID_CREDENTIALS', attemptsLeft: 3 })
    expect(docsOf('users').get('a1').data.adminFail).toEqual({ count: 2, lockedUntil: 0 })
    const ok = await as('a1', { action: 'adminLogin', account: 'labadmin', password: 'correct horse' })
    expect(ok.me).toMatchObject({ isAdmin: true, account: 'labadmin' })
    expect(docsOf('users').get('a1').data.adminFail).toBeNull()
  })

  test('without configured accounts nobody can log in as admin', async () => {
    settings.ADMIN_ACCOUNTS.length = 0
    expect(await as('a1', { action: 'adminLogin', account: 'labadmin', password: 'correct horse' })).toEqual({ ok: false, code: 'ADMIN_NOT_CONFIGURED' })
  })
})

test('admin records, suspension and export', async () => {
  await create()
  await as('admin-1', { action: 'adminLogin', account: 'labadmin', password: 'correct horse' })

  const records = await as('admin-1', { action: 'adminRecords', instrumentId: 'centrifuge', month: '2026-09' })
  expect(records.records.map((r) => [r.nickname, r.name, r.status])).toEqual([['N-user-1', 'Maria', 'booked']])

  expect(await as('admin-1', { action: 'setSuspended', instrumentId: 'centrifuge', suspended: true, reason: '維修中' })).toMatchObject({ ok: true })
  expect(docsOf('instrument_status').get('centrifuge').data).toMatchObject({ suspended: true, reason: '維修中', updatedBy: 'labadmin' })
  expect(await create({ startMin: 720, endMin: 780 })).toEqual({ ok: false, code: 'SUSPENDED' })

  const first = await as('admin-1', { action: 'exportRecords', instrumentId: 'centrifuge', month: '2026-09', lang: 'zh' })
  expect(first).toMatchObject({ ok: true, count: 1, file: { name: '離心機_2026-09.xlsx' } })
  expect(first.file.fileID).toMatch(/^cloud:\/\/env\/exports\/\w+\.xlsx$/)
  expect(Buffer.isBuffer(state.uploads[0].fileContent)).toBe(true)
  expect(state.uploads[0].fileContent.slice(0, 2).toString()).toBe('PK')
  const second = await as('admin-1', { action: 'exportRecords', instrumentId: 'centrifuge', lang: 'zh' })
  expect(state.deleted).toEqual([first.file.fileID])
  expect(docsOf('users').get('admin-1').data.lastExport).toBe(second.file.fileID)
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

test("avatars must come from this environment's cloud storage", async () => {
  expect(await fn.main({ action: 'login', nickname: 'A', avatar: 'https://example.com/a.png' })).toEqual({ ok: false, code: 'BAD_REQUEST' })
  expect((await fn.main({ action: 'login', nickname: 'A', avatar: 'cloud://env/avatars/a.jpg' })).me.avatar).toBe('cloud://env/avatars/a.jpg')
})

test('unexpected database errors become a generic failure', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  state.collections.get('users').get = () => {
    throw new Error('boom')
  }
  expect(await create()).toEqual({ ok: false, code: 'DEFAULT' })
  console.error.mockRestore()
})

test('calls without a WeChat user are refused', async () => {
  state.openid = undefined
  expect(await create()).toEqual({ ok: false, code: 'UNAUTHORIZED' })
})
