const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { require_sandbox, read_fingerprint } = require('./sandbox.js')
const gnome_dconf = require('../lib/node_modules/gnome-dconf')

const sandbox_dir = require_sandbox()
const dconf = gnome_dconf()
const tricky = {
  '/test/a': "'back\\\\slash and\\nnewline'",
  '/test/b': "[('x=y', 1)]",
  '/test/sub/c': '@as []',
  '/test/d': "'  lead'",
  '/test/e': 'uint32 7'
}

test('the fingerprint notices a change in the database', async function () {
  const before = read_fingerprint(path.join(sandbox_dir, 'config'))
  await dconf.write('/test/fingerprint', 'true')
  assert.notStrictEqual(read_fingerprint(path.join(sandbox_dir, 'config')), before)
  await dconf.reset('/test/fingerprint')
})

test('write, read and read_dir give back the exact values', async function () {
  for (const key in tricky) await dconf.write(key, tricky[key])
  for (const key in tricky) assert.strictEqual(await dconf.read(key), tricky[key])
  assert.deepStrictEqual(await dconf.read_dir('/test/'), tricky)
  assert.strictEqual(await dconf.read('/test/missing'), null)
})

test('reset a key and a whole dir', async function () {
  await dconf.reset('/test/a')
  assert.strictEqual(await dconf.read('/test/a'), null)
  await dconf.reset('/test/')
  assert.deepStrictEqual(await dconf.read_dir('/test/'), {})
})

test('watch reports writes and resets', async function () {
  const changes = []
  const watcher = dconf.watch('/watched/', change => changes.push(change))
  await wait(300) // dconf watch needs a moment to subscribe
  await dconf.write('/watched/x', "'hi'")
  await dconf.reset('/watched/x')
  await wait(300)
  watcher.stop()
  assert.deepStrictEqual(changes, [{ key: '/watched/x', value: "'hi'" }, { key: '/watched/x', value: null }])
})

function wait (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
