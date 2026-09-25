module.exports = {
  // Administrator accounts for 管理員登入 (account + password).
  // Store only password hashes. Create one with:
  //   node scripts/hash-password.js
  // (it asks for the password) and paste the printed value, e.g.
  //   { account: 'admin', passwordHash: 'pbkdf2_sha256$600000$...$...' }
  // Redeploy the cloud function after editing this file. Removing an account
  // or changing its password also signs out everyone who used it.
  ADMIN_ACCOUNTS: [],

  // Screen nicknames, names and purposes with WeChat's content security API
  // (security.msgSecCheck). If the API is unavailable the request still goes through.
  CONTENT_CHECK: true
}
