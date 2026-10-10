const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { require_sandbox } = require('./sandbox.js')
const start_fake_ego = require('./fake-ego.js')
const gnome_dconf = require('../lib/node_modules/gnome-dconf')
const shell_extensions = require('../lib/node_modules/shell-extensions')

require_sandbox()
const dconf = gnome_dconf()
const extensions_dir = path.join(process.env.XDG_DATA_HOME, 'gnome-shell', 'extensions')

test('installs a missing extension from extensions.gnome.org and enables it', async function (t) {
  const extensions = await make_extensions(t)
  assert.deepStrictEqual(await extensions.read_all(), {})
  await extensions.write('/extensions/good@test', "'enabled'")
  assert.ok(fs.existsSync(path.join(extensions_dir, 'good@test', 'metadata.json')))
  assert.deepStrictEqual(await extensions.read_all(), { '/extensions/good@test': "'enabled'" })
  assert.strictEqual(await dconf.read('/org/gnome/shell/enabled-extensions'), "['good@test']")
})

test('disabling keeps it installed, null (removed elsewhere) only disables', async function (t) {
  const extensions = await make_extensions(t)
  await extensions.write('/extensions/good@test', "'disabled'")
  assert.deepStrictEqual(await extensions.read_all(), { '/extensions/good@test': "'disabled'" })
  await extensions.write('/extensions/good@test', "'enabled'")
  await extensions.write('/extensions/good@test', null)
  assert.deepStrictEqual(await extensions.read_all(), { '/extensions/good@test': "'disabled'" })
  assert.strictEqual(await dconf.read('/org/gnome/shell/enabled-extensions'), '@as []')
})

test('an extension that does not support this GNOME is not installed or enabled', async function (t) {
  const extensions = await make_extensions(t)
  await assert.rejects(extensions.write('/extensions/old@test', "'enabled'"), /does not support GNOME 50/)
  assert.ok(!fs.existsSync(path.join(extensions_dir, 'old@test')))
  assert.deepStrictEqual(await extensions.read_all(), {})
})

test('unknown and invalid uuids are refused', async function (t) {
  const extensions = await make_extensions(t)
  await assert.rejects(extensions.write('/extensions/nope@test', "'enabled'"), /not on extensions.gnome.org/)
  await assert.rejects(extensions.write('/extensions/..', "'enabled'"), /not a valid extension uuid/)
  await assert.rejects(extensions.write('/extensions/a/../../b', "'enabled'"), /not a valid extension uuid/)
})

test('other enabled extensions in the list are kept', async function (t) {
  const extensions = await make_extensions(t)
  await dconf.write('/org/gnome/shell/enabled-extensions', "['system@gnome']")
  await extensions.write('/extensions/good@test', "'enabled'")
  assert.strictEqual(await dconf.read('/org/gnome/shell/enabled-extensions'), "['system@gnome', 'good@test']")
})

// every test starts with no extensions installed and an empty list
async function make_extensions (t) {
  const ego = await start_fake_ego([{ uuid: 'good@test', shell: ['49', '50'] }, { uuid: 'old@test', shell: ['3.38'] }])
  t.after(ego.close)
  t.after(() => fs.promises.rm(extensions_dir, { recursive: true, force: true }))
  t.after(() => dconf.reset('/org/gnome/shell/enabled-extensions'))
  return shell_extensions({ dconf, ego_url: ego.url, shell_version: 50 })
}
