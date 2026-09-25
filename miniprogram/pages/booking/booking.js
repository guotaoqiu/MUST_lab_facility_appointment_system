const core = require('../../utils/booking-core')
const i18n = require('../../utils/i18n')
const clock = require('../../utils/clock')
const service = require('../../services/booking')
const instruments = require('../../data/instruments')

const LAST_INSTRUMENT_KEY = 'lastInstrument'

function viewInstrument(inst, lang) {
  return {
    id: inst.id,
    name: i18n.instrumentName(inst, lang),
    meta: [inst.model, inst.location].filter(Boolean).join(' · '),
    photo: inst.photo,
    search: [inst.name.zh, inst.name.en, inst.model, inst.location].join(' ').toLowerCase()
  }
}

function formatSelection(selection, lang) {
  if (!selection) return null
  return {
    date: i18n.formatDate(selection.date, lang),
    time:
      i18n.formatTimeRange(selection.startMin, selection.endMin) +
      ' · ' +
      i18n.formatDuration(selection.endMin - selection.startMin, lang)
  }
}

Component({
  data: {
    lang: 'zh',
    t: {},
    demo: false,
    list: [], // instruments for the side menu
    drawerOpen: false,
    current: null, // selected instrument
    ready: false, // bookings of the current instrument have loaded
    loadError: false,
    weeks: [], // [{ start, title, range }]
    weekIndex: 0,
    days: [], // the 7 days shown
    weekBookings: [],
    nowDate: '',
    nowMinutes: 0,
    selection: null, // { date, startMin, endMin }
    selectionText: null,
    detail: null, // booking shown in the bottom sheet
    viewTop: 0, // px covered by the sticky header / bottom bar, for drag auto-scroll
    viewBottom: 0
  },

  methods: {
    onLoad(query) {
      this.bookings = []
      this.loadSeq = 0
      this.setData({ demo: service.isDemo() })
      this.applyLang()

      let id = query && query.id
      if (!id) {
        try {
          id = wx.getStorageSync(LAST_INSTRUMENT_KEY)
        } catch (e) {}
      }
      const inst = instruments.find((i) => i.id === id)
      if (inst) this.setData({ current: viewInstrument(inst, this.data.lang) })
    },

    onReady() {
      // Always start from the side menu (the last instrument is pre-selected).
      // Opening it after the first render lets it slide in and lets the
      // page-container that catches the back key notice the change.
      this.setData({ drawerOpen: true })
    },

    onShow() {
      this.navigating = false
      this.applyLang()
      if (this.data.current) this.load()
      clearInterval(this.timer)
      this.timer = setInterval(() => this.refreshNow(), 60 * 1000)
    },

    onHide() {
      clearInterval(this.timer)
    },

    onUnload() {
      clearInterval(this.timer)
    },

    onPullDownRefresh() {
      Promise.resolve(this.load()).then(() => wx.stopPullDownRefresh())
    },

    onShareAppMessage() {
      return { title: this.data.t.navBooking, path: '/pages/booking/booking' }
    },

    applyLang() {
      const lang = i18n.getLang()
      const t = i18n.dict(lang)
      wx.setNavigationBarTitle({ title: t.navBooking })
      const current = this.data.current
      const inst = current && instruments.find((i) => i.id === current.id)
      this.setData({
        lang,
        t,
        list: instruments.map((i) => viewInstrument(i, lang)),
        current: inst ? viewInstrument(inst, lang) : null,
        selectionText: formatSelection(this.data.selection, lang)
      })
      this.refreshNow()
    },

    onLangChange(e) {
      i18n.setLang(e.detail.lang)
      this.applyLang()
    },

    // Recompute today, the two weeks and the visible days.
    refreshNow() {
      const { lang, t, weekIndex } = this.data
      const win = core.bookingWindow(clock.now())
      const weeks = win.weekStarts.map((start, i) => ({
        start,
        title: i === 0 ? t.thisWeek : t.nextWeek,
        range: i18n.formatWeekRange(start, lang)
      }))
      const start = weeks[weekIndex].start
      const end = core.addDays(start, 6)
      this.setData({
        nowDate: win.today,
        nowMinutes: win.nowMinutes,
        weeks,
        days: core.weekDates(start).map((date) => ({
          date,
          weekday: i18n.weekdayShort(date, lang),
          dayNum: Number(date.slice(8)),
          isToday: date === win.today,
          isPast: date < win.today
        })),
        weekBookings: this.bookings.filter((b) => b.date >= start && b.date <= end)
      })
    },

    async load() {
      const current = this.data.current
      if (!current) return
      const seq = ++this.loadSeq
      wx.showNavigationBarLoading()
      const res = await service.list(current.id)
      if (seq !== this.loadSeq) return
      wx.hideNavigationBarLoading()
      if (!res.ok) {
        // Keep showing what we had; without data the grid stays disabled.
        this.setData({ loadError: true })
        return
      }
      this.bookings = res.bookings
      this.setData({ ready: true, loadError: false })
      this.refreshNow()
      this.measureInsets()
    },

    // The calendar auto-scrolls while dragging near these edges.
    measureInsets() {
      this.createSelectorQuery()
        .select('.sticky')
        .boundingClientRect()
        .select('.bar')
        .boundingClientRect()
        .exec((res) => {
          const sticky = res && res[0]
          const bar = res && res[1]
          const next = {
            viewTop: sticky ? Math.round(sticky.height) : 0,
            viewBottom: bar ? Math.round(bar.height) : 0
          }
          if (next.viewTop !== this.data.viewTop || next.viewBottom !== this.data.viewBottom) this.setData(next)
        })
    },

    openDrawer() {
      this.setData({ drawerOpen: true })
    },

    closeDrawer() {
      this.setData({ drawerOpen: false })
    },

    // Android back key / swipe-back while the side menu or the detail sheet is open.
    onOverlayBack() {
      this.setData({ drawerOpen: false, detail: null })
    },

    onPickInstrument(e) {
      const id = e.detail.id
      this.setData({ drawerOpen: false })
      if (this.data.current && this.data.current.id === id && this.data.ready) return
      const inst = instruments.find((i) => i.id === id)
      if (!inst) return
      try {
        wx.setStorageSync(LAST_INSTRUMENT_KEY, id)
      } catch (err) {}
      this.bookings = []
      this.setData({ current: viewInstrument(inst, this.data.lang), ready: false, loadError: false })
      this.clearSelection()
      this.refreshNow()
      this.load()
    },

    switchWeek(e) {
      const index = Number(e.currentTarget.dataset.index)
      if (index === this.data.weekIndex) return
      this.setData({ weekIndex: index })
      this.refreshNow()
    },

    onSelectionChange(e) {
      const selection = e.detail.selection
      this.setData({ selection, selectionText: formatSelection(selection, this.data.lang) })
    },

    clearSelection() {
      const calendar = this.selectComponent('#calendar')
      if (calendar) calendar.clearSelection()
      this.setData({ selection: null, selectionText: null })
    },

    goConfirm() {
      const s = this.data.selection
      const current = this.data.current
      if (!s || !current || !this.data.ready || this.navigating) return
      this.navigating = true
      wx.navigateTo({
        url: '/pages/confirm/confirm?id=' + current.id + '&date=' + s.date + '&start=' + s.startMin + '&end=' + s.endMin,
        fail: () => {
          this.navigating = false
        }
      })
    },

    onBookingTap(e) {
      const b = e.detail.booking
      const lang = this.data.lang
      const inst = instruments.find((i) => i.id === b.instrumentId)
      // The list may be a while old: a booking that has ended cannot be cancelled.
      const ended = core.isPast(b.date, b.endMin, core.localNow(clock.now()))
      this.setData({
        detail: {
          booking: b,
          instrumentName: inst ? i18n.instrumentName(inst, lang) : '',
          dateText: i18n.formatDate(b.date, lang),
          timeText:
            i18n.formatTimeRange(b.startMin, b.endMin) + ' · ' + i18n.formatDuration(b.endMin - b.startMin, lang),
          name: b.name,
          purpose: b.purpose,
          mine: b.mine,
          canCancel: b.canCancel && !ended
        }
      })
    },

    closeDetail() {
      this.setData({ detail: null })
    },

    onCancelBooking() {
      const detail = this.data.detail
      const t = this.data.t
      if (!detail || this.cancelling) return
      wx.showModal({
        title: t.cancelBooking,
        content: t.cancelConfirm,
        confirmText: t.confirmCancel,
        confirmColor: '#d14343',
        cancelText: t.keepBooking,
        success: async (r) => {
          if (!r.confirm) return
          this.cancelling = true
          wx.showLoading({ title: '', mask: true })
          const res = await service.cancel(detail.booking)
          wx.hideLoading()
          this.cancelling = false
          this.setData({ detail: null })
          if (res.ok) {
            wx.showToast({ title: t.cancelled, icon: 'success' })
          } else {
            wx.showModal({
              title: t.noticeTitle,
              content: i18n.errorMessage(res.code, this.data.lang),
              showCancel: false,
              confirmText: t.gotIt
            })
          }
          this.load()
        }
      })
    },

    retry() {
      this.load()
    },

    noop() {}
  }
})
