const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const shared_files = require('../lib/node_modules/shared-files')
const { make_devices, until } = require('./helpers.js')

test('a file shared on one device can be fetched on the other', async function (t) {
  const devices = await make_devices(t, 2)
  const [a, b] = make_shared_files(t, devices)
  const data = crypto.randomBytes(300 * 1024) // bigger than one 64kb block
  await a.publish('some-id', data)
  await a.publish('some-id', data) // same file again is not added twice
  await until(() => devices[1].get_file('some-id'))
  assert.deepStrictEqual(await b.fetch('some-id'), data)
})

test('fetching a file nobody shared fails, a damaged file is refused', async function (t) {
  const devices = await make_devices(t, 2)
  const [a, b] = make_shared_files(t, devices)
  await assert.rejects(b.fetch('missing'), /not shared/)
  await a.publish('real', Buffer.from('real content'))
  const ref = await devices[0].get_file('real')
  await devices[0].add_file('fake', { ...ref, sha256: 'f'.repeat(64) }) // points at a blob with other content
  await until(() => devices[1].get_file('fake'))
  await assert.rejects(b.fetch('fake'), /damaged/)
})

test('the shared files are encrypted on disk', async function (t) {
  const devices = await make_devices(t, 1)
  const [a] = make_shared_files(t, devices)
  await a.publish('secret', Buffer.from('very-secret-wallpaper-bytes'))
  const ref = await devices[0].get_file('secret')
  const raw = devices.stores[0].get({ key: Buffer.from(ref.core, 'hex') }) // no encryption key given
  await raw.ready()
  for (let i = 0; i < raw.length; i++) assert.ok(!(await raw.get(i)).toString().includes('very-secret'))
  await raw.close()
})

function make_shared_files (t, devices) {
  const files = devices.map((settings, i) => shared_files({ store: devices.stores[i], settings, timeout: 10000 }))
  t.after(() => Promise.all(files.map(f => f.close())))
  return files
}
