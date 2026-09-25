const i18n = require('../../utils/i18n')

Component({
  data: {
    lang: 'zh',
    t: {}
  },

  methods: {
    onLoad() {
      this.applyLang()
    },

    onShow() {
      this.applyLang()
    },

    applyLang() {
      const lang = i18n.getLang()
      this.setData({ lang, t: i18n.dict(lang) })
    },

    onLangChange(e) {
      i18n.setLang(e.detail.lang)
      this.applyLang()
    },

    goBooking() {
      wx.navigateTo({ url: '/pages/booking/booking' })
    },

    onShareAppMessage() {
      return { title: this.data.t.labName, path: '/pages/index/index' }
    }
  }
})
