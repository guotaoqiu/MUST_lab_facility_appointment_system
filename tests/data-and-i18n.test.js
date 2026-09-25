const fs = require('fs')
const path = require('path')
const { useFixedNow, installWx } = require('./support/harness')

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

useFixedNow()
installWx()

const instruments = require('../miniprogram/shared/instruments')
const zh = require('../miniprogram/i18n/zh')
const en = require('../miniprogram/i18n/en')
const i18n = require('../miniprogram/utils/i18n')

describe('instrument data', () => {
  test('23 instruments with unique, stable ids', () => {
    expect(instruments).toHaveLength(23)
    const ids = instruments.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id) => expect(id).toMatch(/^[a-z0-9-]+$/))
  })

  test('every instrument has both names, a location and a photo in the package', () => {
    instruments.forEach((i) => {
      expect(i.name.zh).toBeTruthy()
      expect(i.name.en).toBeTruthy()
      expect(i.location).toBeTruthy()
      expect(fs.existsSync(path.join(ROOT, 'miniprogram', i.photo))).toBe(true)
    })
  })
})

describe('cloud function copies (npm run sync)', () => {
  test('miniprogram/shared is copied unchanged into the cloud function', () => {
    const files = fs.readdirSync(path.join(ROOT, 'miniprogram/shared')).sort()
    expect(files).toEqual(['booking-core.js', 'instruments.js', 'xlsx.js'])
    expect(fs.readdirSync(path.join(ROOT, 'cloudfunctions/booking/shared')).sort()).toEqual(files)
    files.forEach((f) => expect(read('cloudfunctions/booking/shared/' + f)).toBe(read('miniprogram/shared/' + f)))
  })
})

describe('translations', () => {
  const shape = (obj) =>
    Object.keys(obj)
      .sort()
      .map((k) => (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k]) ? k + '{' + shape(obj[k]) + '}' : k))
      .join(',')

  test('both languages define the same keys', () => {
    expect(shape(en)).toBe(shape(zh))
    expect(zh.weekdays).toHaveLength(7)
    expect(en.weekdays).toHaveLength(7)
  })

  test('every error code the backend can return has a message', () => {
    const sources = read('miniprogram/shared/booking-core.js') + read('miniprogram/services/booking.js') + read('cloudfunctions/booking/index.js')
    const codes = new Set()
    const re = /(?:fail\(|error: |code: )'([A-Z_]+)'/g
    let m
    while ((m = re.exec(sources))) codes.add(m[1])
    expect(codes.size).toBeGreaterThan(25)
    codes.forEach((code) => {
      expect(zh.errors[code]).toBeTruthy()
      expect(en.errors[code]).toBeTruthy()
    })
  })

  test('wx.showModal button labels fit the 4-character limit', () => {
    // WeChat counts a CJK character as 2 and a Latin one as 1, limit 8.
    const width = (s) => Array.from(s).reduce((n, c) => n + (c.charCodeAt(0) > 0xff ? 2 : 1), 0)
    ;[zh, en].forEach((t) => {
      ;[t.confirmCancel, t.keepBooking, t.gotIt, t.confirm, t.cancel, t.cancelAll].forEach((label) => expect(width(label)).toBeLessThanOrEqual(8))
    })
  })

  test('Chinese text is Traditional, not Simplified', () => {
    // Simplified forms of characters this app uses (or could easily slip in).
    const simplifiedOnly = Array.from(
      '预约时间选择仪设备实验称号载输错误确认关闭这个显请说网络连据为们对应试证书写读门开车长点击调剂测结构环热导数动态变统电双样离声纯筛颚础气搅会员单问题项组织级务处览编辑滤温资儿从发现后'
    )
    const texts = [
      JSON.stringify(zh),
      JSON.stringify(instruments.map((i) => i.name.zh)),
      read('miniprogram/services/local-store.js'),
      read('miniprogram/shared/booking-core.js'),
      read('miniprogram/pages/index/index.wxml'),
      read('README.md')
    ].join('')
    const found = simplifiedOnly.filter((c) => texts.includes(c))
    expect(found).toEqual([])
  })
})

describe('formatting', () => {
  test('dates, ranges and durations', () => {
    expect(i18n.formatDate('2026-09-26', 'zh')).toBe('9月26日（週六）')
    expect(i18n.formatDate('2026-09-26', 'en')).toBe('Sat, 26 Sep')
    expect(i18n.formatWeekRange('2026-09-21', 'zh')).toBe('9/21 – 9/27')
    expect(i18n.formatWeekRange('2026-09-21', 'en')).toBe('21 – 27 Sep')
    expect(i18n.formatWeekRange('2026-09-28', 'en')).toBe('28 Sep – 4 Oct')
    expect(i18n.formatTimeRange(540, 630)).toBe('09:00 – 10:30')
    expect(i18n.formatDuration(30, 'zh')).toBe('30 分鐘')
    expect(i18n.formatDuration(90, 'zh')).toBe('1.5 小時')
    expect(i18n.formatDuration(120, 'en')).toBe('2 h')
    expect(i18n.weekdayShort('2026-09-27', 'zh')).toBe('日')
  })

  test('error messages fill in limits and fall back to a default', () => {
    expect(i18n.errorMessage('NAME_TOO_LONG', 'zh')).toBe('姓名不能超過 30 個字')
    expect(i18n.errorMessage('PURPOSE_TOO_LONG', 'en')).toBe('Purpose must be at most 200 characters.')
    expect(i18n.errorMessage('SOMETHING_NEW', 'en')).toBe(en.errors.DEFAULT)
    expect(i18n.errorMessage('INVALID_CREDENTIALS', 'zh', { attemptsLeft: 2 })).toBe('帳號或密碼錯誤，還可以嘗試 2 次')
    expect(i18n.errorMessage('TOO_MANY_ATTEMPTS', 'en', { retryAfterMin: 15 })).toBe('Too many attempts. Please try again in 15 min.')
    // Worded so that "1" reads right too.
    expect(i18n.errorMessage('INVALID_CREDENTIALS', 'en', { attemptsLeft: 1 })).toBe('Wrong account or password. Attempts left: 1.')
  })

  test('dates and times in another year show the year', () => {
    expect(i18n.formatDate('2025-09-26', 'zh')).toBe('2025年9月26日（週五）')
    expect(i18n.formatDate('2025-09-26', 'en')).toBe('Fri, 26 Sep 2025')
    expect(i18n.formatTimestamp(Date.parse('2025-12-31T10:00:00+08:00'), 'zh')).toBe('2025年12月31日 10:00')
    expect(i18n.formatTimestamp(Date.parse('2025-12-31T10:00:00+08:00'), 'en')).toBe('31 Dec 2025 10:00')
    expect(i18n.formatTimestamp(Date.parse('2026-09-25T10:40:00+08:00'), 'zh')).toBe('9月25日 10:40')
  })

  test('English text uses English brackets and punctuation', () => {
    const records = require('../miniprogram/utils/records')
    const r = { id: 'x', instrumentId: 'centrifuge', date: '2026-09-28', startMin: 600, endMin: 660, status: 'cancelled', cancelledBy: 'admin', cancelledByName: 'admin', cancelReason: 'suspended', suspendReason: 'broken' }
    expect(records.viewRecord(r, 'en', { title: 'date', admin: true }).cancelNote).toBe('Cancelled by admin (admin) · instrument suspended: broken')
    expect(records.viewRecord(r, 'zh', { title: 'date', admin: true }).cancelNote).toBe('管理員取消（admin） · 儀器暫停預約：broken')
    expect(JSON.stringify(en)).not.toMatch(/[（）：，。]/)
  })

  test('language follows the saved choice, then the WeChat language', () => {
    jest.isolateModules(() => {
      installWx({ language: 'en' })
      expect(require('../miniprogram/utils/i18n').getLang()).toBe('en')
    })
    jest.isolateModules(() => {
      installWx({ language: 'zh_TW' })
      expect(require('../miniprogram/utils/i18n').getLang()).toBe('zh')
    })
    jest.isolateModules(() => {
      const w = installWx({ language: 'zh_CN' })
      w.storage.set('lang', JSON.stringify('en'))
      const fresh = require('../miniprogram/utils/i18n')
      expect(fresh.getLang()).toBe('en')
      fresh.setLang('zh')
      expect(JSON.parse(w.storage.get('lang'))).toBe('zh')
      fresh.setLang('fr')
      expect(fresh.getLang()).toBe('zh')
    })
  })
})
