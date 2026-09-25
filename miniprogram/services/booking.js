// Booking API used by the pages. Talks to the `booking` cloud function when a
// cloud environment is configured, otherwise runs the same rules locally.
const config = require('../config')
const core = require('../utils/booking-core')
const clock = require('../utils/clock')
const instruments = require('../data/instruments')
const localStore = require('./local-store')

const DEMO_OPENID = 'demo-user'
const instrumentIds = instruments.map((i) => i.id)

let cloudInitialized = false

function useCloud() {
  if (!config.cloudEnv || !wx.cloud) return false
  if (!cloudInitialized) {
    wx.cloud.init({ env: config.cloudEnv, traceUser: true })
    cloudInitialized = true
  }
  return true
}

async function call(action, data) {
  const event = Object.assign({ action }, data)
  if (!useCloud()) {
    return core.handleAction(event, {
      store: localStore,
      openid: DEMO_OPENID,
      isAdmin: false,
      nowMs: Date.now(),
      isInstrument: (id) => instrumentIds.indexOf(id) !== -1
    })
  }
  try {
    const res = await wx.cloud.callFunction({ name: config.functionName, data: event })
    return (res && res.result) || { ok: false, code: 'DEFAULT' }
  } catch (err) {
    console.error('[booking] ' + action + ' failed', err)
    return { ok: false, code: 'NETWORK_ERROR' }
  }
}

module.exports = {
  isDemo() {
    return !useCloud()
  },

  /** Bookings of one instrument for this week and next week. */
  async list(instrumentId) {
    const res = await call('list', { instrumentId })
    if (res.ok) clock.sync(res.serverTime)
    return res
  },

  /** payload: { instrumentId, date, startMin, endMin, name, purpose } */
  create(payload) {
    return call('create', payload)
  },

  cancel(booking) {
    return call('cancel', { instrumentId: booking.instrumentId, date: booking.date, id: booking.id })
  }
}
