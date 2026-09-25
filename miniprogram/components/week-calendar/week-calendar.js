// Week grid: 7 day columns × 30-minute cells.
// Tap a free cell to select it, then drag the two dots to change the range.
const core = require('../../utils/booking-core')

const SLOT = core.SLOT_MINUTES
const DAY_START = core.DAY_START_MINUTES
const DAY_END = core.DAY_END_MINUTES
const CELL_RPX = 48 // height of one 30-minute cell
const NAME_LINE_RPX = 26
const PURPOSE_LINE_RPX = 24
const BLOCK_PADDING_RPX = 8
const BLOCK_GAP_RPX = 2

function toRpx(min) {
  return ((min - DAY_START) / SLOT) * CELL_RPX
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi)
}

function buildRows() {
  const rows = []
  for (let m = DAY_START; m < DAY_END; m += SLOT) rows.push({ min: m, hour: m % 60 === 0 })
  return rows
}

function buildHours() {
  const hours = []
  for (let m = Math.ceil(DAY_START / 60) * 60; m <= DAY_END; m += 60) {
    hours.push({ text: core.minutesToText(m), top: toRpx(m) })
  }
  return hours
}

Component({
  properties: {
    days: { type: Array, value: [] }, // [{ date: 'YYYY-MM-DD', ... }] × 7
    bookings: { type: Array, value: [] }, // bookings within these days
    nowDate: { type: String, value: '' },
    nowMinutes: { type: Number, value: 0 }
  },

  data: {
    rows: buildRows(),
    hours: buildHours(),
    gridHeight: toRpx(DAY_END),
    columns: [],
    sel: null
  },

  observers: {
    'days, bookings, nowDate, nowMinutes': function () {
      this.layout()
    }
  },

  lifetimes: {
    attached() {
      let width = 375
      try {
        width = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth || width
      } catch (e) {}
      this.cellPx = (CELL_RPX * width) / 750
      this.selection = null
      this.drag = null
      this.layout()
    }
  },

  methods: {
    now() {
      return { date: this.data.nowDate, minutes: this.data.nowMinutes }
    },

    bookingsOn(date) {
      return this.data.bookings.filter((b) => b.date === date)
    },

    layout() {
      const now = this.now()
      const slotCount = (DAY_END - DAY_START) / SLOT
      const columns = this.data.days.map((day) => {
        let pastSlots = 0
        if (day.date < now.date) pastSlots = slotCount
        else if (day.date === now.date) pastSlots = clamp(Math.floor((now.minutes - DAY_START) / SLOT), 0, slotCount)

        const blocks = []
        this.bookingsOn(day.date).forEach((b) => {
          const s = Math.max(b.startMin, DAY_START)
          const e = Math.min(b.endMin, DAY_END)
          if (e <= s) return
          const height = toRpx(e) - toRpx(s) - BLOCK_GAP_RPX * 2
          blocks.push({
            id: b.id,
            name: b.name,
            purpose: b.purpose,
            mine: !!b.mine,
            past: core.isPast(day.date, b.endMin, now),
            top: toRpx(s) + BLOCK_GAP_RPX,
            height,
            lines: Math.max(0, Math.floor((height - BLOCK_PADDING_RPX - NAME_LINE_RPX) / PURPOSE_LINE_RPX))
          })
        })

        const showNow = day.date === now.date && now.minutes >= DAY_START && now.minutes <= DAY_END
        return {
          date: day.date,
          isToday: day.date === now.date,
          pastHeight: pastSlots * CELL_RPX,
          nowTop: showNow ? toRpx(now.minutes) : -1,
          blocks
        }
      })
      this.setData({ columns })
      this.revalidateSelection()
    },

    // Drop the selection when it no longer fits: other week, now booked, or now past.
    revalidateSelection() {
      const s = this.selection
      if (!s) return
      const onScreen = this.data.days.some((d) => d.date === s.date)
      const taken = core.findConflict(this.bookingsOn(s.date), s.startMin, s.endMin)
      const past = core.isPast(s.date, s.startMin + SLOT, this.now())
      if (!onScreen || taken || past) this.setSelection(null)
      else this.renderSelection()
    },

    renderSelection() {
      const s = this.selection
      if (!s) {
        this.setData({ sel: null })
        return
      }
      this.setData({
        sel: {
          col: this.data.days.findIndex((d) => d.date === s.date),
          top: toRpx(s.startMin),
          height: toRpx(s.endMin) - toRpx(s.startMin),
          startText: core.minutesToText(s.startMin),
          endText: core.minutesToText(s.endMin),
          showText: s.endMin - s.startMin >= 2 * SLOT
        }
      })
    },

    setSelection(selection) {
      this.selection = selection
      this.renderSelection()
      this.triggerEvent('selectionchange', { selection })
    },

    /** Called by the page (e.g. the "Clear" button). */
    clearSelection() {
      this.drag = null
      if (this.selection) this.setSelection(null)
    },

    onCellTap(e) {
      const col = Number(e.currentTarget.dataset.col)
      const min = Number(e.currentTarget.dataset.min)
      const day = this.data.days[col]
      if (!day || core.isPast(day.date, min + SLOT, this.now())) return
      if (core.findConflict(this.bookingsOn(day.date), min, min + SLOT)) return
      this.setSelection({ date: day.date, startMin: min, endMin: min + SLOT })
    },

    onSelectionTap() {
      if (this.selection) this.triggerEvent('selectiontap', { selection: this.selection })
    },

    onBookingTap(e) {
      const id = e.currentTarget.dataset.id
      const booking = this.data.bookings.find((b) => b.id === id)
      if (booking) this.triggerEvent('bookingtap', { booking })
    },

    onHandleStart(e) {
      const s = this.selection
      if (!s || !e.touches || !e.touches.length) return
      // The free range around the selection: it may grow until the nearest
      // booking, the end of the day, or the current time.
      let minStart = Math.max(DAY_START, core.firstOpenStart(s.date, this.now()))
      let maxEnd = DAY_END
      this.bookingsOn(s.date).forEach((b) => {
        if (b.endMin <= s.startMin) minStart = Math.max(minStart, b.endMin)
        if (b.startMin >= s.endMin) maxEnd = Math.min(maxEnd, b.startMin)
      })
      this.drag = {
        edge: e.currentTarget.dataset.edge,
        y0: e.touches[0].clientY,
        start0: s.startMin,
        end0: s.endMin,
        minStart,
        maxEnd
      }
    },

    onHandleMove(e) {
      const d = this.drag
      const s = this.selection
      if (!d || !s || !e.touches || !e.touches.length) return
      const steps = Math.round((e.touches[0].clientY - d.y0) / this.cellPx)
      let startMin = s.startMin
      let endMin = s.endMin
      if (d.edge === 'bottom') endMin = clamp(d.end0 + steps * SLOT, s.startMin + SLOT, d.maxEnd)
      else startMin = clamp(d.start0 + steps * SLOT, d.minStart, s.endMin - SLOT)
      if (startMin === s.startMin && endMin === s.endMin) return
      this.setSelection({ date: s.date, startMin, endMin })
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    },

    onHandleEnd() {
      this.drag = null
    },

    noop() {}
  }
})
