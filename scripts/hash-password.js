// Prints a password hash for cloudfunctions/booking/settings.js (ADMIN_ACCOUNTS).
//   node scripts/hash-password.js
// It asks for the password (typing is not shown), so the password never
// appears on the command line or in the shell history. Works the same in
// Windows cmd / PowerShell and macOS / Linux terminals.
const crypto = require('crypto')
const readline = require('readline')

const MIN_LENGTH = 12
const ITERATIONS = 600000

function fail(message) {
  console.error(message)
  process.exit(1)
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    // Show the question, then nothing of what is typed.
    let muted = false
    rl._writeToOutput = (s) => {
      if (!muted) process.stdout.write(s)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
    muted = true
  })
}

async function readPassword() {
  if (!process.stdin.isTTY) {
    // Piped in, e.g. from a password manager: the first line is the password.
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    return data.split(/\r?\n/)[0]
  }
  const first = await ask('Password: ')
  const second = await ask('Repeat the password: ')
  if (first !== second) fail('The two passwords are different. Nothing was printed.')
  return first
}

async function main() {
  if (process.argv.length > 2) {
    fail('Run it without arguments: node scripts/hash-password.js\nIt will ask for the password.')
  }
  const password = await readPassword()
  if (Array.from(password).length < MIN_LENGTH) fail('Use at least ' + MIN_LENGTH + ' characters.')
  if (password !== password.trim()) fail('The password starts or ends with a space; please choose another one.')
  const salt = crypto.randomBytes(16)
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
  console.log(['pbkdf2_sha256', ITERATIONS, salt.toString('base64'), hash.toString('base64')].join('$'))
}

main()
