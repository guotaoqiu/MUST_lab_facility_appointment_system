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
  page.instance.onSuspendChange({ detail: { value: false } })
  await flush()
  expect(page.instance.data.suspended).toBeTruthy() // kept when the admin says no
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

test('without administrator rights it goes to the administrator sign-in', async () => {
  await service.logout()
  await service.login()
  await openAdmin()
  expect(w.redirectTo).toEqual(['/pages/login/login?mode=admin'])
})
