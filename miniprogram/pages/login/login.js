const core = require('../../shared/booking-core')
const i18n = require('../../utils/i18n')
const service = require('../../services/booking')

// ?mode=user (WeChat) or ?mode=admin (account + password)
// ?next=back returns to the previous page instead of opening the booking system.
Component({
  data: {
    mode: 'user',
    step: 'start', // user mode: 'start' -> 'profile' (first time only)
    lang: 'zh',
    t: {},
    avatar: '',
    nickname: '',
    nicknameMax: core.NICKNAME_MAX,
    account: '',
    password: '',
    busy: false,
    error: '',
    demoHint: '',
    privacyOpen: false
  },

  methods: {
    onLoad(query) {
      query = query || {}
      this.next = query.next
      const mode = query.mode === 'admin' ? 'admin' : 'user'
      this.setData({ mode })
      this.applyLang()
      if (mode === 'user' && wx.onNeedPrivacyAuthorization) {
        wx.onNeedPrivacyAuthorization((resolve) => {
          this.privacyResolve = resolve
          this.setData({ privacyOpen: true })
        })
      }
    },

    onShow() {
      this.applyLang()
    },

    applyLang() {
      const lang = i18n.getLang()
      const t = i18n.dict(lang)
      wx.setNavigationBarTitle({ title: this.data.mode === 'admin' ? t.navAdminLogin : t.navUserLogin })
      this.setData({
        lang,
        t,
        demoHint: this.data.mode === 'admin' && service.isDemo() ? i18n.format(t.demoAdminHint, service.demoAdmin) : ''
      })
    },

    finish() {
      if (this.next === 'back') wx.navigateBack()
      else wx.redirectTo({ url: '/pages/booking/booking' })
    },

    showError(res) {
      const message = i18n.errorMessage(res.code, this.data.lang, res)
      this.setData({ error: message })
      return message
    },

    // Step 1: sign in with the WeChat identity (the tap also records agreement
    // to the privacy guidelines, needed for the avatar and nickname fields).
    async onWechatLogin() {
      if (this.data.busy) return
      this.setData({ busy: true, error: '' })
      const res = await service.login()
      this.setData({ busy: false })
      if (!res.ok) {
        wx.showModal({ title: this.data.t.noticeTitle, content: this.showError(res), showCancel: false, confirmText: this.data.t.gotIt })
        return
      }
      if (res.needsProfile) this.setData({ step: 'profile' })
      else this.finish()
    },

    onChooseAvatar(e) {
      if (e.detail && e.detail.avatarUrl) this.setData({ avatar: e.detail.avatarUrl })
    },

    onNickname(e) {
      if (e.detail && typeof e.detail.value === 'string') this.setData({ nickname: e.detail.value, error: '' })
    },

    // Step 2 (first time): save the nickname and photo.
    async onSaveProfile() {
      if (this.data.busy) return
      const nickname = core.cleanText(this.data.nickname)
      if (!nickname) {
        this.showError({ code: 'NICKNAME_REQUIRED' })
        return
      }
      this.setData({ busy: true, error: '' })
      const avatar = this.data.avatar ? await service.uploadAvatar(this.data.avatar) : ''
      const res = await service.login({ nickname, avatar })
      this.setData({ busy: false })
      if (!res.ok) {
        this.showError(res)
        return
      }
      this.finish()
    },

    onAccount(e) {
      this.setData({ account: e.detail.value, error: '' })
    },

    onPassword(e) {
      this.setData({ password: e.detail.value, error: '' })
    },

    async onAdminLogin() {
      if (this.data.busy) return
      const account = this.data.account.trim()
      if (!account || !this.data.password) {
        this.showError({ code: 'CREDENTIALS_REQUIRED' })
        return
      }
      this.setData({ busy: true, error: '' })
      const res = await service.adminLogin(account, this.data.password)
      this.setData({ busy: false, password: res.ok ? '' : this.data.password })
      if (!res.ok) {
        this.showError(res)
        return
      }
      this.finish()
    },

    openPrivacy() {
      if (wx.openPrivacyContract) wx.openPrivacyContract({})
    },

    onAgreePrivacy() {
      if (this.privacyResolve) this.privacyResolve({ buttonId: 'agree-privacy', event: 'agree' })
      this.privacyResolve = null
      this.setData({ privacyOpen: false })
    },

    onDisagreePrivacy() {
      if (this.privacyResolve) this.privacyResolve({ event: 'disagree' })
      this.privacyResolve = null
      this.setData({ privacyOpen: false })
    },

    noop() {}
  }
})
