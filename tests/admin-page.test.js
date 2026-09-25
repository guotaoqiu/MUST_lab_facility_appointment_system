// Booking admin: all bookings of an instrument, suspend switch, Excel export.
const { useFixedNow, installWx, render, flush, text } = require('./support/harness')

useFixedNow() // Friday 25 Sep 2026, 10:40 in Macau

const i18n = require('../miniprogram/utils/i18n')
const service = require('../miniprogram/services/booking')

let w
beforeEach(async () => {
  w = installWx()
  i18n.setLang('zh')
  await service.login({ nickname: '小明' })
  await service.create({ instrumentId: 'centrifuge', date: '2026-09-28', startMin: 600, endMin: 660, name: '陳小明', purpose: '離心分離' })
  await service.adminLogin('admin', 'admin123')
})

async function openAdmin(query = { id: 'centrifuge' }) {
  const page = render('pages/admin/admin')
  page.instance.onLoad(query)
  page.instance.onShow()
  await flush()
  await flush()
  return page
}

test('lists the month\'s bookings with the WeChat user, name, purpose and time', async () => {
  const page = await openAdmin()
  expect(w.titles).toContain('預約管理')
  expect(text(page)).toContain('離心機')
  expect(text(page)).toContain('2026年9月')
  expect(text(page)).toContain('有效 3 筆，共 2.5 小時；已取消 0 筆')
  const mine = page.querySelectorAll('.record').find((r) => text(r).includes('陳小明'))
  expect(text(mine)).toContain('小明') // WeChat nickname
  expect(text(mine)).toContain('demo-user') // WeChat user id (openid)
  expect(text(mine)).toContain('離心分離')
  expect(text(mine)).toContain('10:00 – 11:00')
  expect(text(mine)).toContain('預約於')
  expect(mine.querySelector('.cancel')).toBeTruthy()

  page.querySelectorAll('.month-arrow')[1].dispatchEvent('tap')
  await flush()
  await flush()
  expect(text(page)).toContain('2026年10月')
  expect(text(page)).toContain('這個月沒有預約記錄')
})

test('another instrument can be picked', async () => {
  const page = await openAdmin()
  page.instance.onPickInstrument({ detail: { value: 10 } })
  await flush()
  await flush()
  expect(text(page)).toContain('水泥基材料高溫碳化反應試驗設備')
  expect(page.querySelectorAll('.record').length).toBeGreaterThan(1)
})

test('suspending asks for a reason; resuming asks for confirmation', async () => {
  const page = await openAdmin()
  expect(text(page)).toContain('開放預約中')
  w.modalContent = '離心機維修中'
  page.instance.onSuspendChange({ detail: { value: true } })
  await flush()
  await flush()
  expect(w.modals[0]).toMatchObject({ editable: true, placeholderText: '暫停原因（例如：儀器維修中）' })
  expect(text(page)).toContain('離心機維修中')
  expect((await service.list('centrifuge')).suspended.centrifuge.reason).toBe('離心機維修中')

  w.modalAnswer = false
  const toggles = []
  const setData = page.instance.setData.bind(page.instance)
  page.instance.setData = (d, cb) => {
    if ('switchOn' in d) toggles.push(d.switchOn)
    return setData(d, cb)
  }
  page.instance.onSuspendChange({ detail: { value: false } })
  await flush()
  expect(page.instance.data.suspended).toBeTruthy() // kept when the admin says no
  // The switch had moved to "off"; it is really moved back, not just left as it is.
  expect(toggles).toEqual([false, true])
  expect(page.instance.data.switchOn).toBe(true)
  page.instance.setData = setData
  w.modalAnswer = true
  page.instance.onSuspendChange({ detail: { value: false } })
  await flush()
  await flush()
  expect(page.instance.data.suspended).toBeNull()
  expect(text(page)).toContain('開放預約中')
})

test('export opens an Excel file named after the instrument and period', async () => {
  const page = await openAdmin()
  page.querySelector('.bar-btn').dispatchEvent('tap')
  await flush()
  await flush()
  expect(w.actionSheets[0]).toEqual(['匯出 2026年9月', '匯出全部記錄'])
  expect(w.opened).toHaveLength(1)
  expect(w.opened[0]).toMatchObject({ filePath: 'wxfile://usr/離心機_2026-09.xlsx', fileType: 'xlsx', showMenu: true })
  const bytes = new Uint8Array(w.files.get('wxfile://usr/離心機_2026-09.xlsx'))
  expect(Buffer.from(bytes.slice(0, 2)).toString()).toBe('PK')

  w.actionSheetIndex = 1
  page.querySelector('.bar-btn').dispatchEvent('tap')
  await flush()
  await flush()
  expect(w.opened[1].filePath).toBe('wxfile://usr/離心機_全部.xlsx')
})

test('admins can cancel anyone\'s upcoming booking from the list', async () => {
  const page = await openAdmin()
  const other = page.querySelectorAll('.record').find((r) => text(r).includes('Maria Santos')) // a sample booking by someone else
  other.querySelector('.cancel').dispatchEvent('tap')
  await flush()
  await flush()
  const after = page.querySelectorAll('.record').find((r) => text(r).includes('Maria Santos'))
  expect(text(after)).toContain('已取消')
  expect(text(after)).toContain('管理員取消（admin）')
})

test('when the instrument broke, its upcoming bookings can be cancelled in one go', async () => {
  const page = await openAdmin()
  w.modalContent = '轉子損壞'
  page.instance.onSuspendChange({ detail: { value: true } })
  await flush()
  await flush()
  await flush()
  const offer = w.modals[1]
  expect(offer).toMatchObject({ title: '已暫停預約', confirmText: '全部取消' })
  expect(offer.content).toMatch(/^此儀器還有 2 個未結束的預約/) // the one on Wednesday has ended
  await flush()
  await flush()
  expect(w.toasts.map((t) => t.title)).toContain('已取消 2 個預約')
  const cancelled = page.querySelectorAll('.record').filter((r) => text(r).includes('儀器暫停預約：轉子損壞'))
  expect(cancelled).toHaveLength(2)
})

test('bookings kept at first can still be cancelled in one go later', async () => {
  const page = await openAdmin()
  w.modalContent = '轉子損壞'
  w.modalAnswer = true
  const answers = [true, false] // confirm the suspension, then keep the bookings
  w.showModalAnswers = answers
  const showModal = wx.showModal
  wx.showModal = (o) => {
    w.modals.push(o)
    if (o.success) o.success({ confirm: answers.length ? answers.shift() : true, content: w.modalContent })
  }
  page.instance.onSuspendChange({ detail: { value: true } })
  await flush()
  await flush()
  await flush()
  expect(page.querySelectorAll('.record').filter((r) => text(r).includes('儀器暫停預約'))).toHaveLength(0)
  const button = page.querySelector('.cancel-all')
  expect(text(button)).toContain('取消全部 2 個未結束的預約')
  button.dispatchEvent('tap')
  await flush()
  await flush()
  await flush()
  wx.showModal = showModal
  expect(page.querySelectorAll('.record').filter((r) => text(r).includes('儀器暫停預約：轉子損壞'))).toHaveLength(2)
  expect(page.querySelector('.cancel-all')).toBeUndefined()
})

test('a list that failed to load offers a retry', async () => {
  const original = service.adminRecords
  service.adminRecords = async () => ({ ok: false, code: 'NETWORK_ERROR' })
  const page = await openAdmin()
  expect(text(page)).toContain('載入失敗')
  expect(text(page)).not.toContain('這個月沒有預約記錄')
  // The status is unknown too: not "open", and the switch waits.
  expect(text(page)).not.toContain('開放預約中')
  expect(page.instance.data.statusKnown).toBe(false)
  service.adminRecords = original
  page.querySelector('.retry').dispatchEvent('tap')
  await flush()
  await flush()
  expect(page.querySelectorAll('.record').length).toBeGreaterThan(0)
})

test('opens on the instrument used last time', async () => {
  const first = await openAdmin()
  first.instance.onPickInstrument({ detail: { value: 10 } })
  await flush()
  const again = await openAdmin({})
  expect(again.instance.data.current.id).toBe('carbonation-reactor')
  // Opened for an instrument from the calendar's 管理 button: that one next time.
  await openAdmin({ id: 'ball-mill' })
  expect((await openAdmin({})).instance.data.current.id).toBe('ball-mill')
})

test('without a remembered instrument it opens the one on the calendar', async () => {
  w.storage.set('lastInstrument', JSON.stringify('centrifuge'))
  expect((await openAdmin({})).instance.data.current.id).toBe('centrifuge')
})

test('without administrator rights it goes to the administrator sign-in, and comes back here', async () => {
  await service.logout()
  await service.login()
  await openAdmin({ id: 'centrifuge', month: '2026-08' })
  expect(w.redirectTo).toEqual(['/pages/login/login?mode=admin&next=admin&id=centrifuge&month=2026-08'])
})

test('an admin sign-in that ended while cancelling: one message, then the sign-in', async () => {
  const page = await openAdmin()
  const demo = JSON.parse(w.storage.get('demoState.v2'))
  demo.users['demo-user'].admin.expiresAt = 1
  w.storage.set('demoState.v2', JSON.stringify(demo))
  const other = page.querySelectorAll('.record').find((r) => text(r).includes('Maria Santos'))
  other.querySelector('.cancel').dispatchEvent('tap')
  await flush()
  await flush()
  expect(w.modals.map((m) => m.content)).toEqual(['確定要取消這個預約嗎？', '需要管理員權限，請重新以管理員登入'])
  expect(w.redirectTo).toEqual(['/pages/login/login?mode=admin&next=admin&id=centrifuge&month=2026-09'])
})
