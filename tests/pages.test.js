// End-to-end flows through the booking and confirm pages in demo mode (no cloud
// environment), rendered with miniprogram-simulate.
// (The home page has its own file: a test file can load a shared child component
// such as lang-switch for only one page.)
const { useFixedNow, installWx, render, flush, text } = require('./support/harness')

useFixedNow() // Friday 25 Sep 2026, 10:40 in Macau

const i18n = require('../miniprogram/utils/i18n')
const service = require('../miniprogram/services/booking')

let w
let pages = []
beforeEach(async () => {
  w = installWx()
  i18n.setLang('zh')
  pages = []
  await service.login({ nickname: '小明' }) // signed in as a WeChat user (demo mode)
})
afterEach(() => pages.forEach((p) => p.instance.onUnload && p.instance.onUnload()))

async function openBooking(query = {}) {
  const page = render('pages/booking/booking')
  pages.push(page)
  page.instance.onLoad(query)
  page.instance.onShow()
  page.instance.onReady()
  await flush()
  return page
}

async function openConfirm(query) {
  const page = render('pages/confirm/confirm')
  page.instance.onLoad(query)
  page.instance.onShow()
  await flush()
  return page
}

const drawer = (page) => page.querySelector('#drawer')
const calendar = (page) => page.querySelector('#calendar')

async function pick(page, id) {
  drawer(page).querySelectorAll('.item').find((i) => i.dom.dataset.id === id).dispatchEvent('tap')
  await flush()
  await flush()
}

async function tapCell(page, col, min) {
  calendar(page)
    .querySelectorAll('.cell')
    .find((c) => Number(c.dom.dataset.col) === col && Number(c.dom.dataset.min) === min)
    .dispatchEvent('tap')
  await flush()
}

describe('booking page', () => {
  test('opens with the side menu listing all instruments', async () => {
    const page = await openBooking()
    expect(page.instance.data.drawerOpen).toBe(true)
    expect(drawer(page).querySelectorAll('.item')).toHaveLength(23)
    expect(text(drawer(page))).toContain('共 23 台儀器')
    expect(text(page)).toContain('演示模式')
    expect(text(page)).toContain('請先從側邊欄選擇儀器')
    expect(w.titles).toContain('儀器預約')
  })

  test('search matches Chinese, English, model and location', async () => {
    const page = await openBooking()
    const d = drawer(page)
    const search = async (keyword) => {
      d.instance.onInput({ detail: { value: keyword } })
      await flush()
      return d.querySelectorAll('.item').map((i) => i.dom.dataset.id)
    }
    expect(await search('離心')).toEqual(['centrifuge'])
    expect(await search('CENTRI')).toEqual(['centrifuge'])
    expect(await search('xqm')).toEqual(['ball-mill'])
    expect(await search('ITC-81')).toEqual(['potentiostat'])
    expect(await search('zzz')).toEqual([])
    expect(text(d)).toContain('沒有符合的儀器')
  })

  test('picking an instrument shows its week with the bookings', async () => {
    const page = await openBooking()
    await pick(page, 'thermal-imager')
    expect(page.instance.data.drawerOpen).toBe(false)
    expect(JSON.parse(w.storage.get('lastInstrument'))).toBe('thermal-imager')
    expect(text(page)).toContain('紅外線熱成像儀')
    expect(page.instance.data.days.map((d) => d.dayNum)).toEqual([21, 22, 23, 24, 25, 26, 27])
    expect(page.instance.data.days[4].isToday).toBe(true)
    const names = calendar(page).querySelectorAll('.block-name').map((n) => n.dom.textContent)
    expect(names).toEqual(['陳大文', 'Li Wei'])

    page.querySelectorAll('.week')[1].dispatchEvent('tap')
    await flush()
    expect(page.instance.data.days[0].date).toBe('2026-09-28')
    expect(calendar(page).querySelectorAll('.block-name').map((n) => n.dom.textContent)).toEqual(['黃嘉欣'])
  })

  test('select a slot, see it in the bottom bar and go to the confirmation', async () => {
    const page = await openBooking()
    await pick(page, 'thermal-imager')
    expect(text(page.querySelector('.bar'))).toContain('點擊空白格子選擇時間')

    await tapCell(page, 5, 600) // Saturday 10:00
    expect(text(page.querySelector('.bar'))).toContain('9月26日（週六）')
    expect(text(page.querySelector('.bar'))).toContain('10:00 – 10:30 · 30 分鐘')

    page.querySelector('.bar-book').dispatchEvent('tap')
    await flush()
    expect(w.navigateTo).toEqual(['/pages/confirm/confirm?id=thermal-imager&date=2026-09-26&start=600&end=630'])

    page.querySelector('.bar-clear').dispatchEvent('tap')
    await flush()
    expect(page.instance.data.selection).toBeNull()
    expect(page.querySelector('.bar-book')).toBeUndefined()
  })

  test("someone else's booking shows details without a cancel button", async () => {
    const page = await openBooking()
    await pick(page, 'thermal-imager')
    calendar(page).querySelectorAll('.block')[1].dispatchEvent('tap')
    await flush()
    const sheet = page.querySelector('#detail')
    expect(text(sheet)).toContain('Li Wei')
    expect(text(sheet)).toContain('Thermal imaging of heated mortar prisms')
    expect(text(sheet)).toContain('9月23日（週三）')
    expect(text(sheet)).toContain('14:00 – 16:30 · 2.5 小時')
    expect(sheet.querySelector('.btn-danger')).toBeUndefined()
    sheet.querySelector('.btn-plain').dispatchEvent('tap')
    await flush()
    expect(page.instance.data.detail).toBeNull()
  })

  test('in English everything is relabelled (the switch lives in Settings)', async () => {
    const page = await openBooking()
    await pick(page, 'thermal-imager')
    i18n.setLang('en')
    page.instance.onShow() // back from Settings
    await flush()
    expect(text(page)).toContain('Infrared Thermal Imager')
    expect(text(page)).toContain('This Week')
    expect(text(page)).toContain('21 – 27 Sep')
    expect(page.instance.data.days[0].weekday).toBe('Mon')
    expect(w.titles[w.titles.length - 1]).toBe('Instrument Booking')
  })

  test('without signing in the booking system sends you to the sign-in choice', async () => {
    await service.logout()
    const page = render('pages/booking/booking')
    page.instance.onLoad({})
    page.instance.onShow()
    page.instance.onReady()
    await flush()
    expect(w.reLaunch).toEqual(['/pages/index/index?login=1'])
    expect(page.instance.data.drawerOpen).toBe(false)
  })

  test('the gear opens Settings; only administrators get the Manage button', async () => {
    const page = await openBooking()
    expect(page.querySelector('.manage')).toBeUndefined()
    page.querySelector('.top-action').dispatchEvent('tap')
    await flush()
    expect(w.navigateTo).toEqual(['/pages/settings/settings'])

    await service.adminLogin(service.demoAdmin.account, service.demoAdmin.password)
    const admin = await openBooking()
    await pick(admin, 'thermal-imager')
    admin.querySelector('.manage').dispatchEvent('tap')
    await flush()
    expect(w.navigateTo[1]).toBe('/pages/admin/admin?id=thermal-imager')
  })

  test('administrators see which WeChat user made a booking', async () => {
    await service.adminLogin(service.demoAdmin.account, service.demoAdmin.password)
    const page = await openBooking()
    await pick(page, 'thermal-imager')
    calendar(page).querySelectorAll('.block')[1].dispatchEvent('tap')
    await flush()
    const sheet = page.querySelector('#detail')
    expect(text(sheet)).toContain('微信用戶')
    expect(text(sheet)).toContain('Li Wei')
    expect(text(sheet)).toContain('預約於')
    expect(sheet.querySelector('.btn-danger')).toBeUndefined() // it has already ended

    page.instance.closeDetail()
    page.querySelectorAll('.week')[1].dispatchEvent('tap')
    await flush()
    calendar(page).querySelectorAll('.block')[0].dispatchEvent('tap')
    await flush()
    expect(text(sheet)).toContain('黃嘉欣')
    expect(sheet.querySelector('.btn-danger')).toBeTruthy() // admins may cancel anyone's upcoming booking
  })

  test('a suspended instrument shows why and cannot be booked', async () => {
    await service.adminLogin(service.demoAdmin.account, service.demoAdmin.password)
    await service.setSuspended('centrifuge', true, '維修中')
    await service.logout()
    await service.login()
    const page = await openBooking()
    await pick(page, 'centrifuge')
    expect(text(page)).toContain('此儀器暫停預約：維修中')
    expect(text(page).split('維修中')).toHaveLength(2) // shown once, not also in the bottom bar
    expect(text(page.querySelector('.bar'))).toContain('恢復預約後即可選擇時段')
    expect(calendar(page).instance.data.disabled).toBe(true)
    await tapCell(page, 5, 600)
    expect(page.instance.data.selection).toBeNull()
    page.instance.openDrawer()
    await flush()
    const item = drawer(page).querySelectorAll('.item').find((i) => i.dom.dataset.id === 'centrifuge')
    expect(text(item)).toContain('暫停預約')
  })

  test('an administrator whose sign-in has ended is told so when cancelling', async () => {
    await service.adminLogin(service.demoAdmin.account, service.demoAdmin.password)
    const page = await openBooking()
    await pick(page, 'thermal-imager')
    page.querySelectorAll('.week')[1].dispatchEvent('tap')
    await flush()
    calendar(page).querySelectorAll('.block')[0].dispatchEvent('tap') // someone else's booking
    await flush()
    // Meanwhile the week-long admin sign-in runs out.
    const demo = JSON.parse(w.storage.get('demoState.v2'))
    demo.users['demo-user'].admin.expiresAt = 1
    w.storage.set('demoState.v2', JSON.stringify(demo))
    page.querySelector('#detail').querySelector('.btn-danger').dispatchEvent('tap')
    await flush()
    await flush()
    expect(w.modals.map((m) => m.content)).toContain('需要管理員權限，請重新以管理員登入')
    expect(w.modals.map((m) => m.content)).not.toContain('只能取消自己的預約')
    expect(page.instance.data.isAdmin).toBe(false)
    expect(page.querySelector('.manage')).toBeUndefined()
  })

  test('signed out on another device: back to the sign-in, saying why', async () => {
    const page = await openBooking()
    const demo = JSON.parse(w.storage.get('demoState.v2'))
    demo.users['demo-user'].signedOut = true
    w.storage.set('demoState.v2', JSON.stringify(demo))
    await pick(page, 'centrifuge')
    expect(w.reLaunch).toEqual(['/pages/index/index?login=1&expired=1'])
  })

  test('the grid stays disabled until the bookings have loaded', async () => {
    const page = await openBooking()
    const original = service.list
    let release
    service.list = () => new Promise((resolve) => (release = resolve))
    await pick(page, 'centrifuge')
    expect(page.instance.data.ready).toBe(false)
    expect(text(page.querySelector('.sticky'))).toContain('載入中…') // floats over the grid
    expect(calendar(page).instance.data.disabled).toBe(true)
    await tapCell(page, 5, 600)
    expect(page.instance.data.selection).toBeNull()

    release({ ok: false, code: 'NETWORK_ERROR' })
    await flush()
    expect(text(page)).toContain('載入失敗')
    expect(calendar(page).instance.data.disabled).toBe(true)

    service.list = original
    page.querySelector('.status-retry').dispatchEvent('tap')
    await flush()
    await flush()
    expect(page.instance.data.ready).toBe(true)
    expect(calendar(page).instance.data.disabled).toBe(false)
  })

  test('a quick double tap on 預約 opens the confirmation once', async () => {
    const page = await openBooking()
    await pick(page, 'thermal-imager')
    await tapCell(page, 5, 600)
    page.querySelector('.bar-book').dispatchEvent('tap')
    page.querySelector('.bar-book').dispatchEvent('tap')
    await flush()
    expect(w.navigateTo).toHaveLength(1)
    page.instance.onShow() // back from the confirm page
    page.querySelector('.bar-book').dispatchEvent('tap')
    await flush()
    expect(w.navigateTo).toHaveLength(2)
  })

  test('the back key closes the side menu or the detail sheet first', async () => {
    const page = await openBooking()
    expect(page.instance.data.drawerOpen).toBe(true)
    page.instance.onOverlayBack()
    await flush()
    expect(page.instance.data.drawerOpen).toBe(false)
  })

  test('a booking that has ended is not offered for cancelling', async () => {
    await service.create({ instrumentId: 'centrifuge', date: '2026-09-25', startMin: 630, endMin: 660, name: 'Me', purpose: 'Now' })
    const page = await openBooking()
    await pick(page, 'centrifuge')
    const block = () => calendar(page).querySelector('.block-mine')
    block().dispatchEvent('tap')
    await flush()
    expect(page.instance.data.detail.canCancel).toBe(true)
    page.instance.closeDetail()

    jest.setSystemTime(new Date('2026-09-25T03:05:00Z')) // 11:05, the booking ended at 11:00
    block().dispatchEvent('tap')
    await flush()
    expect(page.instance.data.detail.canCancel).toBe(false)
    jest.setSystemTime(new Date('2026-09-25T02:40:00Z'))
  })

  test('coming back pre-selects the last instrument behind the side menu', async () => {
    w.storage.set('lastInstrument', JSON.stringify('centrifuge'))
    const page = await openBooking()
    expect(page.instance.data.drawerOpen).toBe(true)
    expect(page.instance.data.current.id).toBe('centrifuge')
    expect(drawer(page).querySelector('.item-on').dom.dataset.id).toBe('centrifuge')
    page.instance.closeDrawer()
    await flush()
    expect(calendar(page).querySelectorAll('.block-name').map((n) => n.dom.textContent)).toEqual(['吳思穎', 'Maria Santos'])
  })
})

describe('confirm page', () => {
  const query = { id: 'thermal-imager', date: '2026-09-26', start: '600', end: '690' }

  test('summarises the booking and pre-fills the last name used', async () => {
    w.storage.set('bookerName', JSON.stringify('陳大文'))
    const page = await openConfirm(query)
    expect(text(page)).toContain('紅外線熱成像儀')
    expect(text(page)).toContain('9月26日（週六）')
    expect(text(page)).toContain('10:00 – 11:30')
    expect(text(page)).toContain('1.5 小時')
    expect(page.instance.data.name).toBe('陳大文')
    expect(w.titles).toContain('確認預約')
  })

  test('name and purpose are required, and both problems show at once', async () => {
    const page = await openConfirm(query)
    await page.instance.submit()
    await flush()
    expect(text(page)).toContain('請填寫姓名')
    expect(text(page)).toContain('請說明用途')
    page.instance.onNameInput({ detail: { value: '陳大文' } })
    await flush()
    expect(text(page)).not.toContain('請填寫姓名')
    await page.instance.submit()
    await flush()
    expect(text(page)).toContain('請說明用途')
    expect((await service.list('thermal-imager')).bookings).toHaveLength(3) // only the samples
  })

  test('booking succeeds, remembers the name and returns to the calendar', async () => {
    const timers = jest.spyOn(global, 'setTimeout')
    const page = await openConfirm(query)
    page.instance.onNameInput({ detail: { value: '  陳大文 ' } })
    page.instance.onPurposeInput({ detail: { value: '混凝土試件溫度場' } })
    expect(page.instance.data.purposeLength).toBe(8)
    await page.instance.submit()

    expect(w.toasts.map((t) => t.title)).toEqual(['預約成功'])
    expect(JSON.parse(w.storage.get('bookerName'))).toBe('陳大文')
    const back = timers.mock.calls.find((c) => c[1] === 1500)
    expect(w.navigateBack).toBe(0)
    back[0]()
    expect(w.navigateBack).toBe(1)
    timers.mockRestore()

    // Pressing again while leaving does nothing.
    await page.instance.submit()
    expect(w.toasts).toHaveLength(1)

    const list = await service.list('thermal-imager')
    expect(list.bookings.find((b) => b.mine)).toMatchObject({ date: '2026-09-26', startMin: 600, endMin: 690, name: '陳大文' })
  })

  test('leaving the page before the automatic return does not pop the calendar too', async () => {
    const timers = jest.spyOn(global, 'setTimeout')
    const page = await openConfirm(query)
    page.instance.onNameInput({ detail: { value: '陳大文' } })
    page.instance.onPurposeInput({ detail: { value: '測試' } })
    await page.instance.submit()
    const back = timers.mock.calls.find((c) => c[1] === 1500)
    timers.mockRestore()
    page.instance.onUnload() // the user pressed back during the toast
    back[0]()
    expect(w.navigateBack).toBe(0)
  })

  test('a booking that finishes after the user went back refreshes the calendar', async () => {
    const booking = await openBooking()
    await pick(booking, 'thermal-imager')
    const page = await openConfirm(query)
    page.instance.onNameInput({ detail: { value: '陳大文' } })
    page.instance.onPurposeInput({ detail: { value: '測試' } })
    const original = service.create
    let release
    service.create = (payload) => new Promise((resolve) => (release = () => original(payload).then(resolve)))
    const submitted = page.instance.submit()
    page.instance.onUnload() // back pressed while saving
    booking.instance.onShow()
    await flush()
    global.getCurrentPages = () => [booking.instance]
    booking.instance.route = 'pages/booking/booking'
    release()
    await submitted
    await flush()
    await flush()
    service.create = original
    delete global.getCurrentPages
    expect(w.navigateBack).toBe(0)
    expect(w.toasts[0]).toMatchObject({ title: '預約成功', mask: false })
    expect(calendar(booking).querySelector('.block-mine')).toBeTruthy()
  })

  test('a slot taken in the meantime sends the user back to choose again', async () => {
    await service.create({ instrumentId: 'thermal-imager', date: '2026-09-26', startMin: 630, endMin: 660, name: 'X', purpose: 'Y' })
    const page = await openConfirm(query)
    page.instance.onNameInput({ detail: { value: '陳大文' } })
    page.instance.onPurposeInput({ detail: { value: '測試' } })
    await page.instance.submit()
    expect(w.modals[0].content).toBe('該時段剛被其他人預約，請重新選擇')
    expect(w.navigateBack).toBe(1)
    expect(page.instance.data.submitting).toBe(false)
  })

  test('an instrument suspended in the meantime sends the user back', async () => {
    const page = await openConfirm(query)
    await service.adminLogin(service.demoAdmin.account, service.demoAdmin.password)
    await service.setSuspended('thermal-imager', true, '')
    await service.logout()
    await service.login()
    page.instance.onNameInput({ detail: { value: '陳大文' } })
    page.instance.onPurposeInput({ detail: { value: '測試' } })
    await page.instance.submit()
    expect(w.modals[0].content).toBe('此儀器暫停預約')
    expect(w.navigateBack).toBe(1)
  })

  test('a broken link shows an error and goes back', async () => {
    await openConfirm({ id: 'nope', date: '2026-09-26', start: '600', end: '630' })
    expect(w.modals).toHaveLength(1)
    expect(w.navigateBack).toBe(1)
  })
})

describe('full flow', () => {
  test('book, see it as mine, cancel it', async () => {
    const booking = await openBooking()
    await pick(booking, 'centrifuge')
    await tapCell(booking, 5, 780) // Saturday 13:00
    booking.querySelector('.bar-book').dispatchEvent('tap')
    await flush()
    const url = w.navigateTo[0]
    const params = Object.fromEntries(new URLSearchParams(url.split('?')[1]))

    const confirm = await openConfirm(params)
    confirm.instance.onNameInput({ detail: { value: 'Maria' } })
    confirm.instance.onPurposeInput({ detail: { value: 'Centrifuge cement paste' } })
    await confirm.instance.submit()

    // Back on the calendar.
    booking.instance.onShow()
    await flush()
    await flush()
    expect(booking.instance.data.selection).toBeNull()
    const mine = calendar(booking).querySelector('.block-mine')
    expect(mine).toBeTruthy()
    expect(text(mine)).toContain('Maria')

    mine.dispatchEvent('tap')
    await flush()
    const sheet = booking.querySelector('#detail')
    expect(text(sheet)).toContain('我的')
    sheet.querySelector('.btn-danger').dispatchEvent('tap')
    await flush()
    await flush()
    await flush()
    expect(w.modals[0]).toMatchObject({ title: '取消預約', confirmText: '取消預約', cancelText: '保留' })
    expect(w.toasts.map((t) => t.title)).toContain('已取消')
    expect(calendar(booking).querySelector('.block-mine')).toBeUndefined()

    // The rendered bottom bar keeps following the selection.
    await tapCell(booking, 6, 900) // Sunday 15:00
    const bar = text(booking.querySelector('.bar'))
    expect(bar).toContain('9月27日（週日）')
    expect(bar).toContain('15:00 – 15:30 · 30 分鐘')
    expect(bar).not.toContain('點擊空白格子')
  })

  test('keeping the booking in the cancel dialog changes nothing', async () => {
    await service.create({ instrumentId: 'centrifuge', date: '2026-09-26', startMin: 780, endMin: 840, name: 'Maria', purpose: 'Y' })
    const booking = await openBooking()
    await pick(booking, 'centrifuge')
    calendar(booking).querySelector('.block-mine').dispatchEvent('tap')
    await flush()
    w.modalAnswer = false
    booking.querySelector('#detail').querySelector('.btn-danger').dispatchEvent('tap')
    await flush()
    expect(calendar(booking).querySelector('.block-mine')).toBeTruthy()
  })
})
