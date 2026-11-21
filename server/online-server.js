// 友人対戦用の小さな中継サーバー（Node.js だけで動く。追加のインストール不要）
//   node server/online-server.js            … http://localhost:8787 で起動
//   PORT=9000 node server/online-server.js  … ポートを変える
// 外から入ってもらうときは、別のウィンドウでトンネルを開く（例）:
//   cloudflared tunnel --url http://localhost:8787
// サーバーは「操作と選択」を相手に中継するだけ。対戦の処理は両方のブラウザで同じように進む。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 8787;
const ROOT = path.resolve(__dirname, '..');
const rooms = new Map(); // code -> { box: [[],[]], seq: [0,0], waiters: [[],[]], last }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (d) => {
      n += d.length;
      if (n > 5 * 1024 * 1024) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function flush(room, to) {
  const ws = room.waiters[to];
  room.waiters[to] = [];
  for (const w of ws) w();
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  try {
    if (u.pathname === '/api/room' && req.method === 'POST') {
      const code = newCode();
      rooms.set(code, { box: [[], []], seq: [0, 0], waiters: [[], []], last: Date.now() });
      return json(res, 200, { room: code });
    }
    if (u.pathname === '/api/send' && req.method === 'POST') {
      const room = rooms.get(String(u.searchParams.get('room') || '').toUpperCase());
      const from = +u.searchParams.get('from');
      if (!room || (from !== 0 && from !== 1)) return json(res, 404, { error: '部屋がありません' });
      const data = JSON.parse(await readBody(req));
      const to = 1 - from;
      room.last = Date.now();
      room.box[to].push({ seq: ++room.seq[to], data });
      flush(room, to);
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/poll' && req.method === 'GET') {
      const room = rooms.get(String(u.searchParams.get('room') || '').toUpperCase());
      const me = +u.searchParams.get('me');
      const since = +u.searchParams.get('since') || 0;
      if (!room || (me !== 0 && me !== 1)) return json(res, 404, { error: '部屋がありません' });
      room.last = Date.now();
      const take = () => room.box[me].filter((m) => m.seq > since);
      let msgs = take();
      if (!msgs.length) {
        await new Promise((r) => {
          const t = setTimeout(r, 20000);
          room.waiters[me].push(() => {
            clearTimeout(t);
            r();
          });
          req.on('close', () => {
            clearTimeout(t);
            r();
          });
        });
        msgs = take();
      }
      return json(res, 200, { msgs });
    }
    // 画面のファイル（private/ と .git は出さない）
    if (req.method !== 'GET') return json(res, 405, { error: 'method' });
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const f = path.resolve(ROOT, '.' + p);
    const rel = path.relative(ROOT, f);
    if (rel.startsWith('..') || /^(private|\.git|server)([\\/]|$)/.test(rel)) {
      res.writeHead(404);
      return res.end('not found');
    }
    fs.readFile(f, (err, buf) => {
      if (err) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

// 6時間使われていない部屋は消す
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms) if (now - r.last > 6 * 3600 * 1000) rooms.delete(k);
}, 600000).unref();

server.listen(PORT, () => {
  console.log(`友人対戦サーバー: http://localhost:${PORT}`);
  console.log('外から入ってもらうには、別のウィンドウで例えば次を実行してください:');
  console.log(`  cloudflared tunnel --url http://localhost:${PORT}`);
});
