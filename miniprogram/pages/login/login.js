const core = require('../../shared/booking-core')
const i18n = require('../../utils/i18n')
const session = require('../../utils/session')
const service = require('../../services/booking')

// Where to go back to after signing in again on the admin page.
function adminQuery(query) {
  const parts = []
  if (/^[a-z0-9-]+$/.test(query.id || '')) parts.push('id=' + query.id)
  if (core.isMonthString(query.month)) parts.push('month=' + query.month)
  return parts.length ? '?' + parts.join('&') : ''
}

// ?mode=user (WeChat) or ?mode=admin (account + password)
// ?edit=1 (user mode) changes the photo and nickname of a signed-in user.
// After signing in: the booking system, or with ?next=back the previous page,
// or with ?next=admin the admin page (&id=&month= as it was).
Component({
  data: {
    mode: 'user',
    step: 'start', // user mode: 'start' -> 'profile' (first time only)
    edit: false,
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
      this.adminQuery = adminQuery(query)
      const mode = query.mode === 'admin' ? 'admin' : 'user'
      this.setData({ mode })
      const current = session.get()
      if (mode === 'user' && query.edit === '1' && current) {
        this.setData({ step: 'profile', edit: true, nickname: current.nickname || '', avatar: current.avatar || '' })
      }
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
      wx.setNavigationBarTitle({ title: this.data.mode === 'admin' ? t.navAdminLogin : this.data.edit ? t.navEditProfile : t.navUserLogin })
      this.setData({
        lang,
        t,
        demoHint: this.data.mode === 'admin' && service.isDemo() ? i18n.format(t.demoAdminHint, service.demoAdmin) : ''
      })
    },

    finish() {
      if (this.data.edit) {
        wx.showToast({ title: this.data.t.saved, icon: 'success' })
        wx.navigateBack()
      } else if (this.next === 'back') wx.navigateBack()
      else if (this.next === 'admin') wx.redirectTo({ url: '/pages/admin/admin' + this.adminQuery })
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
      if (e.detail && e.detail.avatarUrl) {
        this.avatarPicked = true
        this.setData({ avatar: e.detail.avatarUrl })
      }
    },

    onNickname(e) {
      if (e.detail && typeof e.detail.value === 'string') this.setData({ nickname: e.detail.value, error: '' })
    },

    // WeChat checks the nickname after the field loses focus and empties it
    // when the check fails.
    onNicknameReview(e) {
      if (e.detail && e.detail.pass === false) {
        this.setData({ nickname: '' })
        this.showError({ code: 'NICKNAME_REJECTED' })
      }
    },

    // Step 2 (first time, or ?edit=1): save the nickname and photo. Submitted
    // as a form, which reads the nickname field as it is at that moment
    // (picking WeChat's suggested nickname does not always send an input event).
    async onSaveProfile(e) {
      if (this.data.busy) return
      const form = e && e.detail && e.detail.value
      const nickname = core.cleanText(form && typeof form.nickname === 'string' ? form.nickname : this.data.nickname)
      if (!nickname) {
        this.showError({ code: 'NICKNAME_REQUIRED' })
        return
      }
      this.setData({ busy: true, error: '', nickname })
      // Without a new photo the saved one is kept (also if the upload fails).
      const avatar = this.avatarPicked ? (await service.uploadAvatar(this.data.avatar)) || undefined : undefined
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
