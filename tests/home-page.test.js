const { useFixedNow, installWx, render, flush, text } = require('./support/harness')

useFixedNow()

const i18n = require('../miniprogram/utils/i18n')

let w
beforeEach(() => {
  w = installWx()
  i18n.setLang('zh')
})

describe('home page', () => {
  test('shows the logo, the lab and the entry button; switches language', async () => {
    const page = render('pages/index/index')
    page.instance.onLoad()
    await flush()
    expect(page.querySelector('.logo')).toBeTruthy()
    expect(text(page)).toContain('可持續發展建材實驗室')
    expect(text(page)).toContain('實驗室儀器預約系統')

    page.querySelector('#lang').querySelectorAll('.opt')[1].dispatchEvent('tap')
    await flush()
    expect(text(page)).toContain('Sustainable Building Materials Laboratory')
    expect(text(page)).toContain('Lab Instrument Booking')
    expect(JSON.parse(w.storage.get('lang'))).toBe('en')

    page.querySelector('.entry').dispatchEvent('tap')
    await flush()
    expect(w.navigateTo).toEqual(['/pages/booking/booking'])
  })
})

