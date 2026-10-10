#!/usr/bin/env node
const os = require('os')
const path = require('path')
const readline = require('readline/promises')
const sync_device = require('sync-device')

const usage = `gnome-hypersync: keep your GNOME setup in sync between your own machines, peer to peer

  init [--name=<device>]       set up the first device
  invite                       print an invite code for a new device, then keep syncing
  join <code> [--name=<dev>]   pair this device with an invite code, then keep syncing
  run [--yes]                  keep syncing (asks before applying, --yes applies without asking)
  diff                         show what the other devices changed that this one doesnt have
  apply [--yes]                apply those changes (makes a backup first)
  backups                      list backups
  rollback [<id>]              put back the values from a backup (the newest by default)
  devices                      list paired devices
  remove <device key>          remove a device
  exclude <key or dir/>        never sync this key or dir on this device
  include <key or dir/>        undo an exclude
  excludes                     list excludes`

const args = process.argv.slice(2)
const flags = Object.fromEntries(args.filter(arg => arg.startsWith('--')).map(read_flag))
const [command, param] = args.filter(arg => !arg.startsWith('--'))
const dir = process.env.GNOME_HYPERSYNC_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'gnome-hypersync')
const bootstrap = process.env.GNOME_HYPERSYNC_BOOTSTRAP ? process.env.GNOME_HYPERSYNC_BOOTSTRAP.split(',') : null // only for tests
const device = sync_device({ dir, bootstrap })
const commands = { init, invite, join, run, diff, apply, backups, rollback, devices, remove, exclude, include, excludes }
const keeps_running = ['invite', 'join', 'run']

main().catch(on_error)

async function main () {
  if (!commands[command]) return console.log(usage)
  process.on('SIGINT', stop)
  await commands[command]()
  if (!keeps_running.includes(command)) await device.close()
}

/***************************************
COMMANDS
***************************************/
async function init () {
  await device.init(flags.name || os.hostname())
  console.log(`set up in ${dir}, now run \`gnome-hypersync invite\` here and \`gnome-hypersync join <code>\` on the other device`)
}

function invite () { return device.invite({ on_code: print_code, on_request: ask_digits, confirm }) }
function join () { return device.join({ code: required(param, 'the invite code'), name: flags.name || os.hostname(), on_digits: print_digits, confirm }) }

async function run () {
  await device.open()
  await device.run({ confirm })
}

async function diff () {
  await device.open()
  print_changes(await device.sync.diff())
}

async function apply () {
  await device.open()
  const changes = await device.sync.diff()
  if (!changes.length) return console.log('nothing to apply')
  if (!(await confirm(changes))) return
  console.log(`applied, undo with: gnome-hypersync rollback ${await device.sync.apply(changes)}`)
}

async function backups () { for (const id of await device.backup.list()) console.log(id) }

async function rollback () {
  await device.open()
  const changes = await device.sync.rollback(param)
  console.log(`put back ${changes.length} value(s), they show up in \`gnome-hypersync diff\` again`)
}

async function devices () {
  await device.open()
  const list = await device.settings.list_devices()
  for (const key in list) console.log(`${key}  ${list[key].name}${key === device.settings.writer_key.toString('hex') ? '  (this device)' : ''}`)
}

async function remove () {
  await device.open()
  await device.settings.remove_device(required(param, 'the device key (see `gnome-hypersync devices`)'))
  console.log('removed, the other devices see it when they connect')
}

async function exclude () {
  await device.rules.load()
  await device.rules.exclude(required(param, 'a key or a dir ending with /'))
}

async function include () {
  await device.rules.load()
  await device.rules.include(required(param, 'a key or a dir ending with /'))
}

async function excludes () {
  await device.rules.load()
  for (const excluded of device.rules.list_excludes()) console.log(excluded)
}

/***************************************
QUESTIONS AND PRINTING
***************************************/
async function confirm (changes) {
  print_changes(changes)
  if (flags.yes) return true
  return (await ask(`apply ${changes.length} change(s)? [y/N] `)).trim().toLowerCase() === 'y'
}

function print_changes (changes) {
  if (!changes.length) return console.log('no changes from the other devices')
  for (const change of changes) console.log(`  ${change.key}\n    ${change.local ?? '(not set)'}  ->  ${change.remote ?? '(not set)'}`)
}

function print_code (code) { console.log(`invite code (use it once, on the new device):\n  gnome-hypersync join ${code}`) }
function print_digits (digits) { console.log(`type these digits on the other device: ${digits}`) }
function ask_digits ({ name }) { return ask(`"${name}" wants to pair, type the digits it shows: `) }

async function ask (question) {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await terminal.question(question)
  terminal.close()
  return answer
}

// --yes -> ['yes', true], --name=desk -> ['name', 'desk']
function read_flag (arg) {
  const [name, value = true] = arg.slice(2).split('=')
  return [name, value]
}

function required (value, what) {
  if (!value) throw new Error('missing ' + what)
  return value
}

async function stop () {
  await device.close()
  process.exit(0)
}

function on_error (err) {
  console.error('error: ' + err.message)
  process.exit(1)
}
