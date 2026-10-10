const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

module.exports = { make_sandbox, read_fingerprint, require_sandbox, start_extra_session }

// can be called by npm test: node test/sandbox.js <command> [args...]
if (require.main === module) run_in_sandbox(process.argv.slice(2))

/***************************************
RUN IN SANDBOX
runs the command in its own dbus session with its own dconf database,
then checks that the real dconf database did not change
***************************************/
function run_in_sandbox (command) {
  const real_config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  const before = read_fingerprint(real_config)
  const sandbox = make_sandbox()
  const child = spawn('dbus-run-session', ['--', ...command], { stdio: 'inherit', env: sandbox.env })
  child.on('exit', code => on_sandbox_exit({ code, real_config, before, sandbox }))
}

function on_sandbox_exit ({ code, real_config, before, sandbox }) {
  const after = read_fingerprint(real_config)
  fs.rmSync(sandbox.dir, { recursive: true, force: true })
  if (after !== before) {
    console.error('\n!!! the real dconf database changed during the tests !!!')
    process.exit(1)
  }
  console.log('\nreal dconf database unchanged')
  process.exit(code)
}

/***************************************
MAKE SANDBOX
temp XDG_CONFIG_HOME (dconf database) and XDG_RUNTIME_DIR (dconf change notices)
***************************************/
function make_sandbox () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnome-hypersync-sandbox-'))
  fs.mkdirSync(path.join(dir, 'config'))
  fs.mkdirSync(path.join(dir, 'runtime'), { mode: 0o700 })
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_RUNTIME_DIR: path.join(dir, 'runtime'), GNOME_HYPERSYNC_SANDBOX: dir, GNOME_HYPERSYNC_REAL_BUS: process.env.DBUS_SESSION_BUS_ADDRESS || '' }
  return { dir, env }
}

/***************************************
READ FINGERPRINT
hash of `dconf dump /` on the current bus + hash and mtime of the database file
***************************************/
function read_fingerprint (config_dir) {
  const db_file = path.join(config_dir, 'dconf', 'user')
  const dump = execFileSync('dconf', ['dump', '/'])
  const file = fs.existsSync(db_file) ? fs.readFileSync(db_file) : ''
  const mtime = fs.existsSync(db_file) ? fs.statSync(db_file).mtimeMs : 0
  return [hash(dump), hash(file), mtime].join(' ')
}

/***************************************
REQUIRE SANDBOX
tests that write to dconf call this first
***************************************/
function require_sandbox () {
  const dir = process.env.GNOME_HYPERSYNC_SANDBOX
  const ok = dir && process.env.XDG_CONFIG_HOME === path.join(dir, 'config') && process.env.DBUS_SESSION_BUS_ADDRESS !== process.env.GNOME_HYPERSYNC_REAL_BUS
  if (!ok) throw new Error('not in a sandbox, run the tests with `npm test`')
  return dir
}

/***************************************
START EXTRA SESSION
one more private dbus session with its own dconf database, for a second device in the same test
***************************************/
function start_extra_session () {
  require_sandbox()
  const sandbox = make_sandbox()
  const out = execFileSync('dbus-daemon', ['--session', '--fork', '--print-address=1', '--print-pid=1'], { env: sandbox.env }).toString().trim().split('\n')
  const env = { ...sandbox.env, DBUS_SESSION_BUS_ADDRESS: out[0] }
  return { env, stop: () => stop_extra_session({ pid: Number(out[1]), dir: sandbox.dir }) }
}

function stop_extra_session ({ pid, dir }) {
  process.kill(pid)
  fs.rmSync(dir, { recursive: true, force: true })
}

function hash (data) { return crypto.createHash('sha256').update(data).digest('hex') }
