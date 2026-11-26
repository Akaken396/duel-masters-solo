// 言語AI（Ollama）に手を選ばせるAI。
// ルールと盤面はエンジンが管理し、言語AIには「今できる手」を番号つきで見せて選ばせるだけ。
// 答えがおかしい・つながらない時は、いつものルール型AIにまかせる。
(function (G) {
  'use strict';

  const CIV = { light: '光', water: '水', darkness: '闇', fire: '火', nature: '自然', zero: 'ゼロ' };
  const civs = (d) => (d.civs || []).map((c) => CIV[c] || c).join('/');
  const short = (t, n = 90) => String(t || '').replace(/（[^）]*）|\([^)]*\)/g, '').replace(/\s+/g, ' ').slice(0, n);

  function cardLine(g, c, o = {}) {
    const d = c.def;
    const parts = [`${d.name}（${civs(d)}・コスト${d.cost ?? '-'}`];
    if (o.battle && g.isCreature(c)) parts.push(`パワー${g.power(c)}`);
    else if (d.power != null && d.type === 'creature') parts.push(`パワー${d.power}`);
    let s = parts.join('・') + '）';
    if (c.tapped) s += '［タップ］';
    if (o.battle && c.sick && g.isCreature(c)) s += '［召喚酔い］';
    if (o.text && d.text) s += '：' + short(d.text);
    if (o.text && d.twin) s += ` ／ 呪文側「${d.twin.name}」コスト${d.twin.cost}：${short(d.twin.text, 60)}`;
    return s;
  }

  // そのプレイヤーに見えている情報だけを文章にする
  function describe(g, pi) {
    const me = g.p[pi];
    const op = g.p[1 - pi];
    const L = [];
    L.push(`ターン${g.turn}。今は${g.active === pi ? 'あなた' : '相手'}の番。`);
    L.push(`【あなた】シールド${me.shields.length}枚、山札${me.deck.length}枚、マナ${me.mana.filter((m) => !m.tapped).length}/${me.mana.length}（${[...new Set(me.mana.flatMap((m) => (m.def.civs || []).map((c) => CIV[c])))].join('・') || 'なし'}）`);
    L.push('手札：' + (me.hand.length ? '\n' + me.hand.map((c) => '  - ' + cardLine(g, c, { text: true })).join('\n') : 'なし'));
    L.push('バトルゾーン：' + (me.battle.length ? '\n' + me.battle.map((c) => '  - ' + cardLine(g, c, { battle: true, text: true })).join('\n') : 'なし'));
    L.push('墓地：' + (me.grave.length ? me.grave.slice(-10).map((c) => c.def.name).join('、') + (me.grave.length > 10 ? ` ほか${me.grave.length - 10}枚` : '') : 'なし'));
    L.push(`【相手】シールド${op.shields.length}枚、手札${op.hand.length}枚、山札${op.deck.length}枚、マナ${op.mana.length}枚`);
    L.push('相手のバトルゾーン：' + (op.battle.length ? '\n' + op.battle.map((c) => '  - ' + cardLine(g, c, { battle: true, text: true })).join('\n') : 'なし'));
    L.push('相手の墓地：' + (op.grave.length ? op.grave.slice(-8).map((c) => c.def.name).join('、') : 'なし'));
    const recent = (g.logs || []).slice(-8).filter((x) => !/^🤖/.test(x));
    if (recent.length) L.push('最近の出来事：\n' + recent.map((x) => '  ' + x).join('\n'));
    return L.join('\n');
  }

  const SYSTEM = [
    'あなたはトレーディングカードゲーム「デュエル・マスターズ」の上手なプレイヤーです。',
    'ルールの処理はゲームが正確に行います。あなたは示された選択肢の中から、勝つために最も良いものを選んでください。',
    '基本：毎ターン1枚マナに置ける。マナを払ってカードを使う。クリーチャーは出たターンは攻撃できない（召喚酔い）。',
    'シールドが0の相手に攻撃が通れば勝ち。相手の返しの攻撃で負けないように、守りも考える。',
    '答えは必ずJSONだけで返す：{"choice": [選んだ番号...], "reason": "短い理由"}',
  ].join('\n');

  function make(cfg) {
    const rule = G.AI;
    const base = String(cfg.url || 'http://localhost:11434').replace(/\/+$/, '');
    const stats = { asked: 0, failed: 0 };

    async function ask(g, pi, question, options, min, max) {
      const prompt = [
        cfg.memo ? '【あなたのデッキの作戦】\n' + cfg.memo + '\n' : '',
        '【盤面】',
        describe(g, pi),
        '',
        '【質問】' + question,
        options.map((o, i) => `${i + 1}. ${o}`).join('\n'),
        '',
        min === max ? `ちょうど${min}個の番号を選んでください。` : `${min}〜${max}個の番号を選んでください。`,
      ].join('\n');
      stats.asked++;
      g.aiThinking = true;
      g.changed && g.changed();
      try {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), (cfg.timeoutSec || 90) * 1000) : null;
        const r = await fetch(base + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctl ? ctl.signal : undefined,
          body: JSON.stringify({
            model: cfg.model,
            stream: false,
            format: 'json',
            options: { temperature: 0.3, num_ctx: cfg.numCtx || 8192 },
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: prompt },
            ],
          }),
        });
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('Ollama ' + r.status);
        const j = await r.json();
        const text = (j.message && j.message.content) || '';
        let obj = null;
        try {
          obj = JSON.parse(text);
        } catch (e) {
          const m = text.match(/\{[\s\S]*\}/);
          if (m) obj = JSON.parse(m[0]);
        }
        let ch = obj && (obj.choice ?? obj.choices ?? obj.number);
        if (!Array.isArray(ch)) ch = ch == null ? [] : [ch];
        const nums = [...new Set(ch.map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= options.length))];
        if (nums.length < min || nums.length > max) throw new Error('答えの数が合わない: ' + text.slice(0, 80));
        if (obj.reason) g.log(`🤖 ${String(obj.reason).slice(0, 120)}`);
        return nums.map((x) => x - 1);
      } catch (e) {
        stats.failed++;
        if (stats.failed <= 3 || stats.failed % 10 === 0) g.log(`🤖 言語AIの答えが使えなかったので、ふつうのAIで選んだ（${String(e.message || e).slice(0, 60)}）`);
        return null;
      } finally {
        g.aiThinking = false;
      }
    }

    // その場でできる手の一覧
    function actions(g, pi) {
      const me = g.p[pi];
      const out = [];
      for (const c of me.hand) {
        if (g.canPlay(pi, c)) out.push({ label: `手札の「${c.def.name}」を使う（コスト${c.def.cost}）`, run: () => g.play(pi, c.uid) });
        if (g.canPlayTwin && g.canPlayTwin(pi, c)) out.push({ label: `手札の「${c.def.name}」の呪文側「${g.twin(c).name}」を使う（コスト${g.twin(c).cost}）`, run: () => g.playTwin(pi, c.uid) });
        if (g.canCharge(pi, c)) out.push({ label: `手札の「${c.def.name}」をマナに置く`, run: () => g.chargeMana(pi, c.uid) });
      }
      for (const c of [...me.grave, ...me.mana, ...(me.hyper || [])]) {
        if (g.canPlayFromGrave(pi, c)) out.push({ label: `${{ grave: '墓地', mana: 'マナ', hyper: '超次元ゾーン' }[g.zoneOf(c)] || ''}の「${c.def.name}」を使う`, run: () => g.playFromGrave(pi, c.uid) });
      }
      for (const c of me.battle) {
        for (const t of g.attackTargets(c)) out.push({ label: t === 'player' ? `「${c.def.name}」（パワー${g.power(c)}）で相手プレイヤーを攻撃` : `「${c.def.name}」（パワー${g.power(c)}）で相手の「${t.def.name}」（パワー${g.power(t)}${t.tapped ? '・タップ' : ''}）を攻撃`, run: () => g.attack(pi, c.uid, t === 'player' ? 'player' : t.uid) });
        if (g.canTapAbility(c)) out.push({ label: `「${c.def.name}」をタップして能力を使う`, run: () => g.useTapAbility(pi, c.uid) });
      }
      out.push({ label: 'ターンを終了する', end: true });
      return out;
    }

    async function takeTurn(g, pi) {
      if (pi !== cfg.player) return rule.takeTurn(g, pi);
      await g.pause();
      let fails = 0;
      for (let step = 0; step < 40; step++) {
        if (g.winner != null || g.p[pi].skipRestTurn === g.turn) break;
        const acts = actions(g, pi);
        if (acts.length === 1) break;
        const r = await ask(g, pi, 'あなたの番です。次に何をしますか？', acts.map((a) => a.label), 1, 1);
        if (!r) {
          // 言語AIが使えない時は、このターンの残りをふつうのAIにまかせる
          if (++fails >= 2) return rule.takeTurn(g, pi);
          continue;
        }
        const a = acts[r[0]];
        if (a.end) break;
        const ok = await a.run();
        if (ok === false) g.log(`🤖 「${a.label}」はできなかった`);
        await g.pause();
      }
      g.log(`${g.p[pi].name}はターンを終了した`);
    }

    async function choose(g, pi, req) {
      if (pi !== cfg.player || cfg.choices === false) return rule.choose(g, pi, req);
      const opts = req.options || [];
      const min = Math.min(req.min ?? 1, opts.length);
      const max = Math.min(req.max ?? 1, opts.length);
      // 迷う余地のない質問は聞かない
      if (opts.length <= 1 || max === 0 || (min === max && max === opts.length)) return rule.choose(g, pi, req);
      if (/どう払いますか|支払い/.test(req.prompt || '')) return rule.choose(g, pi, req);
      const labels = opts.map((o) => {
        if (o.card) {
          const own = o.card.owner === pi ? '自分' : '相手';
          const z = g.zoneOf(o.card);
          const hidden = (z === 'hand' || z === 'shields' || z === 'deck') && o.card.owner !== pi && !o.card.faceUp;
          return hidden ? `${own}の${{ hand: '手札', shields: 'シールド', deck: '山札' }[z]}のカード` : `${own}の${{ battle: 'バトルゾーン', hand: '手札', mana: 'マナ', grave: '墓地', shields: 'シールド', deck: '山札' }[z] || ''}の「${o.card.def.name}」${z === 'battle' && g.isCreature(o.card) ? `（パワー${g.power(o.card)}）` : ''}`;
        }
        return String(o.label || o.id);
      });
      const r = await ask(g, pi, String(req.prompt || '選んでください'), labels, min, max);
      if (!r) return rule.choose(g, pi, req);
      return r.map((i) => opts[i].id);
    }

    return { takeTurn, choose, chooseCharge: rule.chooseCharge, stats, describe };
  }

  // Ollama に入っているモデルの一覧
  async function listModels(url) {
    const r = await fetch(String(url || 'http://localhost:11434').replace(/\/+$/, '') + '/api/tags');
    if (!r.ok) throw new Error('Ollama ' + r.status);
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  }

  G.LLMAI = { make, listModels, describe };
  if (typeof module !== 'undefined') module.exports = G.LLMAI;
})(typeof globalThis !== 'undefined' ? globalThis : window);
