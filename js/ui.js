// 画面まわり
(function () {
  'use strict';
  const { Game, CIV_LABEL, TYPE_LABEL, NON_CREATURE, parsed, twinDef } = Engine;
  const $ = (s, r = document) => r.querySelector(s);
  const CIVS = ['light', 'water', 'darkness', 'fire', 'nature', 'zero'];
  const CIV_COLOR = { light: '#e9cf4a', water: '#3d8fe0', darkness: '#6b4c8a', fire: '#e0503d', nature: '#3fa35a', zero: '#9aa3ad' };

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  function civBg(civs) {
    const cs = (civs && civs.length ? civs : ['zero']).map((c) => CIV_COLOR[c] || '#777');
    if (cs.length === 1) return `linear-gradient(160deg, ${cs[0]} 0%, #1a1a1a 130%)`;
    const step = 100 / cs.length;
    return `linear-gradient(120deg, ${cs.map((c, i) => `${c} ${i * step}%, ${c} ${(i + 1) * step}%`).join(', ')})`;
  }

  // ===== カード表示 =====
  function cardFace(def, opts = {}) {
    const c = el('div', { class: 'card' + (opts.click ? ' click' : '') });
    const src = Store.imageFor(def);
    const face = () =>
      el(
        'div',
        { class: 'face', style: { background: civBg(def.civs) } },
        el('div', { class: 'top' }, el('div', { class: 'cost', text: def.cost ?? '' }), el('div', { class: 'name', text: def.name })),
        el('div', { class: 'txt', text: def.text || '' }),
        el('div', { class: 'pw', text: NON_CREATURE.includes(def.type) ? TYPE_LABEL[def.type] : def.power ?? '' })
      );
    if (src) {
      const img = el('img', { src, alt: def.name, draggable: 'false', loading: 'lazy' });
      img.onerror = () => {
        img.remove();
        c.prepend(face());
      };
      c.append(img);
      if (opts.nameBadge) c.append(el('div', { class: 'badge nm', text: def.name }));
    } else c.append(face());
    c.addEventListener('mouseenter', () => showZoom(def, opts.inst));
    return c;
  }

  function cardBack(label) {
    const c = el('div', { class: 'card back' });
    if (label != null) c.append(el('div', { class: 'num', text: label }));
    return c;
  }

  function uniqKnown(p) {
    const seen = new Set();
    return (p.known || []).filter((k) => !seen.has(k.name) && seen.add(k.name));
  }
  function officialUrl(def) {
    if (def.officialUrl) return def.officialUrl;
    return 'https://www.google.com/search?q=' + encodeURIComponent(`site:dm.takaratomy.co.jp ${def.name}`);
  }
  function showZoom(def, inst) {
    const z = $('#zoom');
    if (!z) return;
    z.innerHTML = '';
    z.append(cardFace(def));
    const p = parsed(def);
    const civ = (def.civs || []).map((c) => CIV_LABEL[c]).join('/');
    const pw = inst && game ? game.power(inst) : def.power;
    z.append(
      el('div', {}, el('b', { text: def.name })),
      el('div', { class: 'muted', text: `${civ}　コスト${def.cost}　${NON_CREATURE.includes(def.type) ? TYPE_LABEL[def.type] : 'パワー' + (pw ?? '')}　${(def.races || []).join(' / ')}` }),
      el('div', { class: 'ztext', text: def.text || '（テキスト未登録）' })
    );
    if (def.flavor) z.append(el('div', { class: 'zflavor', text: def.flavor }));
    const auto = TextParse.describe(p);
    if (auto.length) z.append(el('div', { class: 'zauto', text: '自動: ' + auto.join(' / ') }));
    if (p.manual.length) z.append(el('div', { class: 'zman', text: '手動: ' + p.manual.join(' / ') }));
    for (const k of uniqKnown(p)) z.append(el('div', { class: 'zknown' }, el('b', { text: k.name }), '：' + k.desc));
    if (!String(def.id || '').startsWith('s-')) {
      z.append(el('a', { class: 'zlink', href: officialUrl(def), target: '_blank', rel: 'noopener noreferrer', text: def.officialUrl ? '公式ページで見る ↗' : '公式サイトで探す ↗' }));
    }
    const t = twinDef(def);
    if (t) {
      const tp = parsed(t);
      z.append(el('hr'), el('div', {}, el('b', { text: t.name }), el('span', { class: 'muted', text: `　呪文 コスト${t.cost}` })), el('div', { class: 'ztext', text: t.text || '（テキスト未登録）' }));
      const ta = TextParse.describe(tp);
      if (ta.length) z.append(el('div', { class: 'zauto', text: '自動: ' + ta.join(' / ') }));
      if (tp.manual.length) z.append(el('div', { class: 'zman', text: '手動: ' + tp.manual.join(' / ') }));
    }
  }

  // ===== メニュー =====
  const menu = $('#menu');
  function openMenu(x, y, title, items) {
    menu.innerHTML = '';
    if (title) menu.append(el('div', { class: 'mh', text: title }));
    for (const it of items) {
      if (!it) continue;
      menu.append(
        el('button', {
          text: it.label,
          disabled: it.disabled,
          onclick: (e) => {
            e.stopPropagation();
            closeMenu();
            it.run();
          },
        })
      );
    }
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  }
  function closeMenu() {
    menu.hidden = true;
  }
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  document.addEventListener('contextmenu', (e) => {
    if (!menu.contains(e.target)) closeMenu();
  });

  // ===== モーダル =====
  const modal = $('#modal');
  const modalBox = $('.modal-box', modal);
  function openModal(...kids) {
    modalBox.innerHTML = '';
    modalBox.append(...kids);
    modal.hidden = false;
  }
  function closeModal() {
    modal.hidden = true;
    modalBox.innerHTML = '';
  }

  // ===== タブ =====
  document.querySelectorAll('header nav button').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.tab))
  );
  function showTab(name) {
    document.querySelectorAll('header nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name));
    if (name === 'battle') refreshSetup();
    if (name === 'decks') renderDeckList();
    if (name === 'cards') renderCardList();
  }

  // =====================================================================
  // 対戦
  // =====================================================================
  let game = null;
  let mode = 'vsai';
  let lastSetup = null;
  let renderQueued = false;

  function refreshSetup() {
    for (const [sel, key] of [
      ['#setup-my', 'myDeck'],
      ['#setup-ai', 'aiDeck'],
    ]) {
      const s = $(sel);
      const cur = s.value || Store.prefs[key];
      s.innerHTML = '';
      for (const d of Store.decks) s.append(el('option', { value: d.id, text: d.name }));
      if (Store.decks.some((d) => d.id === cur)) s.value = cur;
      else if (sel === '#setup-ai' && Store.decks[1]) s.value = Store.decks[1].id;
    }
    updateSetupCounts();
    for (const k of ['first', 'speed', 'mode']) if (Store.prefs[k]) $('#setup-' + k).value = Store.prefs[k];
    if (Store.prefs.server) $('#setup-server').value = Store.prefs.server;
    $('#setup-server-row').hidden = $('#setup-mode').value !== 'host';
  }
  function updateSetupCounts() {
    for (const [sel, out] of [
      ['#setup-my', '#setup-my-n'],
      ['#setup-ai', '#setup-ai-n'],
    ]) {
      const d = Store.decks.find((x) => x.id === $(sel).value);
      const r = d ? parseDeckList(d.list) : { count: 0, unknown: [] };
      $(out).textContent = `${r.count}枚` + (r.unknown.length ? `（未登録 ${r.unknown.length}）` : '');
      $(out).className = r.count === 40 && !r.unknown.length ? 'muted' : 'warn';
    }
  }
  $('#setup-mode').addEventListener('change', () => ($('#setup-server-row').hidden = $('#setup-mode').value !== 'host'));
  // 招待URL（?join=部屋）で開いたとき
  {
    const jr = new URLSearchParams(location.search).get('join');
    if (jr && /^https?:/.test(location.protocol)) setTimeout(() => joinOnline(jr.toUpperCase()), 0);
  }
  $('#setup-my').addEventListener('change', updateSetupCounts);
  $('#setup-ai').addEventListener('change', updateSetupCounts);

  $('#setup-start').addEventListener('click', () => {
    const my = Store.decks.find((d) => d.id === $('#setup-my').value);
    const ai = Store.decks.find((d) => d.id === $('#setup-ai').value);
    if (!my || !ai) return alert('デッキを選んでください');
    const a = parseDeckList(my.list);
    const b = parseDeckList(ai.list);
    for (const [d, r] of [
      [my, a],
      [ai, b],
    ]) {
      if (r.count < 10) return alert(`「${d.name}」のカードが少なすぎます（${r.count}枚）`);
      if ($('#setup-strict').checked) {
        const per = {};
        for (const e of r.entries) if (!parsed(e.def).kw.noCopyLimit) per[e.def.name] = (per[e.def.name] || 0) + e.n;
        const over = Object.entries(per).filter(([, n]) => n > 4);
        const bad = [];
        const mainN = r.defs.filter((d) => !Engine.homeZone(d)).length;
        const hyN = r.defs.filter((d) => Engine.homeZone(d) === 'hyper').length;
        const grN = r.defs.filter((d) => Engine.homeZone(d) === 'gr').length;
        if (mainN !== 40) bad.push(`デッキ（超次元・超GRを除く）は40枚ちょうどです（今は${mainN}枚）`);
        if (hyN > 8) bad.push(`超次元ゾーンは8枚までです（今は${hyN}枚）`);
        if (grN && grN !== 12) bad.push(`超GRは12枚ちょうどです（今は${grN}枚）`);
        if (over.length) bad.push('同じ名前のカードは4枚までです：' + over.map(([k, n]) => `${k}×${n}`).join('、'));
        if (r.unknown.length) bad.push('未登録のカード：' + r.unknown.join('、'));
        if (bad.length) return alert(`「${d.name}」は競技ルールを満たしていません。\n` + bad.join('\n') + '\n\n（チェックを外すと、このまま遊べます）');
        continue;
      }
      if (r.count !== 40 || r.unknown.length) {
        if (!confirm(`「${d.name}」は${r.count}枚です${r.unknown.length ? `（未登録のカード: ${r.unknown.join('、')}）` : ''}。このまま始めますか？`)) return;
      }
    }
    Object.assign(Store.prefs, {
      myDeck: my.id,
      aiDeck: ai.id,
      first: $('#setup-first').value,
      speed: $('#setup-speed').value,
      mode: $('#setup-mode').value,
    });
    Store.savePrefs();
    lastSetup = { my, ai, a, b };
    if ($('#setup-mode').value === 'host') return hostOnline();
    startGame();
  });

  // ===== 友人と対戦 =====
  let net = null;
  let me = 0;
  const onlineStatus = (t) => {
    const e = $('#online-status');
    if (e) e.textContent = t || '';
  };
  async function hostOnline() {
    const { my, a, b } = lastSetup;
    const base = $('#setup-server').value.trim().replace(/\/+$/, '');
    Store.prefs.server = base;
    Store.savePrefs();
    let room;
    try {
      room = await Online.Net.createRoom(base);
    } catch (e) {
      return alert(`サーバー（${base}）につながりません。\n先に「node server/online-server.js」を起動してください。`);
    }
    if (net) net.stop();
    net = new Online.Net(base, room, 0);
    net.onStatus = onlineStatus;
    const isLocal = /localhost|127\.0\.0\.1/.test(base);
    $('#online-wait').hidden = false;
    $('#online-wait').innerHTML = '';
    $('#online-wait').append(
      el('div', { text: `部屋 ${room} を作りました。相手の参加を待っています…` }),
      el('div', { class: 'muted', text: isLocal ? `相手に送るURL：トンネルのURLの後ろに「/?join=${room}」をつけたもの（例: https://xxxx.trycloudflare.com/?join=${room}）` : `相手に送るURL：${base}/?join=${room}` }),
      el('button', { text: 'やめる', onclick: () => (net && net.stop(), (net = null), ($('#online-wait').hidden = true)) })
    );
    net.onMessage = (m) => {
      if (m.t !== 'hello' || game) return;
      const guestDefs = Array.isArray(m.deck) && m.deck.length ? m.deck : b.defs;
      const f = $('#setup-first').value;
      const first = f === 'me' ? 0 : f === 'ai' ? 1 : Math.random() < 0.5 ? 0 : 1;
      const seed = (Math.random() * 4294967296) >>> 0;
      const names = [`ホスト（${my.name}）`, `${m.name || 'ゲスト'}`];
      const st = { t: 'start', seed, first, decks: [a.defs, guestDefs], names };
      net.send(st);
      $('#online-wait').hidden = true;
      beginOnline(st, 0);
    };
    net.start();
  }
  function joinOnline(room) {
    $('#join').hidden = false;
    $('#join-room').textContent = room;
    const s = $('#join-deck');
    s.innerHTML = '';
    s.append(el('option', { value: '', text: 'ホストが選んだデッキを使う' }));
    for (const d of Store.decks) s.append(el('option', { value: d.id, text: d.name }));
    $('#join-go').onclick = () => {
      const d = Store.decks.find((x) => x.id === s.value);
      const defs = d ? parseDeckList(d.list).defs : null;
      if (net) net.stop();
      net = new Online.Net(location.origin, room, 1);
      net.onStatus = (t) => ($('#join-status').textContent = t || '接続しました。ホストが始めるのを待っています…');
      net.onMessage = (m) => {
        if (m.t === 'start' && !game) {
          $('#join').hidden = true;
          beginOnline(m, 1);
        }
      };
      net.start();
      net.send({ t: 'hello', name: $('#join-name').value.trim() || 'ゲスト', deck: defs });
      $('#join-status').textContent = '接続しました。ホストが始めるのを待っています…';
      $('#join-go').disabled = true;
    };
  }
  function beginOnline(st, myIdx) {
    me = myIdx;
    mode = 'online';
    const n = net;
    n.onMessage = (m) => {
      if (m.t === 'quit' && game && game.net === n) {
        game.log('相手が対戦をやめました');
        alert('相手が対戦をやめました');
      }
    };
    launch(
      new Game({
        decks: st.decks,
        names: st.names,
        ai: [false, false],
        first: st.first,
        aiDelay: 0,
        rng: Online.seededRng(st.seed),
        net: n,
        chooser: humanChoose,
        onChange: queueRender,
        onLog: addLog,
      })
    );
    n.game = game;
    n.pump();
  }

  function startGame() {
    const { my, ai, a, b } = lastSetup;
    mode = $('#setup-mode').value;
    const f = $('#setup-first').value;
    const first = f === 'me' ? 0 : f === 'ai' ? 1 : Math.random() < 0.5 ? 0 : 1;
    $('#log').innerHTML = '';
    $('#zoom').innerHTML = '<div class="muted">カードにマウスを乗せると、ここに大きく表示されます</div>';
    const names = mode === 'solo' ? [`自分（${my.name}）`, `相手（${ai.name}）`] : mode === 'watch' ? [`AI-1（${my.name}）`, `AI-2（${ai.name}）`] : ['あなた', 'AI'];
    launch(
      new Game({
        decks: [a.defs, b.defs],
        names,
        ai: [mode === 'watch', mode !== 'solo'],
        first,
        aiDelay: +$('#setup-speed').value,
        chooser: humanChoose,
        onChange: queueRender,
        onLog: addLog,
      })
    );
  }
  function launch(g0) {
    game = g0;
    document.body.classList.add('ingame');
    $('#log').innerHTML = '';
    $('#setup').hidden = true;
    $('#board').hidden = false;
    const g = game;
    window.__dmGame = g; // 動作確認用
    g.run().then(() => {
      if (game === g) {
        render();
        showResult();
      }
    });
    render();
  }

  $('#btn-end').addEventListener('click', () => game && game.endTurn());
  $('#btn-log').addEventListener('click', (e) => {
    e.stopPropagation();
    document.body.classList.toggle('showlog');
  });
  $('#btn-more').addEventListener('click', (e) => {
    e.stopPropagation();
    document.body.classList.toggle('showmore');
  });
  // ログを開いているとき、ログの外をタップしたら閉じる
  document.addEventListener('click', (e) => {
    if (document.body.classList.contains('showlog') && !e.target.closest('#sidebar') && !e.target.closest('#btn-log')) document.body.classList.remove('showlog');
  });

  // ===== スマホ：長押しでカードを大きく見る =====
  {
    let timer = null;
    let fired = false;
    let lastTouch = 0;
    let bypass = false;
    const pop = $('#zoompop');
    const closePop = () => (pop.hidden = true);
    pop.addEventListener('click', (e) => {
      if (e.target === pop) closePop();
    });
    const openPop = (cardEl, x, y) => {
      cardEl.dispatchEvent(new MouseEvent('mouseenter'));
      const z = $('#zoom');
      pop.innerHTML = '';
      const box = el('div', { class: 'zbox' });
      for (const k of [...z.childNodes]) box.append(k.cloneNode(true));
      box.append(
        el(
          'div',
          { class: 'acts' },
          el('button', {
            text: '手動の操作',
            onclick: () => {
              closePop();
              bypass = true;
              cardEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
              bypass = false;
            },
          }),
          el('button', { class: 'primary', text: '閉じる', onclick: closePop })
        )
      );
      pop.append(box);
      pop.hidden = false;
    };
    document.addEventListener(
      'touchstart',
      (e) => {
        lastTouch = Date.now();
        const c = e.target.closest && e.target.closest('.card');
        clearTimeout(timer);
        fired = false;
        if (!c || c.closest('#zoompop')) return;
        const t = e.touches[0];
        timer = setTimeout(() => {
          fired = true;
          openPop(c, t.clientX, t.clientY);
        }, 450);
      },
      { passive: true }
    );
    for (const ev of ['touchend', 'touchmove', 'touchcancel']) document.addEventListener(ev, () => clearTimeout(timer), { passive: true });
    document.addEventListener(
      'click',
      (e) => {
        if (fired) {
          fired = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );
    // タッチの長押しで出る右クリックメニューは止める（手動の操作はボタンから）
    document.addEventListener(
      'contextmenu',
      (e) => {
        if (!bypass && Date.now() - lastTouch < 1500 && e.target.closest && e.target.closest('.card')) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
  }
  $('#btn-undo').addEventListener('click', () => {
    if (!game || mode === 'online' || !game.undo()) return;
    // ログを表示し直す
    $('#log').innerHTML = '';
    for (const m of game.logs) addLog(m);
    render();
  });
  $('#btn-loop-rec').addEventListener('click', () => {
    if (!game) return;
    if (game.loopRec) {
      const st = game.loopStop();
      $('#btn-loop-rec').textContent = '⏺ ループ記録';
      $('#btn-loop-play').disabled = !st;
    } else {
      game.loopStart();
      $('#btn-loop-rec').textContent = '■ 記録終了';
    }
    render();
  });
  $('#chk-auto').addEventListener('change', (e) => {
    if (!game) return;
    game.autoOn = e.target.checked;
    game.log(game.autoOn ? '「同じ答え」の自動回答をオンにした' : '「同じ答え」の自動回答をオフにした（毎回聞きます）');
    render();
  });
  $('#btn-auto-clear').addEventListener('click', () => {
    if (!game) return;
    game.autoAnswers = {};
    game.log('自動の答えをすべて解除した');
    render();
  });
  $('#btn-loop-play').addEventListener('click', async () => {
    if (!game || !game.loopSaved) return;
    const n = parseInt(prompt(`記録したループ（${game.loopSaved.length}手）を何回くり返しますか？`, '5'), 10);
    if (!(n > 0)) return;
    await game.loopReplay(n);
    render();
  });
  $('#btn-quit').addEventListener('click', () => {
    if (game && game.winner == null && !confirm('対戦をやめますか？')) return;
    quitGame();
  });
  function quitGame() {
    if (net) {
      net.send({ t: 'quit' });
      const n0 = net;
      setTimeout(() => n0.stop(), 1500);
      net = null;
    }
    if (game) {
      game.opts.onChange = null;
      game.opts.onLog = null;
      game.abort();
    }
    game = null;
    closeModal();
    document.body.classList.remove('ingame', 'showlog', 'showmore');
    $('#board').hidden = true;
    $('#setup').hidden = false;
    refreshSetup();
  }

  function showResult() {
    if (!game || game.winner == null) return;
    const humanWon = mode === 'vsai' ? game.winner === 0 : mode === 'online' ? game.winner === me : null;
    openModal(
      el(
        'div',
        { class: 'result' },
        el('div', { class: 'big', text: humanWon == null ? `${game.p[game.winner].name}の勝ち` : humanWon ? '勝利！' : '敗北…' }),
        el('div', { class: 'muted', text: `${game.endReason}（${game.turn}ターン）` }),
        el(
          'div',
          { class: 'acts', style: { justifyContent: 'center', marginTop: '14px' } },
          mode === 'online' ? null : el('button', { class: 'primary', text: 'もう一度', onclick: () => (closeModal(), startGame()) }),
          el('button', { text: '盤面を見る', onclick: closeModal }),
          el('button', { text: '準備画面へ', onclick: quitGame })
        )
      )
    );
  }

  function addLog(msg) {
    const log = $('#log');
    const cls = msg.startsWith('――') ? 'turn' : msg.startsWith('【手動】') ? 'manual' : msg.startsWith('■') ? 'win' : '';
    log.append(el('div', { class: cls, text: msg }));
    log.scrollTop = log.scrollHeight;
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  const isHuman = (pi) => game && (mode === 'online' ? pi === me : !game.p[pi].isAI);
  const canAct = (pi) => game && game.winner == null && isHuman(pi) && game.active === pi && !game.busy && modal.hidden;
  const visibleHand = (pi) => (mode === 'online' ? pi === me : mode !== 'vsai' || pi === 0);

  function render() {
    if (!game) return;
    const g = game;
    const act = g.p[g.active];
    $('#turninfo').innerHTML = '';
    $('#turninfo').append(
      `ターン${g.turn}　`,
      el('b', { text: act.name }),
      ' の番',
      g.active === g.active && isHuman(g.active) ? `　マナ: ${g.manaCharged ? '置いた' : 'まだ置ける'}` : ''
    );
    // 待機中の能力（処理の順番待ち）
    if (g.pending && g.pending.length) {
      $('#turninfo').append(el('div', { class: 'pending-list', text: '待機中：' + g.pendSummary(g.pending) }));
    }
    $('#btn-end').disabled = !(isHuman(g.active) && g.winner == null);
    $('#btn-undo').disabled = mode === 'online' || !g.canUndo() || g.p[g.history[g.history.length - 1].active].isAI;
    {
      const n = Object.values(g.autoAnswers || {}).filter((x) => x.turn === g.turn).length;
      $('#btn-auto-clear').textContent = `自動の答えを解除（${n}）`;
      $('#btn-auto-clear').disabled = !n;
      $('#chk-auto').checked = g.autoOn !== false;
    }
    $('#btn-loop-rec').textContent = g.loopRec ? '■ 記録終了' : '⏺ ループ記録';
    $('#btn-loop-rec').disabled = !(isHuman(g.active) && g.winner == null);
    $('#btn-loop-play').disabled = !(g.loopSaved && isHuman(g.active) && g.winner == null && !g.loopRec);
    for (const pi of [0, 1]) renderSide(pi);
  }

  function renderSide(pi) {
    const g = game;
    const pl = g.p[pi];
    const root = $('#side-' + (mode === 'online' && me === 1 ? 1 - pi : pi));
    root.innerHTML = '';
    root.classList.toggle('active', g.active === pi);

    // バトルゾーン
    const battle = zone('battle', `${pl.name}　バトルゾーン`);
    for (const c of pl.battle) battle.c.append(instCard(c, 'battle'));
    // シールド・マナ・山札・墓地
    const row = el('div', { class: 'zrow' });
    const sh = zone('shields', `シールド ${pl.shields.length}`);
    pl.shields.forEach((c, i) => {
      const e = c.faceUp ? cardFace(c.def, { inst: c, nameBadge: true }) : cardBack(i + 1);
      e.style.setProperty('--cw', '54px');
      e.addEventListener('contextmenu', (ev) => manualMenu(ev, c, 'shields'));
      if ((c.under || []).length) {
        // シールドの束：一番上のカードだけ表示し、クリックで中身を見る
        const topC = c.under[c.under.length - 1];
        const te = cardFace(topC.def, { inst: topC, nameBadge: true });
        te.style.setProperty('--cw', '54px');
        te.classList.add('click');
        te.title = 'クリックで束の中身を見る';
        te.addEventListener('contextmenu', (ev) => manualMenu(ev, topC, 'shields'));
        te.addEventListener('click', () => shieldStackModal(c));
        const wrap = el('div', { class: 'shstack' }, te, el('span', { class: 'n', text: '束' + (c.under.length + 1) }));
        sh.c.append(wrap);
      } else sh.c.append(e);
    });
    const untapped = pl.mana.filter((m) => !m.tapped).length;
    const mana = zone('mana', `マナ ${untapped}/${pl.mana.length}　${manaCivSummary(pl)}`);
    for (const c of pl.mana) {
      const e = c.faceDown ? cardBack() : instCard(c, 'mana');
      if (c.faceDown) {
        if (c.tapped) e.classList.add('tapped');
        e.title = '裏向きのマナ（文明なし）';
        e.addEventListener('contextmenu', (ev) => manualMenu(ev, c, 'mana'));
      }
      e.style.setProperty('--cw', '62px');
      mana.c.append(e);
    }
    const deck = zone('pile', `山札`);
    deck.c.append(cardBack());
    deck.e.append(el('div', { class: 'count', text: pl.deck.length }));
    deck.e.addEventListener('click', (ev) => deckMenu(ev, pi));
    deck.e.addEventListener('contextmenu', (ev) => deckMenu(ev, pi));
    const grave = zone('pile', `墓地`);
    const top = pl.grave[pl.grave.length - 1];
    if (top) grave.c.append(cardFace(top.def, { inst: top }));
    grave.e.append(el('div', { class: 'count', text: pl.grave.length }));
    grave.e.addEventListener('click', () => graveModal(pi));
    row.append(sh.e, mana.e, deck.e, grave.e);
    // 超次元ゾーン・超GR（使うデッキの時だけ表示）
    if ((pl.hyper || []).length || g.p.some((x) => (x.hyper || []).length) || pl.battle.some((c) => Engine.homeZone(c.def) === 'hyper')) {
      const hz = zone('pile', `超次元`);
      hz.c.append(el('div', { class: 'muted', text: '表向き' }));
      hz.e.append(el('div', { class: 'count', text: pl.hyper.length }));
      hz.e.addEventListener('click', () => pileModal(pi, 'hyper'));
      row.append(hz.e);
    }
    if ((pl.gr || []).length || g.p.some((x) => (x.gr || []).length)) {
      const gz = zone('pile', `超GR`);
      gz.c.append(cardBack());
      gz.e.append(el('div', { class: 'count', text: pl.gr.length }));
      gz.e.addEventListener('click', () => pileModal(pi, 'gr'));
      row.append(gz.e);
    }

    // 手札
    const hand = zone('hand', `手札 ${pl.hand.length}`);
    for (const c of pl.hand) {
      if (visibleHand(pi)) hand.c.append(instCard(c, 'hand'));
      else {
        const b = cardBack();
        b.addEventListener('contextmenu', (ev) => manualMenu(ev, c, 'hand'));
        hand.c.append(b);
      }
    }
    const handRow = el('div', { class: 'zrow' }, hand.e);
    root.append(battle.e, row, handRow);
  }

  function manaCivSummary(pl) {
    const cnt = {};
    for (const m of pl.mana) for (const c of m.def.civs || []) cnt[c] = (cnt[c] || 0) + 1;
    return Object.entries(cnt)
      .map(([c, n]) => `${CIV_LABEL[c]}${n}`)
      .join(' ');
  }

  function zone(kind, label) {
    const c = el('div', { class: 'zc' });
    const e = el('div', { class: 'zone ' + kind }, el('div', { class: 'zl', text: label }), c);
    return { e, c };
  }

  function instCard(c, z) {
    const g = game;
    const pi = c.owner;
    const mine = canAct(pi);
    let clickable = false;
    let can = false;
    if (mine && z === 'hand') {
      clickable = true;
      can = g.canPlay(pi, c) || g.canPlayTwin(pi, c) || g.canCharge(pi, c);
    } else if (mine && z === 'battle') {
      const t = g.attackTargets(c);
      clickable = can = t.length > 0 || g.canTapAbility(c) || g.canCross(pi, c) || g.canHyperize(pi, c);
    }
    const e = cardFace(c.def, { inst: c, click: clickable, nameBadge: z !== 'mana' });
    if (c.tapped) e.classList.add('tapped');
    if (z === 'battle' && c.sick && !c.tapped) e.classList.add('sick');
    if (can) e.classList.add('can');
    if (z === 'battle' && c.seals > 0) e.append(el('div', { class: 'badge seal', text: `封印${c.seals}` }));
    const exN = (c.exLife ? 1 : 0) + (c.exLifes || []).length;
    if (z === 'battle' && exN) e.append(el('div', { class: 'badge seal', text: exN > 1 ? `EXライフ×${exN}` : 'EXライフ' }));
    if (z === 'battle' && c.attachedTo) {
      const h = g.find(c.attachedTo);
      if (h) e.append(el('div', { class: 'badge seal', text: `${{ weapon: '装備', cross: 'クロス', aura: 'オーラ' }[Engine.attachKind(c.def)] || '付'}→${h.card.def.name.slice(0, 6)}` }));
    }
    if (z === 'battle' && c.frontDef) e.append(el('div', { class: 'badge up', text: '裏面' }));
    if (z === 'battle' && g.isCreature(c)) {
      const p = g.power(c);
      e.append(el('div', { class: 'badge' + (p !== +c.def.power ? ' up' : ''), text: p }));
    }
    if (clickable) e.addEventListener('click', (ev) => (z === 'hand' ? handMenu(ev, c) : attackMenu(ev, c)));
    e.addEventListener('contextmenu', (ev) => manualMenu(ev, c, z));
    return e;
  }

  function handMenu(ev, c) {
    ev.stopPropagation();
    const g = game;
    const pi = c.owner;
    const pay = g.payment(pi, c);
    let why = '';
    if (!pay) {
      const untapped = g.p[pi].mana.filter((m) => !m.tapped).length;
      why = untapped < c.def.cost ? '（マナ不足）' : '（文明が足りない）';
    }
    openMenu(ev.clientX, ev.clientY, c.def.name, [
      {
        label: `使う（コスト${c.def.cost}）${why}`,
        disabled: !g.canPlay(pi, c),
        run: () => g.actRec({ t: 'play', pi, uid: c.uid, label: `「${c.def.name}」を使う` }),
      },
      g.twin(c) && {
        label: g.twin(c).type === 'field' ? `裏面「${g.twin(c).name}」で出す（コスト${g.twin(c).cost}）` : `呪文側「${g.twin(c).name}」を使う（コスト${g.twin(c).cost}）`,
        disabled: !g.canPlayTwin(pi, c),
        run: () => g.actRec({ t: 'playTwin', pi, uid: c.uid, label: `「${c.def.name}」の呪文側を使う` }),
      },
      {
        label: g.manaCharged ? 'マナに置く（このターンは置いた）' : 'マナに置く',
        disabled: !g.canCharge(pi, c),
        run: () => g.actRec({ t: 'charge', pi, uid: c.uid, label: 'マナに置く' }),
      },
    ]);
  }

  function attackMenu(ev, c) {
    ev.stopPropagation();
    const g = game;
    const pi = c.owner;
    const ts = g.attackTargets(c);
    const extra = g.canTapAbility(c) ? [{ label: '攻撃するかわりに、タップして能力を使う', run: () => g.actRec({ t: 'tapAbility', pi, uid: c.uid, label: 'タップ能力' }) }] : [];
    if (g.canHyperize(pi, c)) extra.push({ label: `ハイパー化する（自分の他のクリーチャーを${g.kw(c).hyperize.tapOthers}体タップ）`, run: () => g.actRec({ t: 'hyperize', pi, uid: c.uid, label: 'ハイパー化' }) });
    if (g.canCross(pi, c)) extra.push({ label: `クリーチャーにクロスする（コスト${c.def.cost}）`, run: () => g.actRec({ t: 'cross', pi, uid: c.uid, label: 'クロス' }) });
    openMenu(
      ev.clientX,
      ev.clientY,
      `${c.def.name}（${g.power(c)}）で攻撃`,
      extra.concat(ts.map((t) =>
        t === 'player'
          ? {
              label: `${g.opp(pi).name}を攻撃（シールド${g.opp(pi).shields.length}）`,
              run: () => g.actRec({ t: 'attack', pi, uid: c.uid, target: 'player', label: '攻撃' }),
            }
          : { label: `「${t.def.name}」(${g.power(t)})を攻撃`, run: () => g.actRec({ t: 'attack', pi, uid: c.uid, target: t.uid, label: '攻撃' }) }
      ))
    );
  }

  function manualMenu(ev, c, z) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!game || game.busy) return;
    const g = game;
    const owner = g.p[c.owner].name;
    const items = [];
    const mv = (zone, opt, label) => ({ label, disabled: z === zone && !opt, run: () => g.actRec({ t: 'mMove', pi: c.owner, uid: c.uid, zone, opt: opt || {} }) });
    if (z === 'battle' || z === 'mana') items.push({ label: c.tapped ? 'アンタップする' : 'タップする', run: () => g.actRec({ t: 'mTap', pi: c.owner, uid: c.uid }) });
    if (z === 'shields' && mode !== 'online') items.push({ label: '表を見る', run: () => showZoom(c.def, c) });
    items.push(
      mv('hand', null, '手札へ'),
      mv('battle', null, 'バトルゾーンへ'),
      mv('mana', null, 'マナへ'),
      mv('grave', null, '墓地へ'),
      mv('shields', null, 'シールドへ'),
      mv('deck', { top: true }, '山札の上へ'),
      mv('deck', { top: false }, '山札の下へ')
    );
    if (z === 'hand') items.push({ label: 'コストを払わずに使う', run: () => g.actRec({ t: 'freePlay', pi: c.owner, uid: c.uid, label: 'コストを払わずに使う' }) });
    if (z === 'hand' && g.twin(c)) items.push({ label: 'コストを払わずに呪文側を使う', run: () => g.actRec({ t: 'freeTwin', pi: c.owner, uid: c.uid, label: 'コストを払わずに呪文側を使う' }) });
    openMenu(ev.clientX, ev.clientY, `[手動] ${z === 'shields' || (z === 'hand' && !visibleHand(c.owner)) ? '？' : c.def.name}（${owner}）`, items);
  }

  function deckMenu(ev, pi) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!game || game.busy) return;
    const g = game;
    const pl = g.p[pi];
    const top = pl.deck[0];
    openMenu(ev.clientX, ev.clientY, `${pl.name}の山札（${pl.deck.length}）`, [
      { label: '1枚引く', disabled: !top, run: () => g.actRec({ t: 'mDraw', pi }) },
      { label: 'シャッフル', run: () => g.actRec({ t: 'mShuffle', pi }) },
      { label: '上の1枚を見る', disabled: !top || mode === 'online', run: () => showZoom(top.def, top) },
      { label: '上の1枚をマナへ', disabled: !top, run: () => g.actRec({ t: 'mMove', pi, uid: top.uid, zone: 'mana', opt: {} }) },
      { label: '上の1枚をシールドへ', disabled: !top, run: () => g.actRec({ t: 'mMove', pi, uid: top.uid, zone: 'shields', opt: {} }) },
      { label: '上の1枚を墓地へ', disabled: !top, run: () => g.actRec({ t: 'mMove', pi, uid: top.uid, zone: 'grave', opt: {} }) },
      { label: '山札をすべて見る', disabled: mode === 'online', run: () => pileModal(pi, 'deck') },
      ...(top && isHuman(pi) && g.active === pi && g.canPlayFromGrave(pi, top) ? [{ label: `上の1枚「${top.def.name}」を使う（能力）`, run: () => g.actRec({ t: 'graveUse', pi, uid: top.uid, label: '墓地から使う' }) }] : []),
    ]);
  }

  // シールドの束の中身（上から順に）
  function shieldStackModal(sh) {
    const box = el('div', { class: 'opts' });
    for (const u of sh.under.slice().reverse()) {
      const ue = cardFace(u.def, { inst: u });
      ue.addEventListener('contextmenu', (ev) => manualMenu(ev, u, 'shields'));
      box.append(el('div', { class: 'opt' }, ue, el('div', { text: '表向き' })));
    }
    box.append(el('div', { class: 'opt' }, sh.faceUp ? cardFace(sh.def, { inst: sh }) : cardBack('?'), el('div', { text: sh.faceUp ? '一番下（表向き）' : '一番下：裏向きのシールド' })));
    openModal(el('h3', { text: `シールドの束（${sh.under.length + 1}枚・上から順に）　右クリックで移動` }), box, el('div', { class: 'acts' }, el('button', { text: '閉じる', onclick: () => closeModal() })));
  }
  function graveModal(pi) {
    pileModal(pi, 'grave');
  }
  function pileModal(pi, z) {
    const g = game;
    const pl = g.p[pi];
    const box = el('div', { class: 'opts' });
    const draw = () => {
      box.innerHTML = '';
      for (const c of pl[z]) {
        const e = cardFace(c.def, { inst: c });
        e.addEventListener('contextmenu', (ev) => {
          manualMenu(ev, c, z);
        });
        const usable = (z === 'grave' || z === 'mana' || z === 'hyper') && g.winner == null && isHuman(pi) && g.active === pi && !g.busy && g.canPlayFromGrave(pi, c);
        if (usable) {
          e.classList.add('click', 'can');
          e.addEventListener('click', () => {
            g.opts.onChange = prev;
            closeModal();
            g.actRec({ t: 'graveUse', pi, uid: c.uid, label: '墓地から使う' });
          });
        }
        box.append(el('div', { class: 'opt' }, e, usable ? el('div', { text: 'クリックで使う' }) : null));
      }
      if (!pl[z].length) box.append(el('div', { class: 'muted', text: '（空）' }));
    };
    draw();
    const prev = g.opts.onChange;
    g.opts.onChange = (x) => {
      prev && prev(x);
      if (!modal.hidden) draw();
    };
    openModal(
      el('h3', { text: `${pl.name}の${{ grave: '墓地', deck: '山札', hyper: '超次元ゾーン', gr: '超GR', mana: 'マナゾーン' }[z] || z}（${pl[z].length}枚）　右クリックで移動` }),
      box,
      el('div', { class: 'acts' }, el('button', { text: '閉じる', onclick: () => ((g.opts.onChange = prev), closeModal(), render()) }))
    );
  }

  // ===== 人間の選択 =====
  function humanChoose(g, pi, req) {
    return new Promise((resolve) => {
      const who = mode === 'solo' ? `[${g.p[pi].name}] ` : '';
      const selected = new Set();
      const remember = el('input', { type: 'checkbox' });
      const done = (ids) => {
        closeModal();
        resolve(remember.checked ? { ids, remember: true } : ids);
        render();
      };
      const head = el('h3', { text: who + req.prompt });
      const kids = [head];
      if (req.kind !== 'reveal') kids.push(el('label', { class: 'remember', title: 'このターンの間、同じ質問が出たら自動で同じ答えを選びます' }, remember, el('span', { text: ' このターン、同じ質問には同じ答え' })));
      // 誘発が続くループ：選択だけを記録してくり返す
      {
        const ctl = (o) => {
          closeModal();
          resolve(o);
          render();
        };
        const bar = el('div', { class: 'ansloop' });
        if (req.loopHint && !g.ansRec) {
          const k = req.loopHint.k;
          bar.append(
            el('button', {
              class: 'primary',
              text: `↻ ループを検出（1周＝${k}回の選択）：まとめてくり返す`,
              title: '直前の選択が同じ並びで2回続きました。同じ選び方を指定した周回数だけ自動でくり返します',
              onclick: () => {
                const n = parseInt(prompt(`同じ選び方（1周＝${k}回の選択）をあと何周くり返しますか？`, '10'), 10);
                if (n > 0) ctl({ ctl: 'ansHintRepeat', k, n });
              },
            })
          );
        }
        if (!g.ansRec) {
          bar.append(el('button', { text: '⏺ ここから選択を記録', title: 'この質問から1周分の選択を記録します（処理が続くループ用）', onclick: () => ctl({ ctl: 'ansRecStart' }) }));
        } else {
          bar.append(
            el('span', { class: 'muted', text: `選択を記録中（${g.ansRec.length}回）` }),
            el('button', {
              text: '↻ ここまでを1周としてくり返す',
              title: '記録を始めた質問に戻ってきたら押してください',
              onclick: () => {
                if (!g.ansRec.length) return alert('まだ1回も選んでいません');
                const n = parseInt(prompt(`記録した選択（${g.ansRec.length}回）を何周くり返しますか？`, '5'), 10);
                if (n > 0) ctl({ ctl: 'ansRepeat', n });
              },
            }),
            el('button', { text: '記録やめる', onclick: () => ctl({ ctl: 'ansRecStop' }) })
          );
        }
        if (req.kind !== 'reveal') kids.push(bar);
      }

      if (req.kind === 'modes') {
        // 先に処理内容をすべて選ぶ。選んだ順に処理する
        const order = [];
        const list = el('div', { class: 'modelist' });
        const chosen = el('div', { class: 'chosen' });
        const ok = el('button', { class: 'primary', text: '決定して処理する' });
        const redraw = () => {
          chosen.innerHTML = '';
          chosen.append(el('span', { class: 'muted', text: `選んだ順（${order.length}/${req.max}）: ` }));
          order.forEach((id, i) => {
            const o = req.options.find((x) => x.id === id);
            chosen.append(
              el('button', {
                class: 'chip',
                text: `${i + 1}. ${o.label} ✕`,
                onclick: () => {
                  order.splice(i, 1);
                  redraw();
                },
              })
            );
          });
          list.querySelectorAll('button').forEach((b) => {
            const id = b.dataset.id;
            b.disabled = order.length >= req.max || (!req.repeat && order.includes(id));
          });
          ok.disabled = order.length < req.min || order.length === 0 && req.min > 0;
          ok.disabled = order.length < Math.max(req.min, 0) || (req.min > 0 && !order.length);
        };
        for (const o of req.options) {
          list.append(el('button', { 'data-id': o.id, text: o.label, style: { textAlign: 'left' }, onclick: () => (order.push(o.id), redraw()) }));
        }
        ok.addEventListener('click', () => done(order.slice()));
        kids.push(
          el('div', { class: 'muted', text: req.repeat ? '同じものを何回でも選べます。' : req.max > 1 ? `${req.max}つまで選べます。` : '' }),
          list,
          chosen,
          el('div', { class: 'acts', style: { marginTop: '10px' } }, req.min === 0 ? el('button', { text: '何もしない', onclick: () => done([]) }) : null, ok)
        );
        openModal(...kids);
        redraw();
        return;
      }

      if (req.kind === 'mode') {
        const sel = new Set();
        const btns = el('div', { class: 'col' });
        const ok = el('button', { class: 'primary', text: '決定' });
        const upd = () => (ok.disabled = sel.size < Math.max(req.min, req.max === 1 ? 1 : 0));
        for (const o of req.options) {
          const b = el('button', { text: o.label, style: { textAlign: 'left' } });
          b.addEventListener('click', () => {
            if (req.max === 1) return done([o.id]);
            if (sel.has(o.id)) sel.delete(o.id);
            else if (sel.size < req.max) sel.add(o.id);
            b.classList.toggle('primary', sel.has(o.id));
            upd();
          });
          btns.append(b);
        }
        kids.push(btns);
        if (req.max > 1) {
          ok.addEventListener('click', () => done([...sel]));
          kids.push(el('div', { class: 'acts', style: { marginTop: '10px' } }, ok));
          upd();
        }
        openModal(...kids);
        return;
      }

      if (req.kind === 'reveal') {
        kids.push(el('div', { class: 'opts' }, (req.cards || []).map((c) => {
          const e = cardFace(c.def, { inst: c });
          e.addEventListener('mouseenter', () => showZoom(c.def, c));
          return el('div', { class: 'opt' }, e, el('div', { class: 'lbl', text: c.def.name }));
        })));
        kids.push(el('div', { class: 'acts' }, el('button', { class: 'primary', text: '確認した', onclick: () => done(['ok']) })));
        openModal(...kids);
        return;
      }
      if (req.kind === 'yesno' || req.kind === 'number') {
        if (req.card) {
          const e = cardFace(req.card.def, { inst: req.card });
          kids.push(el('div', { class: 'opts' }, e));
          showZoom(req.card.def, req.card);
        }
        kids.push(
          el(
            'div',
            { class: 'acts' },
            req.options.map((o) => el('button', { class: o.id === 'yes' ? 'primary' : '', text: o.label, onclick: () => done([o.id]) }))
          )
        );
        openModal(...kids);
        return;
      }

      if (req.kind === 'block' && req.attacker) {
        kids.push(el('div', { class: 'muted', text: '攻撃してきたクリーチャー:' }), el('div', { class: 'opts' }, cardFace(req.attacker.def, { inst: req.attacker })));
        kids.push(el('div', { class: 'muted', text: 'ブロックするクリーチャーを選んでください:' }));
      }
      const opts = el('div', { class: 'opts' });
      const ok = el('button', { class: 'primary', text: req.kind === 'block' ? 'ブロックする' : '決定' });
      const info = el('span', { class: 'muted' });
      const update = () => {
        ok.disabled = req.kind === 'block' ? selected.size !== 1 : selected.size < Math.max(1, req.min);
        info.textContent = `${selected.size} / ${req.max}${req.min < req.max ? `（${req.min}〜${req.max}）` : ''}`;
      };
      req.options.forEach((o, i) => {
        const e = req.kind === 'shield' ? cardBack(i + 1) : cardFace(o.card.def, { inst: o.card });
        e.classList.add('click');
        e.addEventListener('click', () => {
          if (selected.has(o.id)) selected.delete(o.id);
          else {
            if (selected.size >= req.max) {
              if (req.max === 1) {
                selected.clear();
                opts.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
              } else return;
            }
            selected.add(o.id);
          }
          e.classList.toggle('sel', selected.has(o.id));
          update();
        });
        const label = req.kind === 'shield' ? '' : o.card.owner !== pi ? `相手: ${o.label}` : o.label;
        opts.append(el('div', { class: 'opt' }, e, el('div', { text: label })));
      });
      ok.addEventListener('click', () => done([...selected]));
      const acts = el('div', { class: 'acts' }, info, el('span', { class: 'grow' }));
      if (req.kind === 'block') acts.append(el('button', { text: 'ブロックしない', onclick: () => done([]) }));
      else if (req.min === 0) acts.append(el('button', { text: '選ばない', onclick: () => done([]) }));
      acts.append(ok);
      kids.push(opts, acts);
      openModal(...kids);
      update();
    });
  }

  // =====================================================================
  // デッキ
  // =====================================================================
  let deckSel = null;
  function renderDeckList() {
    const ul = $('#deck-list');
    ul.innerHTML = '';
    if (!deckSel || !Store.decks.find((d) => d.id === deckSel)) deckSel = Store.decks[0]?.id || null;
    for (const d of Store.decks) {
      const r = parseDeckList(d.list);
      ul.append(
        el(
          'li',
          { class: d.id === deckSel ? 'on' : '', onclick: () => ((deckSel = d.id), renderDeckList()) },
          el('span', { text: d.name }),
          el('span', { class: 'c', text: r.count + '枚' })
        )
      );
    }
    loadDeckForm();
    renderPick();
  }
  function loadDeckForm() {
    const d = Store.decks.find((x) => x.id === deckSel);
    $('#deck-name').value = d ? d.name : '';
    $('#deck-text').value = d ? d.list : '';
    checkDeck();
  }
  function checkDeck() {
    const r = parseDeckList($('#deck-text').value);
    const out = $('#deck-check');
    out.innerHTML = '';
    const mainN = r.defs.filter((d) => !Engine.homeZone(d)).length;
    const hyN = r.defs.filter((d) => Engine.homeZone(d) === 'hyper').length;
    const grN = r.defs.filter((d) => Engine.homeZone(d) === 'gr').length;
    out.append(el('span', { class: mainN === 40 ? 'good' : 'warn', text: `${mainN}枚` + (mainN === 40 ? '' : '（40枚が基本です）') }));
    if (hyN) out.append(`　超次元ゾーン: ${hyN}枚`);
    if (grN) out.append(`　超GR: ${grN}枚`);
    const civ = {};
    let trig = 0;
    for (const def of r.defs) {
      for (const c of def.civs || []) civ[c] = (civ[c] || 0) + 1;
      if (parsed(def).kw.shieldTrigger) trig++;
    }
    out.append(`　文明: ${Object.entries(civ).map(([c, n]) => CIV_LABEL[c] + n).join(' ')}　S・トリガー: ${trig}枚`);
    const over = r.entries.filter((e) => !parsed(e.def).kw.noCopyLimit).reduce((m, e) => ((m[e.def.name] = (m[e.def.name] || 0) + e.n), m), {});
    const o4 = Object.entries(over).filter(([, n]) => n > 4);
    if (o4.length) out.append(el('div', { class: 'warn', text: '5枚以上: ' + o4.map(([k, n]) => `${k}×${n}`).join('、') }));
    if (r.unknown.length) out.append(el('div', { class: 'bad', text: '未登録のカード: ' + r.unknown.join('、') }));
    const pv = $('#deck-preview');
    pv.innerHTML = '';
    const merged = new Map();
    for (const e of r.entries) merged.set(e.def, (merged.get(e.def) || 0) + e.n);
    for (const [def, n] of merged) {
      const e = cardFace(def, { nameBadge: true, click: true });
      e.style.setProperty('--cw', '96px');
      e.addEventListener('click', () => deckAdd(def, +1));
      e.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        deckAdd(def, -1);
      });
      pv.append(el('div', { class: 'gi' }, e, el('span', { class: 'n', text: '×' + n })));
    }
    $('#deck-addmissing').disabled = !r.unknown.length;
    return r;
  }
  $('#deck-text').addEventListener('input', checkDeck);

  // ===== 一覧からデッキを組む =====
  // デッキのテキストを「枚数 カード名」の行にまとめ直して、枚数を増減する
  function deckAdd(def, delta) {
    const r = parseDeckList($('#deck-text').value);
    const counts = new Map();
    for (const e of r.entries) counts.set(e.def, (counts.get(e.def) || 0) + e.n);
    const n = Math.max(0, (counts.get(def) || 0) + delta);
    if (delta > 0 && n > 4 && !parsed(def).kw.noCopyLimit && !confirm(`「${def.name}」が5枚以上になります。追加しますか？`)) return;
    if (n) counts.set(def, n);
    else counts.delete(def);
    const unknown = r.unknown.map((u) => `1 ${u}`);
    const lines = [...counts].sort((a, b) => (a[0].cost ?? 0) - (b[0].cost ?? 0) || a[0].name.localeCompare(b[0].name, 'ja')).map(([d, k]) => `${k} ${d.name}`);
    $('#deck-text').value = [...lines, ...unknown].join('\n');
    checkDeck();
    renderPick();
  }
  const pickCivs = new Set();
  const pickCivBox = $('#pick-civs');
  for (const c of CIVS) {
    const b = el('button', { class: 'civbtn', text: CIV_LABEL[c], style: { borderColor: CIV_COLOR[c] } });
    b.addEventListener('click', () => {
      if (pickCivs.has(c)) pickCivs.delete(c);
      else pickCivs.add(c);
      b.classList.toggle('on', pickCivs.has(c));
      b.style.background = pickCivs.has(c) ? CIV_COLOR[c] : '';
      renderPick();
    });
    pickCivBox.append(b);
  }
  // 手動で処理する文の数（カード専用の処理があるものは0）
  function manualCount(def) {
    if (window.CardScripts && CardScripts.get(def.name)) return 0;
    try {
      const p = parsed(def);
      const wk = (q) => (q.known || []).filter((k) => k.whole).length;
      let n = p.manual.length + wk(p);
      const td = twinDef && twinDef(def);
      if (td) n += parsed(td).manual.length + wk(parsed(td));
      return n;
    } catch (e) {
      return 0;
    }
  }
  // 「自動/手動」の絞り込みと並べ替え
  function autoFilter(list, mode) {
    if (!mode) return list;
    if (mode === 'auto') return list.filter((c) => manualCount(c) === 0);
    const out = list.filter((c) => manualCount(c) > 0);
    if (mode === 'manualSort') out.sort((a, b) => manualCount(b) - manualCount(a));
    return out;
  }
  function renderPick() {
    const grid = $('#pick-grid');
    if (!grid) return;
    const q = $('#pick-search').value.trim().normalize('NFKC').toLowerCase();
    const type = $('#pick-type').value;
    const cost = $('#pick-cost').value;
    const inDeck = new Map();
    for (const e of parseDeckList($('#deck-text').value).entries) inDeck.set(e.def, (inDeck.get(e.def) || 0) + e.n);
    let list = Store.cards
      .filter((c) => !q || (c.name + ' ' + (c.text || '') + ' ' + (c.races || []).join(' ')).normalize('NFKC').toLowerCase().includes(q))
      .filter((c) => !pickCivs.size || (c.civs || []).some((x) => pickCivs.has(x)))
      .filter((c) => !type || c.type === type)
      .filter((c) => !cost || (cost === '7' ? (c.cost ?? 0) >= 7 : (c.cost ?? 0) === +cost))
      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name, 'ja'));
    list = autoFilter(list, $('#pick-auto').value);
    grid.innerHTML = '';
    const LIMIT = 150;
    if (list.length > LIMIT) grid.append(el('div', { class: 'muted', style: { width: '100%' }, text: `${list.length}枚中 ${LIMIT}枚を表示中。検索や文明・コストで絞り込んでください` }));
    for (const def of list.slice(0, LIMIT)) {
      const e = cardFace(def, { nameBadge: true, click: true });
      e.style.setProperty('--cw', '78px');
      e.addEventListener('click', () => deckAdd(def, +1));
      e.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        deckAdd(def, -1);
      });
      const n = inDeck.get(def) || 0;
      const mc = $('#pick-auto').value ? manualCount(def) : 0;
      grid.append(el('div', { class: 'gi' }, e, n ? el('span', { class: 'n', text: '×' + n }) : null, mc ? el('span', { class: 'mc', title: '手動で処理する文の数', text: '手動' + mc }) : null));
    }
    if (!list.length) grid.append(el('div', { class: 'muted', text: '該当するカードがありません' }));
  }
  ['#pick-search', '#pick-type', '#pick-cost', '#pick-auto'].forEach((sel) => $(sel).addEventListener('input', renderPick));
  $('#deck-new').addEventListener('click', () => {
    const d = { id: 'd-' + Date.now().toString(36), name: '新しいデッキ', list: '' };
    Store.decks.push(d);
    Store.saveDecks();
    deckSel = d.id;
    renderDeckList();
    $('#deck-name').focus();
  });
  $('#deck-save').addEventListener('click', () => {
    const d = Store.decks.find((x) => x.id === deckSel);
    if (!d) return;
    d.name = $('#deck-name').value.trim() || '無題のデッキ';
    d.list = $('#deck-text').value;
    Store.saveDecks();
    renderDeckList();
  });
  $('#deck-dup').addEventListener('click', () => {
    const d = Store.decks.find((x) => x.id === deckSel);
    if (!d) return;
    const n = { id: 'd-' + Date.now().toString(36), name: d.name + ' のコピー', list: $('#deck-text').value };
    Store.decks.push(n);
    Store.saveDecks();
    deckSel = n.id;
    renderDeckList();
  });
  $('#deck-del').addEventListener('click', () => {
    const d = Store.decks.find((x) => x.id === deckSel);
    if (!d || !confirm(`「${d.name}」を削除しますか？`)) return;
    Store.decks = Store.decks.filter((x) => x !== d);
    Store.saveDecks();
    deckSel = null;
    renderDeckList();
  });
  $('#deck-addmissing').addEventListener('click', () => {
    const r = parseDeckList($('#deck-text').value);
    if (!r.unknown.length) return;
    $('#deck-save').click();
    showTab('cards');
    newCard(r.unknown[0]);
  });

  // =====================================================================
  // カード
  // =====================================================================
  let cardSel = null; // 編集中のカードID
  let draft = null; // 未保存の新規カード

  const civBox = $('#cf-civs');
  for (const c of CIVS) {
    civBox.append(el('label', {}, el('input', { type: 'checkbox', value: c }), el('span', { style: { color: CIV_COLOR[c] }, text: CIV_LABEL[c] })));
  }

  function renderCardList() {
    const q = $('#card-search').value.trim().normalize('NFKC').toLowerCase();
    const ul = $('#card-list');
    ul.innerHTML = '';
    const amode = $('#card-auto').value;
    const list = autoFilter(
      Store.cards
        .filter((c) => !q || (c.name + ' ' + (c.text || '') + ' ' + (c.races || []).join(' ')).normalize('NFKC').toLowerCase().includes(q))
        .slice()
        .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name, 'ja')),
      amode
    );
    $('#card-auto-n').textContent = amode ? ` ${list.length}枚` : '';
    const LIMIT = 400;
    if (list.length > LIMIT) ul.append(el('li', { class: 'muted', text: `${list.length}枚中 ${LIMIT}枚を表示中。上の検索で絞り込んでください` }));
    for (const c of list.slice(0, LIMIT)) {
      ul.append(
        el(
          'li',
          { class: c.id === cardSel ? 'on' : '', onclick: () => selectCard(c.id) },
          el('span', { class: 'dot', style: { background: civBg(c.civs) } }),
          el('span', { text: c.name }),
          amode && manualCount(c) ? el('span', { class: 'mc', title: '手動で処理する文の数', text: '手動' + manualCount(c) }) : null,
          el('span', { class: 'c', text: `${c.cost}${Store.imageUrls[c.id] || c.imageUrl ? ' 🖼' : ''}` })
        )
      );
    }
    if (!cardSel && !draft && Store.cards[0]) selectCard(list[0]?.id || Store.cards[0].id);
  }
  $('#card-search').addEventListener('input', renderCardList);
  $('#card-auto').addEventListener('input', renderCardList);

  function selectCard(id) {
    cardSel = id;
    draft = null;
    loadCardForm(Store.byId(id));
    renderCardList();
  }
  function newCard(name = '') {
    draft = { id: Store.newId(), name, civs: [], cost: 1, type: 'creature', power: 1000, races: [], text: '', imageUrl: '' };
    cardSel = draft.id;
    loadCardForm(draft);
    renderCardList();
    $('#cf-name').focus();
  }
  $('#card-new').addEventListener('click', () => newCard());

  function loadCardForm(c) {
    if (!c) return;
    $('#cf-name').value = c.name;
    $('#cf-type').value = c.type || 'creature';
    civBox.querySelectorAll('input').forEach((i) => (i.checked = (c.civs || []).includes(i.value)));
    $('#cf-cost').value = c.cost ?? '';
    $('#cf-power').value = c.power ?? '';
    $('#cf-races').value = (c.races || []).join(' ');
    $('#cf-text').value = c.text || '';
    $('#cf-url').value = c.imageUrl || '';
    $('#cf-flavor').value = c.flavor || '';
    $('#cf-official').value = c.officialUrl || '';
    $('#cf-tname').value = c.twin?.name || '';
    $('#cf-tcost').value = c.twin?.cost ?? '';
    $('#cf-ttext').value = c.twin?.text || '';
    $('#cf-twinbox').open = !!c.twin?.name;
    $('#cf-id').textContent = 'ID: ' + c.id + (draft ? '（未保存）' : '');
    $('#cf-file').value = '';
    updateCardPreview();
  }
  function formToCard() {
    const type = $('#cf-type').value;
    return {
      id: cardSel,
      name: $('#cf-name').value.trim(),
      type,
      civs: [...civBox.querySelectorAll('input:checked')].map((i) => i.value),
      cost: +$('#cf-cost').value || 0,
      power: NON_CREATURE.includes(type) ? null : $('#cf-power').value === '' ? null : +$('#cf-power').value,
      races: $('#cf-races').value.split(/[\s　/／,、]+/).filter(Boolean),
      text: $('#cf-text').value,
      imageUrl: $('#cf-url').value.trim(),
      flavor: $('#cf-flavor').value,
      officialUrl: $('#cf-official').value.trim(),
      evolution: (Store.byId(cardSel) || draft || {}).evolution || '',
      twin: $('#cf-tname').value.trim() ? { name: $('#cf-tname').value.trim(), cost: +$('#cf-tcost').value || 0, text: $('#cf-ttext').value } : null,
    };
  }
  function updateCardPreview() {
    const c = formToCard();
    $('#cf-power').disabled = NON_CREATURE.includes(c.type);
    const tout = $('#cf-tparsed');
    tout.innerHTML = '';
    const td = twinDef(c);
    if (td) {
      const tp = TextParse.parseCard(td);
      const ta = TextParse.describe(tp);
      tout.append(el('div', { class: 'good', text: ta.length ? '✓ ' + ta.join(' / ') : '（自動処理する能力なし）' }));
      if (tp.manual.length) tout.append(el('div', { class: 'warn' }, '手動で処理する文:', el('ul', {}, tp.manual.map((m) => el('li', { text: m })))));
    }
    const pv = $('#cf-preview');
    pv.innerHTML = '';
    pv.append(cardFace(c));
    const p = TextParse.parseCard(c);
    const out = $('#cf-parsed');
    out.innerHTML = '';
    const auto = TextParse.describe(p);
    out.append(el('div', { class: 'good', text: auto.length ? '✓ ' + auto.join(' / ') : '（自動処理する能力なし）' }));
    if (p.manual.length) out.append(el('div', { class: 'warn' }, '手動で処理する文:', el('ul', {}, p.manual.map((m) => el('li', { text: m })))));
    for (const k of uniqKnown(p)) out.append(el('div', { class: 'muted' }, `認識：${k.name}（${k.desc}）`));
    if (!c.civs.length) out.append(el('div', { class: 'bad', text: '文明を選んでください' }));
  }
  document.querySelectorAll('#card-edit input, #card-edit select, #card-edit textarea').forEach((i) => {
    if (i.type !== 'file') i.addEventListener('input', updateCardPreview);
  });

  function saveCard(silent) {
    const c = formToCard();
    if (!c.name) {
      if (!silent) alert('カード名を入れてください');
      return false;
    }
    const dup = Store.cards.find((x) => x.id !== c.id && G_norm(x.name) === G_norm(c.name));
    if (dup && !silent && !confirm(`同じ名前のカード（${dup.id}）があります。デッキでは先に登録された方が使われます。保存しますか？`)) return false;
    const i = Store.cards.findIndex((x) => x.id === c.id);
    if (i >= 0) Store.cards[i] = c;
    else Store.cards.push(c);
    draft = null;
    Store.saveCards();
    $('#cf-id').textContent = 'ID: ' + c.id;
    renderCardList();
    return true;
  }
  const G_norm = (s) => window.normName(s);
  $('#cf-save').addEventListener('click', () => saveCard(false));
  $('#cf-open-official').addEventListener('click', () => window.open(officialUrl(formToCard()), '_blank', 'noopener'));
  $('#cf-dup').addEventListener('click', () => {
    const c = formToCard();
    draft = { ...c, id: Store.newId(), name: c.name + '（コピー）' };
    cardSel = draft.id;
    loadCardForm(draft);
    renderCardList();
  });
  $('#cf-del').addEventListener('click', async () => {
    const c = Store.byId(cardSel);
    if (!c) {
      draft = null;
      cardSel = null;
      return renderCardList();
    }
    if (!confirm(`「${c.name}」を削除しますか？`)) return;
    Store.cards = Store.cards.filter((x) => x.id !== c.id);
    Store.saveCards();
    await Store.setImage(c.id, null).catch(() => {});
    cardSel = null;
    renderCardList();
  });

  async function setCardImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (!saveCard(true)) return alert('先にカード名を入れてください');
    await Store.setImage(cardSel, file);
    updateCardPreview();
    renderCardList();
  }
  $('#cf-file').addEventListener('change', (e) => setCardImage(e.target.files[0]));
  $('#cf-img-del').addEventListener('click', async () => {
    await Store.setImage(cardSel, null).catch(() => {});
    $('#cf-url').value = '';
    saveCard(true);
    updateCardPreview();
  });
  const pvBox = $('.cardform .preview');
  pvBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    pvBox.classList.add('drag');
  });
  pvBox.addEventListener('dragleave', () => pvBox.classList.remove('drag'));
  pvBox.addEventListener('drop', (e) => {
    e.preventDefault();
    pvBox.classList.remove('drag');
    setCardImage(e.dataTransfer.files[0]);
  });

  // 画像まとめて
  $('#img-bulk').addEventListener('click', () => $('#img-bulk-input').click());
  $('#img-bulk-input').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    let ok = 0;
    const miss = [];
    for (const f of files) {
      const base = f.name.replace(/\.[^.]+$/, '');
      const def = Store.byName(base) || Store.byId(base);
      if (def) {
        await Store.setImage(def.id, f);
        ok++;
      } else miss.push(f.name);
    }
    e.target.value = '';
    renderCardList();
    if (cardSel) updateCardPreview();
    alert(`${ok}枚の画像を割り当てました。` + (miss.length ? `\n対応するカードが見つからなかった画像（${miss.length}）:\n` + miss.slice(0, 30).join('\n') : ''));
  });

  // バックアップ
  $('#data-export').addEventListener('click', async () => {
    const images = {};
    for (const c of Store.cards) {
      const b = await Store.getImageBlob(c.id);
      if (b) images[c.id] = await blobToDataUrl(b);
    }
    const data = { app: 'dmsolo', version: 1, cards: Store.cards, decks: Store.decks, images };
    const a = el('a', {
      href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })),
      download: `hitorimawashi-backup-${new Date().toISOString().slice(0, 10)}.json`,
    });
    document.body.append(a);
    a.click();
    a.remove();
  });
  // 文字コード（UTF-8 / UTF-16）やBOMの違いを吸収して読む
  async function readTextLoose(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
    if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
    // BOMなしUTF-16（1バイトおきに0が並ぶ）
    if (buf.length > 4 && buf[1] === 0 && buf[3] === 0) return new TextDecoder('utf-16le').decode(buf);
    return new TextDecoder('utf-8').decode(buf);
  }
  // 前後のゴミ（BOM・空白・説明文など）を除いて JSON を取り出す
  function parseJsonLoose(text) {
    let t = text.replace(/^﻿/, '').trim();
    try {
      return JSON.parse(t);
    } catch (e) {
      const s = t.search(/[{[]/);
      const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
      if (s < 0 || end <= s) throw new Error('中に { や [ が見つかりません');
      return JSON.parse(t.slice(s, end + 1));
    }
  }
  function blobToDataUrl(b) {
    return new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(b);
    });
  }
  $('#data-import').addEventListener('click', () => $('#data-import-input').click());
  $('#data-import-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let data;
    let text = '';
    try {
      text = await readTextLoose(f);
      data = parseJsonLoose(text);
    } catch (err) {
      const head = text.slice(0, 80).replace(/\s+/g, ' ');
      return alert(
        `JSONとして読めませんでした。\n\nファイル: ${f.name}（${f.size.toLocaleString()} バイト）\n理由: ${err.message}\n先頭: ${head || '（空）'}\n\n` +
          'ダウンロードしたファイルの名前が .json で終わっているか、中身が「{"app":"dmsolo"」で始まっているかを確認してください。'
      );
    }
    const cards = Array.isArray(data) ? data : data.cards || [];
    const decks = Array.isArray(data) ? [] : data.decks || [];
    let nc = 0;
    for (const raw of cards) {
      const c = normalizeImportedCard(raw);
      if (!c) continue;
      const i = Store.cards.findIndex((x) => x.id === c.id || (!raw.id && G_norm(x.name) === G_norm(c.name)));
      if (i >= 0) Store.cards[i] = { ...c, id: Store.cards[i].id };
      else Store.cards.push(c);
      nc++;
    }
    for (const d of decks) {
      if (!d || !d.name) continue;
      const i = Store.decks.findIndex((x) => x.id === d.id);
      const dd = { id: d.id || 'd-' + Math.random().toString(36).slice(2), name: d.name, list: d.list || '' };
      if (i >= 0) Store.decks[i] = dd;
      else Store.decks.push(dd);
    }
    let ni = 0;
    for (const [id, url] of Object.entries(data.images || {})) {
      try {
        const b = await (await fetch(url)).blob();
        await Store.setImage(id, b);
        ni++;
      } catch (err) {
        /* skip */
      }
    }
    await Store.saveCards();
    Store.saveDecks();
    renderCardList();
    alert(`カード${nc}枚・デッキ${decks.length}個・画像${ni}枚を読み込みました（保存済み）`);
  });

  const CIV_FROM = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature', ゼロ: 'zero', 無色: 'zero' };
  function normalizeImportedCard(r) {
    if (!r || !r.name) return null;
    let civs = r.civs || r.civilizations || r.civ || [];
    if (typeof civs === 'string') civs = civs.split(/[\s/／,、・]+/);
    civs = civs.map((c) => CIV_FROM[c] || String(c).toLowerCase()).filter((c) => CIVS.includes(c));
    let type = r.type || 'creature';
    if (/呪文|spell/i.test(type)) type = 'spell';
    else if (/タマシード|tamaseed/i.test(type)) type = 'tamaseed';
    else if (/城|castle/i.test(type)) type = 'castle';
    else if (/フィールド|field/i.test(type)) type = 'field';
    else type = 'creature';
    let races = r.races || [];
    if (typeof races === 'string') races = races.split(/[\s/／,、]+/).filter(Boolean);
    return {
      id: r.id || Store.newId(),
      name: String(r.name),
      civs,
      cost: +r.cost || 0,
      type,
      power: NON_CREATURE.includes(type) ? null : r.power == null || r.power === '' ? null : parseInt(String(r.power).replace(/[^\d]/g, ''), 10) || 0,
      races,
      text: r.text || '',
      imageUrl: r.imageUrl || r.image || '',
      flavor: r.flavor || '',
      officialUrl: r.officialUrl || '',
      evolution: r.evolution || '',
      twin: r.twin && r.twin.name ? { name: String(r.twin.name), cost: +r.twin.cost || 0, text: r.twin.text || '' } : null,
    };
  }

  $('#data-reset').addEventListener('click', () => {
    if (!confirm('カードとデッキをサンプルに戻します（登録したものは消えます）。よろしいですか？\n※先にバックアップを保存しておくと安全です')) return;
    Store.cards = Samples.cards.map((c) => ({ ...c }));
    Store.decks = Samples.decks.map((d) => ({ ...d }));
    Store.saveCards();
    Store.saveDecks();
    cardSel = null;
    renderCardList();
  });

  // =====================================================================
  // 公式から取り込む
  // =====================================================================
  $('#off-bookmarklet').href = Official.bookmarkletHref();
  $('#off-bookmarklet').addEventListener('click', (e) => {
    e.preventDefault();
    alert('このボタンはクリックではなく、ブラウザのブックマークバーへドラッグして登録してください。\n登録後、公式のカード詳細ページを開いた状態でそのブックマークを押します。');
  });
  $('#off-open').addEventListener('click', () => {
    const url = $('#off-url').value.trim();
    if (!/^https:\/\/dm\.takaratomy\.co\.jp\/card\/detail\/\?id=/.test(url)) {
      return alert('公式のカード詳細ページのURL（https://dm.takaratomy.co.jp/card/detail/?id=…）を貼ってください');
    }
    // 取り込みデータを送り返してもらうため、opener を残して開く
    window.open(url, 'dmofficial');
  });
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.app === 'dmsolo-official') importOfficial(d);
    if (d && d.app === 'dmsolo-official-batch') importOfficialBatch(d.cards || [], d.skipped || 0);
    // 公式ページのブックマークから「取り込み済みのカード」を聞かれたら答える
    if (d && d.app === 'dmsolo-ask-known' && e.source) {
      const ids = Store.cards.map((c) => Official.idFromUrl(c.officialUrl)).filter(Boolean);
      try {
        e.source.postMessage({ app: 'dmsolo-known', ids }, '*');
      } catch (err) {
        /* 送れなければスキップなしで進む */
      }
    }
  });
  async function importOfficialBatch(list, skipped = 0) {
    let add = 0;
    let upd = 0;
    let manualCards = 0;
    for (const d of list) {
      try {
        const r = await importOfficial(d, true);
        if (r === 'add') add++;
        else if (r === 'update') upd++;
        const nm = Official.toCard(d).name;
        if (r && !(window.CardScripts && CardScripts.get(nm)) && TextParse.parseCard(Store.byName(nm)).manual.length) manualCards++;
      } catch (e) {
        /* 読めなかったカードは飛ばす */
      }
    }
    Store.saveCards();
    showTab('cards');
    alert(`${list.length}枚を取り込みました（追加 ${add}・更新 ${upd}${skipped ? `・取り込み済みでスキップ ${skipped}` : ''}）。\n手動の文が残っているカード: ${manualCards}枚`);
  }
  $('#off-search').addEventListener('click', () => window.open('https://dm.takaratomy.co.jp/card/', 'dmofficial'));
  $('#off-pack-btn').addEventListener('click', () => {
    const code = $('#off-pack').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!code) return alert('パックの記号を入れてください（例: dm26ex4）。公式サイトの商品ページURLの最後の部分です');
    window.open('https://dm.takaratomy.co.jp/card/#dmsolo-pack=' + code, 'dmofficial');
    alert(`公式サイトを開きました。開いたページで、ブックマーク「DM取り込み」を押してください。\nパック「${code}」のカードを番号順に取り込みます。`);
  });
  $('#off-paste-btn').addEventListener('click', () => {
    try {
      const d = parseJsonLoose($('#off-paste').value);
      if (d && d.app === 'dmsolo-official-batch') {
        importOfficialBatch(d.cards || []);
        $('#off-paste').value = '';
        return;
      }
      if (!d || d.app !== 'dmsolo-official') throw new Error('取り込みデータではありません');
      importOfficial(d);
      $('#off-paste').value = '';
    } catch (err) {
      alert('読み込めませんでした: ' + err.message);
    }
  });

  async function importOfficial(d, quiet) {
    let c;
    try {
      c = Official.toCard(d);
    } catch (err) {
      return alert(err.message);
    }
    const old = Store.byName(c.name);
    if (old) {
      c.id = old.id;
      Object.assign(old, c);
      Store._nameIdx = null;
    } else {
      c.id = Store.newId();
      Store.cards.push(c);
    }
    // 公式画像を優先して表示する（手元の画像は外す）
    if (Store.imageUrls[c.id]) await Store.setImage(c.id, null).catch(() => {});
    if (quiet) return old ? 'update' : 'add';
    Store.saveCards();
    showTab('cards');
    selectCard(c.id);
    const p = TextParse.parseCard(c);
    alert(`「${c.name}」を${old ? '更新' : '追加'}しました。\n自動処理: ${TextParse.describe(p).join(' / ') || 'なし'}${p.manual.length ? `\n手動の文: ${p.manual.length}件` : ''}`);
  }

  // キーワード一覧（使い方タブ）
  (function () {
    const box = $('#kw-list');
    if (!box || !window.Keywords) return;
    for (const k of Keywords.list) {
      box.append(el('div', { class: 'kw ' + (k.auto ? 'auto' : 'man') }, el('span', { class: 'tag', text: k.auto ? '自動' : '手動' }), el('b', { text: k.name }), el('span', { class: 'muted', text: '　' + k.desc })));
    }
  })();

  // ===== 起動 =====
  Store.init().then(() => {
    refreshSetup();
  });
})();
