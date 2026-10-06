// Serveur local temporaire pour le générateur de figurines (src/proto/film-perso/icons.html?save) :
// reçoit un data-URL PNG (POST /<id>) et l'écrit dans public/perso/icons/<id>.png.
// Usage : node scripts/save-icons.cjs   (puis ouvrir icons.html?yaw=0&t=0.25&save dans le navigateur)
const http = require('http')
const fs = require('fs')
const path = require('path')
const OUT = path.join(__dirname, '..', 'public', 'perso', 'icons')
fs.mkdirSync(OUT, { recursive: true })
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') { res.end(); return }
  const id = req.url.replace(/[^a-z0-9]/gi, '')
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    const m = /^data:image\/png;base64,(.+)$/.exec(body)
    if (!m || !id) { res.statusCode = 400; res.end('bad'); return }
    fs.writeFileSync(path.join(OUT, id + '.png'), Buffer.from(m[1], 'base64'))
    console.log('saved', id)
    res.end('ok')
  })
}).listen(5299, () => console.log('listening 5299'))
