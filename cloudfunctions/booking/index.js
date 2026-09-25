// Cloud function `booking`: all reads and writes of the booking system.
// The rules live in ./shared (a copy of miniprogram/shared, see `npm run sync`).
//
// Collections (set to "no client access"; only this function reads and writes):
//   schedules          one document per instrument per day, _id '<instrumentId>_<YYYY-MM-DD>',
//                      { instrumentId, date, bookings: [active bookings] } — used to reject overlaps
//   bookings           one record per booking (history, incl. cancelled), _id = booking id
//   users              _id = openid, { nickname, avatar, admin, adminFail, ... }
//   instrument_status  _id = instrument id, { suspended, reason, updatedAt, updatedBy }
//
// Documents a mini program writes itself always carry `_openid`; documents
// this function writes never do. Queries leave out anything with `_openid`
// (so it does not use up their limits either), and trusted() checks again:
// even a collection left open to clients cannot grant admin rights or fake data.
const crypto = require('crypto')
const cloud = require('wx-server-sdk')
const core = require('./shared/booking-core')
const settings = require('./settings')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, throwOnNotFound: false })

const db = cloud.database()
const _ = db.command
const SCHEDULES = 'schedules'
const BOOKINGS = 'bookings'
const USERS = 'users'
const STATUS = 'instrument_status'
const MAX_ATTEMPTS = 4
const PAGE = 1000 // most documents one query may return
const MAX_PAGES = 20
// Only files this function created may be deleted (32 hex characters; the
// first version used shorter base-36 names).
const EXPORT_FILE = /^cloud:\/\/[^/]+\/exports\/(?:[0-9a-f]{32}|[0-9a-z]{9,20})\.xlsx$/

class Abort extends Error {
  constructor(outcome) {
    super('aborted: ' + outcome.error)
    this.outcome = outcome
  }
}

function errorText(err) {
  return String((err && (err.errMsg || err.message)) || err)
}

function isMissingCollection(err) {
  return !!err && (err.errCode === -502005 || /-502005|COLLECTION_NOT_EXIST|collection not exist/i.test(errorText(err)))
}

// wx-server-sdk reports a write conflict inside a transaction as a plain error
// (errCode -501001, "...TransactionConflict..."), without the `code` that
// runTransaction's own retry looks for, so conflicts are retried here.
function isConflict(err) {
  return !!err && (err.code === 'DATABASE_TRANSACTION_CONFLICT' || /conflict/i.test(errorText(err)))
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withoutId(doc) {
  if (!doc) return null
  const copy = Object.assign({}, doc)
  delete copy._id
  return copy
}

function trusted(doc) {
  if (doc && Object.prototype.hasOwnProperty.call(doc, '_openid')) {
    console.warn('ignoring a document written by a client', doc._id)
    return null
  }
  return doc
}

// Retries a transaction that ran into a concurrent write; gives up (and the
// request fails) after a few tries.
async function retrying(run) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      if (err instanceof Abort) return err.outcome
      if (attempt >= MAX_ATTEMPTS || !isConflict(err)) throw err
      await wait(20 + Math.floor(Math.random() * 80) * attempt)
    }
  }
}

// Collections are created on first use (once per container, again if a
// write finds one missing).
let collectionsReady = null
function ensureCollections(again) {
  if (!collectionsReady || again) {
    collectionsReady = Promise.all(
      [SCHEDULES, BOOKINGS, USERS, STATUS].map((name) => db.createCollection(name).catch(() => {}))
    )
  }
  return collectionsReady
}

async function write(fn) {
  await ensureCollections()
  try {
    return await fn()
  } catch (err) {
    if (!isMissingCollection(err)) throw err
    await ensureCollections(true)
    return fn()
  }
}

// Read helper: a missing collection simply means "nothing yet".
async function read(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingCollection(err)) return empty
    throw err
  }
}

function dayId(instrumentId, date) {
  return instrumentId + '_' + date
}

// Create a document up front so concurrent transactions always read and
// write the same existing document (and conflict with each other).
async function ensureDoc(collection, id, data) {
  const existing = await db.collection(collection).doc(id).get()
  if (existing.data) return
  try {
    await db.collection(collection).add({ data: Object.assign({ _id: id }, data) })
  } catch (err) {
    // Another request created it first, which is fine.
  }
}

// Added to every query: only documents this function wrote.
const SERVER_WRITTEN = { _openid: _.exists(false) }

const store = {
  async listDays(instrumentId, fromDate, toDate) {
    const ids = []
    for (let date = fromDate; date <= toDate; date = core.addDays(date, 1)) ids.push(dayId(instrumentId, date))
    // Look days up by _id (always indexed).
    const where = Object.assign({ _id: _.in(ids) }, SERVER_WRITTEN)
    const res = await read(() => db.collection(SCHEDULES).where(where).limit(100).get(), { data: [] })
    return res.data.filter(trusted)
  },

  updateDay(instrumentId, date, mutate, options) {
    return write(async () => {
      const id = dayId(instrumentId, date)
      if (!options || options.create !== false) await ensureDoc(SCHEDULES, id, { instrumentId, date, bookings: [], updatedAt: Date.now() })
      return retrying(() =>
        db.runTransaction(async (transaction) => {
          const ref = transaction.collection(SCHEDULES).doc(id)
          const snapshot = await ref.get()
          const outcome = mutate(core.normalizeDay(trusted(snapshot.data)))
          if (outcome.error) throw new Abort(outcome)
          if (outcome.day) {
            await ref.set({ data: { instrumentId, date, bookings: outcome.day.bookings, updatedAt: Date.now() } })
          }
          for (const record of outcome.records || []) {
            const recordRef = transaction.collection(BOOKINGS).doc(record.id)
            if (record.merge) await recordRef.update({ data: record.data })
            else await recordRef.set({ data: withoutId(record.data) })
          }
          return outcome
        })
      )
    })
  },

  async getUser(openid) {
    const res = await read(() => db.collection(USERS).doc(openid).get(), { data: null })
    return withoutId(trusted(res.data))
  },

  // Read-modify-write in a transaction: concurrent requests of the same user
  // (e.g. two wrong passwords at once) are applied one after the other.
  updateUser(openid, mutate) {
    return write(async () => {
      await ensureDoc(USERS, openid, { createdAt: Date.now() })
      return retrying(() =>
        db.runTransaction(async (transaction) => {
          const ref = transaction.collection(USERS).doc(openid)
          const snapshot = await ref.get()
          const user = withoutId(trusted(snapshot.data))
          const outcome = mutate(user) || {}
          if (outcome.error) throw new Abort(outcome)
          if (outcome.fields) await ref.set({ data: Object.assign({}, user, outcome.fields) })
          return outcome
        })
      )
    })
  },

  async listRecords(query) {
    const where = Object.assign(
      query.openid
        ? { openid: query.openid }
        : Object.assign({ instrumentId: query.instrumentId }, query.from ? { date: _.gte(query.from).and(_.lte(query.to)) } : {}),
      SERVER_WRITTEN
    )
    const records = []
    for (let page = 0; page < MAX_PAGES; page++) {
      // Sorted down to _id, so pages neither overlap nor skip records.
      const res = await read(
        () =>
          db
            .collection(BOOKINGS)
            .where(where)
            .orderBy('date', 'asc')
            .orderBy('startMin', 'asc')
            .orderBy('_id', 'asc')
            .skip(page * PAGE)
            .limit(PAGE)
            .get(),
        { data: [] }
      )
      res.data.filter(trusted).forEach((doc) => records.push(Object.assign(withoutId(doc), { id: doc._id })))
      if (res.data.length < PAGE) return { records, truncated: false }
    }
    return { records, truncated: true }
  },

  async getStatuses() {
    const where = Object.assign({ _id: _.in(core.instrumentIds()) }, SERVER_WRITTEN)
    const res = await read(() => db.collection(STATUS).where(where).limit(100).get(), { data: [] })
    const out = {}
    res.data.filter(trusted).forEach((doc) => {
      out[doc._id] = withoutId(doc)
    })
    return out
  },

  setStatus(instrumentId, status) {
    return write(() => db.collection(STATUS).doc(instrumentId).set({ data: status }))
  }
}

// Admin passwords are stored as 'pbkdf2_sha256$<iterations>$<salt>$<hash>'
// (create one with `node scripts/hash-password.js`).
function pbkdf2(password, salt, iterations) {
  return new Promise((resolve, reject) =>
    crypto.pbkdf2(password, salt, iterations, 32, 'sha256', (err, key) => (err ? reject(err) : resolve(key)))
  )
}

function parseHash(value) {
  const parts = String(value || '').split('$')
  const iterations = Number(parts[1])
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256' || !Number.isInteger(iterations) || iterations < 1000 || iterations > 10000000) {
    return null
  }
  const salt = Buffer.from(parts[2], 'base64')
  const hash = Buffer.from(parts[3], 'base64')
  return salt.length >= 8 && hash.length === 32 ? { iterations, salt, hash } : null
}

const warned = new Set()
/** The configured accounts; a malformed entry is left out (and logged once). */
function adminAccounts() {
  const out = []
  settings.ADMIN_ACCOUNTS.forEach((entry, i) => {
    const account = entry && typeof entry.account === 'string' ? entry.account.trim() : ''
    const parsed = account && parseHash(entry.passwordHash)
    if (parsed) {
      // Stored with each sign-in: changing the password ends those sign-ins.
      const key = crypto.createHash('sha256').update(entry.passwordHash).digest('hex').slice(0, 16)
      out.push(Object.assign({ account, key }, parsed))
    } else if (!warned.has(i + ':' + account)) {
      warned.add(i + ':' + account)
      console.error('settings.js ADMIN_ACCOUNTS[' + i + '] is not a valid account; see README')
    }
  })
  return out
}

const DUMMY_SALT = Buffer.alloc(16)

async function verifyAdmin(account, password) {
  const accounts = adminAccounts()
  const entry = accounts.find((a) => a.account === account)
  // Unknown accounts take as long as known ones.
  const iterations = entry ? entry.iterations : accounts.length ? accounts[0].iterations : 600000
  const actual = await pbkdf2(password, entry ? entry.salt : DUMMY_SALT, iterations)
  return entry && crypto.timingSafeEqual(actual, entry.hash) ? entry.key : null
}

function isActiveAdmin(session) {
  return adminAccounts().some((a) => a.account === session.account && a.key === session.key)
}

async function checkText(text, openid) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({ openid, scene: 1, version: 2, content: text })
    return !(res && res.result && res.result.suggest === 'risky')
  } catch (err) {
    // Do not block users when the check itself is unavailable.
    console.warn('msgSecCheck failed', err)
    return true
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const ctx = {
    store,
    openid: OPENID,
    nowMs: Date.now(),
    checkText: settings.CONTENT_CHECK ? (text) => checkText(text, OPENID) : null,
    admins: {
      get configured() {
        return adminAccounts().length > 0
      },
      verify: verifyAdmin,
      isActive: isActiveAdmin
    },
    // Avatars are uploaded by the mini program to this environment's cloud storage.
    isAvatarAllowed: (avatar) => /^cloud:\/\//.test(avatar),
    // The mini program downloads the file, saves it under its readable name
    // and then asks for it to be deleted (discardExport). The random name is
    // what keeps others from downloading it in the meantime.
    async saveFile(bytes) {
      const res = await cloud.uploadFile({
        cloudPath: 'exports/' + crypto.randomBytes(16).toString('hex') + '.xlsx',
        fileContent: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)
      })
      return { fileID: res.fileID }
    },
    deleteFile: (fileID) => (EXPORT_FILE.test(fileID) ? cloud.deleteFile({ fileList: [fileID] }) : null)
  }
  try {
    return await core.handleAction(event, ctx)
  } catch (err) {
    console.error('booking action failed', event && event.action, err)
    return { ok: false, code: 'DEFAULT' }
  }
}
