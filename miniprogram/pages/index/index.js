const i18n = require('../../utils/i18n')
const session = require('../../utils/session')

Component({
  data: {
    lang: 'zh',
    t: {},
    session: null,
    choiceOpen: false
  },

  methods: {
    onLoad(query) {
      this.applyLang()
      // Other pages send people here with ?login=1 when they need to sign in.
      if (query && query.login === '1') this.openChoice = true
    },

    onShow() {
      this.navigating = false
      this.applyLang()
      this.setData({ session: session.get() })
    },

    onReady() {
      if (this.openChoice) {
        this.openChoice = false
        this.setData({ choiceOpen: true })
      }
    },

    applyLang() {
      const lang = i18n.getLang()
      this.setData({ lang, t: i18n.dict(lang) })
    },

    onLangChange(e) {
      i18n.setLang(e.detail.lang)
      this.applyLang()
    },

    navigate(url) {
      if (this.navigating) return // a quick double tap would open the page twice
      this.navigating = true
      wx.navigateTo({
        url,
        fail: () => {
          this.navigating = false
        }
      })
    },

    onEntry() {
      if (session.get()) this.navigate('/pages/booking/booking')
      else this.setData({ choiceOpen: true })
    },

    closeChoice() {
      this.setData({ choiceOpen: false })
    },

    chooseLogin(e) {
      this.setData({ choiceOpen: false })
      this.navigate('/pages/login/login?mode=' + e.currentTarget.dataset.mode)
    },

    goSettings() {
      this.navigate('/pages/settings/settings')
    },

    onShareAppMessage() {
      return { title: this.data.t.labName, path: '/pages/index/index' }
    },

    noop() {}
  }
})
