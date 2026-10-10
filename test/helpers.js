const fs = require('fs')
const os = require('os')
const path = require('path')
const Corestore = require('corestore')
const settings_store = require('../lib/node_modules/settings-store')

module.exports = { make_devices, until, wait, hex, temp_dir, values }

/***************************************
HELPERS
***************************************/
// device a creates the settings, the others join like after pairing, all replicate in this process
async function make_devices (t, count) {
  const stores = []
  const devices = []
  for (let i = 0; i < count; i++) stores.push(new Corestore(temp_dir()))
  const a = settings_store({ store: stores[0] })
  await a.ready()
  await a.add_device(a.writer_key, 'a')
  devices.push(a)
  for (let i = 1; i < count; i++) {
    const writer_key = await settings_store.get_writer_key(stores[i])
    await a.add_device(writer_key, 'device ' + i)
    const device = settings_store({ store: stores[i], key: a.key, encryption_key: a.encryption_key })
    await device.ready()
    devices.push(device)
  }
  const streams = []
  devices.stores = stores
  devices.connect = connect
  devices.disconnect = disconnect
  connect()
  for (const device of devices.slice(1)) await until(() => device.writable)
  t.after(close_all)
  return devices

  function connect () {
    for (let i = 1; i < count; i++) streams.push(...pipe(stores[0], stores[i]))
  }
  function disconnect () { while (streams.length) streams.pop().destroy() }
  async function close_all () {
    disconnect()
    for (const device of devices) await device.close()
    for (const store of stores) await store.close()
  }
}

function pipe (store_a, store_b) {
  const s1 = store_a.replicate(true)
  const s2 = store_b.replicate(false)
  s1.pipe(s2).pipe(s1)
  s1.on('error', () => {})
  s2.on('error', () => {})
  return [s1, s2]
}

async function until (check, ms = 10000) {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out')
    await wait(50)
  }
}

function values (all) { return Object.fromEntries(Object.entries(all).map(([key, entry]) => [key, entry.value])) }
function hex (key) { return key.toString('hex') }
function temp_dir () { return fs.mkdtempSync(path.join(os.tmpdir(), 'gnome-hypersync-test-')) }
function wait (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
