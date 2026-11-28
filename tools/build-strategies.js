// strategies/*.md を画面で使えるように js/strategies.js にまとめる
//   node tools/build-strategies.js
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'strategies');
const out = { base: '', decks: {} };
for (const f of fs.readdirSync(dir).sort()) {
  if (!f.endsWith('.md')) continue;
  const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r/g, '').trim();
  const name = f.replace(/\.md$/, '');
  if (name === '_基礎ルール') out.base = text;
  else out.decks[name] = text;
}
const js = `// 自動生成：node tools/build-strategies.js（元は strategies/*.md）\n(function (G) {\n  G.STRATEGIES = ${JSON.stringify(out, null, 2)};\n  if (typeof module !== 'undefined') module.exports = G.STRATEGIES;\n})(typeof globalThis !== 'undefined' ? globalThis : window);\n`;
fs.writeFileSync(path.join(__dirname, '..', 'js', 'strategies.js'), js);
console.log('基礎ルール', out.base.length, '文字 / デッキ', Object.keys(out.decks).join('、'));
