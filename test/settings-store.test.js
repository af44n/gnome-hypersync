const test = require('node:test')
const assert = require('node:assert')
const { make_devices, until, hex, values } = require('./helpers.js')

test('two devices see each others settings', async function (t) {
  const [a, b] = await make_devices(t, 2)
  await a.set('/org/gnome/desktop/interface/color-scheme', "'prefer-dark'")
  await b.set('/org/gnome/desktop/interface/icon-theme', "'Papirus'")
  await until(async () => Object.keys(await b.read_all()).length === 2 && Object.keys(await a.read_all()).length === 2)
  assert.deepStrictEqual(values(await a.read_all()), values(await b.read_all()))
  assert.strictEqual((await b.get('/org/gnome/desktop/interface/color-scheme')).value, "'prefer-dark'")
  assert.deepStrictEqual(Object.keys(await a.list_devices()).length, 2)
})

test('the data on disk is encrypted', async function (t) {
  const devices = await make_devices(t, 1)
  const [a] = devices
  await a.set('/secret/key', "'very-secret-value'")
  const raw = devices.stores[0].get({ key: a.writer_key, valueEncoding: 'binary' }) // no encryption key given
  await raw.ready()
  for (let i = 0; i < raw.length; i++) assert.ok(!(await raw.get(i)).toString().includes('very-secret-value'))
  await raw.close()
})

test('newest change wins after both devices changed the same key offline', async function (t) {
  for (const newer of ['a', 'b']) {
    for (const newer_writes_first of [true, false]) {
      const devices = await make_devices(t, 2)
      const [a, b] = devices
      devices.disconnect()
      const now = Date.now()
      const writes = [() => (newer === 'a' ? a : b).set('/k', "'newer'", now), () => (newer === 'a' ? b : a).set('/k', "'older'", now - 1000)]
      if (!newer_writes_first) writes.reverse()
      for (const write of writes) await write()
      devices.connect()
      await until(async () => (await a.get('/k'))?.value === (await b.get('/k'))?.value)
      assert.strictEqual((await a.get('/k')).value, "'newer'", `newer on ${newer}, newer writes first: ${newer_writes_first}`)
    }
  }
})

test('a reset is synced and also follows newest wins', async function (t) {
  const [a, b] = await make_devices(t, 2)
  await a.set('/k', "'x'")
  await until(async () => (await b.get('/k'))?.value === "'x'")
  await b.set('/k', null)
  await until(async () => (await a.get('/k'))?.value === null)
})

test('a removed device can no longer write, the last device cannot remove itself', async function (t) {
  const [a, b] = await make_devices(t, 2)
  await a.remove_device(b.writer_key)
  await until(() => !b.writable)
  assert.deepStrictEqual(Object.keys(await a.list_devices()), [hex(a.writer_key)])
  await a.remove_device(a.writer_key)
  await a.set('/still', 'true')
  assert.ok(a.writable)
  assert.strictEqual((await a.get('/still')).value, 'true')
})
