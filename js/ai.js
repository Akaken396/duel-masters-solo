// ルールベースのAI。マナ置き → 出せる中で重いカードから → 攻撃判断 の順に動く
(function (G) {
  'use strict';

  function value(g, c) {
    const k = g.kw(c);
    let v = (+c.def.cost || 0) * 2 + g.power(c) / 1000;
    if (k.blocker) v += 2;
    if (k.breaker > 1) v += k.breaker;
    if (k.slayer) v += 2;
    return v;
  }

  function chooseCharge(g, pi) {
    const me = g.p[pi];
    if (!me.hand.length) return null;
    const manaN = me.mana.length;
    if (manaN >= 8 && me.hand.length <= 2) return null;
    const manaCivs = new Set(me.mana.flatMap((m) => m.def.civs || []));
    const names = {};
    me.hand.forEach((c) => (names[c.def.name] = (names[c.def.name] || 0) + 1));
    let best = null;
    let bestScore = -Infinity;
    for (const c of me.hand) {
      const cost = +c.def.cost || 0;
      let s = 0;
      const civs = c.def.civs || [];
      if (manaN < 4 && civs.some((x) => !manaCivs.has(x))) s += 4;
      if (cost > manaN + 3) s += cost;
      else if (cost <= manaN + 1) s -= 3; // すぐ使えるカードは残す
      if (names[c.def.name] > 1) s += 2;
      if (g.kw(c).shieldTrigger && c.def.type === 'spell') s += 1; // トリガー呪文は手札では弱め
      if (civs.length > 1) s -= 1; // 多色はタップインなので後回し
      s -= cost * 0.1;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  // 使っても意味のない呪文などを避ける
  function worthPlaying(g, pi, c) {
    const abs = g.abilities(c, c.def);
    if (c.def.type !== 'spell') return true;
    if (!abs.length) return true; // 手動効果はとりあえず使う
    for (const ab of abs) {
      for (const a of ab.acts) {
        if (['destroy', 'bounce', 'tap'].includes(a.act)) {
          const pool = g.targetsFor(a, pi).filter((t) => t.owner !== pi);
          if (pool.length) return true;
        } else if (a.act === 'discard') {
          if (g.opp(pi).hand.length) return true;
        } else if (a.act === 'graveToHand') {
          if (g.p[pi].grave.some((x) => x.def.type === 'creature' || !a.creatureOnly)) return true;
        } else return true;
      }
    }
    return false;
  }

  async function playCards(g, pi) {
    const me = g.p[pi];
    for (let guard = 0; guard < 30; guard++) {
      const cand = [];
      for (const c of me.hand) {
        if (g.canPlay(pi, c) && worthPlaying(g, pi, c)) cand.push({ c, twin: false, cost: +c.def.cost || 0, v: value(g, c) });
        else if (g.canPlayTwin && g.canPlayTwin(pi, c)) {
          const t = g.twin(c);
          if (worthPlaying(g, pi, { def: t })) cand.push({ c, twin: true, cost: +t.cost || 0, v: 0 });
        }
      }
      for (const c of me.grave) {
        if (g.canPlayFromGrave(pi, c) && worthPlaying(g, pi, c)) cand.push({ c, grave: true, cost: +c.def.cost || 0, v: value(g, c) });
      }
      if (!cand.length) return;
      cand.sort((a, b) => b.cost - a.cost || b.v - a.v);
      const pick = cand[0];
      if (pick.grave) await g.playFromGrave(pi, pick.c.uid);
      else if (pick.twin) await g.playTwin(pi, pick.c.uid);
      else await g.play(pi, pick.c.uid);
      await g.pause();
    }
  }

  function breaks(g, c) {
    return Math.min(g.breakCount ? g.breakCount(c) : g.kw(c).breaker, 99);
  }

  async function attackPhase(g, pi) {
    const me = g.p[pi];
    const op = g.opp(pi);
    for (let guard = 0; guard < 40; guard++) {
      const attackers = me.battle.filter((c) => g.attackTargets(c).length);
      if (!attackers.length) return;
      attackers.sort((a, b) => g.power(b) - g.power(a));
      const oppBlockers = op.battle.filter((c) => !c.tapped && g.kw(c).blocker);
      const playerAttackers = attackers.filter((c) => g.attackTargets(c).includes('player'));

      // とどめを狙えるか：ブロッカーが止める分を差し引いても届くなら総攻撃
      const blockable = playerAttackers.filter((c) => !g.kw(c).unblockable);
      const unblockable = playerAttackers.filter((c) => g.kw(c).unblockable);
      const remaining = blockable.slice(oppBlockers.length); // 強い順に止められると仮定（悲観的）
      const through = [...unblockable, ...remaining];
      const brk = through.map((c) => breaks(g, c)).sort((a, b) => a - b);
      // 1体はとどめ用に残し、残りのブレイク数でシールドを割り切れるか
      const lethal = through.length >= 1 && brk.slice(1).reduce((s, x) => s + x, 0) >= op.shields.length;
      const throughCount = through.length;

      let chosen = null;
      let target = null;
      if (lethal || (op.shields.length === 0 && throughCount > 0)) {
        chosen = playerAttackers[0];
        target = 'player';
      } else {
        // 1) 有利に倒せるタップ状態の相手クリーチャー
        for (const c of attackers) {
          const tg = g.attackTargets(c).filter((t) => t !== 'player' && g.power(t) < g.power(c));
          if (tg.length) {
            tg.sort((a, b) => value(g, b) - value(g, a));
            chosen = c;
            target = tg[0];
            break;
          }
        }
        if (!chosen) {
          // 2) プレイヤー攻撃。相手の返しが怖い時はブロッカーを残す
          const threat = op.battle.reduce((s, c) => s + breaks(g, c), 0);
          for (const c of playerAttackers) {
            const k = g.kw(c);
            if (k.blocker && threat >= me.shields.length && me.shields.length <= 3) continue;
            const killer = oppBlockers.some((b) => g.power(b) >= g.power(c));
            if (killer && !k.unblockable && value(g, c) >= 6) continue;
            chosen = c;
            target = 'player';
            break;
          }
        }
      }
      if (!chosen) return;
      await g.attack(pi, chosen.uid, target === 'player' ? 'player' : target.uid);
      await g.pause();
    }
  }

  async function takeTurn(g, pi) {
    await g.pause();
    const c = chooseCharge(g, pi);
    if (c) {
      await g.chargeMana(pi, c.uid);
      await g.pause();
    }
    await playCards(g, pi);
    await attackPhase(g, pi);
    g.log(`${g.p[pi].name}はターンを終了した`);
  }

  // 選択の要求に答える
  async function choose(g, pi, req) {
    const opts = req.options;
    if (req.aiPick) return req.aiPick.slice(0, Math.max(req.min, Math.min(req.max, req.aiPick.length)));
    switch (req.kind) {
      case 'yesno':
        return ['yes'];
      case 'mode':
      case 'modes':
        return opts.slice(0, Math.max(1, req.min)).map((o) => o.id);
      case 'number':
        return [opts[opts.length - 1].id];
      case 'block': {
        const atk = req.attacker;
        const pa = g.power(atk);
        const me = g.p[pi];
        const cards = opts.map((o) => o.card);
        const survive = cards.filter((b) => g.power(b) > pa).sort((a, b) => g.power(a) - g.power(b));
        if (survive.length) return [survive[0].uid];
        const trade = cards.filter((b) => g.power(b) === pa || g.kw(b).slayer);
        if (trade.length && value(g, atk) >= value(g, trade[0])) return [trade[0].uid];
        if (req.target === 'player') {
          const danger = me.shields.length === 0 || (g.kw(atk).breaker >= 2 && me.shields.length <= 2) || me.shields.length <= 1;
          if (danger) {
            cards.sort((a, b) => value(g, a) - value(g, b));
            return [cards[0].uid];
          }
        }
        return [];
      }
      case 'shield': {
        const ids = opts.slice(0, req.max).map((o) => o.id);
        return ids;
      }
      case 'discard': {
        if (req.max > 1) return opts.slice().sort((a, b) => value(g, a.card) - value(g, b.card)).slice(0, req.max).map((o) => o.id);
        const sorted = opts.slice().sort((a, b) => value(g, a.card) - value(g, b.card));
        return [sorted[0].id];
      }
      case 'recover': {
        if (/進化元/.test(req.prompt)) {
          const sorted = opts.slice().sort((a, b) => value(g, a.card) - value(g, b.card));
          return [sorted[0].id];
        }
        const sorted = opts.slice().sort((a, b) => value(g, b.card) - value(g, a.card));
        return sorted.slice(0, req.max).map((o) => o.id);
      }
      case 'target':
      default: {
        // 相手のカードは価値の高い順、自分のカードは低い順
        const theirs = opts.filter((o) => o.card && o.card.owner !== pi).sort((a, b) => value(g, b.card) - value(g, a.card));
        const mine = opts.filter((o) => !o.card || o.card.owner === pi).sort((a, b) => (a.card ? value(g, a.card) : 0) - (b.card ? value(g, b.card) : 0));
        const harmful = ['destroy', 'bounce', 'tap'].includes(req.act);
        const order = harmful ? [...theirs, ...mine] : [...mine, ...theirs];
        const n = harmful ? Math.max(req.min, Math.min(req.max, theirs.length)) : req.max;
        return order.slice(0, Math.max(req.min, n)).map((o) => o.id);
      }
    }
  }

  G.AI = { takeTurn, choose, chooseCharge };
  if (typeof module !== 'undefined') module.exports = G.AI;
})(typeof globalThis !== 'undefined' ? globalThis : window);
