module.exports = {
  // Administrator accounts for 管理員登入 (account + password).
  // Store only password hashes. Create one with:
  //   node scripts/hash-password.js 'your-password'
  // and paste the printed value, e.g.
  //   { account: 'admin', passwordHash: 'pbkdf2_sha256$100000$...$...' }
  // Redeploy the cloud function after editing this file.
  ADMIN_ACCOUNTS: [],

  // Screen nicknames, names and purposes with WeChat's content security API
  // (security.msgSecCheck). If the API is unavailable the request still goes through.
  CONTENT_CHECK: true
}
