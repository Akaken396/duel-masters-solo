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
    // 進み具合を画面に出す
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:99999;left:12px;bottom:12px;background:#111c32;color:#fff;padding:10px 14px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5)';
    var show = function (t) { box.textContent = t; if (!box.parentNode) document.body.appendChild(box); };
    var readCard = function (u) {
      return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        return doc.querySelector('.card-name') ? extract(doc, u) : null;
      }).catch(function () { return null; });
    };
    // 取り込み済みのカードID（ツールに問い合わせる。応答がなければ空）
    var known = {};
    var askKnown = function (cb) {
      if (!window.opener) return cb();
      var done = false;
      var h = function (e) {
        if (e.data && e.data.app === 'dmsolo-known') {
          (e.data.ids || []).forEach(function (i) { known[String(i).toLowerCase()] = 1; });
          done = true; window.removeEventListener('message', h); cb();
        }
      };
      window.addEventListener('message', h);
      try { window.opener.postMessage({ app: 'dmsolo-ask-known' }, '*'); } catch (e) {}
      setTimeout(function () { if (!done) { window.removeEventListener('message', h); cb(); } }, 1500);
    };
    var idOf = function (u) { var m = String(u).match(/[?&]id=([a-z0-9-]+)/i); return m ? m[1].toLowerCase() : ''; };
    var knownCount = function () { return Object.keys(known).length; };

    // パック単位：パックの記号から、カード番号 001, 002, … を順に読む（番号が続けて見つからなくなったら終了）
    var pm = location.hash.match(/dmsolo-pack=([a-z0-9]+)/i);
    var links0 = q('[data-href*="/card/detail/?id="], a[href*="/card/detail/?id="]');
    var pack = pm ? pm[1] : (!links0.length ? prompt('取り込むパックの記号を入れてください（例: dm26ex4, dm26rp1）') : null);
    if (pack) {
      pack = pack.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!pack) return;
      askKnown(function () {
        var mine = Object.keys(known).filter(function (i) { return i.indexOf(pack + '-') === 0; }).length;
        if (!confirm('パック「' + pack + '」のカードを、番号順にすべて取り込みますか？（1枚ずつ読むので数分かかることがあります）')) return;
        var skip = mine ? confirm('このパックで取り込み済みのカードが' + mine + '枚あります。取り込み済みは飛ばしますか？\n（キャンセルを押すと、全部取り込み直します）') : false;
        var outP = [], num = 1, miss = 0, skipped = 0;
        var stepP = function () {
          if (miss >= 3 || num > 400) {
            show('パック「' + pack + '」: ' + outP.length + '枚読み込み' + (skipped ? '・' + skipped + '枚スキップ' : ''));
            if (!outP.length && !skipped) { alert('パック「' + pack + '」のカードが見つかりませんでした。記号を確かめてください（例: dm26ex4）'); return; }
            send({ app: 'dmsolo-official-batch', cards: outP, pack: pack, skipped: skipped }, 'パック「' + pack + '」の' + outP.length + '枚を読み込みました' + (skipped ? '（取り込み済み' + skipped + '枚はスキップ）' : '') + '。');
            return;
          }
          var id = pack + '-' + ('00' + num).slice(-3);
          num++;
          if (skip && known[id]) { skipped++; miss = 0; stepP(); return; }
          show('パック「' + pack + '」を取り込み中… ' + id + '（' + outP.length + '枚' + (skipped ? '・スキップ' + skipped : '') + '）');
          readCard('https://dm.takaratomy.co.jp/card/detail/?id=' + id).then(function (c) {
            if (c) { outP.push(c); miss = 0; } else miss++;
            setTimeout(stepP, 400);
          });
        };
        stepP();
      });
      return;
    }
    // 一覧ページ：カード詳細へのリンクを集める（ページ送りがあれば全ページ）
    var seen = {}, links = [];
    var addLinks = function (root, base) {
      // 公式の一覧はカード画像の data-href にリンクが入っている（普通のリンクも拾う）
      q('[data-href*="/card/detail/?id="], a[href*="/card/detail/?id="]', root).forEach(function (a) {
        var raw = a.getAttribute('data-href') || a.getAttribute('href');
        var u = new URL(raw, base).href;
        if (!seen[u]) { seen[u] = 1; links.push(u); }
      });
    };
    addLinks(document, location.href);
    if (!links.length) { alert('このページにはカードが見つかりません。カード詳細ページか、カード一覧（検索結果）ページで押してください。'); return; }
    var form = document.querySelector('form#search_cond');
    var lastPage = 1;
    q('.wp-pagenavi [data-page]').forEach(function (a) { var n = parseInt(a.getAttribute('data-page'), 10); if (n > lastPage) lastPage = n; });
    var curInput = form && form.querySelector("input[name='pagenum']");
    var curPage = curInput ? parseInt(curInput.value, 10) || 1 : 1;
    var allPages = form && lastPage > 1 && confirm('検索結果は全' + lastPage + 'ページあります。全ページを順番にめくって取り込みますか？\n（キャンセルを押すと、今表示しているページだけ取り込みます）');
    var collect = function (cb) {
      if (!allPages) return cb();
      var page = 1;
      // 公式の検索画面と同じ送り方：/card/ へ、値の入っている項目だけを送る
      var action = location.origin + '/card/';
      var buildBody = function (pg) {
        var body = new URLSearchParams();
        q('input', form).forEach(function (el) {
          var t = (el.getAttribute('type') || 'text').toLowerCase();
          var ok = t === 'text' || t === 'search' || t === 'number' || t === 'hidden' || ((t === 'checkbox' || t === 'radio') && el.checked);
          if (!ok || !el.name || el.value === '') return;
          body.append(el.name, el.name === 'pagenum' ? String(pg) : el.value);
        });
        q('select', form).forEach(function (el) { if (el.name && el.value !== '') body.append(el.name, el.value); });
        var sort = document.querySelector('#sort-area');
        if (sort) q('select,input[type=hidden]', sort).forEach(function (el) { if (el.name && el.value !== '' && !body.has(el.name)) body.append(el.name, el.value); });
        if (!body.has('pagenum')) body.append('pagenum', String(pg));
        return body.toString();
      };
      var stepPage = function () {
        if (page > lastPage) return cb();
        show('検索結果をめくっています… ' + page + '/' + lastPage + 'ページ（' + links.length + '枚）');
        if (page === curPage) { page++; return stepPage(); }
        var pg = page++;
        fetch(action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: buildBody(pg) })
          .then(function (r) { return r.text(); })
          .then(function (html) { addLinks(new DOMParser().parseFromString(html, 'text/html'), action); })
          .catch(function () {})
          .then(function () { setTimeout(stepPage, 400); });
      };
      stepPage();
    };
    collect(function () {
      askKnown(function () {
        var already = links.filter(function (u) { return known[idOf(u)]; });
        if (!confirm((allPages ? '全' + lastPage + 'ページで' : 'このページに表示されている') + links.length + '枚のカードを取り込みますか？（1枚ずつ読むので時間がかかります）')) return;
        var skip = already.length ? confirm('このうち' + already.length + '枚は取り込み済みです。飛ばしますか？\n（キャンセルを押すと、全部取り込み直します）') : false;
        var todo = skip ? links.filter(function (u) { return !known[idOf(u)]; }) : links;
        var out = [], k = 0;
        var next = function () {
          if (k >= todo.length) {
            show(out.length + '枚読み込み' + (skip ? '・' + already.length + '枚スキップ' : ''));
            send({ app: 'dmsolo-official-batch', cards: out, skipped: skip ? already.length : 0 }, out.length + '枚読み込みました' + (skip && already.length ? '（取り込み済み' + already.length + '枚はスキップ）' : '') + '。');
            return;
          }
          var u = todo[k++];
          show('取り込み中 ' + k + '/' + todo.length);
          readCard(u).then(function (c) { if (c) out.push(c); setTimeout(next, 400); });
        };
        next();
      });
    });
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
