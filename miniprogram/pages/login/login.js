const core = require('../../shared/booking-core')
const i18n = require('../../utils/i18n')
const session = require('../../utils/session')
const service = require('../../services/booking')

const REVIEW_WAIT_MS = 2500

function newerOrEqual(version, min) {
  const a = String(version || '0').split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < b.length; i++) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]
  }
  return true
}

// WeChat reviews a type="nickname" input after it loses focus and reports
// back through bindnicknamereview (base library 2.29.1 and later).
function reviewsNickname() {
  try {
    return newerOrEqual((wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).SDKVersion, '2.29.1')
  } catch (e) {
    return false
  }
}

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
      this.savedAvatar = this.data.avatar
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
      this.finished = true
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
      if (this.review && !this.review.pending) this.review = null // a new nickname needs a new review
    },

    // Leaving the field starts WeChat's review of the nickname; saving waits
    // for its answer (tapping 完成 straight from the field does both at once).
    onNicknameBlur(e) {
      this.onNickname(e)
      if (reviewsNickname()) this.review = { pending: true, pass: true }
    },

    // WeChat empties the field when the nickname fails its check.
    onNicknameReview(e) {
      if (this.finished) return
      const pass = !(e.detail && e.detail.pass === false)
      this.review = { pending: false, pass }
      if (this.reviewDone) this.reviewDone()
      if (!pass) {
        this.setData({ nickname: '' })
        this.showError({ code: 'NICKNAME_REJECTED' })
      }
    },

    waitForReview() {
      if (!this.review || !this.review.pending) return Promise.resolve()
      return new Promise((resolve) => {
        const timer = setTimeout(() => this.reviewDone(), REVIEW_WAIT_MS) // no answer: go ahead
        this.reviewDone = () => {
          clearTimeout(timer)
          this.reviewDone = null
          resolve()
        }
      })
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
      this.setData({ busy: true, error: '' })
      await this.waitForReview()
      if (this.review && !this.review.pass) {
        this.setData({ busy: false }) // onNicknameReview has said why
        return
      }
      this.setData({ nickname })
      // Without a new photo the saved one is kept.
      let avatar
      if (this.avatarPicked) {
        avatar = await service.uploadAvatar(this.data.avatar)
        if (!avatar) {
          // Put the saved photo back, so saving again keeps it.
          this.avatarPicked = false
          this.setData({ busy: false, avatar: this.savedAvatar })
          this.showError({ code: 'AVATAR_UPLOAD_FAILED' })
          return
        }
      }
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
