const core = require('../../utils/booking-core')
const i18n = require('../../utils/i18n')
const clock = require('../../utils/clock')
const service = require('../../services/booking')
const instruments = require('../../data/instruments')

const NAME_KEY = 'bookerName'
// After these errors the chosen slot is no longer usable: go back and pick again.
const RESELECT_CODES = ['CONFLICT', 'IN_PAST', 'OUT_OF_RANGE', 'INVALID_TIME', 'INVALID_DATE', 'BAD_INSTRUMENT']

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
      this.request = instrument && core.isDateString(query.date) && startMin < endMin
        ? { instrumentId: instrument.id, date: query.date, startMin, endMin }
        : null
      this.instrument = instrument

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

      const checked = core.validateBooking(payload, clock.now())
      if (!checked.ok) {
        if (/^NAME_/.test(checked.code)) this.setData({ 'errors.name': i18n.errorMessage(checked.code, lang) })
        else if (/^PURPOSE_/.test(checked.code)) this.setData({ 'errors.purpose': i18n.errorMessage(checked.code, lang) })
        else this.showError(checked.code, RESELECT_CODES.indexOf(checked.code) !== -1)
        return
      }

      this.setData({ submitting: true })
      const res = await service.create(payload)
      if (res.ok) {
        try {
          wx.setStorageSync(NAME_KEY, checked.value.name)
        } catch (e) {}
        wx.showToast({ title: this.data.t.success, icon: 'success', duration: 1500, mask: true })
        // Stay "submitting" so the button cannot be pressed again before leaving.
        setTimeout(() => wx.navigateBack(), 1500)
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
          if (goBack) wx.navigateBack()
        }
      })
    }
  }
})
