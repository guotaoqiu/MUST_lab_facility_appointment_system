const i18n = require('../../utils/i18n')
const session = require('../../utils/session')
const records = require('../../utils/records')
const service = require('../../services/booking')

function profileOf(s, t) {
  if (!s) return {}
  const admin = s.role === 'admin'
  return {
    avatar: s.avatar,
    name: admin && !s.nickname ? s.account : s.nickname,
    role: s.role,
    roleText: admin ? t.roleAdmin + ' · ' + s.account : t.roleUser
  }
}

Component({
  data: {
    lang: 'zh',
    t: {},
    profile: {},
    tab: 'upcoming',
    upcoming: [],
    history: [],
    items: [], // the list of the selected tab
    loading: false,
    loaded: false
  },

  methods: {
    onShow() {
      this.navigating = false
      if (!session.get()) {
        wx.reLaunch({ url: '/pages/index/index?login=1' })
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
      wx.setNavigationBarTitle({ title: t.navSettings })
      this.setData({ lang, t, profile: profileOf(session.get(), t) })
      this.render()
    },

    render() {
      const res = this.result
      if (!res) return
      const lang = this.data.lang
      const view = (r) => records.viewRecord(r, lang, { title: 'instrument' })
      const upcoming = res.upcoming.map(view)
      const history = res.history.map(view)
      this.setData({ upcoming, history, items: this.data.tab === 'upcoming' ? upcoming : history })
    },

    async load() {
      this.setData({ loading: true })
      const res = await service.myBookings()
      this.setData({ loading: false })
      if (!res.ok) {
        wx.showToast({ title: i18n.errorMessage(res.code, this.data.lang), icon: 'none' })
        return
      }
      if (!session.get()) {
        wx.reLaunch({ url: '/pages/index/index?login=1' })
        return
      }
      this.result = res
      this.setData({ loaded: true, profile: profileOf(session.get(), this.data.t) })
      this.render()
    },

    switchTab(e) {
      const tab = e.currentTarget.dataset.tab
      this.setData({ tab, items: tab === 'upcoming' ? this.data.upcoming : this.data.history })
    },

    onLangChange(e) {
      i18n.setLang(e.detail.lang)
      this.applyLang()
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
          else wx.showModal({ title: t.noticeTitle, content: i18n.errorMessage(res.code, this.data.lang), showCancel: false, confirmText: t.gotIt })
          this.load()
        }
      })
    },

    navigate(url) {
      if (this.navigating) return
      this.navigating = true
      wx.navigateTo({
        url,
        fail: () => {
          this.navigating = false
        }
      })
    },

    goAdmin() {
      this.navigate('/pages/admin/admin')
    },

    goAdminLogin() {
      this.navigate('/pages/login/login?mode=admin&next=back')
    },

    onLogout() {
      const t = this.data.t
      wx.showModal({
        title: t.logout,
        content: t.logoutConfirm,
        confirmText: t.confirm,
        cancelText: t.cancel,
        success: async (r) => {
          if (!r.confirm) return
          await service.logout()
          wx.reLaunch({ url: '/pages/index/index' })
        }
      })
    }
  }
})
