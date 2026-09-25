// Cloud function `booking`: all reads and writes of the booking system.
// The rules live in ./shared (a copy of miniprogram/shared, see `npm run sync`).
//
// Collections (all "no client access"; only this function reads and writes):
//   schedules          one document per instrument per day, _id '<instrumentId>_<YYYY-MM-DD>',
//                      { instrumentId, date, bookings: [active bookings] } — used to reject overlaps
//   bookings           one record per booking (history, incl. cancelled), _id = booking id
//   users              _id = openid, { nickname, avatar, admin, adminFail, ... }
//   instrument_status  _id = instrument id, { suspended, reason, updatedAt, updatedBy }
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

// Create the day document up front so concurrent transactions always read and
// write the same existing document (and conflict with each other).
async function ensureDay(id, instrumentId, date) {
  const existing = await db.collection(SCHEDULES).doc(id).get()
  if (existing.data) return
  try {
    await db.collection(SCHEDULES).add({ data: { _id: id, instrumentId, date, bookings: [], updatedAt: Date.now() } })
  } catch (err) {
    // Another request created it first, which is fine.
  }
}

const store = {
  async listDays(instrumentId, fromDate, toDate) {
    const ids = []
    for (let date = fromDate; date <= toDate; date = core.addDays(date, 1)) ids.push(dayId(instrumentId, date))
    // Look days up by _id (always indexed).
    const res = await read(() => db.collection(SCHEDULES).where({ _id: _.in(ids) }).limit(100).get(), { data: [] })
    return res.data
  },

  updateDay(instrumentId, date, mutate, options) {
    return write(() => this.transact(instrumentId, date, mutate, options))
  },

  async transact(instrumentId, date, mutate, options) {
    const id = dayId(instrumentId, date)
    if (!options || options.create !== false) await ensureDay(id, instrumentId, date)
    for (let attempt = 1; ; attempt++) {
      try {
        return await db.runTransaction(async (transaction) => {
          const ref = transaction.collection(SCHEDULES).doc(id)
          const snapshot = await ref.get()
          const outcome = mutate(core.normalizeDay(snapshot.data))
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
      } catch (err) {
        if (err instanceof Abort) return err.outcome
        if (attempt >= MAX_ATTEMPTS || !isConflict(err)) throw err
        await wait(20 + Math.floor(Math.random() * 80) * attempt)
      }
    }
  },

  async getUser(openid) {
    const res = await read(() => db.collection(USERS).doc(openid).get(), { data: null })
    return withoutId(res.data)
  },

  saveUser(openid, user) {
    return write(() => db.collection(USERS).doc(openid).set({ data: withoutId(user) }))
  },

  async listRecords(query) {
    const where = query.openid
      ? { openid: query.openid }
      : Object.assign(
          { instrumentId: query.instrumentId },
          query.from ? { date: _.gte(query.from).and(_.lte(query.to)) } : {}
        )
    const out = []
    for (let skip = 0; skip < 20 * PAGE; skip += PAGE) {
      const res = await read(
        () => db.collection(BOOKINGS).where(where).orderBy('date', 'asc').orderBy('startMin', 'asc').skip(skip).limit(PAGE).get(),
        { data: [] }
      )
      res.data.forEach((doc) => out.push(Object.assign(withoutId(doc), { id: doc._id })))
      if (res.data.length < PAGE) break
    }
    return out
  },

  async getStatuses() {
    const res = await read(() => db.collection(STATUS).limit(100).get(), { data: [] })
    const out = {}
    res.data.forEach((doc) => {
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

const DUMMY_HASH = 'pbkdf2_sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

async function verifyAdmin(account, password) {
  const entry = settings.ADMIN_ACCOUNTS.find((a) => a.account === account)
  const [scheme, iterations, salt, hash] = String(entry ? entry.passwordHash : DUMMY_HASH).split('$')
  if (scheme !== 'pbkdf2_sha256' || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await pbkdf2(password, Buffer.from(salt, 'base64'), Number(iterations))
  return !!entry && actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
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
    admins: { configured: settings.ADMIN_ACCOUNTS.length > 0, verify: verifyAdmin },
    // Avatars are uploaded by the mini program to this environment's cloud storage.
    isAvatarAllowed: (avatar) => /^cloud:\/\//.test(avatar),
    // The mini program downloads the file and saves it under its readable name.
    async saveFile(bytes) {
      const res = await cloud.uploadFile({
        cloudPath: 'exports/' + core.makeId(Date.now()) + '.xlsx',
        fileContent: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)
      })
      return { fileID: res.fileID }
    },
    deleteFile: (fileID) => cloud.deleteFile({ fileList: [fileID] })
  }
  try {
    return await core.handleAction(event, ctx)
  } catch (err) {
    console.error('booking action failed', event && event.action, err)
    return { ok: false, code: 'DEFAULT' }
  }
}
