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
      this.navigating = false
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
      if (this.navigating) return // a quick double tap would open the page twice
      this.navigating = true
      wx.navigateTo({
        url: '/pages/booking/booking',
        fail: () => {
          this.navigating = false
        }
      })
    },

    onShareAppMessage() {
      return { title: this.data.t.labName, path: '/pages/index/index' }
    }
  }
})
