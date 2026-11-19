// 画面まわり
(function () {
  'use strict';
  const { Game, CIV_LABEL, parsed } = Engine;
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
        el('div', { class: 'pw', text: def.type === 'spell' ? '呪文' : def.power ?? '' })
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
      el('div', { class: 'muted', text: `${civ}　コスト${def.cost}　${def.type === 'spell' ? '呪文' : 'パワー' + (pw ?? '')}　${(def.races || []).join(' / ')}` }),
      el('div', { class: 'ztext', text: def.text || '' })
    );
    const auto = TextParse.describe(p);
    if (auto.length) z.append(el('div', { class: 'zauto', text: '自動: ' + auto.join(' / ') }));
    if (p.manual.length) z.append(el('div', { class: 'zman', text: '手動: ' + p.manual.join(' / ') }));
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
    startGame();
  });

  function startGame() {
    const { my, ai, a, b } = lastSetup;
    mode = $('#setup-mode').value;
    const f = $('#setup-first').value;
    const first = f === 'me' ? 0 : f === 'ai' ? 1 : Math.random() < 0.5 ? 0 : 1;
    $('#log').innerHTML = '';
    $('#zoom').innerHTML = '<div class="muted">カードにマウスを乗せると、ここに大きく表示されます</div>';
    const names = mode === 'solo' ? [`自分（${my.name}）`, `相手（${ai.name}）`] : mode === 'watch' ? [`AI-1（${my.name}）`, `AI-2（${ai.name}）`] : ['あなた', 'AI'];
    game = new Game({
      decks: [a.defs, b.defs],
      names,
      ai: [mode === 'watch', mode !== 'solo'],
      first,
      aiDelay: +$('#setup-speed').value,
      chooser: humanChoose,
      onChange: queueRender,
      onLog: addLog,
    });
    $('#setup').hidden = true;
    $('#board').hidden = false;
    const g = game;
    g.run().then(() => {
      if (game === g) {
        render();
        showResult();
      }
    });
    render();
  }

  $('#btn-end').addEventListener('click', () => game && game.endTurn());
  $('#btn-quit').addEventListener('click', () => {
    if (game && game.winner == null && !confirm('対戦をやめますか？')) return;
    quitGame();
  });
  function quitGame() {
    if (game) {
      game.opts.onChange = null;
      game.opts.onLog = null;
      game.abort();
    }
    game = null;
    closeModal();
    $('#board').hidden = true;
    $('#setup').hidden = false;
    refreshSetup();
  }

  function showResult() {
    if (!game || game.winner == null) return;
    const humanWon = mode === 'vsai' ? game.winner === 0 : null;
    openModal(
      el(
        'div',
        { class: 'result' },
        el('div', { class: 'big', text: humanWon == null ? `${game.p[game.winner].name}の勝ち` : humanWon ? '勝利！' : '敗北…' }),
        el('div', { class: 'muted', text: `${game.endReason}（${game.turn}ターン）` }),
        el(
          'div',
          { class: 'acts', style: { justifyContent: 'center', marginTop: '14px' } },
          el('button', { class: 'primary', text: 'もう一度', onclick: () => (closeModal(), startGame()) }),
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

  const isHuman = (pi) => game && !game.p[pi].isAI;
  const canAct = (pi) => game && game.winner == null && isHuman(pi) && game.active === pi && !game.busy && modal.hidden;
  const visibleHand = (pi) => mode !== 'vsai' || pi === 0;

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
    $('#btn-end').disabled = !(isHuman(g.active) && g.winner == null);
    for (const pi of [0, 1]) renderSide(pi);
  }

  function renderSide(pi) {
    const g = game;
    const pl = g.p[pi];
    const root = $('#side-' + pi);
    root.innerHTML = '';
    root.classList.toggle('active', g.active === pi);

    // バトルゾーン
    const battle = zone('battle', `${pl.name}　バトルゾーン`);
    for (const c of pl.battle) battle.c.append(instCard(c, 'battle'));
    // シールド・マナ・山札・墓地
    const row = el('div', { class: 'zrow' });
    const sh = zone('shields', `シールド ${pl.shields.length}`);
    pl.shields.forEach((c, i) => {
      const e = cardBack(i + 1);
      e.style.setProperty('--cw', '54px');
      e.addEventListener('contextmenu', (ev) => manualMenu(ev, c, 'shields'));
      sh.c.append(e);
    });
    const untapped = pl.mana.filter((m) => !m.tapped).length;
    const mana = zone('mana', `マナ ${untapped}/${pl.mana.length}　${manaCivSummary(pl)}`);
    for (const c of pl.mana) {
      const e = instCard(c, 'mana');
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
      can = g.canPlay(pi, c) || g.canCharge(pi, c);
    } else if (mine && z === 'battle') {
      const t = g.attackTargets(c);
      clickable = can = t.length > 0;
    }
    const e = cardFace(c.def, { inst: c, click: clickable, nameBadge: z !== 'mana' });
    if (c.tapped) e.classList.add('tapped');
    if (z === 'battle' && c.sick && !c.tapped) e.classList.add('sick');
    if (can) e.classList.add('can');
    if (z === 'battle' && c.def.type !== 'spell') {
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
        run: () => g.act(() => g.play(pi, c.uid)),
      },
      {
        label: g.manaCharged ? 'マナに置く（このターンは置いた）' : 'マナに置く',
        disabled: !g.canCharge(pi, c),
        run: () => g.act(() => g.chargeMana(pi, c.uid)),
      },
    ]);
  }

  function attackMenu(ev, c) {
    ev.stopPropagation();
    const g = game;
    const pi = c.owner;
    const ts = g.attackTargets(c);
    openMenu(
      ev.clientX,
      ev.clientY,
      `${c.def.name}（${g.power(c)}）で攻撃`,
      ts.map((t) =>
        t === 'player'
          ? {
              label: `${g.opp(pi).name}を攻撃（シールド${g.opp(pi).shields.length}）`,
              run: () => g.act(() => g.attack(pi, c.uid, 'player')),
            }
          : { label: `「${t.def.name}」(${g.power(t)})を攻撃`, run: () => g.act(() => g.attack(pi, c.uid, t.uid)) }
      )
    );
  }

  function manualMenu(ev, c, z) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!game || game.busy) return;
    const g = game;
    const owner = g.p[c.owner].name;
    const items = [];
    const mv = (zone, opt, label) => ({ label, disabled: z === zone && !opt, run: () => g.manualMove(c.uid, zone, opt) });
    if (z === 'battle' || z === 'mana') items.push({ label: c.tapped ? 'アンタップする' : 'タップする', run: () => g.manualTap(c.uid) });
    if (z === 'shields') items.push({ label: '表を見る', run: () => showZoom(c.def, c) });
    items.push(
      mv('hand', null, '手札へ'),
      mv('battle', null, 'バトルゾーンへ'),
      mv('mana', null, 'マナへ'),
      mv('grave', null, '墓地へ'),
      mv('shields', null, 'シールドへ'),
      mv('deck', { top: true }, '山札の上へ'),
      mv('deck', { top: false }, '山札の下へ')
    );
    if (z === 'hand' && c.def.type === 'spell')
      items.push({ label: '呪文の効果をコストなしで解決', run: () => g.act(() => g.putIntoPlay(c.owner, c, true)) });
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
      { label: '1枚引く', disabled: !top, run: () => g.manualDraw(pi) },
      { label: 'シャッフル', run: () => g.manualShuffle(pi) },
      { label: '上の1枚を見る', disabled: !top, run: () => showZoom(top.def, top) },
      { label: '上の1枚をマナへ', disabled: !top, run: () => g.manualMove(top.uid, 'mana') },
      { label: '上の1枚をシールドへ', disabled: !top, run: () => g.manualMove(top.uid, 'shields') },
      { label: '上の1枚を墓地へ', disabled: !top, run: () => g.manualMove(top.uid, 'grave') },
      { label: '山札をすべて見る', run: () => pileModal(pi, 'deck') },
    ]);
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
        box.append(el('div', { class: 'opt' }, e));
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
      el('h3', { text: `${pl.name}の${z === 'grave' ? '墓地' : '山札'}（${pl[z].length}枚）　右クリックで移動` }),
      box,
      el('div', { class: 'acts' }, el('button', { text: '閉じる', onclick: () => ((g.opts.onChange = prev), closeModal(), render()) }))
    );
  }

  // ===== 人間の選択 =====
  function humanChoose(g, pi, req) {
    return new Promise((resolve) => {
      const who = mode === 'solo' ? `[${g.p[pi].name}] ` : '';
      const selected = new Set();
      const done = (ids) => {
        closeModal();
        resolve(ids);
        render();
      };
      const head = el('h3', { text: who + req.prompt });
      const kids = [head];

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
    out.append(el('span', { class: r.count === 40 ? 'good' : 'warn', text: `${r.count}枚` + (r.count === 40 ? '' : '（40枚が基本です）') }));
    const civ = {};
    let trig = 0;
    for (const def of r.defs) {
      for (const c of def.civs || []) civ[c] = (civ[c] || 0) + 1;
      if (parsed(def).kw.shieldTrigger) trig++;
    }
    out.append(`　文明: ${Object.entries(civ).map(([c, n]) => CIV_LABEL[c] + n).join(' ')}　S・トリガー: ${trig}枚`);
    const over = r.entries.reduce((m, e) => ((m[e.def.name] = (m[e.def.name] || 0) + e.n), m), {});
    const o4 = Object.entries(over).filter(([, n]) => n > 4);
    if (o4.length) out.append(el('div', { class: 'warn', text: '5枚以上: ' + o4.map(([k, n]) => `${k}×${n}`).join('、') }));
    if (r.unknown.length) out.append(el('div', { class: 'bad', text: '未登録のカード: ' + r.unknown.join('、') }));
    const pv = $('#deck-preview');
    pv.innerHTML = '';
    const merged = new Map();
    for (const e of r.entries) merged.set(e.def, (merged.get(e.def) || 0) + e.n);
    for (const [def, n] of merged) {
      const e = cardFace(def, { nameBadge: true });
      e.style.setProperty('--cw', '96px');
      pv.append(el('div', { class: 'gi' }, e, el('span', { class: 'n', text: '×' + n })));
    }
    $('#deck-addmissing').disabled = !r.unknown.length;
    return r;
  }
  $('#deck-text').addEventListener('input', checkDeck);
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
    const list = Store.cards
      .filter((c) => !q || (c.name + ' ' + (c.text || '') + ' ' + (c.races || []).join(' ')).normalize('NFKC').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name, 'ja'));
    for (const c of list) {
      ul.append(
        el(
          'li',
          { class: c.id === cardSel ? 'on' : '', onclick: () => selectCard(c.id) },
          el('span', { class: 'dot', style: { background: civBg(c.civs) } }),
          el('span', { text: c.name }),
          el('span', { class: 'c', text: `${c.cost}${Store.imageUrls[c.id] || c.imageUrl ? ' 🖼' : ''}` })
        )
      );
    }
    if (!cardSel && !draft && Store.cards[0]) selectCard(list[0]?.id || Store.cards[0].id);
  }
  $('#card-search').addEventListener('input', renderCardList);

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
      power: type === 'spell' ? null : $('#cf-power').value === '' ? null : +$('#cf-power').value,
      races: $('#cf-races').value.split(/[\s　/／,、]+/).filter(Boolean),
      text: $('#cf-text').value,
      imageUrl: $('#cf-url').value.trim(),
    };
  }
  function updateCardPreview() {
    const c = formToCard();
    $('#cf-power').disabled = c.type === 'spell';
    const pv = $('#cf-preview');
    pv.innerHTML = '';
    pv.append(cardFace(c));
    const p = TextParse.parseCard(c);
    const out = $('#cf-parsed');
    out.innerHTML = '';
    const auto = TextParse.describe(p);
    out.append(el('div', { class: 'good', text: auto.length ? '✓ ' + auto.join(' / ') : '（自動処理する能力なし）' }));
    if (p.manual.length) out.append(el('div', { class: 'warn' }, '手動で処理する文:', el('ul', {}, p.manual.map((m) => el('li', { text: m })))));
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
    try {
      data = JSON.parse(await f.text());
    } catch (err) {
      return alert('JSONとして読めませんでした');
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
    Store.saveCards();
    Store.saveDecks();
    renderCardList();
    alert(`カード${nc}枚・デッキ${decks.length}個・画像${ni}枚を読み込みました`);
  });

  const CIV_FROM = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature', ゼロ: 'zero', 無色: 'zero' };
  function normalizeImportedCard(r) {
    if (!r || !r.name) return null;
    let civs = r.civs || r.civilizations || r.civ || [];
    if (typeof civs === 'string') civs = civs.split(/[\s/／,、・]+/);
    civs = civs.map((c) => CIV_FROM[c] || String(c).toLowerCase()).filter((c) => CIVS.includes(c));
    let type = r.type || 'creature';
    if (/呪文|spell/i.test(type)) type = 'spell';
    else type = 'creature';
    let races = r.races || [];
    if (typeof races === 'string') races = races.split(/[\s/／,、]+/).filter(Boolean);
    return {
      id: r.id || Store.newId(),
      name: String(r.name),
      civs,
      cost: +r.cost || 0,
      type,
      power: type === 'spell' ? null : r.power == null || r.power === '' ? null : parseInt(String(r.power).replace(/[^\d]/g, ''), 10) || 0,
      races,
      text: r.text || '',
      imageUrl: r.imageUrl || r.image || '',
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

  // ===== 起動 =====
  Store.init().then(() => {
    refreshSetup();
  });
})();
