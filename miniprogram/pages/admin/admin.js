const core = require('../../shared/booking-core')
const instruments = require('../../shared/instruments')
const i18n = require('../../utils/i18n')
const clock = require('../../utils/clock')
const session = require('../../utils/session')
const records = require('../../utils/records')
const service = require('../../services/booking')

const LAST_KEY = 'adminInstrument'

function currentMonth() {
  return core.localNow(clock.now()).date.slice(0, 7)
}

function shiftMonth(month, step) {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + step
  return Math.floor(total / 12) + '-' + core.pad2((total % 12) + 1)
}

// ?id=<instrument>&month=YYYY-MM — all bookings of one instrument, suspend
// switch, Excel export. Without an id: the instrument used here last time.
Component({
  data: {
    lang: 'zh',
    t: {},
    names: [],
    index: 0,
    current: {},
    month: '',
    monthText: '',
    records: [],
    summaryText: '',
    suspended: null,
    suspendedText: '',
    switchOn: false, // follows the switch as shown, so it can be flipped back
    loading: false,
    loadError: false,
    busy: false,
    exporting: false
  },

  methods: {
    onLoad(query) {
      query = query || {}
      let id = query.id
      if (!id) {
        try {
          id = wx.getStorageSync(LAST_KEY)
        } catch (e) {}
      }
      const index = Math.max(0, instruments.findIndex((i) => i.id === id))
      this.setData({ index, month: core.isMonthString(query.month) ? query.month : currentMonth() })
    },

    onShow() {
      if (!session.isAdmin()) {
        this.toAdminLogin()
        return
      }
      this.applyLang()
      this.load()
    },

    // Sign in as administrator again, then come back to this instrument and month.
    toAdminLogin() {
      const id = instruments[this.data.index].id
      wx.redirectTo({ url: '/pages/login/login?mode=admin&next=admin&id=' + id + '&month=' + this.data.month })
    },

    onPullDownRefresh() {
      Promise.resolve(this.load()).then(() => wx.stopPullDownRefresh())
    },

    applyLang() {
      const lang = i18n.getLang()
      const t = i18n.dict(lang)
      wx.setNavigationBarTitle({ title: t.navAdmin })
      const inst = instruments[this.data.index]
      this.setData({
        lang,
        t,
        names: instruments.map((i) => i18n.instrumentName(i, lang)),
        current: {
          id: inst.id,
          name: i18n.instrumentName(inst, lang),
          meta: [inst.model, inst.location].filter(Boolean).join(' · '),
          photo: inst.photo
        },
        monthText: i18n.formatMonth(this.data.month, lang)
      })
      this.render()
    },

    render() {
      const res = this.result
      const { lang, t } = this.data
      if (!res) return
      const s = res.summary
      this.setData({
        records: res.records.map((r) => records.viewRecord(r, lang, { title: 'date', admin: true })),
        summaryText: s.total ? i18n.format(t.summary, s) : '',
        suspended: res.suspended,
        switchOn: !!res.suspended,
        suspendedText: res.suspended
          ? (res.suspended.reason ? res.suspended.reason + ' · ' : '') + i18n.format(t.suspendedSince, { time: i18n.formatTimestamp(res.suspended.since, lang) })
          : ''
      })
    },

    async load() {
      const id = this.data.current.id || instruments[this.data.index].id
      const month = this.data.month
      const seq = (this.seq = (this.seq || 0) + 1)
      this.setData({ loading: true, loadError: false })
      const res = await service.adminRecords(id, month)
      if (seq !== this.seq) return
      this.setData({ loading: false })
      if (!res.ok) {
        if (res.code === 'ADMIN_REQUIRED') return this.fail(res)
        // Keep what is shown; with nothing shown, offer a retry.
        if (this.result) wx.showToast({ title: i18n.errorMessage(res.code, this.data.lang), icon: 'none' })
        else this.setData({ loadError: true })
        return
      }
      this.result = res
      this.render()
    },

    retry() {
      this.load()
    },

    // Lost admin rights (e.g. the week-long sign-in expired): sign in again.
    fail(res) {
      const t = this.data.t
      wx.showModal({
        title: t.noticeTitle,
        content: i18n.errorMessage(res.code, this.data.lang, res),
        showCancel: false,
        confirmText: t.gotIt,
        success: () => {
          if (res.code === 'ADMIN_REQUIRED') this.toAdminLogin()
        }
      })
    },

    onPickInstrument(e) {
      const index = Number(e.detail.value)
      try {
        wx.setStorageSync(LAST_KEY, instruments[index].id)
      } catch (err) {}
      this.result = null
      this.setData({ index, records: [], summaryText: '', suspended: null, switchOn: false })
      this.applyLang()
      this.load()
    },

    onPickMonth(e) {
      this.setMonth(e.detail.value)
    },

    stepMonth(e) {
      this.setMonth(shiftMonth(this.data.month, Number(e.currentTarget.dataset.step)))
    },

    setMonth(month) {
      this.result = null
      this.setData({ month, monthText: i18n.formatMonth(month, this.data.lang), records: [], summaryText: '' })
      this.load()
    },

    onSuspendChange(e) {
      const t = this.data.t
      const suspend = e.detail.value
      // The switch has already moved; record that, so that moving it back is
      // a real change the switch receives.
      this.setData({ switchOn: suspend })
      const revert = () => this.setData({ switchOn: !suspend })
      const apply = async (reason) => {
        this.setData({ busy: true })
        const res = await service.setSuspended(this.data.current.id, suspend, reason || '')
        this.setData({ busy: false })
        if (!res.ok) {
          revert()
          return this.fail(res)
        }
        await this.load()
        if (suspend && res.upcoming) this.offerCancelUpcoming(res.upcoming, reason || '')
      }
      if (suspend) {
        wx.showModal({
          title: t.suspendSwitch,
          editable: true,
          placeholderText: t.suspendPrompt,
          confirmText: t.confirm,
          cancelText: t.cancel,
          success: (r) => (r.confirm ? apply(r.content) : revert()),
          fail: revert
        })
      } else {
        wx.showModal({
          title: t.resumeTitle,
          content: t.resumeContent,
          confirmText: t.confirm,
          cancelText: t.cancel,
          success: (r) => (r.confirm ? apply('') : revert()),
          fail: revert
        })
      }
    },

    // The instrument is out of service: its bookings that have not ended yet
    // can be cancelled in one go (the bookers see why).
    offerCancelUpcoming(count, reason) {
      const t = this.data.t
      wx.showModal({
        title: t.suspendedTitle,
        content: i18n.format(t.cancelUpcomingPrompt, { n: count }),
        confirmText: t.cancelAll,
        confirmColor: '#d14343',
        cancelText: t.keepBooking,
        success: async (r) => {
          if (!r.confirm) return
          wx.showLoading({ title: '', mask: true })
          const res = await service.cancelUpcoming(this.data.current.id, reason)
          wx.hideLoading()
          if (!res.ok) return this.fail(res)
          wx.showToast({ title: i18n.format(t.cancelledCount, { n: res.cancelled }), icon: 'none' })
          this.load()
        }
      })
    },

    onCancel(e) {
      const item = e.detail.item
      const t = this.data.t
      wx.showModal({
        title: t.cancelBooking,
        content: t.cancelConfirm,
        confirmText: t.confirmCancel,
        confirmColor: '#d14343',
        cancelText: t.keepBooking,
        success: async (r) => {
          if (!r.confirm) return
          wx.showLoading({ title: '', mask: true })
          const res = await service.cancel(item)
          wx.hideLoading()
          if (res.ok) wx.showToast({ title: t.cancelled, icon: 'success' })
          else this.fail(res)
          if (res.code !== 'ADMIN_REQUIRED') this.load() // otherwise it is leaving for the sign-in
        }
      })
    },

    onExport() {
      if (this.data.busy) return
      const t = this.data.t
      wx.showActionSheet({
        itemList: [i18n.format(t.exportMonth, { month: this.data.monthText }), t.exportAll],
        success: async (r) => {
          const month = r.tapIndex === 0 ? this.data.month : undefined
          this.setData({ busy: true, exporting: true })
          wx.showLoading({ title: t.exporting, mask: true })
          const res = await service.exportRecords(this.data.current.id, month, this.data.lang)
          wx.hideLoading()
          this.setData({ busy: false, exporting: false })
          if (!res.ok) this.fail(res)
        }
      })
    }
  }
})
