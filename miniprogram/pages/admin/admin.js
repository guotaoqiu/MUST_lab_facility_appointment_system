const core = require('../../shared/booking-core')
const instruments = require('../../shared/instruments')
const i18n = require('../../utils/i18n')
const clock = require('../../utils/clock')
const session = require('../../utils/session')
const records = require('../../utils/records')
const service = require('../../services/booking')

function currentMonth() {
  return core.localNow(clock.now()).date.slice(0, 7)
}

function shiftMonth(month, step) {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + step
  return Math.floor(total / 12) + '-' + core.pad2((total % 12) + 1)
}

// ?id=<instrument> — all bookings of one instrument, suspend switch, Excel export.
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
    loading: false,
    busy: false,
    exporting: false
  },

  methods: {
    onLoad(query) {
      const index = Math.max(0, instruments.findIndex((i) => i.id === (query && query.id)))
      this.setData({ index, month: currentMonth() })
    },

    onShow() {
      if (!session.isAdmin()) {
        wx.redirectTo({ url: '/pages/login/login?mode=admin' })
        return
      }
      this.applyLang()
      this.load()
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
        suspendedText: res.suspended
          ? (res.suspended.reason ? res.suspended.reason + ' · ' : '') + i18n.format(t.suspendedSince, { time: i18n.formatTimestamp(res.suspended.since, lang) })
          : ''
      })
    },

    async load() {
      const id = this.data.current.id || instruments[this.data.index].id
      const month = this.data.month
      const seq = (this.seq = (this.seq || 0) + 1)
      this.setData({ loading: true })
      const res = await service.adminRecords(id, month)
      if (seq !== this.seq) return
      this.setData({ loading: false })
      if (!res.ok) return this.fail(res)
      this.result = res
      this.render()
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
          if (res.code === 'ADMIN_REQUIRED') wx.redirectTo({ url: '/pages/login/login?mode=admin' })
        }
      })
    },

    onPickInstrument(e) {
      this.result = null
      this.setData({ index: Number(e.detail.value), records: [], summaryText: '' })
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
      const revert = () => this.setData({ suspended: this.data.suspended ? Object.assign({}, this.data.suspended) : null })
      const apply = async (reason) => {
        this.setData({ busy: true })
        const res = await service.setSuspended(this.data.current.id, suspend, reason || '')
        this.setData({ busy: false })
        if (!res.ok) {
          revert()
          return this.fail(res)
        }
        this.load()
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
          this.load()
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
