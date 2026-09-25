// Demo-mode storage: keeps everything in wx storage on this device, with a
// few sample bookings (re-created each week) so the calendar is not empty.
const core = require('../shared/booking-core')
const clock = require('../utils/clock')

const STORAGE_KEY = 'demoState.v2'
const SAMPLE_PREFIX = 'demo-sample'

// [instrumentId, days after this Monday, start, end, name, purpose, cancelled]
const SAMPLES = [
  ['thermal-imager', 0, '09:00', '11:00', '陳大文', '混凝土試件表面溫度場測量'],
  ['thermal-imager', 2, '14:00', '16:30', 'Li Wei', 'Thermal imaging of heated mortar prisms'],
  ['thermal-imager', 8, '10:00', '12:00', '黃嘉欣', '保溫板熱橋檢測'],
  ['thermal-imager', 3, '10:00', '11:00', '黃嘉欣', '保溫板熱橋檢測', true],
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

function dayKey(instrumentId, date) {
  return instrumentId + '_' + date
}

function isSample(openid) {
  return typeof openid === 'string' && openid.indexOf(SAMPLE_PREFIX) === 0
}

// Replace last week's samples with this week's; keep everything else.
function seed(state, monday) {
  Object.keys(state.days).forEach((key) => {
    state.days[key].bookings = state.days[key].bookings.filter((b) => !isSample(b.openid))
  })
  Object.keys(state.records).forEach((id) => {
    if (isSample(state.records[id].openid)) delete state.records[id]
  })
  const createdAt = Date.parse(monday + 'T08:00:00+08:00') - 24 * 3600 * 1000
  SAMPLES.forEach(([instrumentId, offset, start, end, name, purpose, cancelled], i) => {
    const date = core.addDays(monday, offset)
    const booking = {
      id: 'sample-' + monday + '-' + i,
      startMin: toMinutes(start),
      endMin: toMinutes(end),
      name,
      purpose,
      openid: SAMPLE_PREFIX + '-' + name,
      nickname: name,
      avatar: '',
      createdAt
    }
    const record = Object.assign({ instrumentId, date, status: 'active' }, booking)
    if (cancelled) {
      Object.assign(record, { status: 'cancelled', cancelledAt: createdAt + 3600 * 1000, cancelledBy: 'self', cancelledByName: name })
    } else {
      const key = dayKey(instrumentId, date)
      const day = state.days[key] || (state.days[key] = { instrumentId, date, bookings: [] })
      day.bookings.push(booking)
      day.bookings.sort((a, b) => a.startMin - b.startMin)
    }
    state.records[booking.id] = record
  })
  state.seedWeek = monday
}

function save(state) {
  wx.setStorageSync(STORAGE_KEY, state)
}

function load() {
  let saved = null
  try {
    saved = wx.getStorageSync(STORAGE_KEY) || null
  } catch (e) {}
  const state = Object.assign({ seedWeek: '', days: {}, records: {}, users: {}, statuses: {} }, saved || {})
  const monday = core.bookingWindow(clock.now()).firstDate
  if (state.seedWeek !== monday) {
    seed(state, monday)
    save(state)
  }
  return state
}

const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

module.exports = {
  async listDays(instrumentId, fromDate, toDate) {
    const state = load()
    const days = []
    for (let date = fromDate; date <= toDate; date = core.addDays(date, 1)) {
      const day = state.days[dayKey(instrumentId, date)]
      if (day && day.bookings.length) days.push(copy(day))
    }
    return days
  },

  async updateDay(instrumentId, date, mutate) {
    const state = load()
    const key = dayKey(instrumentId, date)
    const outcome = mutate(core.normalizeDay(copy(state.days[key])))
    if (outcome.error) return outcome
    if (outcome.day) state.days[key] = { instrumentId, date, bookings: outcome.day.bookings }
    ;(outcome.records || []).forEach((r) => {
      state.records[r.id] = r.merge ? Object.assign({}, state.records[r.id], r.data) : Object.assign({}, r.data)
    })
    if (outcome.day || outcome.records) save(state)
    return outcome
  },

  async getUser(openid) {
    return copy(load().users[openid] || null)
  },

  async updateUser(openid, mutate) {
    const state = load()
    const outcome = mutate(copy(state.users[openid] || null)) || {}
    if (outcome.error || !outcome.fields) return outcome
    state.users[openid] = Object.assign({}, state.users[openid], copy(outcome.fields))
    save(state)
    return outcome
  },

  async listRecords(query) {
    const records = load().records
    const list = Object.keys(records)
      .map((id) => Object.assign({}, records[id], { id }))
      .filter((r) =>
        query.openid
          ? r.openid === query.openid
          : r.instrumentId === query.instrumentId && (!query.from || (r.date >= query.from && r.date <= query.to))
      )
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startMin - b.startMin))
    return { records: list, truncated: false }
  },

  async getStatuses() {
    return copy(load().statuses)
  },

  async setStatus(instrumentId, status) {
    const state = load()
    state.statuses[instrumentId] = copy(status)
    save(state)
  }
}
