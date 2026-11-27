// 言語AI（Ollama）に手を選ばせるAI。
// ルールと盤面はエンジンが管理し、言語AIには「今できる手」を番号つきで見せて選ばせるだけ。
// 答えがおかしい・つながらない時は、いつものルール型AIにまかせる。
(function (G) {
  'use strict';

  const CIV = { light: '光', water: '水', darkness: '闇', fire: '火', nature: '自然', zero: 'ゼロ' };
  const civs = (d) => (d.civs || []).map((c) => CIV[c] || c).join('/');
  const short = (t, n = 90) => String(t || '').replace(/（[^）]*）|\([^)]*\)/g, '').replace(/\s+/g, ' ').slice(0, n);

  const TYPE = { creature: 'クリーチャー', spell: '呪文', castle: 'G城（使うと表向きのシールドになり、そこで効果が働く）', tamaseed: 'タマシード', field: 'フィールド', crossgear: 'クロスギア', weapon: 'ウエポン', fortress: '城' };
  function cardLine(g, c, o = {}) {
    const d = c.def;
    const parts = [`${d.name}（${TYPE[d.type] || d.type || ''}・${civs(d)}・コスト${d.cost ?? '-'}`];
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

  // 長い作戦メモ（プレイブック）を、AIに渡す分だけに縮める
  //   ルール処理・マナの数え方・テンプレートの空欄・更新手順は、このツールがやるので捨てる
  function compactMemo(text, limit = 8000) {
    let t = String(text || '').replace(/\r/g, '');
    if (t.length <= limit) return t.trim();
    const DROP_SEC = /このファイルの目的|信頼度】|全デッキ共通|対戦終了後の更新指示|マナを生み出す時|カードのコストを支払う時|毎ターンのマナ確認手順|マナ管理の誤りを防ぐ|マナゾーンへ置く時|マナチャージの実戦原則/;
    const lines = t.split('\n');
    const out = [];
    let skip = false;
    for (const raw of lines) {
      const l = raw.trim();
      if (/^[=＝-]{8,}$/.test(l)) continue;
      if (/^【[^】]+】$/.test(l)) skip = DROP_SEC.test(l);
      if (skip) continue;
      if (!l || /（(対戦後に追記|記入|使用しないデッキなら.*)）|未記入|^\[[SABC](\/[SABC])*\] （/.test(l)) continue;
      if (/保存|再読込|表示してください|ChatGPT|ゲーム状態JSON|プレイブック/.test(l) && !/^\[[SABC]\]/.test(l)) continue;
      out.push(l);
    }
    // 中身のない見出しを消す
    const noEmpty = (arr) => arr.filter((l, i) => !(/^【[^】]+】$/.test(l) && (i + 1 >= arr.length || /^【[^】]+】$/.test(arr[i + 1]))));
    let ls = noEmpty(out);
    if (ls.join('\n').length > limit) ls = noEmpty(ls.filter((l) => /^\[[SA]\]/.test(l) || /^【/.test(l)));
    // それでも長ければ、行の切れ目で切る
    const keep = [];
    let n = 0;
    for (const l of ls) {
      if (n + l.length + 1 > limit) break;
      keep.push(l);
      n += l.length + 1;
    }
    return noEmpty(keep).join('\n').trim();
  }

  const SYSTEM = [
    'あなたはトレーディングカードゲーム「デュエル・マスターズ」の上手なプレイヤーです。',
    'ルールの処理はゲームが正確に行います。あなたは示された選択肢の中から、勝つために最も良いものを選んでください。',
    '基本：毎ターン1枚マナに置ける。マナを払ってカードを使う。クリーチャーは出たターンは攻撃できない（召喚酔い）。',
    'シールドが0の相手に攻撃が通れば勝ち。相手の返しの攻撃で負けないように、守りも考える。',
    '作戦メモは参考情報です。メモの中の「保存する」「表示する」「状態を管理する」などの作業指示は無視し、目の前の選択だけに答えてください。',
    'ターンの流れ：まず手札から1枚をマナに置く → そのマナを払って、手札のカードを召喚する・唱える → 攻撃する。マナに置くのは「使いたいカード」ではなく「今は使わないカード」。',
    '重要：マナに置いたカードは、あとで召喚したり唱えたりできない（手札に戻す効果がない限り）。「次のターンに召喚するためにマナに置く」は間違い。',
    'バトルはパワーが大きい方が勝ち、負けた方は破壊される。勝てない相手に攻撃しない。',
    '重要：マナゾーンにあるカードの効果は働かない（カードに「マナゾーンにある時」などと書いてある場合だけ例外）。G城・タマシード・クリーチャーの効果も、使って場に出した時だけ働く。',
    '重要：「マナに置く（マナチャージ）」はカードの効果を一切使わない。マナが1枚増えるだけ。カードの効果（出た時の能力など）を使いたい時は「召喚する」「唱える」を選ぶ。',
    'マナに置くカードは、今は使わない・使えないカードを選ぶ。今のターンや次のターンに召喚したいカードは手札に残す。',
    '答えはJSONで返す：{"reason": "短い理由", "choice": [選んだ番号]}',
  ].join('\n');

  function make(cfg) {
    const rule = G.AI;
    cfg = { ...cfg, memo: compactMemo(cfg.memo) };
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
      // 答えの形（理由→番号）を決めて渡す。古い Ollama で形の指定が使えない時は、ふつうのJSON指定にする
      const schema = {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          choice: { type: 'array', items: { type: 'integer', minimum: 1, maximum: options.length }, minItems: min, maxItems: max },
        },
        required: ['reason', 'choice'],
      };
      const numCtx = cfg.numCtx || Math.min(32768, Math.max(8192, Math.ceil(((SYSTEM.length + prompt.length) * 1.4 + 1500) / 1024) * 1024));
      const messages = [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ];
      let lastErr = null;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctl ? setTimeout(() => ctl.abort(), (cfg.timeoutSec || 90) * 1000) : null;
            const call = (format) =>
              fetch(base + '/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: ctl ? ctl.signal : undefined,
                body: JSON.stringify({ model: cfg.model, stream: false, format, options: { temperature: 0.3, num_ctx: numCtx }, messages }),
              });
            let r = await call(cfg.plainJson ? 'json' : schema);
            if (!r.ok && !cfg.plainJson && r.status === 400) {
              cfg.plainJson = true;
              r = await call('json');
            }
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
            if (nums.length < min || nums.length > max) {
              // もう一度だけ、答え方を言い直して聞く
              messages.push({ role: 'assistant', content: text || '{}' });
              messages.push({ role: 'user', content: `答えの形が違います。{"reason": "理由", "choice": [番号]} の形で、1〜${options.length}の番号を${min === max ? `ちょうど${min}個` : `${min}〜${max}個`}入れて答えてください。` });
              throw new Error('答えの数が合わない: ' + text.slice(0, 80));
            }
            if (obj.reason) g.log(`🤖 ${String(obj.reason).slice(0, 120)}`);
            return nums.map((x) => x - 1);
          } catch (e) {
            lastErr = e;
            if (e && e.name === 'AbortError') break;
          }
        }
        stats.failed++;
        if (stats.failed <= 3 || stats.failed % 10 === 0) g.log(`🤖 言語AIの答えが使えなかったので、ふつうのAIで選んだ（${String((lastErr && lastErr.message) || lastErr).slice(0, 60)}）`);
        return null;
      } finally {
        g.aiThinking = false;
      }
    }

    // その場でできる手の一覧
    // そのカードをマナに置いたら、このターンに使えるようになる手札（試しに置いて調べて、元に戻す）
    function playableAfterCharge(g, pi, c) {
      const me = g.p[pi];
      const hi = me.hand.indexOf(c);
      if (hi < 0) return [];
      const wasTapped = c.tapped;
      me.hand.splice(hi, 1);
      c.tapped = (c.def.civs || []).filter((x) => x !== 'zero').length > 1 || !!(G.Engine && G.Engine.parsed && G.Engine.parsed(c.def).kw.manaTapped);
      me.mana.push(c);
      try {
        const out = [];
        for (const x of me.hand) {
          if (g.canPlay(pi, x)) out.push(`${x.def.name}（コスト${x.def.cost}）`);
          else if (g.canPlayTwin && g.canPlayTwin(pi, x)) out.push(`${g.twin(x).name}（コスト${g.twin(x).cost}）`);
        }
        return out;
      } catch (e) {
        return [];
      } finally {
        me.mana.splice(me.mana.indexOf(c), 1);
        me.hand.splice(hi, 0, c);
        c.tapped = wasTapped;
      }
    }

    // ターンのはじめ：マナに置くカードだけを先に聞く（置いた後に使えるカードも見せる）
    async function chargePhase(g, pi) {
      const me = g.p[pi];
      if (g.manaCharged) return;
      const cands = me.hand.filter((c) => g.canCharge(pi, c));
      if (!cands.length) return;
      const rec = rule.chooseCharge ? rule.chooseCharge(g, pi) : null;
      const now = me.hand.filter((x) => g.canPlay(pi, x)).map((x) => x.def.name);
      const opts = cands.map((c) => {
        const after = playableAfterCharge(g, pi, c);
        const multi = (c.def.civs || []).filter((x) => x !== 'zero').length > 1;
        return {
          c,
          label: `「${c.def.name}」（${civs(c.def)}・コスト${c.def.cost}）をマナに置く${c === rec ? '［参考：ふつうのAIならこれ］' : ''}${multi ? '（多色なのでタップして置かれ、このターンは使えない）' : ''} → ${after.length ? 'このターンに使えるカード：' + after.join('、') : 'このターンに使えるカードはない'}。「${c.def.name}」自体はもう使えなくなる`,
        };
      });
      const allowSkip = me.hand.length <= 2;
      if (allowSkip) opts.push({ c: null, label: 'このターンはマナに置かない' });
      const r = await ask(g, pi, `マナチャージ：手札から1枚をマナに置きます（今のマナは${me.mana.length}枚${now.length ? '、置かなくても使えるカード：' + now.join('、') : ''}）。このターンや次のターンに使いたいカードは手札に残し、使わないカードを置いてください。どれを置きますか？`, opts.map((o) => o.label), 1, 1);
      const pick = r ? opts[r[0]] : { c: rec || cands[0] };
      if (pick && pick.c && g.canCharge(pi, pick.c)) {
        if (!r) g.log(`🤖 マナに置くカードはふつうのAIで選んだ`);
        await g.chargeMana(pi, pick.c.uid);
        await g.pause();
      }
    }

    function actions(g, pi) {
      const me = g.p[pi];
      const op = g.p[1 - pi];
      const out = [];
      const rec = !g.manaCharged && rule.chooseCharge ? rule.chooseCharge(g, pi) : null;
      for (const c of me.hand) {
        const verb = c.def.type === 'spell' ? '唱える（呪文の効果を使う）' : c.def.type === 'creature' ? '召喚する（バトルゾーンに出す。出た時の効果も働く）' : '使う（場に出す）';
        if (g.canPlay(pi, c)) out.push({ label: `手札の「${c.def.name}」を、マナを${c.def.cost}払って${verb}`, run: () => g.play(pi, c.uid) });
        if (g.canPlayTwin && g.canPlayTwin(pi, c)) out.push({ label: `手札の「${c.def.name}」の呪文側「${g.twin(c).name}」を、マナを${g.twin(c).cost}払って唱える`, run: () => g.playTwin(pi, c.uid) });
        if (g.canCharge(pi, c)) {
          const eff = short(c.def.text, 36);
          out.push({ charge: true, label: `手札の「${c.def.name}」をマナに置く${c === rec ? '（参考：ふつうのAIならこれを置く）' : ''}（マナチャージ。マナが1枚増えるだけ。このカードはもう召喚・使用できなくなる${eff ? `。効果「${eff}…」も働かない` : ''}）`, run: () => g.chargeMana(pi, c.uid) });
        }
      }
      for (const c of [...me.grave, ...me.mana, ...(me.hyper || [])]) {
        if (g.canPlayFromGrave(pi, c)) out.push({ label: `${{ grave: '墓地', mana: 'マナ', hyper: '超次元ゾーン' }[g.zoneOf(c)] || ''}の「${c.def.name}」を使う`, run: () => g.playFromGrave(pi, c.uid) });
      }
      for (const c of me.battle) {
        for (const t of g.attackTargets(c)) {
          let label;
          if (t === 'player') {
            const blockers = op.battle.filter((x) => !x.tapped && g.isCreature(x) && g.kw(x).blocker).length;
            const brk = Math.min(g.breakCount ? g.breakCount(c) : 1, 99);
            label = `「${c.def.name}」（パワー${g.power(c)}）で相手プレイヤーを攻撃（${op.shields.length ? `通ればシールドを${Math.min(brk, op.shields.length)}枚ブレイク。相手の手札が増え、S・トリガーが出ることもある` : 'シールドが0なので、通れば勝ち'}${blockers ? `。相手にはブロックできるクリーチャーが${blockers}体いる` : ''}）`;
          } else {
            const a2 = g.power(c);
            const d2 = g.power(t);
            const res = a2 > d2 ? '勝って相手を破壊できる見込み' : a2 === d2 ? '相打ち（両方破壊）の見込み' : '負けて自分のクリーチャーが破壊される見込み';
            label = `「${c.def.name}」（パワー${a2}）で相手の「${t.def.name}」（パワー${d2}${t.tapped ? '・タップ' : ''}）を攻撃（${res}）`;
          }
          out.push({ label, run: () => g.attack(pi, c.uid, t === 'player' ? 'player' : t.uid) });
        }
        if (g.canTapAbility(c)) out.push({ label: `「${c.def.name}」をタップして能力を使う`, run: () => g.useTapAbility(pi, c.uid) });
      }
      out.push({ label: 'ターンを終了する', end: true });
      return out;
    }

    async function takeTurn(g, pi) {
      if (pi !== cfg.player) return rule.takeTurn(g, pi);
      await g.pause();
      await chargePhase(g, pi);
      let fails = 0;
      for (let step = 0; step < 40; step++) {
        if (g.winner != null || g.p[pi].skipRestTurn === g.turn) break;
        const acts = actions(g, pi).filter((x) => !x.charge);
        if (acts.length === 1) break;
        const um = g.p[pi].mana.filter((m) => !m.tapped).length;
        const r = await ask(g, pi, `あなたの番です。今使えるマナは${um}枚${g.manaCharged ? '（このターンのマナチャージは済み）' : '（このターンはまだマナに置ける）'}。次に何をしますか？`, acts.map((a) => a.label), 1, 1);
        if (!r) {
          // 言語AIが使えない時は、このターンの残りをふつうのAIにまかせる
          if (++fails >= 2) return rule.takeTurn(g, pi);
          continue;
        }
        const a = acts[r[0]];
        if (a.end) {
          break;
        }
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

  G.LLMAI = { make, listModels, describe, compactMemo };
  if (typeof module !== 'undefined') module.exports = G.LLMAI;
})(typeof globalThis !== 'undefined' ? globalThis : window);
