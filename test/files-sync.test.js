const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')
const { until, temp_dir } = require('./helpers.js')
const { make_sync_devices } = require('./sync-helpers.js')

const picture = '/org/gnome/desktop/background/picture-uri'
const picture_dark = '/org/gnome/desktop/background/picture-uri-dark'

test('the wallpaper image is synced and saved in its own folder', async function (t) {
  const [a, b] = await make_sync_devices(t)
  const image = await set_wallpaper(a, 'mountains.png')
  await a.dconf.write('/org/gnome/desktop/background/picture-options', "'zoom'")
  const sent = await a.sync.push_local_changes()
  assert.deepStrictEqual(sent.sort(), ['/org/gnome/desktop/background/picture-options', '/wallpaper/picture-uri', '/wallpaper/picture-uri-dark'])
  assert.strictEqual(await a.store.get(picture), null) // the file:// path itself is never sent
  await until(async () => Object.keys(await b.store.read_all()).length === 3)
  const { failed } = await b.sync.apply(await b.sync.diff())
  assert.deepStrictEqual(failed, [])
  const file = uri_path(await b.dconf.read(picture))
  assert.ok(file.startsWith(path.join(b.data_dir, 'backgrounds', 'gnome-hypersync')))
  assert.deepStrictEqual(fs.readFileSync(file), image)
  assert.strictEqual(await b.dconf.read(picture_dark), await b.dconf.read(picture))
  assert.strictEqual(await b.dconf.read('/org/gnome/desktop/background/picture-options'), "'zoom'")
  assert.deepStrictEqual(await b.sync.push_local_changes(), []) // no echo
})

test('a theme folder in use is synced, with symlinks, and nothing else is touched', async function (t) {
  const [a, b] = await make_sync_devices(t)
  make_theme(path.join(a.home, '.themes', 'Test Theme')) // old style folder in home
  make_theme(path.join(a.data_dir, 'icons', 'Test-Icons'))
  await a.dconf.write('/org/gnome/desktop/interface/gtk-theme', "'Test Theme'")
  await a.dconf.write('/org/gnome/desktop/interface/icon-theme', "'Test-Icons'")
  await a.dconf.write('/org/gnome/desktop/interface/cursor-theme', "'Adwaita'") // a system theme, not synced as a folder
  const sent = await a.sync.push_local_changes()
  assert.deepStrictEqual(sent.filter(key => key.startsWith('/themes/')).sort(), ['/themes/icons/Test-Icons', '/themes/themes/Test Theme'])
  await until(async () => (await b.store.read_all())['/themes/icons/Test-Icons'])
  assert.deepStrictEqual((await b.sync.apply(await b.sync.diff())).failed, [])
  assert.deepStrictEqual(listing(path.join(b.data_dir, 'themes', 'Test Theme')), listing(path.join(a.home, '.themes', 'Test Theme')))
  assert.deepStrictEqual(listing(path.join(b.data_dir, 'icons', 'Test-Icons')), listing(path.join(a.data_dir, 'icons', 'Test-Icons')))
  assert.strictEqual(await b.dconf.read('/org/gnome/desktop/interface/gtk-theme'), "'Test Theme'")
  assert.deepStrictEqual(await b.sync.push_local_changes(), []) // no echo
})

test('an existing different theme folder is not replaced', async function (t) {
  const [a, b] = await make_sync_devices(t)
  make_theme(path.join(a.data_dir, 'themes', 'Mine'))
  await a.dconf.write('/org/gnome/desktop/interface/gtk-theme', "'Mine'")
  await a.sync.push_local_changes()
  fs.mkdirSync(path.join(b.home, '.themes', 'Mine'), { recursive: true })
  fs.writeFileSync(path.join(b.home, '.themes', 'Mine', 'index.theme'), 'different')
  await until(async () => (await b.store.read_all())['/themes/themes/Mine'])
  const { failed } = await b.sync.apply(await b.sync.diff())
  assert.deepStrictEqual(failed.map(change => change.key), ['/themes/themes/Mine'])
  assert.match(failed[0].error, /already exists and is different/)
  assert.strictEqual(fs.readFileSync(path.join(b.home, '.themes', 'Mine', 'index.theme'), 'utf8'), 'different')
})

test('a theme archive with files outside its folder is refused', async function (t) {
  const [a, b] = await make_sync_devices(t)
  const dir = temp_dir()
  make_theme(path.join(dir, 'Evil'))
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'should never be written')
  execFileSync('tar', ['-czf', path.join(dir, 'evil.tar.gz'), '-C', dir, 'Evil', 'outside.txt'])
  await a.files.publish('/themes/themes/Evil evil-id', fs.readFileSync(path.join(dir, 'evil.tar.gz')))
  await a.store.set('/themes/themes/Evil', "'evil-id'")
  await until(async () => (await b.store.read_all())['/themes/themes/Evil'])
  const { failed } = await b.sync.apply(await b.sync.diff())
  assert.match(failed[0].error, /files outside its folder/)
  assert.ok(!fs.existsSync(path.join(b.data_dir, 'themes', 'Evil')))
  assert.ok(!fs.existsSync(path.join(b.data_dir, 'themes', 'outside.txt')))
})

/***************************************
HELPERS
***************************************/
async function set_wallpaper (device, name) {
  const image = crypto.randomBytes(200 * 1024)
  fs.writeFileSync(path.join(device.home, name), image)
  const uri = `'${pathToFileURL(path.join(device.home, name)).href}'`
  await device.dconf.write(picture, uri)
  await device.dconf.write(picture_dark, uri)
  return image
}

function make_theme (dir) {
  fs.mkdirSync(path.join(dir, 'gtk-3.0', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.theme'), '[Desktop Entry]\nName=test\n')
  fs.writeFileSync(path.join(dir, 'gtk-3.0', 'gtk.css'), '* { color: red; }\n')
  fs.writeFileSync(path.join(dir, 'gtk-3.0', 'assets', 'a.png'), crypto.randomBytes(1000))
  fs.symlinkSync('gtk-3.0', path.join(dir, 'gtk-4.0')) // a symlink to a folder
  fs.symlinkSync('a.png', path.join(dir, 'gtk-3.0', 'assets', 'b.png'))
}

function listing (dir) { return fs.readdirSync(dir, { recursive: true }).sort().map(name => name + ' ' + describe(path.join(dir, name))) }

function describe (file) {
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink()) return 'link ' + fs.readlinkSync(file)
  return stat.isDirectory() ? 'dir' : crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function uri_path (value) { return new URL(value.slice(1, -1)).pathname }
