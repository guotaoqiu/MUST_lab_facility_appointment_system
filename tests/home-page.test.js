// Home page (sign-in choice) and the sign-in page, in demo mode.
const { useFixedNow, installWx, render, flush, text } = require('./support/harness')

useFixedNow()

const i18n = require('../miniprogram/utils/i18n')
const session = require('../miniprogram/utils/session')
const service = require('../miniprogram/services/booking')

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
    expect(w.navigateTo).toEqual(['/pages/login/login?mode=user'])
    expect(page.instance.data.choiceOpen).toBe(false)

    page.instance.onShow()
    page.querySelector('.entry').dispatchEvent('tap')
    await flush()
    page.querySelectorAll('.choice')[1].dispatchEvent('tap')
    await flush()
    expect(w.navigateTo[1]).toBe('/pages/login/login?mode=admin')
  })

  test('signed in: straight to the booking system; the name chip opens Settings', async () => {
    await service.login({ nickname: '小明' })
    const page = await openHome()
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
    page.instance.closeChoice()
    await flush()
    expect(page.instance.data.choiceOpen).toBe(false)
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

    await page.instance.onSaveProfile()
    await flush()
    expect(text(page)).toContain('請輸入暱稱')

    page.instance.onChooseAvatar({ detail: { avatarUrl: 'http://tmp/a.jpg' } })
    page.instance.onNickname({ detail: { value: ' 小明 ' } })
    await page.instance.onSaveProfile()
    expect(w.redirectTo).toEqual(['/pages/booking/booking'])
    expect(session.get()).toMatchObject({ role: 'user', nickname: '小明' })
    expect(session.get().avatar).toMatch(/^wxfile:\/\/usr\/avatar-/) // kept on the phone in demo mode
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

  test('from Settings it returns there', async () => {
    const page = await openLogin({ mode: 'admin', next: 'back' })
    page.instance.onAccount({ detail: { value: 'admin' } })
    page.instance.onPassword({ detail: { value: 'admin123' } })
    await page.instance.onAdminLogin()
    expect(w.navigateBack).toBe(1)
    expect(w.redirectTo).toEqual([])
  })
})
