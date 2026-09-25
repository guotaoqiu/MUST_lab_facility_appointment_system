// The booking service in cloud mode, against a fake wx.cloud.
const { useFixedNow, installWx } = require('./support/harness')

useFixedNow()

let w
beforeEach(() => {
  w = installWx()
})

/** A fresh service in cloud mode; `results` answers the cloud function by action. */
function cloudService(results) {
  let service, session
  jest.isolateModules(() => {
    jest.doMock('../miniprogram/config', () => ({ cloudEnv: 'test-env', functionName: 'booking' }))
    service = require('../miniprogram/services/booking')
    session = require('../miniprogram/utils/session')
  })
  const calls = []
  wx.cloud = {
    init() {},
    async callFunction({ data }) {
      calls.push(data)
      const r = results[data.action]
      if (r instanceof Error) throw r
      return { result: r }
    },
    downloadFile: async ({ fileID }) => ({ tempFilePath: 'wxfile://tmp/' + fileID.split('/').pop() })
  }
  return { service, session, calls }
}

const admin = { role: 'admin', account: 'admin', nickname: '小明', avatar: '' }

test('a sign-out that did not reach the server keeps the phone signed in', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  const { service, session } = cloudService({ logout: new Error('offline') })
  session.set(admin)
  expect(await service.logout()).toEqual({ ok: false, code: 'NETWORK_ERROR' })
  expect(session.get()).toEqual(admin)
  console.error.mockRestore()
})

test('a sign-out that worked forgets the sign-in', async () => {
  const { service, session } = cloudService({ logout: { ok: true, me: { loggedIn: false, isAdmin: false } } })
  session.set(admin)
  expect((await service.logout()).ok).toBe(true)
  expect(session.get()).toBeNull()
})

test('a failure saying the admin sign-in has ended updates the phone', async () => {
  const { service, session } = cloudService({
    setSuspended: { ok: false, code: 'ADMIN_REQUIRED', me: { loggedIn: true, isAdmin: false, nickname: '小明', avatar: '' } }
  })
  session.set(admin)
  await service.setSuspended('centrifuge', true, '')
  expect(session.get()).toMatchObject({ role: 'user', nickname: '小明' })
})

test('an export is downloaded, opened under its name, and removed from cloud storage', async () => {
  const fileID = 'cloud://env/exports/' + 'a'.repeat(32) + '.xlsx'
  const { service, calls } = cloudService({
    exportRecords: { ok: true, count: 3, file: { name: '離心機_2026-09.xlsx', fileID } },
    discardExport: { ok: true }
  })
  expect(await service.exportRecords('centrifuge', '2026-09', 'zh')).toEqual({ ok: true, count: 3 })
  expect(w.opened[0]).toMatchObject({ filePath: 'wxfile://usr/離心機_2026-09.xlsx', showMenu: true })
  expect(calls.map((c) => c.action)).toEqual(['exportRecords', 'discardExport'])
  expect(calls[1].fileID).toBe(fileID)
})
