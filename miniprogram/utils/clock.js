// "Now" as seen by the server. Every list response carries serverTime, so a
// phone with a wrong clock still shades past slots correctly.
let offset = 0

module.exports = {
  now() {
    return Date.now() + offset
  },
  sync(serverTime) {
    if (typeof serverTime === 'number' && serverTime > 0) offset = serverTime - Date.now()
  }
}
