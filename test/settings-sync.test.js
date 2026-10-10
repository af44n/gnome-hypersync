const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { start_extra_session } = require('./sandbox.js')
const { make_devices, until, temp_dir } = require('./helpers.js')
const gnome_dconf = require('../lib/node_modules/gnome-dconf')
const sync_rules = require('../lib/node_modules/sync-rules')
const safety_backup = require('../lib/node_modules/safety-backup')
const settings_sync = require('../lib/node_modules/settings-sync')

const scheme = '/org/gnome/desktop/interface/color-scheme'
const icons = '/org/gnome/desktop/interface/icon-theme'

test('rules only allow synced dirs and skip per machine and private keys', function () {
  const is_allowed = sync_rules.is_allowed
  assert.ok(is_allowed({ key: scheme, value: "'prefer-dark'" }))
  assert.ok(!is_allowed({ key: '/org/gnome/desktop/privacy/recent-files-max-age' }))
  assert.ok(!is_allowed({ key: '/org/gnome/shell/extensions/dash-to-dock/preferred-monitor-by-connector' }))
  assert.ok(!is_allowed({ key: '/org/gnome/desktop/interface/text-scaling-factor' }))
  assert.ok(!is_allowed({ key: '/org/gnome/shell/extensions/dynamic-music-pill/playback-history' }))
  assert.ok(!is_allowed({ key: '/org/gnome/shell/extensions/openbar/bguri', value: "'x'" }))
  assert.ok(!is_allowed({ key: '/org/gnome/shell/extensions/x/image', value: "'file:///home/me/a.png'" }))
  assert.ok(!is_allowed({ key: scheme, exclude: ['/org/gnome/desktop/interface/'] }))
  assert.ok(!is_allowed({ key: scheme, exclude: [scheme] }))
})

test('a change on one device is applied on the other, without echo', async function (t) {
  const [a, b] = await make_sync_devices(t)
  await a.dconf.write(scheme, "'prefer-dark'")
  assert.deepStrictEqual(await a.sync.push_local_changes(), [scheme])
  await until(async () => (await b.store.get(scheme))?.value === "'prefer-dark'")
  const changes = await b.sync.diff()
  assert.deepStrictEqual(changes, [{ key: scheme, local: null, remote: "'prefer-dark'" }])
  await b.sync.apply(changes)
  assert.strictEqual(await b.dconf.read(scheme), "'prefer-dark'")
  assert.deepStrictEqual(await b.sync.push_local_changes(), []) // writing it did not count as a change here
  assert.deepStrictEqual(await b.sync.diff(), [])
  assert.deepStrictEqual(await a.sync.push_local_changes(), [])
})

test('on the first sync the other devices win, keys only this device has are sent', async function (t) {
  const [a, b] = await make_sync_devices(t)
  await a.dconf.write(icons, "'Papirus'")
  await a.sync.push_local_changes()
  await until(async () => (await b.store.get(icons))?.value === "'Papirus'")
  await b.dconf.write(icons, "'Adwaita'")
  await b.dconf.write(scheme, "'prefer-light'")
  assert.deepStrictEqual(await b.sync.push_local_changes(), [scheme])
  assert.deepStrictEqual(await b.sync.diff(), [{ key: icons, local: "'Adwaita'", remote: "'Papirus'" }])
})

test('an edit right after applying a new key is sent, not undone', async function (t) {
  const [a, b] = await make_sync_devices(t)
  await a.dconf.write(scheme, "'prefer-dark'")
  await a.sync.push_local_changes()
  await until(async () => (await b.store.get(scheme))?.value === "'prefer-dark'")
  await b.sync.apply(await b.sync.diff())
  await b.dconf.write(scheme, "'prefer-light'")
  assert.deepStrictEqual(await b.sync.push_local_changes(), [scheme])
})

test('a change made here and not sent yet is not undone by diff', async function (t) {
  const [a] = await make_sync_devices(t)
  await a.dconf.write(scheme, "'prefer-dark'")
  await a.sync.push_local_changes()
  await a.dconf.write(scheme, "'prefer-light'")
  assert.deepStrictEqual(await a.sync.diff(), [])
})

test('denied keys and local file paths are never sent', async function (t) {
  const [a] = await make_sync_devices(t)
  await a.dconf.write('/org/gnome/shell/extensions/dash-to-dock/preferred-monitor', '0')
  await a.dconf.write('/org/gnome/shell/extensions/x/image', "'file:///home/me/a.png'")
  await a.dconf.write('/org/gnome/desktop/privacy/remember-recent-files', 'false')
  assert.deepStrictEqual(await a.sync.push_local_changes(), [])
  assert.deepStrictEqual(await a.store.read_all(), {})
})

test('rollback puts back the old value on this device only, the change shows up in diff again', async function (t) {
  const [a, b] = await make_sync_devices(t)
  await b.dconf.write(scheme, "'default'")
  await b.sync.push_local_changes()
  await until(async () => (await a.store.get(scheme))?.value === "'default'")
  await a.dconf.write(scheme, "'default'")
  await a.sync.push_local_changes()
  await a.dconf.write(scheme, "'prefer-dark'")
  await a.sync.push_local_changes()
  await until(async () => (await b.store.get(scheme))?.value === "'prefer-dark'")
  const id = await b.sync.apply(await b.sync.diff())
  assert.deepStrictEqual(await b.backup.list(), [id])
  await b.sync.rollback()
  assert.strictEqual(await b.dconf.read(scheme), "'default'")
  assert.deepStrictEqual(await b.sync.push_local_changes(), []) // the rollback is not sent to the others
  assert.strictEqual((await a.store.get(scheme)).value, "'prefer-dark'")
  assert.deepStrictEqual(await b.sync.diff(), [{ key: scheme, local: "'default'", remote: "'prefer-dark'" }])
})

test('a reset on one device resets the key on the other', async function (t) {
  const [a, b] = await make_sync_devices(t)
  await a.dconf.write(scheme, "'prefer-dark'")
  await a.sync.push_local_changes()
  await until(async () => (await b.store.get(scheme))?.value === "'prefer-dark'")
  await b.sync.apply(await b.sync.diff())
  await a.dconf.reset(scheme)
  assert.deepStrictEqual(await a.sync.push_local_changes(), [scheme])
  await until(async () => (await b.store.get(scheme))?.value === null)
  await b.sync.apply(await b.sync.diff())
  assert.strictEqual(await b.dconf.read(scheme), null)
})

test('an excluded key is not applied here', async function (t) {
  const [a, b] = await make_sync_devices(t)
  await b.rules.exclude(scheme)
  await a.dconf.write(scheme, "'prefer-dark'")
  await a.sync.push_local_changes()
  await until(async () => (await b.store.get(scheme))?.value === "'prefer-dark'")
  assert.deepStrictEqual(await b.sync.diff(), [])
  await b.rules.load()
  assert.deepStrictEqual(b.rules.list_excludes(), [scheme]) // saved in the local rules file
})

/***************************************
HELPERS
***************************************/
async function make_sync_devices (t) {
  const stores = await make_devices(t, 2)
  const devices = []
  for (const store of stores) devices.push(await make_sync_device(t, store))
  return devices
}

// every device gets its own dbus session and dconf database
async function make_sync_device (t, store) {
  const session = start_extra_session()
  t.after(session.stop)
  const dir = temp_dir()
  const dconf = gnome_dconf({ env: session.env })
  const rules = sync_rules({ file: path.join(dir, 'rules.json') })
  const backup = safety_backup({ dir: path.join(dir, 'backups'), dconf })
  const sync = settings_sync({ dconf, store, rules, backup, file: path.join(dir, 'synced.json') })
  await rules.load()
  await sync.load()
  return { dconf, store, rules, backup, sync }
}
