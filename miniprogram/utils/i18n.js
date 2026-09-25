const core = require('./booking-core')

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

/** 9月26日（週六） / Sat, 26 Sep */
function formatDate(date, lang) {
  const p = parts(date)
  if ((lang || getLang()) === 'zh') return p.m + '月' + p.d + '日（週' + dict('zh').weekdays[p.wd] + '）'
  return dict('en').weekdays[p.wd] + ', ' + p.d + ' ' + MONTHS_EN[p.m - 1]
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

function errorMessage(code, lang) {
  const t = dict(lang)
  const limits = { NAME_TOO_LONG: core.NAME_MAX, PURPOSE_TOO_LONG: core.PURPOSE_MAX }
  return format(t.errors[code] || t.errors.DEFAULT, { n: limits[code] })
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
  instrumentName
}
