const test = require('node:test')
const assert = require('node:assert')
const Corestore = require('corestore')
const create_testnet = require('hyperdht/testnet')
const settings_store = require('../lib/node_modules/settings-store')
const device_network = require('../lib/node_modules/device-network')
const device_pairing = require('../lib/node_modules/device-pairing')
const { until, temp_dir, hex } = require('./helpers.js')

test('pair a new device with the invite code and the digits, then sync over hyperswarm', async function (t) {
  const { a, b } = await make_two_devices(t)
  const digits = { shown: null }
  const invite = a.pairing.invite({ settings: a.settings, on_request: () => until(() => digits.shown).then(() => digits.shown) })
  const keys = await b.pairing.join({ code: invite.code, writer_key: b.writer_key, name: 'laptop', on_digits: shown => { digits.shown = shown } })
  const paired = await invite.paired
  assert.strictEqual(paired.name, 'laptop')
  assert.deepStrictEqual(keys.key, a.settings.key)
  assert.deepStrictEqual(keys.encryption_key, a.settings.encryption_key)
  b.settings = settings_store({ store: b.store, key: keys.key, encryption_key: keys.encryption_key })
  await b.settings.ready()
  b.network.join(b.settings.discovery_key)
  await until(() => b.settings.writable, 30000)
  await b.settings.set('/k', "'from b'")
  await until(async () => (await a.settings.get('/k'))?.value === "'from b'", 30000)
  assert.deepStrictEqual(Object.keys(await a.settings.list_devices()).sort(), [hex(a.settings.writer_key), hex(b.writer_key)].sort())
  await b.settings.close()
})

test('wrong digits deny the new device', async function (t) {
  const { a, b } = await make_two_devices(t)
  const invite = a.pairing.invite({ settings: a.settings, on_request: async () => '000000' })
  invite.paired.catch(() => {})
  const joined = b.pairing.join({ code: invite.code, writer_key: b.writer_key, name: 'thief', on_digits: () => {} })
  await assert.rejects(joined, /pairing denied/)
  await assert.rejects(invite.paired, /did not match/)
  assert.deepStrictEqual(Object.keys(await a.settings.list_devices()), [hex(a.settings.writer_key)])
})

/***************************************
HELPERS
***************************************/
// a has settings and waits on the dht, b is a fresh device. all on a local test dht
async function make_two_devices (t) {
  const testnet = await create_testnet(3)
  const a = await make_device(testnet)
  const b = await make_device(testnet)
  a.settings = settings_store({ store: a.store })
  await a.settings.ready()
  await a.settings.add_device(a.settings.writer_key, 'desktop')
  a.network.join(a.settings.discovery_key)
  b.writer_key = await settings_store.get_writer_key(b.store)
  t.after(close_all)
  return { a, b }
  async function close_all () {
    for (const device of [a, b]) await close_device(device)
    await testnet.destroy()
  }
}

async function make_device (testnet) {
  const store = new Corestore(temp_dir())
  const network = device_network({ store, bootstrap: testnet.bootstrap })
  const swarm = await network.start()
  return { store, network, pairing: device_pairing({ swarm }) }
}

async function close_device (device) {
  await device.pairing.close()
  if (device.settings) await device.settings.close()
  await device.network.stop()
  await device.store.close()
}
