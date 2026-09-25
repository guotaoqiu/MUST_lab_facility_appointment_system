const core = require('../shared/booking-core')
const clock = require('./clock')

const DICTS = {
  zh: require('../i18n/zh'),
  en: require('../i18n/en')
}
const STORAGE_KEY = 'lang'
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

let current = null

function detect() {
  try {
    const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()
    return /^zh/i.test(info.language || '') ? 'zh' : 'en'
  } catch (e) {
    return 'zh'
  }
}

function getLang() {
  if (current) return current
  let saved = ''
  try {
    saved = wx.getStorageSync(STORAGE_KEY)
  } catch (e) {}
  current = DICTS[saved] ? saved : detect()
  return current
}

function setLang(lang) {
  if (!DICTS[lang]) return
  current = lang
  try {
    wx.setStorageSync(STORAGE_KEY, lang)
  } catch (e) {}
}

function dict(lang) {
  return DICTS[lang || getLang()]
}

function format(template, params) {
  return String(template).replace(/\{(\w+)\}/g, (m, key) => (params && params[key] != null ? params[key] : m))
}

function parts(date) {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d, wd: core.weekdayOf(date) }
}

function weekdayShort(date, lang) {
  return dict(lang).weekdays[core.weekdayOf(date)]
}

// Dates in another year than now show the year.
function otherYear(y) {
  return String(y) !== core.localNow(clock.now()).date.slice(0, 4)
}

/** 9月26日（週六） / Sat, 26 Sep; 2025年9月26日（週五） / Fri, 26 Sep 2025 */
function formatDate(date, lang) {
  const p = parts(date)
  const year = otherYear(p.y)
  if ((lang || getLang()) === 'zh') return (year ? p.y + '年' : '') + p.m + '月' + p.d + '日（週' + dict('zh').weekdays[p.wd] + '）'
  return dict('en').weekdays[p.wd] + ', ' + p.d + ' ' + MONTHS_EN[p.m - 1] + (year ? ' ' + p.y : '')
}

/** 9/21 – 9/27 / 21 – 27 Sep / 28 Sep – 4 Oct */
function formatWeekRange(weekStart, lang) {
  const a = parts(weekStart)
  const b = parts(core.addDays(weekStart, 6))
  if ((lang || getLang()) === 'zh') return a.m + '/' + a.d + ' – ' + b.m + '/' + b.d
  if (a.m === b.m) return a.d + ' – ' + b.d + ' ' + MONTHS_EN[b.m - 1]
  return a.d + ' ' + MONTHS_EN[a.m - 1] + ' – ' + b.d + ' ' + MONTHS_EN[b.m - 1]
}

function formatTimeRange(startMin, endMin) {
  return core.minutesToText(startMin) + ' – ' + core.minutesToText(endMin)
}

/** 30 分鐘 / 2 小時 / 1.5 小時 */
function formatDuration(minutes, lang) {
  const t = dict(lang)
  if (minutes < 60) return format(t.minutesUnit, { n: minutes })
  return format(t.hoursUnit, { n: Math.round((minutes / 60) * 10) / 10 })
}

/** Message for an error code; `res` may carry numbers such as attemptsLeft. */
function errorMessage(code, lang, res) {
  const t = dict(lang)
  res = res || {}
  const n = {
    NAME_TOO_LONG: core.NAME_MAX,
    PURPOSE_TOO_LONG: core.PURPOSE_MAX,
    NICKNAME_TOO_LONG: core.NICKNAME_MAX,
    REASON_TOO_LONG: core.SUSPEND_REASON_MAX,
    INVALID_CREDENTIALS: res.attemptsLeft,
    TOO_MANY_ATTEMPTS: res.retryAfterMin
  }[code]
  return format(t.errors[code] || t.errors.DEFAULT, { n })
}

/** 2026-09-25 10:40 -> 9月25日 10:40 / 25 Sep 10:40 (with the year if not this year) */
function formatTimestamp(ms, lang) {
  if (!ms) return ''
  const t = core.localNow(ms)
  const p = parts(t.date)
  const year = otherYear(p.y)
  const time = core.minutesToText(t.minutes)
  if ((lang || getLang()) === 'zh') return (year ? p.y + '年' : '') + p.m + '月' + p.d + '日 ' + time
  return p.d + ' ' + MONTHS_EN[p.m - 1] + (year ? ' ' + p.y : '') + ' ' + time
}

/** 2026-09 -> 2026年9月 / Sep 2026 */
function formatMonth(month, lang) {
  const [y, m] = month.split('-').map(Number)
  if ((lang || getLang()) === 'zh') return y + '年' + m + '月'
  return MONTHS_EN[m - 1] + ' ' + y
}

function instrumentName(instrument, lang) {
  return instrument.name[lang || getLang()] || instrument.name.zh
}

module.exports = {
  getLang,
  setLang,
  dict,
  format,
  weekdayShort,
  formatDate,
  formatWeekRange,
  formatTimeRange,
  formatDuration,
  errorMessage,
  formatTimestamp,
  formatMonth,
  instrumentName
}
