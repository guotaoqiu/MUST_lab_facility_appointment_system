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

Component({
  data: {
    lang: 'zh',
    t: {},
    demo: false,
    list: [], // instruments for the side menu
    drawerOpen: false,
    current: null, // selected instrument
    weeks: [], // [{ start, title, range }]
    weekIndex: 0,
    days: [], // the 7 days shown
    weekBookings: [],
    nowDate: '',
    nowMinutes: 0,
    loadError: false,
    selection: null, // { date, startMin, endMin }
    selectionText: null,
    detail: null // booking shown in the bottom sheet
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
      // Always start from the side menu; the last instrument is pre-selected.
      this.setData({ drawerOpen: true })
    },

    onShow() {
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
        current: inst ? viewInstrument(inst, lang) : null
      })
      this.refreshNow()
    },

    onLangChange(e) {
      i18n.setLang(e.detail.lang)
      this.applyLang()
    },

    // Recompute today, the two weeks and the visible days.
    refreshNow() {
      const { lang, t, weekIndex, selection } = this.data
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
        weekBookings: this.bookings.filter((b) => b.date >= start && b.date <= end),
        selectionText: selection
          ? {
              date: i18n.formatDate(selection.date, lang),
              time:
                i18n.formatTimeRange(selection.startMin, selection.endMin) +
                ' · ' +
                i18n.formatDuration(selection.endMin - selection.startMin, lang)
            }
          : null
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
        this.setData({ loadError: true })
        return
      }
      this.bookings = res.bookings
      this.setData({ loadError: false })
      this.refreshNow()
    },

    openDrawer() {
      this.setData({ drawerOpen: true })
    },

    closeDrawer() {
      this.setData({ drawerOpen: false })
    },

    onPickInstrument(e) {
      const id = e.detail.id
      this.setData({ drawerOpen: false })
      if (this.data.current && this.data.current.id === id && !this.data.loadError && this.loadSeq) return
      const inst = instruments.find((i) => i.id === id)
      if (!inst) return
      try {
        wx.setStorageSync(LAST_INSTRUMENT_KEY, id)
      } catch (err) {}
      this.bookings = []
      this.setData({ current: viewInstrument(inst, this.data.lang), loadError: false })
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
      this.setData({ selection: e.detail.selection })
      this.refreshNow()
    },

    clearSelection() {
      const calendar = this.selectComponent('#calendar')
      if (calendar) calendar.clearSelection()
      this.setData({ selection: null, selectionText: null })
    },

    goConfirm() {
      const s = this.data.selection
      const current = this.data.current
      if (!s || !current) return
      wx.navigateTo({
        url:
          '/pages/confirm/confirm?id=' + current.id + '&date=' + s.date + '&start=' + s.startMin + '&end=' + s.endMin
      })
    },

    onBookingTap(e) {
      const b = e.detail.booking
      const lang = this.data.lang
      const inst = instruments.find((i) => i.id === b.instrumentId)
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
          canCancel: b.canCancel
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
