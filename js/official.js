// 公式カードページからの取り込み
// ブラウザの制限で、このツールから公式サイトを直接読むことはできない。
// そこで「公式ページで押すブックマーク（ブックマークレット）」が、そのページの内容を
// このツールへ送る（または クリップボードにコピーする）。読むのはあなたのブラウザ自身。
(function (G) {
  'use strict';

  // 公式ページ上で動くコード（ブックマークレット本体）
  function bookmarkletSource() {
    /* eslint-disable */
    var q = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
    var txt = function (el) {
      if (!el) return '';
      var c = el.cloneNode(true);
      q('img', c).forEach(function (i) { i.replaceWith(document.createTextNode(i.alt ? i.alt : '')); });
      var lis = q('li', c);
      if (lis.length) return lis.map(function (l) { return l.innerText.replace(/\s*\n\s*/g, '\n').trim(); }).filter(Boolean).join('\n');
      return (c.innerText || '').trim();
    };
    var h = document.querySelector('.card-name');
    var nameRaw = '';
    if (h) { var hc = h.cloneNode(true); q('.packname', hc).forEach(function (p) { p.remove(); }); nameRaw = hc.textContent.trim(); }
    var names = nameRaw.split(/\s*[／]\s*/);
    var col = function (cls) { return q('td.' + cls).map(txt); };
    var types = col('type'), civs = col('civil'), pows = col('power'), costs = col('cost'), races = col('race'), skills = col('skills'), flavors = col('flavor');
    var n = Math.max(types.length, 1);
    var sides = [];
    for (var i = 0; i < n; i++) {
      sides.push({ name: names[i] || names[0] || '', type: types[i] || '', civil: civs[i] || '', power: pows[i] || '', cost: costs[i] || '', race: races[i] || '', text: skills[i] || '', flavor: flavors[i] || '' });
    }
    var img = document.querySelector('.card-img img');
    var data = { app: 'dmsolo-official', url: location.href, image: img ? img.src : '', sides: sides };
    var json = JSON.stringify(data);
    var sent = false;
    try { if (window.opener) { window.opener.postMessage(data, '*'); sent = true; } } catch (e) {}
    var done = function (copied) {
      alert((sent ? 'ツールに送りました。' : '') + (copied ? '取り込みデータをコピーしました。' + (sent ? '' : 'ツールの「貼り付けて追加」に貼ってください。') : ''));
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(function () { done(true); }, function () { if (!sent) prompt('このデータをコピーしてツールに貼ってください', json); else done(false); });
    else if (!sent) prompt('このデータをコピーしてツールに貼ってください', json); else done(false);
    /* eslint-enable */
  }

  function bookmarkletHref() {
    const src = '(' + bookmarkletSource.toString() + ')()';
    return 'javascript:' + encodeURIComponent(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*/g, ' '));
  }

  // URLのIDから画像URLを作る（例: ?id=dm26ex4-011）
  function idFromUrl(url) {
    const m = String(url || '').match(/[?&]id=([a-z0-9-]+)/i);
    return m ? m[1].toLowerCase() : null;
  }
  function imageFromUrl(url) {
    const id = idFromUrl(url);
    return id ? `https://dm.takaratomy.co.jp/wp-content/card/cardimage/${id}.jpg` : '';
  }

  const CIV = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature', ゼロ: 'zero', 無色: 'zero' };
  function mapType(t) {
    t = String(t || '');
    if (/タマシード/.test(t)) return 'tamaseed';
    if (/城/.test(t)) return 'castle';
    if (/フィールド/.test(t)) return 'field';
    if (/呪文/.test(t) && !/クリーチャー/.test(t)) return 'spell';
    return 'creature';
  }
  const num = (s) => {
    const m = String(s || '').normalize('NFKC').match(/\d+/);
    return m ? +m[0] : null;
  };

  // 取り込みデータ → このツールのカード
  function toCard(data) {
    let sides = (data.sides || []).filter((s) => s.name || s.text);
    if (!sides.length) throw new Error('カードの情報が見つかりませんでした');
    // ハイパーモードを持つカードは、同じ名前・同じコストの2面として載っている → 1枚にまとめる
    if (sides.length === 2 && (sides[0].name === sides[1].name || !sides[1].name) && sides[0].cost === sides[1].cost && mapType(sides[1].type) !== 'spell') {
      const base = sides[0].text.split('\n').map((x) => x.trim());
      const extra = sides[1].text.split('\n').map((x) => x.trim()).filter((x) => x && !base.includes(x));
      const hp = num(sides[1].power);
      sides = [{ ...sides[0], text: sides[0].text + (extra.length ? `\nハイパーモード${hp ? ' ' + hp : ''}\n` + extra.join('\n') : '') }];
    }
    const main = sides.find((s) => mapType(s.type) !== 'spell') || sides[0];
    const other = sides.find((s) => s !== main);
    const type = mapType(main.type);
    const card = {
      name: main.name.trim(),
      civs: String(main.civil)
        .split(/[\/／・\s]+/)
        .map((c) => CIV[c])
        .filter(Boolean),
      cost: num(main.cost) ?? 0,
      type,
      power: type === 'creature' ? num(main.power) : null,
      races: String(main.race)
        .split(/[\/／]+/)
        .map((r) => r.trim())
        .filter(Boolean),
      text: main.text || '',
      flavor: main.flavor || '',
      evolution: /進化/.test(main.type) ? (/NEO/.test(main.type) ? 'neo' : 'evo') : '',
      officialUrl: data.url || '',
      imageUrl: data.image || imageFromUrl(data.url),
      twin: null,
    };
    if (other) card.twin = { name: other.name.trim(), cost: num(other.cost) ?? 0, text: other.text || '', type: mapType(other.type) };
    return card;
  }

  G.Official = { bookmarkletHref, idFromUrl, imageFromUrl, toCard };
})(window);
