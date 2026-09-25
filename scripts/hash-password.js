// Prints a password hash for cloudfunctions/booking/settings.js (ADMIN_ACCOUNTS).
//   node scripts/hash-password.js 'your-password'
const crypto = require('crypto')

const password = process.argv[2]
if (!password || password.length < 8) {
  console.error('Usage: node scripts/hash-password.js <password>   (at least 8 characters)')
  process.exit(1)
}
const iterations = 100000
const salt = crypto.randomBytes(16)
const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
console.log(['pbkdf2_sha256', iterations, salt.toString('base64'), hash.toString('base64')].join('$'))
