// Home page (sign-in choice) and the sign-in page, in demo mode.
const { useFixedNow, installWx, render, flush, text } = require('./support/harness')

useFixedNow()

const i18n = require('../miniprogram/utils/i18n')
const session = require('../miniprogram/utils/session')
const service = require('../miniprogram/services/booking')

// The sign-in choice waits a moment after closing the sheet before it navigates.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let w
beforeEach(() => {
  w = installWx()
  i18n.setLang('zh')
})

async function openHome(query = {}) {
  const page = render('pages/index/index')
  page.instance.onLoad(query)
  page.instance.onShow()
  page.instance.onReady()
  await flush()
  return page
}

async function openLogin(query) {
  const page = render('pages/login/login')
  page.instance.onLoad(query)
  page.instance.onShow()
  await flush()
  return page
}

describe('home page', () => {
  test('shows the logo, the lab and the entry button; switches language', async () => {
    const page = await openHome()
    expect(page.querySelector('.logo')).toBeTruthy()
    expect(text(page)).toContain('可持續發展建材實驗室')
    expect(text(page)).toContain('實驗室儀器預約系統')

    page.querySelector('#lang').querySelectorAll('.opt')[1].dispatchEvent('tap')
    await flush()
    expect(text(page)).toContain('Sustainable Building Materials Laboratory')
    expect(text(page)).toContain('Lab Instrument Booking')
    expect(JSON.parse(w.storage.get('lang'))).toBe('en')
  })

  test('not signed in: the entry button asks how to sign in', async () => {
    const page = await openHome()
    expect(page.querySelector('.me')).toBeUndefined()
    page.querySelector('.entry').dispatchEvent('tap')
    await flush()
    expect(page.instance.data.choiceOpen).toBe(true)
    expect(text(page)).toContain('用戶登入')
    expect(text(page)).toContain('管理員登入')

    page.querySelectorAll('.choice')[0].dispatchEvent('tap')
    page.querySelectorAll('.choice')[1].dispatchEvent('tap') // a second quick tap is ignored
    await flush()
    expect(page.instance.data.choiceOpen).toBe(false)
    expect(w.navigateTo).toEqual([]) // not in the same moment as closing the sheet
    await wait(150)
    expect(w.navigateTo).toEqual(['/pages/login/login?mode=user'])

    page.instance.onShow()
    page.querySelector('.entry').dispatchEvent('tap')
    await flush()
    page.querySelectorAll('.choice')[1].dispatchEvent('tap')
    await wait(150)
    expect(w.navigateTo[1]).toBe('/pages/login/login?mode=admin')
  })

  test('signed in: straight to the booking system; the name chip opens Settings', async () => {
    await service.login({ nickname: '小明' })
    const page = await openHome()
    // Administrator sign-in is still one tap away for WeChat users.
    page.querySelector('.admin-link').dispatchEvent('tap')
    await flush()
    expect(w.navigateTo).toEqual(['/pages/login/login?mode=admin'])
    w.navigateTo.length = 0
    page.instance.onShow()
    expect(text(page.querySelector('.me'))).toContain('小明')
    page.querySelector('.entry').dispatchEvent('tap')
    page.querySelector('.entry').dispatchEvent('tap') // a quick double tap opens it once
    await flush()
    expect(w.navigateTo).toEqual(['/pages/booking/booking'])
    page.instance.onShow()
    page.querySelector('.me').dispatchEvent('tap')
    await flush()
    expect(w.navigateTo[1]).toBe('/pages/settings/settings')
  })

  test('pages that need a sign-in open the choice with ?login=1', async () => {
    const page = await openHome({ login: '1' })
    expect(page.instance.data.choiceOpen).toBe(true)
    expect(text(page)).not.toContain('登入已過期')
    page.instance.closeChoice()
    await flush()
    expect(page.instance.data.choiceOpen).toBe(false)
  })

  test('an ended sign-in is explained', async () => {
    const page = await openHome({ login: '1', expired: '1' })
    expect(text(page.querySelector('.sheet'))).toContain('登入已過期，請重新登入')
  })

  test('administrators do not get the extra administrator link', async () => {
    await service.adminLogin('admin', 'admin123')
    const page = await openHome()
    expect(page.querySelector('.admin-link')).toBeUndefined()
  })
})

describe('user sign-in (WeChat)', () => {
  test('first time: WeChat sign-in, then nickname and photo, then the booking system', async () => {
    const page = await openLogin({ mode: 'user' })
    expect(w.titles).toContain('用戶登入')
    expect(text(page)).toContain('微信一鍵登入')
    expect(text(page)).toContain('《用戶隱私保護指引》')

    await page.instance.onWechatLogin()
    await flush()
    expect(page.instance.data.step).toBe('profile')

    await page.instance.onSaveProfile({ detail: { value: { nickname: '' } } })
    await flush()
    expect(text(page)).toContain('請輸入暱稱')

    page.instance.onChooseAvatar({ detail: { avatarUrl: 'http://tmp/a.jpg' } })
    // The form is read when it is submitted, even without an input event
    // (e.g. after picking the nickname WeChat suggests).
    await page.instance.onSaveProfile({ detail: { value: { nickname: ' 小明 ' } } })
    expect(w.redirectTo).toEqual(['/pages/booking/booking'])
    expect(session.get()).toMatchObject({ role: 'user', nickname: '小明' })
    expect(session.get().avatar).toMatch(/^wxfile:\/\/usr\/avatar-/) // kept on the phone in demo mode
  })

  test('a nickname WeChat rejects is cleared and not submitted', async () => {
    const page = await openLogin({ mode: 'user' })
    await page.instance.onWechatLogin()
    page.instance.onNickname({ detail: { value: 'bad' } })
    page.instance.onNicknameReview({ detail: { pass: false, timeout: false } })
    await flush()
    expect(page.instance.data.nickname).toBe('')
    expect(text(page)).toContain('這個暱稱未通過微信檢查，請換一個')
    await page.instance.onSaveProfile({ detail: { value: { nickname: '' } } })
    expect(w.redirectTo).toEqual([])
  })

  test('the photo and nickname can be changed later (from Settings)', async () => {
    await service.login({ nickname: '小明', avatar: 'wxfile://usr/old.jpg' })
    const page = await openLogin({ mode: 'user', edit: '1', next: 'back' })
    expect(w.titles).toContain('修改資料')
    expect(page.instance.data.step).toBe('profile')
    expect(page.instance.data.nickname).toBe('小明')
    expect(text(page)).toContain('儲存')
    await page.instance.onSaveProfile({ detail: { value: { nickname: '小明明' } } })
    expect(w.navigateBack).toBe(1)
    expect(w.toasts.map((t) => t.title)).toContain('已儲存')
    expect(session.get()).toMatchObject({ nickname: '小明明', avatar: 'wxfile://usr/old.jpg' }) // the photo is kept
  })

  test('returning users go straight in', async () => {
    await service.login({ nickname: '小明' })
    session.clear()
    const page = await openLogin({ mode: 'user' })
    await page.instance.onWechatLogin()
    expect(page.instance.data.step).toBe('start')
    expect(w.redirectTo).toEqual(['/pages/booking/booking'])
    expect(session.get()).toMatchObject({ role: 'user', nickname: '小明' })
  })

  test('the privacy prompt resolves with the agree button', async () => {
    const page = await openLogin({ mode: 'user' })
    const resolve = jest.fn()
    w.privacyListener(resolve)
    await flush()
    expect(text(page)).toContain('隱私保護提示')
    page.instance.onAgreePrivacy()
    await flush()
    expect(resolve).toHaveBeenCalledWith({ buttonId: 'agree-privacy', event: 'agree' })
    expect(page.instance.data.privacyOpen).toBe(false)
  })
})

describe('administrator sign-in', () => {
  test('wrong password shows the attempts left; the right one opens the booking system', async () => {
    const page = await openLogin({ mode: 'admin' })
    expect(w.titles).toContain('管理員登入')
    expect(text(page)).toContain('演示模式帳號：admin，密碼：admin123')

    await page.instance.onAdminLogin()
    await flush()
    expect(text(page)).toContain('請輸入帳號和密碼')

    page.instance.onAccount({ detail: { value: 'admin' } })
    page.instance.onPassword({ detail: { value: 'nope' } })
    await page.instance.onAdminLogin()
    await flush()
    expect(text(page)).toContain('帳號或密碼錯誤，還可以嘗試 4 次')

    page.instance.onPassword({ detail: { value: 'admin123' } })
    await page.instance.onAdminLogin()
    expect(w.redirectTo).toEqual(['/pages/booking/booking'])
    expect(session.get()).toMatchObject({ role: 'admin', account: 'admin' })
    expect(page.instance.data.password).toBe('')
  })

  test('signing in again from the admin page returns to it', async () => {
    const page = await openLogin({ mode: 'admin', next: 'admin', id: 'centrifuge', month: '2026-08' })
    page.instance.onAccount({ detail: { value: 'admin' } })
    page.instance.onPassword({ detail: { value: 'admin123' } })
    await page.instance.onAdminLogin()
    expect(w.redirectTo).toEqual(['/pages/admin/admin?id=centrifuge&month=2026-08'])
  })

  test('from Settings it returns there', async () => {
    const page = await openLogin({ mode: 'admin', next: 'back' })
    page.instance.onAccount({ detail: { value: 'admin' } })
    page.instance.onPassword({ detail: { value: 'admin123' } })
    await page.instance.onAdminLogin()
    expect(w.navigateBack).toBe(1)
    expect(w.redirectTo).toEqual([])
  })
})
