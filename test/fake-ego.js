const http = require('http')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { temp_dir } = require('./helpers.js')

module.exports = start_fake_ego

// a local stand in for extensions.gnome.org that serves packed fake extensions.
// like the real one it hands out the newest version even when it does not fit the asked shell version
async function start_fake_ego (extensions) {
  const dir = temp_dir()
  const zips = {}
  for (const { uuid, shell } of extensions) zips[uuid] = pack_extension({ dir, uuid, shell })
  const server = http.createServer((req, res) => answer({ req, res, zips }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const requests = []
  server.on('request', req => requests.push(req.url))
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() }
}

function answer ({ req, res, zips }) {
  const url = new URL(req.url, 'http://x')
  const uuid = url.searchParams.get('uuid')
  if (url.pathname === '/extension-info/' && zips[uuid]) return res.end(JSON.stringify({ uuid, download_url: `/download/${uuid}.zip` }))
  const download = url.pathname.match(/^\/download\/(.+)\.zip$/)
  if (download && zips[download[1]]) return res.end(fs.readFileSync(zips[download[1]]))
  res.statusCode = 404
  res.end('{}')
}

function pack_extension ({ dir, uuid, shell }) {
  const source = path.join(dir, 'source', uuid)
  fs.mkdirSync(source, { recursive: true })
  fs.writeFileSync(path.join(source, 'metadata.json'), JSON.stringify({ uuid, name: uuid, description: 'test', 'shell-version': shell, version: 1 }))
  fs.writeFileSync(path.join(source, 'extension.js'), 'export default class Test { enable () {} disable () {} }\n')
  execFileSync('gnome-extensions', ['pack', '--force', '--out-dir=' + dir, source])
  return path.join(dir, uuid + '.shell-extension.zip')
}
