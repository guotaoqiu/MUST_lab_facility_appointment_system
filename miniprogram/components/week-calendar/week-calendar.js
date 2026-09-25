// Week grid: 7 day columns × 30-minute cells.
// Tap a free cell to select it, then drag the two dots to change the range.
//
// All vertical positions are whole pixels derived from one slot height.
// WeChat rounds every rpx value separately, so mixing stacked rpx cells with
// rpx offsets would make the rows drift away from the labels and blocks.
const core = require('../../shared/booking-core')

const SLOT = core.SLOT_MINUTES
const DAY_START = core.DAY_START_MINUTES
const DAY_END = core.DAY_END_MINUTES
const SLOT_RPX = 48 // design height of one 30-minute cell
// Text metrics of a booking block in rpx, matching .block in the wxss.
const NAME_LINE_RPX = 26
const PURPOSE_LINE_RPX = 24
const BLOCK_PADDING_RPX = 8
const BLOCK_GAP_PX = 1
const TAP_SLOP_PX = 6 // finger movement that still counts as a tap
const EDGE_PX = 40 // auto-scroll when a dragging finger is this close to the visible edge
const AUTO_SCROLL_MS = 90

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi)
}

function buildRows() {
  const rows = []
  for (let m = DAY_START; m < DAY_END; m += SLOT) rows.push({ min: m, hour: m % 60 === 0 })
  return rows
}

Component({
  properties: {
    days: { type: Array, value: [] }, // [{ date: 'YYYY-MM-DD', ... }] × 7
    bookings: { type: Array, value: [] }, // bookings within these days
    nowDate: { type: String, value: '' },
    nowMinutes: { type: Number, value: 0 },
    disabled: { type: Boolean, value: false }, // bookings not loaded yet
    viewTop: { type: Number, value: 0 }, // px of the window covered by the sticky header
    viewBottom: { type: Number, value: 0 } // px of the window covered by the bottom bar
  },

  data: {
    rows: buildRows(),
    slotPx: 24,
    hours: [],
    gridHeight: 0,
    columns: [],
    sel: null
  },

  observers: {
    'days, bookings, nowDate, nowMinutes': function () {
      this.layout()
    }
  },

  lifetimes: {
    created() {
      let info = {}
      try {
        info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {}
      } catch (e) {}
      const width = info.windowWidth || 375
      this.slotPx = Math.max(16, Math.round((SLOT_RPX * width) / 750))
      this.rpxPerPx = 750 / width
      this.windowHeight = info.windowHeight || 667
      this.selection = null
      this.drag = null
    },

    attached() {
      const hours = []
      for (let m = Math.ceil(DAY_START / 60) * 60; m <= DAY_END; m += 60) {
        hours.push({ text: core.minutesToText(m), top: this.toPx(m) })
      }
      this.ready = true
      this.setData({ slotPx: this.slotPx, hours, gridHeight: this.toPx(DAY_END) })
      this.layout()
    },

    detached() {
      this.stopAutoScroll()
    }
  },

  methods: {
    toPx(min) {
      return ((min - DAY_START) / SLOT) * this.slotPx
    },

    now() {
      return { date: this.data.nowDate, minutes: this.data.nowMinutes }
    },

    bookingsOn(date) {
      return this.data.bookings.filter((b) => b.date === date)
    },

    layout() {
      if (!this.ready) return
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
          const height = this.toPx(e) - this.toPx(s) - BLOCK_GAP_PX * 2
          blocks.push({
            id: b.id,
            name: b.name,
            purpose: b.purpose,
            mine: !!b.mine,
            past: core.isPast(day.date, b.endMin, now),
            top: this.toPx(s) + BLOCK_GAP_PX,
            height,
            lines: Math.max(0, Math.floor((height * this.rpxPerPx - BLOCK_PADDING_RPX - NAME_LINE_RPX) / PURPOSE_LINE_RPX))
          })
        })

        const showNow = day.date === now.date && now.minutes >= DAY_START && now.minutes <= DAY_END
        return {
          date: day.date,
          isToday: day.date === now.date,
          pastHeight: pastSlots * this.slotPx,
          nowTop: showNow ? Math.round(this.toPx(now.minutes)) : -1,
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
      if (!onScreen || taken || past) {
        this.drag = null
        this.stopAutoScroll()
        // Runs inside the parent's setData (via the observer): tell it afterwards.
        this.setSelection(null, true)
      } else {
        this.renderSelection()
      }
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
          top: this.toPx(s.startMin),
          height: this.toPx(s.endMin) - this.toPx(s.startMin),
          startText: core.minutesToText(s.startMin),
          endText: core.minutesToText(s.endMin),
          showText: s.endMin - s.startMin >= 2 * SLOT
        }
      })
    },

    setSelection(selection, deferEvent) {
      this.selection = selection
      this.renderSelection()
      if (deferEvent) Promise.resolve().then(() => this.triggerEvent('selectionchange', { selection: this.selection }))
      else this.triggerEvent('selectionchange', { selection })
    },

    /** Called by the page (e.g. the "Clear" button). */
    clearSelection() {
      this.drag = null
      this.stopAutoScroll()
      if (this.selection) this.setSelection(null)
    },

    selectSlot(col, min) {
      const day = this.data.days[col]
      if (this.data.disabled || !day || min < DAY_START || min >= DAY_END) return
      if (core.isPast(day.date, min + SLOT, this.now())) return
      if (core.findConflict(this.bookingsOn(day.date), min, min + SLOT)) return
      this.setSelection({ date: day.date, startMin: min, endMin: min + SLOT })
    },

    onCellTap(e) {
      this.selectSlot(Number(e.currentTarget.dataset.col), Number(e.currentTarget.dataset.min))
    },

    onSelectionTap() {
      if (this.selection && !this.data.disabled) this.triggerEvent('selectiontap', { selection: this.selection })
    },

    onBookingTap(e) {
      const id = e.currentTarget.dataset.id
      const booking = this.data.bookings.find((b) => b.id === id)
      if (booking) this.triggerEvent('bookingtap', { booking })
    },

    onHandleStart(e) {
      const s = this.selection
      if (!s || this.data.disabled || !e.touches || !e.touches.length) return
      // The free range around the selection: it may grow until the nearest
      // booking, the end of the day, or the current time.
      let minStart = Math.max(DAY_START, core.firstOpenStart(s.date, this.now()))
      let maxEnd = DAY_END
      this.bookingsOn(s.date).forEach((b) => {
        if (b.endMin <= s.startMin) minStart = Math.max(minStart, b.endMin)
        if (b.startMin >= s.endMin) maxEnd = Math.min(maxEnd, b.startMin)
      })
      const touch = e.touches[0]
      const drag = {
        edge: e.currentTarget.dataset.edge,
        x0: touch.clientX,
        y0: touch.clientY,
        y: touch.clientY,
        moved: false,
        ended: false,
        scrolled: 0, // px the page was auto-scrolled during this drag
        scrollTop0: null,
        dir: 0,
        rect: null,
        start0: s.startMin,
        end0: s.endMin,
        minStart,
        maxEnd
      }
      this.drag = drag
      this.createSelectorQuery()
        .select('.sel')
        .boundingClientRect((rect) => {
          drag.rect = rect
          if (drag.ended) this.tapThrough(drag) // the finger was lifted before this answer came back
        })
        .selectViewport()
        .scrollOffset((res) => {
          drag.scrollTop0 = res ? res.scrollTop : null
        })
        .exec()
    },

    onHandleMove(e) {
      const d = this.drag
      if (!d || !this.selection || !e.touches || !e.touches.length) return
      const touch = e.touches[0]
      d.y = touch.clientY
      if (Math.abs(touch.clientY - d.y0) > TAP_SLOP_PX || Math.abs(touch.clientX - d.x0) > TAP_SLOP_PX) d.moved = true
      this.applyDrag()
      if (d.moved) this.updateAutoScroll()
    },

    onHandleEnd() {
      const d = this.drag
      this.drag = null
      this.stopAutoScroll()
      if (!d || d.moved) return
      d.ended = true
      if (d.rect) this.tapThrough(d)
    },

    onHandleCancel() {
      this.drag = null
      this.stopAutoScroll()
    },

    // A still tap on a dot acts on whatever lies under the finger:
    // the selection itself, a neighbouring booking, or a free cell.
    tapThrough(d) {
      const s = this.selection
      if (!s || !d.rect) return
      if (d.y0 >= d.rect.top && d.y0 <= d.rect.bottom) {
        this.onSelectionTap()
        return
      }
      const min = s.startMin + Math.floor((d.y0 - d.rect.top) / this.slotPx) * SLOT
      const booking = this.bookingsOn(s.date).find((b) => b.startMin <= min && min < b.endMin)
      if (booking) {
        this.triggerEvent('bookingtap', { booking })
        return
      }
      this.selectSlot(this.data.days.findIndex((day) => day.date === s.date), min)
    },

    applyDrag() {
      const d = this.drag
      const s = this.selection
      const steps = Math.round((d.y - d.y0 + d.scrolled) / this.slotPx)
      let startMin = s.startMin
      let endMin = s.endMin
      if (d.edge === 'bottom') endMin = clamp(d.end0 + steps * SLOT, s.startMin + SLOT, d.maxEnd)
      else startMin = clamp(d.start0 + steps * SLOT, d.minStart, s.endMin - SLOT)
      if (startMin === s.startMin && endMin === s.endMin) return
      d.moved = true
      this.setSelection({ date: s.date, startMin, endMin })
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    },

    // Keep dragging past the visible part of the grid by scrolling the page.
    updateAutoScroll() {
      const d = this.drag
      const bottomEdge = this.windowHeight - this.data.viewBottom - EDGE_PX
      const topEdge = this.data.viewTop + EDGE_PX
      const dir = d.y > bottomEdge ? 1 : d.y < topEdge ? -1 : 0
      if (dir === d.dir) return
      d.dir = dir
      clearInterval(this.scrollTimer)
      this.scrollTimer = dir ? setInterval(() => this.autoScrollStep(), AUTO_SCROLL_MS) : null
    },

    autoScrollStep() {
      const d = this.drag
      const s = this.selection
      if (!d || !s || d.scrollTop0 == null) return
      const growing = d.edge === 'bottom' ? d.dir > 0 : d.dir < 0
      const atLimit =
        d.edge === 'bottom'
          ? growing ? s.endMin >= d.maxEnd : s.endMin <= s.startMin + SLOT
          : growing ? s.startMin <= d.minStart : s.startMin >= s.endMin - SLOT
      const scrollTop = d.scrollTop0 + d.scrolled + d.dir * this.slotPx
      if (atLimit || scrollTop < 0) {
        this.stopAutoScroll()
        return
      }
      d.scrolled += d.dir * this.slotPx
      wx.pageScrollTo({ scrollTop, duration: 0 })
      this.applyDrag()
    },

    stopAutoScroll() {
      clearInterval(this.scrollTimer)
      this.scrollTimer = null
      if (this.drag) this.drag.dir = 0
    },

    noop() {}
  }
})
