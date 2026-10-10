const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { spawn } = require('child_process')
const create_testnet = require('hyperdht/testnet')
const { start_extra_session } = require('./sandbox.js')
const { until, temp_dir } = require('./helpers.js')
const gnome_dconf = require('../lib/node_modules/gnome-dconf')

const cli_file = path.join(__dirname, '..', 'lib', 'cli.js')
const scheme = '/org/gnome/desktop/interface/color-scheme'
const icons = '/org/gnome/desktop/interface/icon-theme'

test('two devices pair and sync with the real cli', async function (t) {
  const testnet = await create_testnet(3)
  t.after(() => testnet.destroy())
  const bootstrap = testnet.bootstrap.map(node => `${node.host}:${node.port}`).join(',')
  const a = make_device(t, bootstrap)
  const b = make_device(t, bootstrap)
  await pair_and_sync({ a, b }).catch(err => { throw new Error(`${err.message}\n--- a:\n${a.log.join('')}--- b:\n${b.log.join('')}`) })
})

async function pair_and_sync ({ a, b }) {
  await a.dconf.write(scheme, "'prefer-dark'")
  assert.match(await run_cli(a, ['init', '--name=desk']), /set up in/)
  const inviting = start_cli(a, ['invite', '--yes'])
  const code = (await inviting.wait_for(/gnome-hypersync join (\S+)/))[1]
  assert.match(await run_cli(a, ['diff']), /already running/) // the store is locked while invite runs
  const joining = start_cli(b, ['join', code, '--name=laptop', '--yes'])
  const digits = (await joining.wait_for(/digits on the other device: (\w+)/))[1]
  await inviting.wait_for(/wants to pair/)
  inviting.child.stdin.write(digits + '\n')
  await inviting.wait_for(/paired with laptop/)
  await until(async () => (await b.dconf.read(scheme)) === "'prefer-dark'", 60000)
  await b.dconf.write(icons, "'Papirus'")
  await until(async () => (await a.dconf.read(icons)) === "'Papirus'", 60000)
  await joining.stop()
  await inviting.stop()
  assert.match(await run_cli(b, ['devices']), /laptop {2}\(this device\)/)
  assert.match(await run_cli(b, ['rollback']), /put back 1 value/)
  assert.strictEqual(await b.dconf.read(scheme), null)
  assert.match(await run_cli(b, ['diff']), /color-scheme/)
}

/***************************************
HELPERS
***************************************/
function make_device (t, bootstrap) {
  const session = start_extra_session()
  t.after(session.stop)
  const env = { ...session.env, GNOME_HYPERSYNC_DIR: temp_dir(), GNOME_HYPERSYNC_BOOTSTRAP: bootstrap }
  return { env, dconf: gnome_dconf({ env }), log: [], t }
}

function start_cli (device, args) {
  const child = spawn(process.execPath, [cli_file, ...args], { env: device.env, stdio: ['pipe', 'pipe', 'pipe'] })
  const output = { text: '', toString: () => `$ ${args.join(' ')}\n${output.text}\n` }
  child.stdout.on('data', data => { output.text += data })
  child.stderr.on('data', data => { output.text += data })
  device.log.push(output)
  device.t.after(() => child.kill('SIGKILL'))
  const exited = new Promise(resolve => child.on('exit', resolve))
  return { child, output, wait_for, stop }
  async function wait_for (pattern) {
    await until(() => pattern.test(output.text), 60000).catch(() => { throw new Error(`no ${pattern} in:\n${output.text}`) })
    return output.text.match(pattern)
  }
  function stop () {
    child.kill('SIGINT')
    return exited
  }
}

async function run_cli (device, args) {
  const cli = start_cli(device, args)
  await new Promise(resolve => cli.child.on('exit', resolve))
  return cli.output.text
}
