// 公式カードページからの取り込み
// ブラウザの制限で、このツールから公式サイトを直接読むことはできない。
// そこで「公式ページで押すブックマーク（ブックマークレット）」が、そのページの内容を
// このツールへ送る（または クリップボードにコピーする）。読むのはあなたのブラウザ自身。
(function (G) {
  'use strict';

  // 公式ページ上で動くコード（ブックマークレット本体）
  // ・カード詳細ページ → そのカードを取り込む
  // ・カード一覧／検索結果ページ → 表示中のカードを順番に読んで、まとめて取り込む
  function bookmarkletSource() {
    /* eslint-disable */
    var q = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
    var txt = function (el) {
      if (!el) return '';
      var c = el.cloneNode(true);
      q('img', c).forEach(function (i) { i.replaceWith(document.createTextNode(i.alt ? i.alt : '')); });
      var lis = q('li', c);
      if (lis.length) return lis.map(function (l) { return (l.innerText || l.textContent).replace(/\s*\n\s*/g, '\n').trim(); }).filter(Boolean).join('\n');
      return ((c.innerText || c.textContent) || '').trim();
    };
    var extract = function (doc, url) {
      var h = doc.querySelector('.card-name');
      var nameRaw = '';
      if (h) { var hc = h.cloneNode(true); q('.packname', hc).forEach(function (p) { p.remove(); }); nameRaw = hc.textContent.trim(); }
      var names = nameRaw.split(/\s+[／\/]\s+|\s*／\s*/);
      var col = function (cls) { return q('td.' + cls, doc).map(txt); };
      var types = col('type'), civs = col('civil'), pows = col('power'), costs = col('cost'), races = col('race'), skills = col('skills'), flavors = col('flavor');
      var n = Math.max(types.length, 1), sides = [];
      for (var i = 0; i < n; i++) sides.push({ name: names[i] || names[0] || '', type: types[i] || '', civil: civs[i] || '', power: pows[i] || '', cost: costs[i] || '', race: races[i] || '', text: skills[i] || '', flavor: flavors[i] || '' });
      var img = doc.querySelector('.card-img img');
      return { app: 'dmsolo-official', url: url, image: img ? new URL(img.getAttribute('src'), url).href : '', sides: sides };
    };
    var send = function (data, msg) {
      var sent = false;
      try { if (window.opener) { window.opener.postMessage(data, '*'); sent = true; } } catch (e) {}
      var json = JSON.stringify(data);
      var done = function (copied) { alert(msg + (sent ? 'ツールに送りました。' : '') + (copied && !sent ? '取り込みデータをコピーしました。ツールの「貼り付けて追加」に貼ってください。' : '')); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(function () { done(true); }, function () { if (!sent) prompt('このデータをコピーしてツールに貼ってください', json); else done(false); });
      else if (!sent) prompt('このデータをコピーしてツールに貼ってください', json); else done(false);
    };
    if (document.querySelector('.card-itself')) { send(extract(document, location.href), ''); return; }
    // 一覧ページ：表示中のカード詳細へのリンクを集める
    var seen = {}, links = [];
    q('a[href*="/card/detail/?id="]').forEach(function (a) { var u = new URL(a.getAttribute('href'), location.href).href; if (!seen[u]) { seen[u] = 1; links.push(u); } });
    if (!links.length) { alert('このページにはカードが見つかりません。カード詳細ページか、カード一覧（検索結果）ページで押してください。'); return; }
    if (!confirm('このページに表示されている' + links.length + '枚のカードを取り込みますか？（1枚ずつ読むので少し時間がかかります）')) return;
    var out = [], k = 0, title = document.title;
    var next = function () {
      if (k >= links.length) { document.title = title; send({ app: 'dmsolo-official-batch', cards: out }, out.length + '枚読み込みました。'); return; }
      var u = links[k++];
      document.title = '取り込み中 ' + k + '/' + links.length;
      fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        if (doc.querySelector('.card-name')) out.push(extract(doc, u));
      }).catch(function () {}).then(function () { setTimeout(next, 400); });
    };
    next();
    /* eslint-enable */
  }

  function bookmarkletHref() {
    const src = '(' + bookmarkletSource.toString() + ')()';
    const body = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l)) // 行コメントを消す
      .join(' ');
    return 'javascript:' + encodeURIComponent(body);
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
    // 「A / B」のような両面カードの名前を、それぞれの面に分ける
    if (sides.length > 1) {
      const parts = String(sides[0].name).split(/\s+[／\/]\s+|\s*／\s*/);
      if (parts.length === sides.length) sides = sides.map((x, i) => ({ ...x, name: parts[i] }));
    }
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
