const { useFixedNow, installWx, render, flush } = require('./support/harness')
const core = require('../miniprogram/shared/booking-core')

useFixedNow()

const THIS_WEEK = core.weekDates('2026-09-21').map((date) => ({ date }))
const NEXT_WEEK = core.weekDates('2026-09-28').map((date) => ({ date }))
const FRI = 4 // column of 2026-09-25, "today"
const SAT = 5
const CELL_PX = 24 // one 30-minute slot (48rpx) on a 375px-wide screen

const BOOKINGS = [
  { id: 'b1', instrumentId: 'ball-mill', date: '2026-09-26', startMin: 600, endMin: 720, name: '陳大文', purpose: '研磨', mine: false, canCancel: false },
  { id: 'b2', instrumentId: 'ball-mill', date: '2026-09-26', startMin: 840, endMin: 870, name: 'Li Wei', purpose: 'Grinding', mine: true, canCancel: true },
  { id: 'b3', instrumentId: 'ball-mill', date: '2026-09-22', startMin: 540, endMin: 600, name: '王小明', purpose: '舊的', mine: false, canCancel: false }
]

let events
function setup(props, windowWidth) {
  installWx()
  if (windowWidth) wx.getWindowInfo = () => ({ windowWidth, windowHeight: 844 })
  const cal = render('components/week-calendar/week-calendar', Object.assign({
    days: THIS_WEEK,
    bookings: BOOKINGS,
    nowDate: '2026-09-25',
    nowMinutes: 640
  }, props))
  events = { selectionchange: [], selectiontap: [], bookingtap: [] }
  Object.keys(events).forEach((name) => cal.addEventListener(name, (e) => events[name].push(e.detail)))
  return cal
}

const cellAt = (cal, col, min) =>
  cal.querySelectorAll('.cell').find((c) => Number(c.dom.dataset.col) === col && Number(c.dom.dataset.min) === min)

async function tap(cal, col, min) {
  cellAt(cal, col, min).dispatchEvent('tap')
  await flush()
}

async function drag(cal, edge, cells) {
  const handle = cal.querySelector('.handle-' + edge)
  handle.dispatchEvent('touchstart', { touches: [{ x: 5, y: 300 }] })
  await flush()
  handle.dispatchEvent('touchmove', { touches: [{ x: 5, y: 300 + cells * CELL_PX }] })
  await flush()
  handle.dispatchEvent('touchend', {})
  await flush()
}

const lastSelection = () => events.selectionchange[events.selectionchange.length - 1].selection

test('draws a 08:00–22:00 grid of half-hour cells for 7 days', () => {
  const cal = setup()
  expect(cal.querySelectorAll('.cell')).toHaveLength(7 * 28)
  const hours = cal.instance.data.hours.map((h) => h.text)
  expect(hours[0]).toBe('08:00')
  expect(hours[hours.length - 1]).toBe('22:00')
})

test('places bookings, shades the past and marks now', () => {
  const cal = setup()
  const cols = cal.instance.data.columns
  const sat = cols[SAT]
  expect(sat.blocks.map((b) => [b.id, b.top, b.height])).toEqual([
    ['b1', 4 * CELL_PX + 1, 4 * CELL_PX - 2],
    ['b2', 12 * CELL_PX + 1, CELL_PX - 2]
  ])
  expect(sat.blocks[0].lines).toBeGreaterThan(0) // 2 h: room for the purpose
  expect(sat.blocks[1].lines).toBe(0) // 30 min: name only
  expect(sat.blocks[1].mine).toBe(true)
  expect(cols[1].blocks[0].past).toBe(true)

  expect(cols[0].pastHeight).toBe(28 * CELL_PX) // Monday is over
  expect(cols[FRI].pastHeight).toBe(5 * CELL_PX) // 08:00–10:30 are over at 10:40
  expect(cols[SAT].pastHeight).toBe(0)
  expect(cols[FRI].nowTop).toBe(Math.round((160 / 30) * CELL_PX))
  expect(cols[SAT].nowTop).toBe(-1)

  const text = cal.dom.textContent
  expect(text).toContain('陳大文')
  expect(text).toContain('研磨')
})

test('rows, labels, blocks and the past share one whole-pixel slot height on any screen width', () => {
  // 48rpx is 24.96px on a 390pt iPhone; WeChat rounds each rpx value on its own,
  // so everything is laid out in px from a single rounded slot height.
  const cal = setup({}, 390)
  const slot = cal.instance.data.slotPx
  expect(slot).toBe(25)
  expect(cal.querySelector('.cell').dom.getAttribute('style')).toContain('height: 25px')
  const hours = cal.instance.data.hours
  expect(hours[hours.length - 1]).toEqual({ text: '22:00', top: 28 * slot })
  expect(cal.instance.data.gridHeight).toBe(28 * slot)
  hours.forEach((h, i) => expect(h.top).toBe(i * 2 * slot))
  expect(cal.instance.data.columns[SAT].blocks[0].top).toBe(4 * slot + 1)
  expect(cal.instance.data.columns[FRI].pastHeight).toBe(5 * slot)
  const styles = [cal.querySelector('.block'), cal.querySelector('.past'), cal.querySelector('.now')].map((n) => n.dom.getAttribute('style'))
  styles.forEach((style) => expect(style).not.toContain('rpx'))
})

test('tapping a free cell selects 30 minutes', async () => {
  const cal = setup()
  await tap(cal, SAT, 780)
  expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 780, endMin: 810 })
  expect(cal.querySelector('.sel')).toBeTruthy()
})

test('the slot containing now can be selected, earlier ones cannot', async () => {
  const cal = setup()
  await tap(cal, FRI, 600)
  await tap(cal, 0, 900)
  expect(events.selectionchange).toHaveLength(0)
  await tap(cal, FRI, 630)
  expect(lastSelection()).toEqual({ date: '2026-09-25', startMin: 630, endMin: 660 })
})

test('dragging the bottom dot extends the selection up to the next booking', async () => {
  const cal = setup()
  await tap(cal, SAT, 750) // 12:30–13:00
  await drag(cal, 'bottom', 1)
  expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 750, endMin: 810 })
  await drag(cal, 'bottom', 10) // would run into b2 at 14:00
  expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 750, endMin: 840 })
  await drag(cal, 'bottom', -20) // never shorter than one slot
  expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 750, endMin: 780 })
})

test('dragging the top dot stops at the previous booking and at now', async () => {
  const cal = setup()
  await tap(cal, SAT, 780)
  await drag(cal, 'top', -10) // b1 ends at 12:00
  expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 720, endMin: 810 })

  await tap(cal, FRI, 720)
  await drag(cal, 'top', -10) // now is 10:40, the 10:30 slot is the earliest
  expect(lastSelection()).toEqual({ date: '2026-09-25', startMin: 630, endMin: 750 })
  await drag(cal, 'top', 20) // never shorter than one slot
  expect(lastSelection()).toEqual({ date: '2026-09-25', startMin: 720, endMin: 750 })
})

test('the day ends at 22:00', async () => {
  const cal = setup()
  await tap(cal, SAT, 1260)
  await drag(cal, 'bottom', 10)
  expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 1260, endMin: 1320 })
})

test('tapping the selection asks to book it; tapping a booking opens it', async () => {
  const cal = setup()
  await tap(cal, SAT, 900)
  cal.querySelector('.sel').dispatchEvent('tap')
  await flush()
  expect(events.selectiontap).toEqual([{ selection: { date: '2026-09-26', startMin: 900, endMin: 930 } }])

  cal.querySelectorAll('.block').find((b) => b.dom.dataset.id === 'b2').dispatchEvent('tap')
  await flush()
  expect(events.bookingtap[0].booking.id).toBe('b2')
  expect(events.selectionchange).toHaveLength(1) // the booking tap did not change the selection
})

test('the selection is dropped when it leaves the screen or gets booked', async () => {
  const cal = setup()
  await tap(cal, SAT, 900)
  cal.setData({ days: NEXT_WEEK })
  await flush()
  expect(lastSelection()).toBeNull()
  expect(cal.querySelector('.sel')).toBeUndefined()

  cal.setData({ days: THIS_WEEK })
  await tap(cal, SAT, 900)
  cal.setData({
    bookings: BOOKINGS.concat({ id: 'b4', date: '2026-09-26', startMin: 900, endMin: 960, name: 'X', purpose: 'Y' })
  })
  await flush()
  expect(lastSelection()).toBeNull()
})

test('clearSelection() empties the selection', async () => {
  const cal = setup()
  await tap(cal, SAT, 900)
  cal.instance.clearSelection()
  await flush()
  expect(lastSelection()).toBeNull()
})

test('while disabled (bookings not loaded) nothing can be selected', async () => {
  const cal = setup({ disabled: true })
  await tap(cal, SAT, 900)
  expect(events.selectionchange).toHaveLength(0)
  expect(cal.querySelector('.cal-disabled')).toBeTruthy()
})

describe('tapping a dot without dragging', () => {
  let rect
  beforeEach(() => {
    rect = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return /--sel(\s|$)/.test(this.className)
        ? { top: 300, bottom: 300 + CELL_PX, left: 0, right: 40, width: 40, height: CELL_PX }
        : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
    })
  })
  afterEach(() => rect.mockRestore())

  async function tapHandle(cal, edge, y, moves = []) {
    const handle = cal.querySelector('.handle-' + edge)
    handle.dispatchEvent('touchstart', { touches: [{ x: 5, y }] })
    await flush()
    for (const m of moves) {
      handle.dispatchEvent('touchmove', { touches: [m] })
      await flush()
    }
    handle.dispatchEvent('touchend', {})
    await flush()
  }

  test('inside the selection it asks to book', async () => {
    const cal = setup()
    await tap(cal, SAT, 900)
    await tapHandle(cal, 'bottom', 310)
    expect(events.selectiontap).toHaveLength(1)
  })

  test('outside the selection it selects the cell under the finger', async () => {
    const cal = setup()
    await tap(cal, SAT, 900)
    await tapHandle(cal, 'bottom', 300 + CELL_PX + 5)
    expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 930, endMin: 960 })
    expect(events.selectiontap).toHaveLength(0)
  })

  test('over a neighbouring booking it opens that booking', async () => {
    const cal = setup()
    await tap(cal, SAT, 720) // right below b1 (10:00–12:00)
    await tapHandle(cal, 'top', 295)
    expect(events.bookingtap.map((e) => e.booking.id)).toEqual(['b1'])
    expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 720, endMin: 750 })
  })

  test('a quick tap that ends before the position is known still counts', async () => {
    const cal = setup()
    await tap(cal, SAT, 900)
    const handle = cal.querySelector('.handle-bottom')
    handle.dispatchEvent('touchstart', { touches: [{ x: 5, y: 310 }] })
    handle.dispatchEvent('touchend', {})
    await flush()
    await flush()
    expect(events.selectiontap).toHaveLength(1)
  })

  test('a little jitter near the bottom bar is still a tap, not an auto-scroll', async () => {
    const cal = setup({ viewBottom: 60 })
    wx.pageScrollTo = jest.fn()
    await tap(cal, SAT, 900)
    rect.mockImplementation(function () {
      return /--sel(\s|$)/.test(this.className)
        ? { top: 590, bottom: 590 + CELL_PX, left: 0, right: 40, width: 40, height: CELL_PX }
        : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
    })
    await tapHandle(cal, 'bottom', 600, [{ x: 5, y: 601 }])
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(events.selectiontap).toHaveLength(1)
    expect(wx.pageScrollTo).not.toHaveBeenCalled()
    expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 900, endMin: 930 })
  })

  test('a sideways swipe or a cancelled touch is not a tap', async () => {
    const cal = setup()
    await tap(cal, SAT, 900)
    await tapHandle(cal, 'bottom', 310, [{ x: 60, y: 311 }, { x: 120, y: 312 }])
    const handle = cal.querySelector('.handle-bottom')
    handle.dispatchEvent('touchstart', { touches: [{ x: 5, y: 310 }] })
    await flush()
    handle.dispatchEvent('touchcancel', {})
    await flush()
    expect(events.selectiontap).toHaveLength(0)
  })
})

test('dragging near the bottom bar scrolls the page and keeps extending', async () => {
  const cal = setup({ viewBottom: 60 }) // window 667px: auto-scroll below 567px
  wx.pageScrollTo = jest.fn()
  await tap(cal, SAT, 1080) // 18:00–18:30
  const handle = cal.querySelector('.handle-bottom')
  handle.dispatchEvent('touchstart', { touches: [{ x: 5, y: 500 }] })
  await flush()
  handle.dispatchEvent('touchmove', { touches: [{ x: 5, y: 600 }] })
  await flush()
  expect(lastSelection().endMin).toBe(1230) // 20:30 from the finger alone
  await new Promise((resolve) => setTimeout(resolve, 500))
  handle.dispatchEvent('touchend', {})
  await flush()
  expect(lastSelection()).toEqual({ date: '2026-09-26', startMin: 1080, endMin: 1320 })
  expect(wx.pageScrollTo.mock.calls.map((c) => c[0].scrollTop)).toEqual([24, 48, 72])
})
