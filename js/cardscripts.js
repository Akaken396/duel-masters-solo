// カードごとの専用処理。テキスト解析では表せない効果をここで自動化する。
// キーはカード名（全角・半角や空白の違いは無視）。
//
// 使えるフック（すべて任意）:
//   summon / cast / attack / block / destroyed / turnStart / turnEnd / shieldAdded / exLifeLost
//                                    (g, card, pi)          … 誘発。定義すると、そのタイミングのテキスト解析より優先
//   selfCost(g, card, pi, def)      → 数値 … このカード自身のコスト（軽減後）
//   costMod(g, src, pi, card, def, withSasage) → {n, use, sasage} … 場のsrcが pi のカードのコストを下げる
//   lock(g, src, pi, def)           → true … 相手 pi はそのカードを使えない
//   replaceEnter(g, src, card, how) → true … 相手クリーチャーが出る時、かわりにマナへ
//   wouldDestroy(g, card)           → 'mana' など … 自分が破壊される時の行き先
//   protectDestroy(g, src, card)    → true … 自分のクリーチャーの破壊を肩代わり
//   forbidAttack(g, src, card)      → true … 相手クリーチャーは攻撃できない
//   graveUse(g, src, pi, card)      → true … 墓地のそのカードを使える
//   dynamicTrigger(g, shieldCard)   → true … シールドから手札に来た時にS・トリガー扱い
//   onAnyEnter(g, src, card) / onAnyCast(g, src, card, def) / onBreak(g, src, breaker)
//   revChange(g, handCard, attacker) → true … 革命チェンジできる
(function (G) {
  'use strict';

  const norm = (s) =>
    String(s || '')
      .normalize('NFKC')
      .replace(/[\s　]/g, '');

  // ===== 共通の小道具 =====
  const isCreature = (g, c) => g.isCreature(c);
  const hasRace = (c, r) => (c.def.races || []).some((x) => x.includes(r));
  const hasCiv = (c, civ) => (c.def.civs || []).includes(civ);
  const cost = (c) => +c.def.cost || 0;
  const val = (g, c) => cost(c) * 2 + g.power(c) / 1000;
  const byVal = (g) => (a, b) => val(g, b) - val(g, a);
  const name = (c) => `「${c.def.name}」`;

  async function pick(g, pi, pool, n, optional, prompt, act = 'target', aiPick) {
    if (!pool.length) return [];
    const max = Math.min(n, pool.length);
    const ids = await g.choose(pi, {
      kind: act === 'recover' || act === 'discard' || act === 'shield' ? act : 'target',
      act,
      prompt,
      options: pool.map((c) => ({ id: c.uid, label: c.def.name, card: c })),
      min: optional ? 0 : max,
      max,
      aiPick: aiPick ? aiPick(pool, max).map((c) => c.uid) : undefined,
    });
    return ids.map((id) => pool.find((c) => c.uid === id)).filter(Boolean);
  }

  // モード選択。modes: [{id, label}]
  async function mode(g, pi, prompt, modes, aiId, n = 1) {
    if (!modes.length) return [];
    return g.chooseModes(pi, prompt, modes, {
      min: n === 'any' ? 0 : 1,
      max: n === 'any' ? modes.length : n,
      aiPick: aiId != null ? [].concat(aiId) : [modes[0].id],
    });
  }

  async function discard(g, pi, n, src) {
    const pl = g.p[pi];
    const picked = await pick(g, pi, pl.hand.slice(), n, false, `${src ? name(src) + ': ' : ''}捨てる手札を${n}枚選んでください`, 'discard', (pool, m) =>
      pool.slice().sort((a, b) => val(g, a) - val(g, b)).slice(0, m)
    );
    for (const c of picked) await g.discardCard(c, src ? src.owner : pi);
  }

  function draw(g, pi, n) {
    g.draw(pi, n);
    g.log(`${g.p[pi].name}はカードを${n}枚引いた`);
  }

  // 墓地から出す
  async function reanimate(g, pi, filter, prompt, optional) {
    const pool = g.p[pi].grave.filter(filter);
    if (!pool.length) {
      g.log(`${prompt}: 対象がいなかった`);
      return null;
    }
    const r = await pick(g, pi, pool, 1, optional, prompt, 'recover', (p) => p.slice().sort(byVal(g)).slice(0, 1));
    if (!r[0]) return null;
    await g.enterBattle(r[0], pi, 'other');
    return r[0];
  }

  // ササゲール3：ディスペクターのコストを3下げ、このタマシードを破壊
  const isDispecter = (def) => def.type !== 'spell' && (def.races || []).some((r) => r.includes('ディスペクター'));
  const sasageOk = (g, src, pi, def) => g.zoneOf(src) === 'battle' && src.owner === pi && isDispecter(def);
  function sasage3(g, src, pi, card, def, sasSrc) {
    if (sasSrc !== src || !sasageOk(g, src, pi, def)) return null;
    return {
      n: 3,
      use: async () => {
        g.log(`ササゲール：${name(src)}を破壊してコストを3下げた`);
        await g.destroyMany([src], { byOpp: false });
      },
    };
  }

  // 封印：山札の上のカードを裏向きで付ける。外した封印は墓地へ
  function addSeals(g, card, n) {
    const me = g.p[card.owner];
    card.sealCards = me.deck.splice(0, Math.min(n, me.deck.length));
    card.seals = card.sealCards.length;
    g.log(`${name(card)}に山札の上から封印が${card.seals}つ付いた（山札残り${me.deck.length}）`);
  }
  async function removeSeal(g, card, onAllGone) {
    if (!(card.seals > 0) || !card.sealCards) return;
    const sc = card.sealCards.pop();
    card.seals = card.sealCards.length;
    if (sc) {
      g.moveTo(sc, 'grave');
      g.log(`${name(card)}の封印を1つ外した →「${sc.def.name}」を墓地へ（残り${card.seals}）`);
    }
    await g.pause(0.5);
    if (card.seals === 0 && onAllGone) await onAllGone();
  }

  // 自分のクリーチャー1体を選んで、次の自分のターンまでアンタップさせない
  function freeze(g, c, ownerOfEffect) {
    c.tapped = true;
    c.frozenUntil = g.nextTurnOf(1 - ownerOfEffect);
    g.log(`${name(c)}はタップされ、次のターンのはじめにアンタップしない`);
  }

  const S = {};

  // ================= 青黒バロム =================
  async function skullAllGone(g, card) {
    const pi = card.owner;
    if (g.zoneOf(card) !== 'battle') return;
    g.moveTo(card, 'grave');
    g.log(`${name(card)}の封印がすべて外れ、破壊された`);
    await g.trigger(card, 'destroyed', pi);
    await reanimate(g, pi, (c) => isCreature(g, c) && hasCiv(c, 'darkness'), `${name(card)}: 墓地から出す闇のクリーチャー`, false);
  }
  S['覇王の頭蓋 髑髏魔城'] = {
    summon(g, card) {
      g.addSeals(card, 7);
    },
    async turnStart(g, card) {
      await g.removeSeal(card); // 自分のコマンドが出た時の封印外しはエンジン側の共通ルール
    },
    sealsGone: (g, card) => skullAllGone(g, card),
  };

  S['ア・ストラ・ゼーレの電影'] = {
    async summon(g, card, pi) {
      for (const p of [pi, 1 - pi]) if (g.p[p].hand.length) await discard(g, p, 1, card);
    },
    graveUse: (g, src, pi, card) => src.usedTurn !== g.turn && isCreature(g, card) && hasRace(card, 'ディスペクター'),
    // ササゲールはテキストの「ササゲール3」を汎用処理
  };

  S['邪杯と魔術の決断'] = {
    selfCost: (g, card, pi, def) => (g.graveThisTurn ? (+def.cost || 0) - 2 : null),
    async cast(g, card, pi) {
      const me = g.p[pi];
      const op = g.opp(pi);
      const minus0 = me.grave.length * 1000;
      const killable = op.battle.filter((c) => isCreature(g, c) && g.power(c) <= minus0);
      const tama = me.grave.filter((c) => c.def.type === 'tamaseed' && cost(c) <= 4);
      const ai = [killable.length ? 'minus' : 'draw', tama.length ? 'tama' : 'draw'];
      // 先に2回分の処理を選び、その順に実行する
      const picks = await g.chooseModes(
        pi,
        `${name(card)}: 2回選んでください（同じものも可）`,
        [
          { id: 'draw', label: '2枚引いて手札を1枚捨てる' },
          { id: 'minus', label: '相手クリーチャー1体のパワーを、自分の墓地の枚数×1000下げる' },
          { id: 'tama', label: 'コスト4以下のタマシードを自分の墓地から出す' },
        ],
        { min: 2, max: 2, repeat: true, aiPick: ai }
      );
      for (const m of picks) {
        const minus = me.grave.length * 1000;
        if (m === 'draw') {
          draw(g, pi, 2);
          await discard(g, pi, 1, card);
        } else if (m === 'minus') {
          const pool = op.battle.filter((c) => isCreature(g, c));
          const r = await pick(g, pi, pool, 1, false, `パワーを${minus}下げるクリーチャー`, 'destroy', (p) => {
            const k = p.filter((c) => g.power(c) <= minus).sort(byVal(g));
            return (k.length ? k : p.slice().sort(byVal(g))).slice(0, 1);
          });
          if (r[0]) {
            r[0].tempPower -= minus;
            g.log(`${name(r[0])}のパワーが-${minus}された`);
            if (g.power(r[0]) <= 0) await g.destroyMany([r[0]]);
          } else g.log('対象がいなかった');
        } else if (m === 'tama') {
          await reanimate(g, pi, (c) => c.def.type === 'tamaseed' && cost(c) <= 4, '墓地から出すタマシード', true);
        }
        await g.pause(0.5);
      }
    },
  };

  S['切札縫合 アビス記号jS'] = {
    // 出た時の「2枚引いて2枚捨てる」はテキスト解析で処理
    // 各ターン1度、墓地から呪文を唱えられる。唱えた後は山札の下へ
    graveUse: (g, src, pi, card) => card.def.type === 'spell' && src.usedTurn !== g.turn,
    graveCastTo: 'deckBottom',
    // 自分の墓地にあるカードのコストを2下げる（1未満にはならない）
    costMod: (g, src, pi, card) => (src.owner === pi && g.zoneOf(card) === 'grave' && g.zoneOf(src) === 'battle' ? { n: 2 } : null),
  };

  S['アアルカイトの電影'] = {
    async summon(g, card, pi) {
      const me = g.p[pi];
      const top = me.deck.slice(0, 4);
      if (!top.length) return;
      const r = await pick(g, pi, top, 1, false, `${name(card)}: 手札に加えるカード（残りは山札の下）`, 'recover', (p) => p.slice().sort(byVal(g)).slice(0, 1));
      for (const c of top) {
        if (c === r[0]) g.moveTo(c, 'hand');
        else g.moveTo(c, 'deck', { top: false });
      }
      g.log(`${me.name}は山札の上から4枚見て1枚を手札に加えた`);
    },
    async destroyed(g, card, pi) {
      const pool = g.p[pi].battle.filter((c) => isCreature(g, c));
      const r = await pick(g, pi, pool, 1, false, `${name(card)}: 相手の呪文で選ばれなくする自分のクリーチャー`, 'recover', (p) => p.slice().sort(byVal(g)).slice(0, 1));
      if (r[0]) {
        r[0].spellShieldUntil = g.nextTurnOf(pi) - 1;
        g.log(`${name(r[0])}は次の自分のターンのはじめまで、相手の呪文で選ばれない`);
      }
    },
  };

  S['切札縫合 メイドヴァロム'] = {
    async summon(g, card, pi) {
      const pool = g.opp(pi).battle.slice();
      const r = await pick(g, pi, pool, 5, true, `${name(card)}: 手札に戻す相手のエレメント（5つまで）`, 'bounce', (p, m) => p.slice().sort(byVal(g)).slice(0, m));
      for (const c of r) if (await g.leave(c, 'hand', { byOpp: true })) g.log(`${name(c)}は手札に戻った`);
      // 進化して出ていれば、相手の手札を見ないで5枚選んで捨てさせる
      if (card.under && card.under.length) {
        const op = g.opp(pi);
        for (let i = 0; i < 5 && op.hand.length; i++) {
          const c = op.hand[Math.floor(g.rng() * op.hand.length)];
          g.moveTo(c, 'grave');
          g.log(`${op.name}は手札の「${c.def.name}」を捨てた（ランダム）`);
        }
      }
    },
  };

  S['ブレイン・スラッシュ'] = {
    async cast(g, card, pi) {
      const me = g.p[pi];
      const field = me.battle; // クリーチャーとタマシード
      const both = field.some((c) => hasCiv(c, 'water')) && field.some((c) => hasCiv(c, 'darkness'));
      const reTargets = me.grave.filter((c) => isCreature(g, c) && cost(c) <= 8);
      const ai = both ? ['draw', 'rean'] : [reTargets.some((c) => cost(c) >= 5) ? 'rean' : 'draw'];
      const picks = await g.chooseModes(
        pi,
        `${name(card)}: ${both ? '水と闇がそろっているので両方選べます' : '1つ選んでください'}`,
        [
          { id: 'draw', label: '3枚引いて手札を1枚捨てる' },
          { id: 'rean', label: 'コスト8以下のクリーチャーを自分の墓地から出す' },
        ],
        { min: 1, max: both ? 2 : 1, aiPick: ai }
      );
      for (const m of picks) {
        if (m === 'draw') {
          draw(g, pi, 3);
          await discard(g, pi, 1, card);
        } else await reanimate(g, pi, (c) => isCreature(g, c) && cost(c) <= 8, '墓地から出すクリーチャー', false);
        await g.pause(0.4);
      }
    },
  };

  S['デス・ザ・ロストの黒像'] = {
    async turnEnd(g, card, pi) {
      card.modesUsed = card.modesUsed || [];
      const all = [
        { id: 'burn', label: '相手のシールド1つを墓地へ' },
        { id: 'hand', label: '相手は手札を2枚捨てる' },
        { id: 'back', label: '自分のシールド2つを手札へ（S・トリガー不可）' },
        { id: 'lose', label: '自分がゲームに負ける' },
      ];
      const left = all.filter((m) => !card.modesUsed.includes(m.id));
      if (!left.length) return;
      const op = g.opp(pi);
      const me = g.p[pi];
      const order = ['burn', 'hand', 'back', 'lose'].filter((x) => left.some((m) => m.id === x));
      let ai = order[0];
      if (ai === 'hand' && !op.hand.length && order.includes('burn')) ai = 'burn';
      const [m] = await mode(g, pi, `${name(card)}: ターンの終わりに1つ選ぶ`, left, ai);
      card.modesUsed.push(m);
      if (m === 'burn' && op.shields.length) {
        const r = await pick(g, pi, op.shields.slice(), 1, false, '墓地に置く相手のシールド', 'shield', (p) => p.slice(-1));
        g.moveTo(r[0], 'grave');
        g.log(`${op.name}のシールド1つが墓地に置かれた（残り${op.shields.length}）`);
      } else if (m === 'hand') {
        await discard(g, op.idx, Math.min(2, op.hand.length), card);
      } else if (m === 'back') {
        const r = await pick(g, pi, me.shields.slice(), 2, false, '手札に戻す自分のシールド', 'recover', (p, n) => p.slice(0, n));
        for (const c of r) g.moveTo(c, 'hand');
        g.log(`${me.name}はシールドを${r.length}つ手札に加えた`);
      } else if (m === 'lose') {
        g.log(`${name(card)}: 最後の選択肢「ゲームに負ける」`);
        g.win(1 - pi, `${card.def.name}の効果`);
      }
    },
  };

  S['愛・爆・発'] = {
    async cast(g, card, pi) {
      const me = g.p[pi];
      for (let i = 0; i < 2 && me.deck.length; i++) {
        const c = me.deck[0];
        g.moveTo(c, 'grave');
        g.log(`${me.name}は山札の上の「${c.def.name}」を墓地に置いた`);
      }
      await reanimate(
        g,
        pi,
        (c) => (isCreature(g, c) || c.def.type === 'tamaseed') && hasCiv(c, 'darkness') && cost(c) <= 4,
        `${name(card)}: 墓地から出す闇のコスト4以下`,
        true
      );
    },
  };

  async function dollBarom(g, card, pi) {
    const op = g.opp(pi);
    const nonDark = (c) => !hasCiv(c, 'darkness');
    const theirKill = op.battle.filter((c) => isCreature(g, c) && nonDark(c)).length;
    const ai = theirKill ? 'kill' : op.hand.some(nonDark) ? 'hand' : 'mana';
    const [m] = await mode(
      g,
      pi,
      `${name(card)}: 1つ選ぶ`,
      [
        { id: 'hand', label: '相手の手札の闇以外をすべて捨てさせる' },
        { id: 'kill', label: '闇以外のクリーチャーをすべて破壊' },
        { id: 'mana', label: '相手のマナの闇以外は次の自分のターンまでアンタップしない' },
      ],
      ai
    );
    if (m === 'hand') {
      const gone = op.hand.filter(nonDark);
      g.log(`${op.name}の手札: ${op.hand.map((c) => c.def.name).join('、') || 'なし'}`);
      for (const c of gone) g.moveTo(c, 'grave');
      g.log(`${op.name}は闇以外の手札${gone.length}枚を捨てた`);
    } else if (m === 'kill') {
      const all = [...g.p[pi].battle, ...op.battle].filter((c) => isCreature(g, c) && nonDark(c));
      await g.destroyMany(all);
    } else {
      for (const c of op.mana) if (nonDark(c)) c.frozenUntil = g.nextTurnOf(pi) - 1;
      g.log(`${op.name}のマナの闇以外のカードは、しばらくアンタップしない`);
    }
  }
  S['切札接続 ドールバロム'] = { summon: dollBarom, exLifeLost: dollBarom };

  S['コーライルの海幻'] = {
    async summon(g, card, pi) {
      const pool = [...g.p[0].battle, ...g.p[1].battle];
      const r = await pick(g, pi, pool, 1, false, `${name(card)}: 山札の下に送るクリーチャーかタマシード`, 'bounce', (p) => {
        const theirs = p.filter((c) => c.owner !== pi).sort(byVal(g));
        return theirs.length ? theirs.slice(0, 1) : [card];
      });
      const c = r[0];
      if (!c) return;
      if (await g.leave(c, 'deck', { byOpp: c.owner !== pi, moveOpt: { top: false } })) {
        g.log(`${name(c)}は山札の下に置かれた`);
        draw(g, c.owner, 1);
      }
    },
  };

  S['欲望の邪道 ニガ=アブシューム'] = {
    // 裏面：自分のターンのはじめにシールドを1つ墓地へ→1枚引き、次に召喚するクリーチャーのコスト-2
    async turnStart(g, card, pi) {
      if (!card.flipped) return;
      const me = g.p[pi];
      if (!me.shields.length) return;
      const [m] = await g.chooseModes(pi, `《支配の邪道 獄鬼夜城》: シールドを1つ墓地に置きますか？`, [
        { id: 'yes', label: 'シールド1つを墓地へ（1枚引き、次の召喚コスト-2）' },
        { id: 'no', label: 'しない' },
      ], { aiPick: [me.shields.length >= 3 ? 'yes' : 'no'] });
      if (m !== 'yes') return;
      const sh = me.shields.find((x) => !x.faceUp) || me.shields[0];
      g.moveTo(sh, 'grave');
      g.log(`${me.name}はシールドを1つ墓地に置いた`);
      draw(g, pi, 1);
      me.nextSummonDiscount = { turn: g.turn, n: 2 };
      await g.shieldsLeft(pi);
    },
    async onShieldsLeft(g, card) {
      if (!card.flipped) return;
      const [m] = await g.chooseModes(card.owner, `《支配の邪道 獄鬼夜城》: 《欲望の邪道 ニガ=アブシューム》側に戻しますか？`, [
        { id: 'yes', label: '表（ニガ=アブシューム）に戻す' },
        { id: 'no', label: '戻さない' },
      ], { aiPick: ['no'] });
      if (m === 'yes') {
        card.flipped = false;
        g.log(`${name(card)}を表に戻した`);
      }
    },
    async onBreak(g, src, breaker) {
      if (src.flipped || !isCreature(g, breaker)) return;
      g.log(`${name(src)}: シールドをブレイクした${name(breaker)}を破壊`);
      await g.destroyMany([breaker], { byOpp: breaker.owner !== src.owner });
    },
    async protectDestroy(g, src, card) {
      if (src.flipped || card === src || !isCreature(g, card)) return false;
      if (!(await g.yesNo(src.owner, `${name(src)}を裏返して${name(card)}の破壊を防ぎますか？`, src))) return false;
      src.flipped = true;
      g.log(`${name(src)}を《支配の邪道 獄鬼夜城》側にして、${name(card)}の破壊を防いだ`);
      return true;
    },
  };

  // ================= 光自然ザゼゼーン =================
  S['キャディ・ビートル'] = {
    replaceEnter: (g, src, card) => g.active === card.owner && cost(card) > g.p[card.owner].mana.length,
    wouldDestroy: () => 'mana',
  };

  S['魂が休む庭園 グリーン・グランドクロス'] = {
    costMod(g, src, pi, card, def, sasSrc) {
      if (src.usedTurn === g.turn || def.type === 'spell' || !isCreature(g, { def })) return null;
      return { n: 1, use: () => (src.usedTurn = g.turn) };
    },
    async turnEnd(g, card, pi) {
      const mine = g.p[pi].battle.filter((c) => isCreature(g, c)).length;
      const theirs = g.opp(pi).battle.filter((c) => isCreature(g, c)).length;
      if (mine > theirs && (await g.yesNo(pi, `${name(card)}: クリーチャーが相手より多いので1枚引きますか？`, card))) draw(g, pi, 1);
    },
  };

  S['楯教の求道者 ザゼ・ゼーン'] = {
    async shieldAdded(g, card, pi) {
      if (g.zoneOf(card) !== 'battle') return;
      if (card.tapped) {
        card.tapped = false;
        g.log(`${name(card)}はアンタップした`);
      }
      const opTargets = g.opp(pi).battle.filter((c) => isCreature(g, c) && !c.tapped);
      const [m] = await mode(
        g,
        pi,
        `${name(card)}: 1つ選ぶ`,
        [
          { id: 'draw', label: 'カードを1枚引く' },
          { id: 'tap', label: '相手クリーチャー1体をタップし、次のターンのはじめにアンタップさせない' },
          { id: 'stay', label: '次の自分のターンのはじめまで離れない' },
        ],
        opTargets.length ? 'tap' : 'draw'
      );
      if (m === 'draw') draw(g, pi, 1);
      else if (m === 'tap') {
        const r = await pick(g, pi, opTargets, 1, false, 'タップする相手クリーチャー', 'tap', (p) => p.slice().sort(byVal(g)).slice(0, 1));
        if (r[0]) freeze(g, r[0], pi);
      } else {
        card.noLeaveUntil = g.nextTurnOf(pi) - 1;
        g.log(`${name(card)}は次の自分のターンのはじめまで離れない`);
      }
    },
  };

  S['我竜塔第七層 ハッスル・キャッスル'] = {
    summon(g, card, pi) {
      const me = g.p[pi];
      if (!me.deck.length) return;
      const c = me.deck[0];
      g.moveTo(c, 'mana', { tapped: true });
      g.log(`${name(card)}: 山札の上の「${c.def.name}」をタップしてマナに置いた`);
    },
    replaceEnter: (g, src, card, how) => how !== 'summon',
  };

  S['世界のY チャクラ・デル・フィン'] = {
    async shieldAdded(g, card, pi) {
      if (g.zoneOf(card) !== 'battle') return;
      const pool = g.opp(pi).battle.filter((c) => isCreature(g, c));
      const r = await pick(g, pi, pool, 1, false, `${name(card)}: タップする相手クリーチャー`, 'tap', (p) => {
        const un = p.filter((c) => !c.tapped).sort(byVal(g));
        return (un.length ? un : p).slice(0, 1);
      });
      if (r[0]) freeze(g, r[0], pi);
    },
  };

  async function gyaiTrigger(g, src, card) {
    if (card.owner !== src.owner || !hasRace(card, 'ドラゴン') || src.usedTurn === g.turn || g.zoneOf(src) !== 'battle') return;
    src.usedTurn = g.turn;
    const pi = src.owner;
    const me = g.p[pi];
    if (me.deck.length > 2 && (await g.yesNo(pi, `${name(src)}: 山札の上から2枚をタップしてマナに置きますか？`, src))) {
      for (let i = 0; i < 2 && me.deck.length; i++) g.moveTo(me.deck[0], 'mana', { tapped: true });
      g.log(`${me.name}は山札の上から2枚をマナに置いた`);
    }
    const dragons = me.mana.filter((c) => hasRace(c, 'ドラゴン'));
    const r = await pick(g, pi, dragons, 1, true, `${name(src)}: マナから手札に戻すドラゴン（任意）`, 'recover', (p) => p.slice().sort(byVal(g)).slice(0, 1));
    for (const c of r) {
      g.moveTo(c, 'hand');
      g.log(`${me.name}は「${c.def.name}」をマナから手札に戻した`);
    }
  }
  S['地封院ギャイ<まかしとき!>'] = {
    summon: (g, card) => gyaiTrigger(g, card, card),
    onAnyEnter: gyaiTrigger,
  };

  S['烈しき切札 ドギラゴン逆'] = {
    summon(g, card, pi) {
      const me = g.p[pi];
      if (me.finalRevUsed) return;
      me.finalRevUsed = true;
      me.noLoseUntil = g.nextTurnOf(pi) - 1;
      me.noLeaveUntil = g.nextTurnOf(pi) - 1;
      g.log(`${name(card)}の極限ファイナル革命！ 次の自分のターンのはじめまで、${me.name}は負けず、クリーチャーは離れない`);
    },
    async turnEnd(g, card, pi) {
      const me = g.p[pi];
      if (me.deck.length > 2 && (await g.yesNo(pi, `${name(card)}: 山札の上から2枚をマナに置きますか？`, card))) {
        for (let i = 0; i < 2 && me.deck.length; i++) g.moveTo(me.deck[0], 'mana');
        g.log(`${me.name}は山札の上から2枚をマナに置いた`);
      }
      let budget = 7;
      for (let i = 0; i < 2; i++) {
        const pool = [...me.hand, ...me.mana].filter((c) => isCreature(g, c) && cost(c) <= budget);
        const r = await pick(g, pi, pool, 1, true, `${name(card)}: 手札かマナから出すクリーチャー（残りコスト${budget}）`, 'recover', (p) =>
          p.slice().sort((a, b) => cost(b) - cost(a) || byVal(g)(a, b)).slice(0, 1)
        );
        if (!r[0]) break;
        budget -= cost(r[0]);
        await g.enterBattle(r[0], pi, 'other');
      }
    },
    revChange: (g, h, attacker) =>
      attacker !== h && (hasCiv(attacker, 'light') || hasCiv(attacker, 'nature')) && g.power(attacker) >= 8000,
  };

  S['神判のカルマ コットン'] = {
    forbidAttack: (g, src, card) => card.owner !== src.owner && card.enteredTurn === g.turn,
  };
  S['ジャッジ・水晶チャージャー'] = {
    async cast(g, card, pi) {
      const op = g.opp(pi);
      const pool = op.battle.filter((c) => cost(c) > op.mana.length);
      const r = await pick(g, pi, pool, 1, false, `${name(card)}: 山札の下に送る相手のエレメント`, 'bounce', (p) => p.slice().sort(byVal(g)).slice(0, 1));
      if (!r[0]) return g.log('対象がいなかった');
      if (await g.leave(r[0], 'deck', { byOpp: true, moveOpt: { top: false } })) g.log(`${name(r[0])}は山札の下に置かれた`);
    },
  };

  async function everShield(g, card, pi) {
    const pool = [...g.p[0].battle, ...g.p[1].battle].filter((c) => g.selectable(c, pi));
    const opts = [{ id: 'elem', label: '場のエレメントを1つ選んでシールド化' }, { id: 'top', label: '山札の上から1枚をシールド化' }, { id: 'none', label: '何もしない' }];
    const theirs = pool.filter((c) => c.owner !== pi && !c.seals);
    const [m] = await g.chooseModes(pi, `${name(card)}: シールド化しますか？`, opts.filter((o) => o.id !== 'elem' || pool.length), { aiPick: [theirs.length ? 'elem' : 'top'] });
    if (m === 'elem') {
      const r = await pick(g, pi, pool, 1, false, 'シールド化するエレメント', 'bounce', (p) => (theirs.length ? theirs.sort(byVal(g)) : p).slice(0, 1));
      if (r[0] && (await g.leave(r[0], 'shields', { byOpp: r[0].owner !== pi }))) {
        g.log(`${name(r[0])}は持ち主のシールドになった`);
        await g.shieldAdded(r[0].owner);
      }
    } else if (m === 'top' && g.p[pi].deck.length) {
      g.moveTo(g.p[pi].deck[0], 'shields');
      g.log(`${g.p[pi].name}は山札の上から1枚をシールド化した`);
      await g.shieldAdded(pi);
    }
  }
  S['天V王 エバーラスト'] = {
    // マナ武装3のコスト軽減はテキスト解析で処理
    summon: everShield,
    attack: everShield,
    // マナ武装5：自分のクリーチャーが離れる時、かわりにシールド2つを手札へ
    async replaceLeave(g, src, card) {
      const pi = src.owner;
      const me = g.p[pi];
      if (g.zoneOf(src) !== 'battle' || me.shields.length < 2) return false;
      if (me.mana.filter((m) => hasCiv(m, 'light')).length < 5) return false;
      const [m] = await g.chooseModes(pi, `${name(src)}のマナ武装5: ${name(card)}が離れるかわりに、シールド2つを手札に加えますか？`, [
        { id: 'yes', label: 'シールド2つを手札へ（S・トリガーは使えない）' },
        { id: 'no', label: 'しない' },
      ], { aiPick: [me.shields.length >= 4 && val(g, card) >= 10 ? 'yes' : 'no'] });
      if (m !== 'yes') return false;
      const r = await pick(g, pi, me.shields.slice(), 2, false, '手札に加えるシールド', 'recover', (p, n) => p.slice(0, n));
      for (const c of r) g.moveTo(c, 'hand');
      g.log(`${name(card)}は離れず、かわりにシールドを${r.length}つ手札に加えた`);
      await g.shieldsLeft(pi);
      return true;
    },
  };

  async function viride(g, src, card, def) {
    const pi = src.owner;
    if (g.active === pi || card.owner === pi || src.usedTurn === g.turn || g.zoneOf(src) !== 'battle') return;
    src.usedTurn = g.turn;
    const c = def ? +def.cost || 0 : cost(card);
    if (await g.yesNo(pi, `${name(src)}: 相手が${name(card)}を使った。1枚引きますか？`, src)) draw(g, pi, 1);
    const pool = g.p[pi].hand.filter((h) => isCreature(g, h) && cost(h) <= c);
    const r = await pick(g, pi, pool, 1, true, `${name(src)}: コスト${c}以下のクリーチャーを手札から出す（任意）`, 'recover', (p) => p.slice().sort(byVal(g)).slice(0, 1));
    if (r[0]) await g.enterBattle(r[0], pi, 'other');
  }
  S['ウィリデ・ゴル・ゲルス'] = {
    selfCost: (g, card, pi) => (g.p[pi].shields.length > g.opp(pi).shields.length ? 2 : null),
    dynamicTrigger: (g, s) => g.p[1 - s.owner].battle.filter((c) => g.isCreature(c)).length >= 3,
    onAnyEnter: (g, src, card) => viride(g, src, card),
    onAnyCast: (g, src, card, def) => viride(g, src, card, def),
  };

  S['一音の妖精'] = {
    lock: (g, src, pi, def) =>
      (def.type === 'spell' && (g.spellsThisTurn?.[pi] || 0) >= 1) ||
      (def.type !== 'spell' && !!(src.under && src.under.length) && (g.creaturesThisTurn?.[pi] || 0) >= 1),
  };

  async function invincible(g, card, pi) {
    const me = g.p[pi];
    const ids = await mode(
      g,
      pi,
      `${name(card)}: 行うものを選ぶ（いくつでも）`,
      [
        { id: 'draw', label: 'カードを1枚引く' },
        { id: 'back', label: 'シールドを1つ手札に戻す' },
        { id: 'add', label: '手札を1枚シールド化する' },
      ],
      'draw',
      'any'
    );
    if (ids.includes('draw')) draw(g, pi, 1);
    if (ids.includes('back') && me.shields.length) {
      const r = await pick(g, pi, me.shields.filter((s) => s.uid !== card.forceShield), 1, false, '手札に戻すシールド', 'recover', (p) => p.slice(0, 1));
      for (const c of r) g.moveTo(c, 'hand');
    }
    if (ids.includes('add') && me.hand.length) {
      const r = await pick(g, pi, me.hand.slice(), 1, false, 'シールド化する手札', 'recover', (p) => p.slice(0, 1));
      for (const c of r) g.moveTo(c, 'shields');
      if (r.length) await g.shieldAdded(pi);
    }
  }
  S['叡智のW インビンシブル・ギャラクシー'] = {
    async summon(g, card, pi) {
      const r = await pick(g, pi, g.p[pi].shields.filter((s) => !s.faceUp), 1, false, `${name(card)}: シールド・フォースで選ぶシールド`, 'recover', (p) => p.slice(0, 1));
      if (r[0]) {
        card.forceShield = r[0].uid;
        g.log(`シールド・フォース：そのシールドがある間、${g.p[pi].name}のクリーチャーは離れない`);
      }
    },
    attack: invincible,
    block: invincible,
  };

  S['神聖龍 エモーショナル・ハードコア'] = {
    untargetable: (g, card) => g.p[card.owner].battle.some((c) => c !== card && hasRace(c, 'オラクル')),
    async summon(g, card, pi) {
      const pool = [...g.opp(pi).battle, ...g.p[pi].battle].filter((c) => c !== card && isCreature(g, c));
      const r = await pick(g, pi, pool, 1, true, `${name(card)}: 能力を無視させるクリーチャー（その名前すべて）`, 'target', (p) => {
        const t = p.filter((c) => c.owner !== pi).sort(byVal(g));
        return t.slice(0, 1);
      });
      if (r[0]) {
        card.ignoreName = r[0].def.name;
        g.log(`${name(card)}: 「${card.ignoreName}」の能力はすべて無視される`);
      }
    },
  };

  const MAP = new Map(Object.entries(S).map(([k, v]) => [norm(k), v]));
  G.CardScripts = { get: (n) => MAP.get(norm(n)) || null, names: () => Object.keys(S) };
  if (typeof module !== 'undefined') module.exports = G.CardScripts;
})(typeof globalThis !== 'undefined' ? globalThis : window);
