const core = require('../../shared/booking-core')
const i18n = require('../../utils/i18n')
const clock = require('../../utils/clock')
const service = require('../../services/booking')
const instruments = require('../../shared/instruments')

const NAME_KEY = 'bookerName'
// After these errors the chosen slot is no longer usable: go back and pick again.
const RESELECT_CODES = ['CONFLICT', 'IN_PAST', 'OUT_OF_RANGE', 'INVALID_TIME', 'INVALID_DATE', 'BAD_INSTRUMENT', 'SUSPENDED']

function refreshBookingPage() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const top = pages[pages.length - 1]
  if (top && top.route === 'pages/booking/booking' && typeof top.load === 'function') top.load()
}

function fieldError(value, max, prefix, lang) {
  const text = core.cleanText(value)
  if (!text) return i18n.errorMessage(prefix + '_REQUIRED', lang)
  if (core.textLength(text) > max) return i18n.errorMessage(prefix + '_TOO_LONG', lang)
  return ''
}

Component({
  data: {
    lang: 'zh',
    t: {},
    summary: {},
    name: '',
    purpose: '',
    purposeLength: 0,
    nameMax: core.NAME_MAX,
    purposeMax: core.PURPOSE_MAX,
    errors: {},
    submitting: false
  },

  methods: {
    onLoad(query) {
      query = query || {}
      const instrument = instruments.find((i) => i.id === query.id)
      const startMin = Number(query.start)
      const endMin = Number(query.end)
      // requestId lets the server recognise a retry of this same booking.
      this.request = instrument && core.isDateString(query.date) && startMin < endMin
        ? { instrumentId: instrument.id, date: query.date, startMin, endMin, requestId: core.makeId(Date.now()) }
        : null
      this.instrument = instrument
      this.left = false

      let name = ''
      try {
        name = wx.getStorageSync(NAME_KEY) || ''
      } catch (e) {}
      this.setData({ name })
      this.applyLang()

      if (!this.request) this.showError('INVALID_TIME', true)
    },

    onShow() {
      this.applyLang()
    },

    onUnload() {
      // Never navigate on behalf of a page the user has already left.
      this.left = true
      clearTimeout(this.backTimer)
    },

    applyLang() {
      const lang = i18n.getLang()
      const t = i18n.dict(lang)
      wx.setNavigationBarTitle({ title: t.navConfirm })
      const r = this.request
      const inst = this.instrument
      this.setData({
        lang,
        t,
        summary: r
          ? {
              photo: inst.photo,
              instrument: i18n.instrumentName(inst, lang),
              meta: [inst.model, inst.location].filter(Boolean).join(' · '),
              date: i18n.formatDate(r.date, lang),
              time: i18n.formatTimeRange(r.startMin, r.endMin),
              duration: i18n.formatDuration(r.endMin - r.startMin, lang)
            }
          : {}
      })
    },

    onNameInput(e) {
      this.setData({ name: e.detail.value, 'errors.name': '' })
    },

    onPurposeInput(e) {
      const purpose = e.detail.value
      this.setData({ purpose, purposeLength: core.textLength(purpose), 'errors.purpose': '' })
    },

    async submit() {
      if (this.data.submitting || !this.request) return
      const lang = this.data.lang
      const payload = Object.assign({}, this.request, { name: this.data.name, purpose: this.data.purpose })

      // Report both fields at once.
      const errors = {
        name: fieldError(payload.name, core.NAME_MAX, 'NAME', lang),
        purpose: fieldError(payload.purpose, core.PURPOSE_MAX, 'PURPOSE', lang)
      }
      if (errors.name || errors.purpose) {
        this.setData({ errors })
        return
      }
      const checked = core.validateBooking(payload, clock.now())
      if (!checked.ok) {
        this.showError(checked.code, RESELECT_CODES.indexOf(checked.code) !== -1)
        return
      }

      this.setData({ submitting: true })
      const res = await service.create(payload)
      if (res.ok) {
        try {
          wx.setStorageSync(NAME_KEY, checked.value.name)
        } catch (e) {}
        if (this.left) refreshBookingPage() // it loaded before this booking existed
        wx.showToast({ title: this.data.t.success, icon: 'success', duration: 1500, mask: !this.left })
        // Stay "submitting" so the button cannot be pressed again before leaving.
        this.backTimer = setTimeout(() => {
          if (!this.left) wx.navigateBack()
        }, 1500)
        return
      }
      this.setData({ submitting: false })
      this.showError(res.code, RESELECT_CODES.indexOf(res.code) !== -1)
    },

    showError(code, goBack) {
      const t = this.data.t
      wx.showModal({
        title: t.noticeTitle,
        content: i18n.errorMessage(code, this.data.lang),
        showCancel: false,
        confirmText: t.gotIt,
        success: () => {
          if (this.left) return
          if (code === 'NOT_LOGGED_IN') wx.reLaunch({ url: '/pages/index/index?login=1' })
          else if (goBack) wx.navigateBack()
        }
      })
    }
  }
})
