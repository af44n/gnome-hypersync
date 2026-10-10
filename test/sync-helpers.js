const path = require('path')
const fs = require('fs')
const { start_extra_session } = require('./sandbox.js')
const { make_devices, temp_dir } = require('./helpers.js')
const start_fake_ego = require('./fake-ego.js')
const gnome_dconf = require('../lib/node_modules/gnome-dconf')
const sync_rules = require('../lib/node_modules/sync-rules')
const safety_backup = require('../lib/node_modules/safety-backup')
const settings_sync = require('../lib/node_modules/settings-sync')
const shell_extensions = require('../lib/node_modules/shell-extensions')
const wallpaper_sync = require('../lib/node_modules/wallpaper-sync')
const theme_folders = require('../lib/node_modules/theme-folders')
const shared_files = require('../lib/node_modules/shared-files')
const local_settings = require('../lib/node_modules/local-settings')

module.exports = { make_sync_devices, install_by_hand }

/***************************************
HELPERS
***************************************/
async function make_sync_devices (t) {
  const stores = await make_devices(t, 2)
  const ego = await start_fake_ego([{ uuid: 'good@test', shell: ['50'] }, { uuid: 'old@test', shell: ['3.38'] }])
  t.after(ego.close)
  const devices = []
  for (let i = 0; i < stores.length; i++) devices.push(await make_sync_device({ t, store: stores[i], corestore: stores.stores[i], ego }))
  devices.connect = stores.connect
  devices.disconnect = stores.disconnect
  return devices
}

async function install_by_hand ({ device, uuid, shell }) {
  const dir = path.join(device.data_dir, 'gnome-shell', 'extensions', uuid)
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(path.join(dir, 'metadata.json'), JSON.stringify({ uuid, 'shell-version': shell }))
  await device.dconf.write('/org/gnome/shell/enabled-extensions', `['${uuid}']`)
}

// every device gets its own dbus session, dconf database, home and data folder
async function make_sync_device ({ t, store, corestore, ego }) {
  const session = start_extra_session()
  t.after(session.stop)
  const dir = temp_dir()
  const dconf = gnome_dconf({ env: session.env })
  const rules = sync_rules({ file: path.join(dir, 'rules.json') })
  const extensions = shell_extensions({ dconf, env: session.env, ego_url: ego.url, shell_version: 50 })
  const files = shared_files({ store: corestore, settings: store, timeout: 10000 })
  t.after(files.close)
  const wallpaper = wallpaper_sync({ dconf, files, index_file: path.join(dir, 'wallpapers.json'), env: session.env })
  const themes = theme_folders({ dconf, files, env: session.env })
  const local = local_settings({ dconf, rules, sources: [extensions, wallpaper, themes] })
  const backup = safety_backup({ dir: path.join(dir, 'backups'), local })
  const sync = settings_sync({ local, store, rules, backup, file: path.join(dir, 'synced.json') })
  await rules.load()
  await sync.load()
  return { dconf, store, rules, backup, sync, extensions, files, env: session.env, data_dir: session.env.XDG_DATA_HOME, home: session.env.HOME }
}
