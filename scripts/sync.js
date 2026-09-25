// Copies what the cloud function shares with the mini program:
//   miniprogram/utils/booking-core.js -> cloudfunctions/booking/booking-core.js
//   instrument ids from miniprogram/data/instruments.js -> cloudfunctions/booking/instrument-ids.json
// Run `npm run sync` after editing either source, then redeploy the cloud function.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const fnDir = path.join(root, 'cloudfunctions', 'booking')

fs.copyFileSync(path.join(root, 'miniprogram', 'utils', 'booking-core.js'), path.join(fnDir, 'booking-core.js'))

const instruments = require(path.join(root, 'miniprogram', 'data', 'instruments.js'))
const ids = instruments.map((i) => i.id)
fs.writeFileSync(path.join(fnDir, 'instrument-ids.json'), JSON.stringify(ids, null, 2) + '\n')

console.log('Synced booking-core.js and ' + ids.length + ' instrument ids to cloudfunctions/booking')
