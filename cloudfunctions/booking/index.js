// Cloud function `booking`: list / create / cancel instrument bookings.
//
// Data model — collection `schedules`, one document per instrument per day:
//   _id: '<instrumentId>_<YYYY-MM-DD>'
//   { instrumentId, date, bookings: [...], cancelled: [...], updatedAt }
// Keeping a day's bookings in one document lets a transaction check for
// overlaps and write the new booking atomically.
const cloud = require('wx-server-sdk')
const core = require('./booking-core')
const settings = require('./settings')
const instrumentIds = require('./instrument-ids.json')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, throwOnNotFound: false })

const db = cloud.database()
const _ = db.command
const COLLECTION = 'schedules'

class Abort extends Error {
  constructor(outcome) {
    super('aborted: ' + outcome.error)
    this.outcome = outcome
  }
}

function isMissingCollection(err) {
  const text = String((err && (err.errMsg || err.message)) || err)
  return !!err && (err.errCode === -502005 || /-502005|COLLECTION_NOT_EXIST|collection not exist/i.test(text))
}

// Create the day document up front so concurrent transactions always read and
// write the same existing document (and conflict with each other).
async function ensureDay(id, instrumentId, date) {
  try {
    const existing = await db.collection(COLLECTION).doc(id).get()
    if (existing.data) return
  } catch (err) {
    if (!isMissingCollection(err)) throw err
    await db.createCollection(COLLECTION).catch(() => {})
  }
  try {
    await db.collection(COLLECTION).add({
      data: { _id: id, instrumentId, date, bookings: [], cancelled: [], updatedAt: Date.now() }
    })
  } catch (err) {
    // Another request created it first, which is fine.
  }
}

const store = {
  async listDays(instrumentId, fromDate, toDate) {
    try {
      const res = await db
        .collection(COLLECTION)
        .where({ instrumentId, date: _.gte(fromDate).and(_.lte(toDate)) })
        .limit(100)
        .get()
      return res.data
    } catch (err) {
      if (isMissingCollection(err)) return []
      throw err
    }
  },

  async updateDay(instrumentId, date, mutate) {
    const id = instrumentId + '_' + date
    await ensureDay(id, instrumentId, date)
    try {
      // runTransaction retries the callback when another write hits the same document.
      return await db.runTransaction(async (transaction) => {
        const ref = transaction.collection(COLLECTION).doc(id)
        const snapshot = await ref.get()
        const outcome = mutate(core.normalizeDay(snapshot.data))
        if (outcome.error) throw new Abort(outcome)
        await ref.set({
          data: {
            instrumentId,
            date,
            bookings: outcome.day.bookings,
            cancelled: outcome.day.cancelled,
            updatedAt: Date.now()
          }
        })
        return outcome
      })
    } catch (err) {
      if (err instanceof Abort) return err.outcome
      throw err
    }
  }
}

async function checkText(text, openid) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({ openid, scene: 1, version: 2, content: text })
    return !(res && res.result && res.result.suggest === 'risky')
  } catch (err) {
    // Do not block bookings when the check itself is unavailable.
    console.warn('msgSecCheck failed', err)
    return true
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const ctx = {
    store,
    openid: OPENID,
    isAdmin: settings.ADMIN_OPENIDS.indexOf(OPENID) !== -1,
    nowMs: Date.now(),
    isInstrument: (id) => instrumentIds.indexOf(id) !== -1,
    checkText: settings.CONTENT_CHECK ? (text) => checkText(text, OPENID) : null
  }
  try {
    return await core.handleAction(event, ctx)
  } catch (err) {
    console.error('booking action failed', event && event.action, err)
    return { ok: false, code: 'DEFAULT' }
  }
}
