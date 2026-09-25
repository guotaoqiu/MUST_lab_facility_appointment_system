// Who is using the app on this phone: a WeChat user or an administrator.
// The server decides (see `me` in its responses); this only remembers it.
const KEY = 'session'

function fromMe(me) {
  if (!me) return null
  if (me.isAdmin) return { role: 'admin', account: me.account, nickname: me.nickname, avatar: me.avatar }
  if (me.loggedIn) return { role: 'user', nickname: me.nickname, avatar: me.avatar }
  return null
}

module.exports = {
  get() {
    try {
      return wx.getStorageSync(KEY) || null
    } catch (e) {
      return null
    }
  },

  set(session) {
    try {
      wx.setStorageSync(KEY, session)
    } catch (e) {}
  },

  clear() {
    try {
      wx.removeStorageSync(KEY)
    } catch (e) {}
  },

  /** Follow the server's view; returns the session (null when logged out). */
  sync(me) {
    const session = fromMe(me)
    if (session) this.set(session)
    else this.clear()
    return session
  },

  isAdmin() {
    const s = this.get()
    return !!s && s.role === 'admin'
  }
}
