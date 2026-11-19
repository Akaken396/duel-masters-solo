// AI同士で対戦させて、例外が出ないか・決着がつくかを確認する
const path = require('path');
const TP = require(path.join(__dirname, '../js/textparse.js'));
require(path.join(__dirname, '../js/cardscripts.js'));
const AI = require(path.join(__dirname, '../js/ai.js'));
const { Game } = require(path.join(__dirname, '../js/engine.js'));
const S = require(path.join(__dirname, '../js/samples.js'));
const byName = Object.fromEntries(S.cards.map((c) => [c.name, c]));
for (const c of S.cards) {
  const p = TP.parseCard(c);
  console.log(c.name.padEnd(14, '　'), TP.describe(p).join(' / '), p.manual.length ? ' [手動] ' + p.manual.join('/') : '');
}
const deck = (d) => d.list.split('\n').flatMap((l) => { const m = l.match(/^(\d+)\s+(.+)$/); return Array(+m[1]).fill(byName[m[2].trim()]); });
let seed = 1; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
(async () => {
  const wins = {}; let turns = 0; const N = +process.argv[2] || 200;
  for (let i = 0; i < N; i++) {
    const a = S.decks[i % 3], b = S.decks[(i + 1) % 3];
    if (deck(a).length !== 40 || deck(b).length !== 40) throw new Error('deck size');
    const g = new Game({ decks: [deck(a), deck(b)], names: [a.name, b.name], ai: [true, true], first: i % 2, rng, AI });
    const w = await g.run();
    if (w == null) { console.log(g.logs.slice(-30).join('\n')); throw new Error('no winner'); }
    const k = g.p[w].name + ' / ' + g.endReason; wins[k] = (wins[k] || 0) + 1; turns += g.turn;
    if (i === 0) console.log(g.logs.slice(0, 60).join('\n'));
  }
  console.log(wins, 'avg turns', (turns / N).toFixed(1));
})().catch((e) => { console.error(e); process.exit(1); });
