const i18n = require('../../utils/i18n')
const session = require('../../utils/session')

Component({
  data: {
    lang: 'zh',
    t: {},
    session: null,
    choiceOpen: false,
    expired: false // came here because the sign-in ended
  },

  methods: {
    onLoad(query) {
      this.applyLang()
      // Other pages send people here with ?login=1 when they need to sign in
      // (&expired=1 when their sign-in has ended).
      if (query && query.login === '1') this.openChoice = true
      if (query && query.expired === '1') this.setData({ expired: true })
    },

    onShow() {
      this.navigating = false
      clearTimeout(this.choiceTimer)
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

    onHide() {
      clearTimeout(this.choiceTimer)
    },

    closeChoice() {
      this.setData({ choiceOpen: false })
    },

    chooseLogin(e) {
      if (this.navigating) return
      this.navigating = true // until the next onShow; a second tap is ignored
      const url = '/pages/login/login?mode=' + e.currentTarget.dataset.mode
      // Let the page-container behind the sheet close before leaving the
      // page; closing it and navigating at once can leave the back key stuck.
      this.setData({ choiceOpen: false }, () => {
        this.choiceTimer = setTimeout(() => {
          wx.navigateTo({
            url,
            fail: () => {
              this.navigating = false
            }
          })
        }, 100)
      })
    },

    // Signed in as a WeChat user: administrator sign-in stays one tap away.
    goAdminLogin() {
      this.navigate('/pages/login/login?mode=admin')
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
