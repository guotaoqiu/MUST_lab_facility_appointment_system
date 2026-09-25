// Copies the code the cloud function shares with the mini program:
//   miniprogram/shared/* -> cloudfunctions/booking/shared/
// Run `npm run sync` after editing anything in miniprogram/shared, then
// redeploy the `booking` cloud function.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const from = path.join(root, 'miniprogram', 'shared')
const to = path.join(root, 'cloudfunctions', 'booking', 'shared')

fs.rmSync(to, { recursive: true, force: true })
fs.mkdirSync(to, { recursive: true })
const files = fs.readdirSync(from).filter((f) => f.endsWith('.js'))
files.forEach((f) => fs.copyFileSync(path.join(from, f), path.join(to, f)))

console.log('Synced ' + files.join(', ') + ' to cloudfunctions/booking/shared')
