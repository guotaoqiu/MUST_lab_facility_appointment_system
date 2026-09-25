// Settings: profile, my bookings, language, sign-out.
const { useFixedNow, installWx, render, flush, text } = require('./support/harness')

useFixedNow() // Friday 25 Sep 2026, 10:40 in Macau

const i18n = require('../miniprogram/utils/i18n')
const session = require('../miniprogram/utils/session')
const service = require('../miniprogram/services/booking')

let w
beforeEach(async () => {
  w = installWx()
  i18n.setLang('zh')
  await service.login({ nickname: '小明' })
})

async function openSettings() {
  const page = render('pages/settings/settings')
  page.instance.onShow() // (no onLoad on this page)
  await flush()
  await flush()
  return page
}

const make = (extra) =>
  service.create(Object.assign({ instrumentId: 'centrifuge', date: '2026-09-28', startMin: 600, endMin: 660, name: '陳小明', purpose: '離心分離' }, extra))

test('shows who is signed in and their upcoming bookings; cancelled ones move to history', async () => {
  await make()
  const b = (await make({ instrumentId: 'ball-mill', date: '2026-09-26', startMin: 900, endMin: 990 })).booking
  const page = await openSettings()
  expect(w.titles).toContain('設置')
  expect(text(page.querySelector('.profile'))).toContain('小明')
  expect(text(page.querySelector('.profile'))).toContain('微信用戶')

  const items = page.querySelectorAll('.record')
  expect(items).toHaveLength(2)
  expect(text(items[0])).toContain('立式行星球磨機')
  expect(text(items[0])).toContain('9月26日（週六）')
  expect(text(items[0])).toContain('15:00 – 16:30 · 1.5 小時')
  expect(text(items[1])).toContain('離心機')

  items[0].querySelector('.cancel').dispatchEvent('tap')
  await flush()
  await flush()
  expect(w.toasts.map((t) => t.title)).toContain('已取消')
  expect(page.querySelectorAll('.record')).toHaveLength(1)

  page.querySelectorAll('.tab')[1].dispatchEvent('tap')
  await flush()
  const history = page.querySelectorAll('.record')
  expect(history).toHaveLength(1)
  expect(text(history[0])).toContain('已取消')
  expect(text(history[0])).toContain('本人取消')
  expect(history[0].querySelector('.cancel')).toBeUndefined()
  expect(b.id).toBeTruthy()
})

test('no bookings yet', async () => {
  const page = await openSettings()
  expect(text(page)).toContain('沒有即將到來的預約')
})

test('the language can be switched here', async () => {
  const page = await openSettings()
  page.querySelector('#lang').querySelectorAll('.opt')[1].dispatchEvent('tap')
  await flush()
  expect(text(page)).toContain('My Bookings')
  expect(w.titles[w.titles.length - 1]).toBe('Settings')
})

test('users can switch to administrator sign-in; administrators get Booking Admin', async () => {
  const page = await openSettings()
  expect(text(page)).not.toContain('預約管理')
  const row = page.querySelectorAll('.row').find((r) => text(r).includes('管理員登入'))
  row.dispatchEvent('tap')
  await flush()
  expect(w.navigateTo).toEqual(['/pages/login/login?mode=admin&next=back'])

  await service.adminLogin('admin', 'admin123')
  const admin = await openSettings()
  expect(text(admin.querySelector('.profile'))).toContain('管理員 · admin')
  admin.querySelectorAll('.row').find((r) => text(r).includes('預約管理')).dispatchEvent('tap')
  await flush()
  expect(w.navigateTo[1]).toBe('/pages/admin/admin')
})

test('signing out goes back to the home page and ends the admin sign-in', async () => {
  await service.adminLogin('admin', 'admin123')
  const page = await openSettings()
  page.querySelectorAll('.row').find((r) => text(r).includes('退出登入')).dispatchEvent('tap')
  await flush()
  await flush()
  expect(w.reLaunch).toEqual(['/pages/index/index'])
  expect(session.get()).toBeNull()
  expect((await service.me()).me.isAdmin).toBe(false)
})

test('without a session it asks to sign in', async () => {
  session.clear()
  await openSettings()
  expect(w.reLaunch).toEqual(['/pages/index/index?login=1'])
})
