const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { start_extra_session } = require('./sandbox.js')
const { make_devices, until, temp_dir } = require('./helpers.js')
const gnome_dconf = require('../lib/node_modules/gnome-dconf')
const sync_rules = require('../lib/node_modules/sync-rules')
const safety_backup = require('../lib/node_modules/safety-backup')
const settings_sync = require('../lib/node_modules/settings-sync')
const shell_extensions = require('../lib/node_modules/shell-extensions')
const local_settings = require('../lib/node_modules/local-settings')
const start_fake_ego = require('./fake-ego.js')

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
  assert.ok(!is_allowed({ key: '/org/gnome/shell/extensions/burn-my-windows/active-profile', value: "'/home/me/.config/burn-my-windows/profiles/1.conf'" }))
  assert.ok(!is_allowed({ key: '/org/gnome/shell/extensions/bluetooth_battery_indicator/devices', value: '[\'{"name":"Box","mac":"AA:BB:CC:DD:EE:0F"}\']' }))
  assert.ok(is_allowed({ key: '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings', value: "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']" }))
  assert.ok(is_allowed({ key: '/org/gnome/desktop/interface/clock-format', value: "'12:30'" }))
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
  const { id } = await b.sync.apply(await b.sync.diff())
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

test('an extension enabled on one device is installed and enabled on the other', async function (t) {
  const [a, b] = await make_sync_devices(t)
  await a.extensions.write('/extensions/good@test', "'enabled'") // like the user installing it on a
  assert.deepStrictEqual(await a.sync.push_local_changes(), ['/extensions/good@test'])
  await until(async () => (await b.store.get('/extensions/good@test'))?.value === "'enabled'")
  const changes = await b.sync.diff()
  assert.deepStrictEqual(changes, [{ key: '/extensions/good@test', local: null, remote: "'enabled'" }])
  assert.deepStrictEqual((await b.sync.apply(changes)).failed, [])
  assert.deepStrictEqual(await b.extensions.read_all(), { '/extensions/good@test': "'enabled'" })
  assert.deepStrictEqual(await b.sync.push_local_changes(), [])
  assert.deepStrictEqual(await b.sync.diff(), [])
})

test('an extension that does not fit is reported, the other changes are still applied', async function (t) {
  const [a, b] = await make_sync_devices(t)
  await install_by_hand({ device: a, uuid: 'old@test', shell: ['3.38'] }) // a runs an old GNOME
  await a.dconf.write(scheme, "'prefer-dark'")
  await a.sync.push_local_changes()
  await until(async () => Object.keys(await b.store.read_all()).length === 2)
  const { failed } = await b.sync.apply(await b.sync.diff())
  assert.deepStrictEqual(failed.map(change => change.key), ['/extensions/old@test'])
  assert.match(failed[0].error, /does not support GNOME 50/)
  assert.strictEqual(await b.dconf.read(scheme), "'prefer-dark'")
  assert.deepStrictEqual((await b.sync.diff()).map(change => change.key), ['/extensions/old@test']) // still offered, not marked as synced
})

test('uninstalling an extension on one device is not sent as a removal', async function (t) {
  const [a] = await make_sync_devices(t)
  await a.extensions.write('/extensions/good@test', "'enabled'")
  await a.sync.push_local_changes()
  await fs.promises.rm(path.join(a.data_dir, 'gnome-shell', 'extensions', 'good@test'), { recursive: true })
  assert.deepStrictEqual(await a.sync.push_local_changes(), [])
  assert.strictEqual((await a.store.get('/extensions/good@test')).value, "'enabled'")
})

/***************************************
HELPERS
***************************************/
async function make_sync_devices (t) {
  const stores = await make_devices(t, 2)
  const ego = await start_fake_ego([{ uuid: 'good@test', shell: ['50'] }, { uuid: 'old@test', shell: ['3.38'] }])
  t.after(ego.close)
  const devices = []
  for (const store of stores) devices.push(await make_sync_device({ t, store, ego }))
  return devices
}

async function install_by_hand ({ device, uuid, shell }) {
  const dir = path.join(device.data_dir, 'gnome-shell', 'extensions', uuid)
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(path.join(dir, 'metadata.json'), JSON.stringify({ uuid, 'shell-version': shell }))
  await device.dconf.write('/org/gnome/shell/enabled-extensions', `['${uuid}']`)
}

// every device gets its own dbus session, dconf database and extensions folder
async function make_sync_device ({ t, store, ego }) {
  const session = start_extra_session()
  t.after(session.stop)
  const dir = temp_dir()
  const dconf = gnome_dconf({ env: session.env })
  const rules = sync_rules({ file: path.join(dir, 'rules.json') })
  const extensions = shell_extensions({ dconf, env: session.env, ego_url: ego.url, shell_version: 50 })
  const local = local_settings({ dconf, extensions, rules })
  const backup = safety_backup({ dir: path.join(dir, 'backups'), local })
  const sync = settings_sync({ local, store, rules, backup, file: path.join(dir, 'synced.json') })
  await rules.load()
  await sync.load()
  return { dconf, store, rules, backup, sync, extensions, data_dir: session.env.XDG_DATA_HOME }
}
