module.exports = {
  // Openids of lab administrators. They can cancel anyone's upcoming booking.
  // Find your openid in the cloud database: it is the `openid` field of a
  // booking you made (schedules collection).
  ADMIN_OPENIDS: [],

  // Screen names and purposes with WeChat's content security API
  // (security.msgSecCheck). If the API is unavailable the booking still goes through.
  CONTENT_CHECK: true
}
