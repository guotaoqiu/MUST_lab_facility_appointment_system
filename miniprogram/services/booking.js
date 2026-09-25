// Booking API used by the pages. Talks to the `booking` cloud function when a
// cloud environment is configured, otherwise runs the same code locally.
const config = require('../config')
const core = require('../shared/booking-core')
const clock = require('../utils/clock')
const session = require('../utils/session')
const localStore = require('./local-store')

const DEMO_OPENID = 'demo-user'
// Demo mode only; real administrator accounts live in cloudfunctions/booking/settings.js.
const DEMO_ADMIN = { account: 'admin', password: 'admin123' }

let cloudInitialized = false

function useCloud() {
  if (!config.cloudEnv || !wx.cloud) return false
  if (!cloudInitialized) {
    wx.cloud.init({ env: config.cloudEnv, traceUser: true })
    cloudInitialized = true
  }
  return true
}

function fs(method, options) {
  return new Promise((resolve, reject) =>
    wx.getFileSystemManager()[method](Object.assign({}, options, { success: resolve, fail: reject }))
  )
}

function demoContext() {
  return {
    store: localStore,
    openid: DEMO_OPENID,
    nowMs: Date.now(),
    admins: {
      configured: true,
      verify: async (account, password) => account === DEMO_ADMIN.account && password === DEMO_ADMIN.password
    },
    async saveFile(bytes, name) {
      const path = wx.env.USER_DATA_PATH + '/' + name
      await fs('writeFile', { filePath: path, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) })
      return { path }
    }
  }
}

async function call(action, data) {
  const event = Object.assign({ action }, data)
  let res
  if (!useCloud()) {
    res = await core.handleAction(event, demoContext())
  } else {
    try {
      const out = await wx.cloud.callFunction({ name: config.functionName, data: event })
      res = (out && out.result) || { ok: false, code: 'DEFAULT' }
    } catch (err) {
      console.error('[booking] ' + action + ' failed', err)
      return { ok: false, code: 'NETWORK_ERROR' }
    }
  }
  if (res.ok && res.serverTime) clock.sync(res.serverTime)
  if (res.ok && res.me) session.sync(res.me)
  return res
}

module.exports = {
  isDemo() {
    return !useCloud()
  },

  demoAdmin: DEMO_ADMIN,

  me() {
    return call('me')
  },

  /** WeChat login. Without a nickname it only checks whether a profile exists. */
  login(profile) {
    return call('login', profile || {})
  },

  adminLogin(account, password) {
    return call('adminLogin', { account, password })
  },

  async logout() {
    const res = await call('logout')
    session.clear()
    return res
  },

  /** Store the picked avatar where the admin can see it later. */
  async uploadAvatar(tempPath) {
    if (!tempPath) return ''
    if (!useCloud()) {
      const path = wx.env.USER_DATA_PATH + '/avatar-' + Date.now() + '.jpg'
      try {
        await fs('copyFile', { srcPath: tempPath, destPath: path })
        return path
      } catch (e) {
        return tempPath
      }
    }
    try {
      const res = await wx.cloud.uploadFile({ cloudPath: 'avatars/' + core.makeId(Date.now()) + '.jpg', filePath: tempPath })
      return res.fileID
    } catch (err) {
      console.error('[booking] avatar upload failed', err)
      return ''
    }
  },

  /** Bookings of one instrument for this week and next week, plus suspended instruments. */
  list(instrumentId) {
    return call('list', { instrumentId })
  },

  /** payload: { instrumentId, date, startMin, endMin, name, purpose, requestId } */
  create(payload) {
    return call('create', payload)
  },

  cancel(booking) {
    return call('cancel', { instrumentId: booking.instrumentId, date: booking.date, id: booking.id })
  },

  myBookings() {
    return call('myBookings')
  },

  adminRecords(instrumentId, month) {
    return call('adminRecords', { instrumentId, month })
  },

  setSuspended(instrumentId, suspended, reason) {
    return call('setSuspended', { instrumentId, suspended, reason })
  },

  /** Build the Excel file and open it (the viewer can forward or save it). */
  async exportRecords(instrumentId, month, lang) {
    const res = await call('exportRecords', { instrumentId, month, lang })
    if (!res.ok) return res
    try {
      let path = res.file.path
      if (res.file.fileID) path = (await wx.cloud.downloadFile({ fileID: res.file.fileID })).tempFilePath
      const named = wx.env.USER_DATA_PATH + '/' + res.file.name
      if (path !== named) {
        try {
          await fs('copyFile', { srcPath: path, destPath: named })
          path = named
        } catch (e) {}
      }
      await new Promise((resolve, reject) =>
        wx.openDocument({ filePath: path, fileType: 'xlsx', showMenu: true, success: resolve, fail: reject })
      )
      return { ok: true, count: res.count }
    } catch (err) {
      console.error('[booking] opening the export failed', err)
      return { ok: false, code: 'EXPORT_OPEN_FAILED' }
    }
  }
}
