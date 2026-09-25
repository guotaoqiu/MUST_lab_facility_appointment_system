// Demo-mode storage: keeps bookings in wx storage on this device and mixes in
// a few sample bookings so the calendar does not look empty.
const core = require('../utils/booking-core')
const clock = require('../utils/clock')

const STORAGE_KEY = 'demoSchedules.v1'
const SEED_OPENID = 'demo-sample'

// [instrumentId, days after this Monday, start, end, name, purpose]
const SAMPLES = [
  ['thermal-imager', 0, '09:00', '11:00', '陳大文', '混凝土試件表面溫度場測量'],
  ['thermal-imager', 2, '14:00', '16:30', 'Li Wei', 'Thermal imaging of heated mortar prisms'],
  ['thermal-imager', 8, '10:00', '12:00', '黃嘉欣', '保溫板熱橋檢測'],
  ['carbonation-reactor', 1, '08:00', '18:00', '王小明', '水泥基材料高溫碳化試驗'],
  ['carbonation-reactor', 3, '09:00', '17:00', '王小明', '碳化試件第二批'],
  ['carbonation-reactor', 9, '08:30', '20:00', 'Zhang Yu', 'Accelerated carbonation of recycled aggregate'],
  ['ball-mill', 4, '13:00', '17:00', '李志強', '粉煤灰研磨'],
  ['ball-mill', 10, '09:00', '12:00', 'Chen Hao', 'Grinding slag powder'],
  ['centrifuge', 2, '10:00', '10:30', '吳思穎', '樣品離心分離'],
  ['centrifuge', 4, '15:00', '16:00', 'Maria Santos', 'Pore solution extraction'],
  ['fume-hood-1', 1, '13:30', '15:30', '周俊傑', '配製鹼激發劑'],
  ['strain-daq', 3, '14:00', '18:00', '劉建華', '梁彎曲試驗應變採集'],
  ['thermal-conductivity', 5, '09:00', '12:00', '陳大文', '泡沫混凝土導熱係數測試']
]

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function sampleBookings(instrumentId, date) {
  const monday = core.bookingWindow(clock.now()).firstDate
  const out = []
  SAMPLES.forEach((s, i) => {
    if (s[0] !== instrumentId || core.addDays(monday, s[1]) !== date) return
    out.push({
      id: 'sample-' + i,
      startMin: toMinutes(s[2]),
      endMin: toMinutes(s[3]),
      name: s[4],
      purpose: s[5],
      openid: SEED_OPENID,
      createdAt: 0
    })
  })
  return out
}

function load() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || {}
  } catch (e) {
    return {}
  }
}

function save(all) {
  wx.setStorageSync(STORAGE_KEY, all)
}

function readDay(all, instrumentId, date) {
  const stored = core.normalizeDay(all[instrumentId + '_' + date])
  return {
    instrumentId,
    date,
    bookings: sampleBookings(instrumentId, date)
      .concat(stored.bookings)
      .sort((a, b) => a.startMin - b.startMin),
    cancelled: stored.cancelled
  }
}

module.exports = {
  async listDays(instrumentId, fromDate, toDate) {
    const all = load()
    const days = []
    for (let date = fromDate; date <= toDate; date = core.addDays(date, 1)) {
      const day = readDay(all, instrumentId, date)
      if (day.bookings.length) days.push(day)
    }
    return days
  },

  async updateDay(instrumentId, date, mutate) {
    const all = load()
    const outcome = mutate(readDay(all, instrumentId, date))
    if (outcome.error || !outcome.day) return outcome
    all[instrumentId + '_' + date] = {
      instrumentId,
      date,
      bookings: outcome.day.bookings.filter((b) => b.openid !== SEED_OPENID),
      cancelled: outcome.day.cancelled
    }
    save(all)
    return outcome
  }
}
