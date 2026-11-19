// 対戦の進行とルール処理
(function (G) {
  'use strict';
  const TP = G.TextParse || (typeof require !== 'undefined' ? require('./textparse.js') : null);

  const CIV_LABEL = { light: '光', water: '水', darkness: '闇', fire: '火', nature: '自然', zero: 'ゼロ' };
  const ZONES = ['deck', 'hand', 'mana', 'shields', 'battle', 'grave'];
  const ZONE_LABEL = { deck: '山札', hand: '手札', mana: 'マナ', shields: 'シールド', battle: 'バトルゾーン', grave: '墓地' };

  // 種類: creature / spell / tamaseed（タマシード） / castle（城）
  const NON_CREATURE = ['spell', 'tamaseed', 'castle', 'field'];
  const TYPE_LABEL = { creature: 'クリーチャー', spell: '呪文', tamaseed: 'タマシード', castle: '城', field: 'フィールド' };

  // ツインパクトの呪文側を、ひとつのカード定義として扱う
  const twinCache = new WeakMap();
  function twinDef(def) {
    if (!def || !def.twin || !def.twin.name) return null;
    let t = twinCache.get(def);
    if (!t || t._src !== JSON.stringify(def.twin)) {
      t = {
        id: def.id + '#twin',
        name: def.twin.name,
        civs: def.twin.civs && def.twin.civs.length ? def.twin.civs : def.civs,
        cost: +def.twin.cost || 0,
        type: def.twin.type || 'spell',
        power: null,
        races: [],
        text: def.twin.text || '',
        _src: JSON.stringify(def.twin),
      };
      twinCache.set(def, t);
    }
    return t;
  }

  const WHEN_J = { targeted: '選ばれた時の能力', oppAttack: '相手の攻撃時の能力', allyCast: '呪文を唱えた時の能力', oppCast: '相手が呪文を唱えた時の能力', allyBattleWin: '味方がバトルに勝った時の能力', oppDestroyed: '相手のクリーチャーが破壊された時の能力', ownShieldLeft: 'シールドが離れた時の能力', attackEnd: '攻撃の終わりの能力', beforeBreak: 'ブレイクの前の能力', unblocked: 'ブロックされなかった時の能力', allyAttack: '味方の攻撃時の能力', allyLeft: '味方が離れた時の能力', tapped: 'タップした時の能力', untapped: 'アンタップした時の能力', evolveSource: 'シンカパワー', tapAbility: 'タップ能力', battleLose: 'バトルに負けた時の能力', left: '離れた時の能力', attacked: '攻撃された時の能力', summonOnly: '召喚で出た時の能力', battleWin: 'バトルに勝った時の能力', oppTurnStart: '相手のターンのはじめの能力', broke: 'ブレイクした時の能力', summon: '出た時の能力', attack: '攻撃する時の能力', destroyed: '破壊された時の能力', turnStart: 'ターンのはじめの能力', turnEnd: 'ターンの終わりの能力', shieldAdded: 'シールドが置かれた時の能力', exLifeLost: 'EXライフが離れた時の能力', block: 'ブロックした時の能力', sealsGone: '封印が外れた時の能力' };

  class GameOver extends Error {
    constructor(winner, reason) {
      super('game over');
      this.winner = winner;
      this.reason = reason;
    }
  }

  let uidSeq = 1;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 解析結果はカード定義ごとにキャッシュ
  const parsedCache = new WeakMap();
  function parsed(def) {
    let p = parsedCache.get(def);
    if (!p) {
      p = TP.parseCard(def);
      parsedCache.set(def, p);
    }
    return p;
  }

  class Game {
    /**
     * opts: { decks:[defs[],defs[]], names:[s,s], ai:[bool,bool], chooser(game,pi,req)->Promise<ids[]>,
     *         onChange(game), onLog(msg), first:0|1, rng, aiDelay(ms), AI }
     */
    constructor(opts) {
      this.opts = opts;
      this.rng = opts.rng || Math.random;
      this.AI = opts.AI || G.AI;
      this.logs = [];
      this.turn = 0;
      this.active = opts.first ?? 0;
      this.first = this.active;
      this.winner = null;
      this.endReason = '';
      this.manaCharged = false;
      this.busy = false;
      this.p = [0, 1].map((i) => ({
        idx: i,
        name: opts.names?.[i] ?? (i === 0 ? 'あなた' : 'AI'),
        isAI: !!opts.ai?.[i],
        deck: opts.decks[i].map((def) => this.mk(def, i)),
        hand: [],
        mana: [],
        shields: [],
        battle: [],
        grave: [],
      }));
    }

    mk(def, owner) {
      return { uid: uidSeq++, def, owner, tapped: false, sick: false, tempPower: 0, attacking: false, enteredTurn: -1 };
    }

    kw(card) {
      const base = this.kwBase(card);
      if (!this.isCreature(card) || this._granting) return base;
      // 自分の場のカードが与える能力
      let out = base;
      this._granting = true;
      try {
        for (const src of this.permanents(card.owner)) {
          const g = this.kwBase(src).grant;
          if (!g || (g.others && src === card)) continue;
          if (g.who && !((card.def.races || []).join('/') + card.def.name).includes(g.who.replace(/(クリーチャー|カード)$/, ''))) continue;
          if (g.civ && !(card.def.civs || []).includes(g.civ)) continue;
          for (const nm of g.names) {
            const hit = G.Keywords && G.Keywords.match(nm, nm);
            if (hit && hit.e.set) {
              if (out === base) out = { ...base };
              hit.e.set(out, hit.m, nm);
            }
          }
        }
      } finally {
        this._granting = false;
      }
      // 次のターンまで与えられた能力（tempGrant）
      for (const tg of this.p[card.owner].tempGrants || []) {
        if (tg.until < this.turn || (tg.uids && !tg.uids.includes(card.uid))) continue;
        for (const nm of tg.names) {
          const hit = G.Keywords && G.Keywords.match(nm, nm);
          if (hit && hit.e.set) {
            if (out === base) out = { ...base };
            hit.e.set(out, hit.m, nm);
          }
        }
      }
      if (base.selfBuff) {
        for (const nm of base.selfBuff.names) {
          const hit = G.Keywords && G.Keywords.match(nm, nm);
          if (hit && hit.e.set) {
            if (out === base) out = { ...base };
            hit.e.set(out, hit.m, nm);
          }
        }
      }
      // マナ武装でパワーアップ＋能力
      const mb = base.manaArmedBuff;
      if (mb && this.p[card.owner].mana.filter((m) => (m.def.civs || []).includes(mb.civ)).length >= mb.n) {
        for (const nm of mb.names) {
          const hit = G.Keywords && G.Keywords.match(nm, nm);
          if (hit && hit.e.set) {
            if (out === base) out = { ...base };
            hit.e.set(out, hit.m, nm);
          }
        }
      }
      // 条件つきで能力を得る
      for (const cgr of base.condGrants || []) {
        if (!this.condOk2(card.owner, cgr.cond, card)) continue;
        for (const nm of cgr.names) {
          const hit = G.Keywords && G.Keywords.match(nm, nm);
          if (hit && hit.e.set) {
            if (out === base) out = { ...base };
            hit.e.set(out, hit.m, nm);
          }
        }
      }
      // パワーが一定以上なら能力を得る
      const pg = base.powerGrant;
      if (pg) {
        const raw = (card.hyper && parsed(card.def).kw.hyperPower) || (+card.def.power || 0) + (card.tempPower || 0) + this.powerExtra(card);
        if (raw >= pg.min) {
          const hit = G.Keywords && G.Keywords.match(pg.name.normalize('NFKC'), pg.name);
          if (hit && hit.e.set) {
            if (out === base) out = { ...base };
            hit.e.set(out, hit.m, pg.name);
          }
        }
      }
      return out;
    }
    kwBase(card) {
      if (this.isIgnored(card.def.name)) return { breaker: 1, powerAttacker: 0 };
      const p = parsed(card.def);
      if (card.hyper && p.hyper) {
        const h = p.hyper.kw;
        return { ...p.kw, ...h, breaker: Math.max(p.kw.breaker, h.breaker || 1), powerAttacker: Math.max(p.kw.powerAttacker, h.powerAttacker || 0) };
      }
      return p.kw;
    }
    abilities(card, def = card.def) {
      if (this.isIgnored(def.name)) return [];
      const p = parsed(def);
      if (card && card.hyper && p.hyper && def === card.def) return [...p.abilities, ...p.hyper.abilities];
      return p.abilities;
    }
    // ブレイク数（パワード・ブレイカー込み）
    breakCount(card) {
      if (this.permanents(1 - card.owner).some((s) => this.kw(s).oppBreakCap)) return 1;
      const k = this.kw(card);
      if (k.poweredBreaker) return Math.max(1, Math.floor(this.power(card) / 6000), k.breaker);
      return k.breaker;
    }
    // 相手に選ばれるか（ジャストダイバー・選べない）
    selectable(card, chooserPi) {
      if (card.owner === chooserPi || this.zoneOf(card) !== 'battle') return true;
      const k = this.kw(card);
      if (k.untargetable === true) return false;
      if (k.untargetable && this.protectOk(k.untargetable, card)) return false;
      for (const src of this.p[card.owner].battle) {
        for (const pr of this.kw(src).protects || []) {
          if (!this.protectOk(pr, card)) continue;
          if (/^他の/.test(pr.who) && card === src) continue;
          if (!pr._cond) pr._cond = G.TextParse && G.TextParse.lookCond ? G.TextParse.lookCond(pr.who.replace(/^他の(、)?/, '').replace(/^(タップされている|タップしている)/, '')) : {};
          if (/^タップ(されて|して)いる/.test(pr.who) && !card.tapped) continue;
          if (this.fitLook(card, pr._cond)) return false;
        }
      }
      if ((card.jdUntil || 0) >= this.turn) return false;
      const sc = this.sc(card);
      if (sc && sc.untargetable && sc.untargetable(this, card)) return false;
      // 場のカードが与える「選ばれない」
      for (const src of this.p[card.owner].battle) {
        const pr = this.kw(src).protect;
        if (!pr) continue;
        if (pr.multi && (card.def.civs || []).length > 1) return false;
        if (pr.who && ((card.def.races || []).join('/') + '/' + card.def.name).includes(pr.who.replace(/(・)?クリーチャー$/, ''))) return false;
      }
      if ((card.protectUntil || 0) >= this.turn) return false;
      // アアルカイトの電影：呪文で選ばれない
      if ((card.spellShieldUntil || 0) >= this.turn && this.currentSource && this.currentSource.type === 'spell') return false;
      return true;
    }
    // 「選ばれない」の条件が今満たされているか
    protectOk(o, card) {
      const src = this.currentSource;
      if (o.unknown) return false;
      if (o.bySpell && !(src && src.type === 'spell')) return false;
      if (o.exceptCiv && src && (src.civs || []).includes(o.exceptCiv)) return false;
      if (o.onlyCiv && !(src && (src.civs || []).includes(o.onlyCiv))) return false;
      if (o.oppTurn && this.active === card.owner) return false;
      if (o.count || o.faceUpShieldsGE) return this.condOk2(card.owner, o, card);
      return true;
    }
    // 「火または自然のコスト5以上のドラゴン」などの条件に合うか
    matchCond(c, cond) {
      if (!cond) return false;
      if (cond.civs && cond.civs.length && !(c.def.civs || []).some((x) => cond.civs.includes(x))) return false;
      if (cond.minCost != null && (+c.def.cost || 0) < cond.minCost) return false;
      if (cond.maxCost != null && (+c.def.cost || 0) > cond.maxCost) return false;
      if (cond.minPower != null && this.power(c) < cond.minPower) return false;
      if (cond.race && !['クリーチャー', ''].includes(cond.race)) {
        const words = cond.race.split(/または|か|、|・/).filter(Boolean);
        const hay = (c.def.races || []).join('/') + '/' + c.def.name;
        if (!words.some((w) => hay.includes(w))) return false;
      }
      return true;
    }
    // 常在の条件（マナ武装・数・シールドなど）
    condOk2(pi, c, card) {
      const me = this.p[pi];
      if (c.myTurn && this.active !== pi) return false;
      if (c.oppTurn && this.active === pi) return false;
      if (c.inBattle) {
        if (!card || !card.inBattle) return false;
        if (c.inBattle.maxCost != null && (+card.inBattle.def.cost || 0) > c.inBattle.maxCost) return false;
        if (c.inBattle.vs && !c.inBattle.vs.split(/または/).some((w) => this.fitLook(card.inBattle, G.TextParse.lookCond(w.replace(/^種族に(.+?)とある/, '$1'))))) return false;
      }
      if (c.manaGE != null && me.mana.length < c.manaGE) return false;
      if (c.handLE != null && me.hand.length > c.handLE) return false;
      if (c.graveGE != null && me.grave.length < c.graveGE) return false;
      if (c.handLess && !(me.hand.length < this.p[1 - pi].hand.length)) return false;
      if (c.shieldsLess && !(me.shields.length < this.p[1 - pi].shields.length)) return false;
      if (c.oppAllTapped && this.p[1 - pi].battle.some((x) => this.isCreature(x) && !x.tapped)) return false;
      if (c.oppHas && !this.p[1 - pi].battle.some((x) => ((x.def.races || []).join('/') + x.def.name + (x.def.type || '')).includes(c.oppHas.replace(/(・)?クリーチャー$/, '')))) return false;
      if (c.countLE) {
        const w = c.countLE.what.replace(/(・)?クリーチャー$/, '');
        const n = me.battle.filter((x) => (!c.countLE.others || x !== card) && this.isCreature(x) && (!w || ((x.def.races || []).join('/') + x.def.name).includes(w))).length;
        if (n > c.countLE.n) return false;
      }
      if (c.count && c.count.others && card) {
        const w = c.count.what.replace(/(・)?クリーチャー$/, '');
        const n = me.battle.filter((x) => x !== card && this.isCreature(x) && (!w || ((x.def.races || []).join('/') + x.def.name).includes(w))).length;
        if (n < c.count.n) return false;
        return this.condOk(pi, { ...c, count: null });
      }
      if (c.n != null && c.manaCiv !== undefined && me.mana.filter((m) => !c.manaCiv || (m.def.civs || []).includes(c.manaCiv)).length < c.n) return false;
      if (c.count && this.countOwn(pi, c.count.what) < c.count.n) return false;
      if (c.faceUpShieldsGE != null && me.shields.filter((s) => s.faceUp).length < c.faceUpShieldsGE) return false;
      return this.condOk(pi, c);
    }
    // 条件の比較
    condOk(pi, c) {
      const me = this.p[pi];
      const op = this.p[1 - pi];
      const cr = (pl) => pl.battle.filter((x) => this.isCreature(x)).length;
      if (c.shieldsMore && !(me.shields.length > op.shields.length)) return false;
      if (c.creaturesMore && !(cr(me) > cr(op))) return false;
      if (c.oppManaMore && !(op.mana.length > me.mana.length)) return false;
      if (c.shieldsLE != null && !(me.shields.length <= c.shieldsLE)) return false;
      if (c.shieldsGE != null && !(me.shields.length >= c.shieldsGE)) return false;
      if (c.powerGE != null && !me.battle.some((x) => this.isCreature(x) && this.power(x) >= c.powerGE)) return false;
      return true;
    }

    // 手札を捨てる（相手の効果で、相手のターンに捨てられる時は、かわりに場に出せるカードがある）
    async discardCard(c, byPi) {
      if (!c || this.zoneOf(c) !== 'hand') return;
      const owner = this.p[c.owner];
      if (parsed(c.def).kw.madness && byPi !== c.owner && this.active !== c.owner) {
        if (await this.yesNo(c.owner, `「${c.def.name}」は捨てられるかわりにバトルゾーンに出せます。出しますか？`, c)) {
          this.log(`「${c.def.name}」は捨てられるかわりに出た`);
          await this.enterBattle(c, c.owner, 'other');
          return;
        }
      }
      this.moveTo(c, 'grave');
      this.log(`${owner.name}は手札の「${c.def.name}」を捨てた`);
    }

    // 相手が自分の効果でシールドを増やす時、かわりに墓地へ（そういうカードがあれば）
    shieldBlocked(pi) {
      return this.permanents(1 - pi).some((s) => this.kw(s).oppShieldToGrave);
    }
    async addShieldFromDeck(pi, n) {
      const me = this.p[pi];
      let added = 0;
      for (let i = 0; i < n && me.deck.length; i++) {
        if (this.shieldBlocked(pi)) {
          this.moveTo(me.deck[0], 'grave');
          this.log(`シールドに置くかわりに墓地に置かれた`);
        } else {
          this.moveTo(me.deck[0], 'shields');
          added++;
        }
      }
      return added;
    }

    // 「自分の○○」の数を数える（タップしているクリーチャー、「ブロッカー」を持つクリーチャー、種族など）
    countOwn(pi, what) {
      const w = String(what || '');
      let pool = this.p[pi].battle;
      if (/タマシード/.test(w)) pool = pool.filter((c) => c.def.type === 'tamaseed');
      else if (/クリーチャー/.test(w) || !/カード/.test(w)) pool = pool.filter((c) => this.isCreature(c));
      if (/タップしている/.test(w) && !/アンタップ/.test(w)) pool = pool.filter((c) => c.tapped);
      if (/アンタップしている/.test(w)) pool = pool.filter((c) => !c.tapped);
      const kwm = w.match(/「(.+?)」を持つ/);
      if (kwm) {
        const hit = G.Keywords && G.Keywords.match(kwm[1], kwm[1]);
        if (hit) {
          const probe = { breaker: 1, powerAttacker: 0 };
          hit.e.set && hit.e.set(probe, hit.m, kwm[1]);
          const keys = Object.keys(probe).filter((k) => k !== 'breaker' && k !== 'powerAttacker');
          pool = pool.filter((c) => keys.every((k) => this.kw(c)[k]) || (probe.breaker > 1 && this.kw(c).breaker >= probe.breaker));
        }
      }
      const civ = w.match(/^(光|水|闇|火|自然)の/);
      if (civ) pool = pool.filter((c) => (c.def.civs || []).includes({ 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[civ[1]]));
      const race = w
        .replace(/「.+?」を持つ/, '')
        .replace(/(タップしている|アンタップしている|(光|水|闇|火|自然)の)/g, '')
        .replace(/(・)?(クリーチャー|カード|タマシード)$/, '')
        .trim();
      if (race) pool = pool.filter((c) => ((c.def.races || []).join('/') + c.def.name).includes(race));
      return pool.length;
    }

    // 封印
    addSeals(card, n) {
      const me = this.p[card.owner];
      card.sealCards = me.deck.splice(0, Math.min(n, me.deck.length));
      card.seals = card.sealCards.length;
      this.log(`「${card.def.name}」に山札の上から封印が${card.seals}つ付いた（山札残り${me.deck.length}）`);
      this.changed();
    }
    async removeSeal(card) {
      if (!(card.seals > 0) || !card.sealCards) return;
      const sc = card.sealCards.pop();
      card.seals = card.sealCards.length;
      if (sc) {
        this.moveTo(sc, 'grave');
        this.log(`「${card.def.name}」の封印を1つ外した →「${sc.def.name}」を墓地へ（残り${card.seals}）`);
      }
      await this.pause(0.5);
      if (card.seals === 0) await this.trigger(card, 'sealsGone', card.owner);
    }
    // エモーショナル・ハードコアなどで能力が無視されている名前か
    isIgnored(n) {
      for (const pl of this.p) for (const c of pl.battle) if (c.ignoreName && c.ignoreName === n && c.def.name !== n) return true;
      return false;
    }
    // カード専用スクリプト（js/cardscripts.js）
    script(def) {
      const S = G.CardScripts;
      if (!S || !def) return null;
      if (this.isIgnored(def.name)) return null;
      return S.get(def.name);
    }
    sc(card) {
      return this.script(card.def);
    }
    // 場で効果を持つカード（バトルゾーン＋表向きシールド）
    permanents(pi) {
      const pl = this.p[pi];
      return [...pl.battle, ...pl.shields.filter((s) => s.faceUp)];
    }
    // その手番プレイヤー pi にとっての「次の pi のターン」
    nextTurnOf(pi) {
      return this.active === pi ? this.turn + 2 : this.turn + 1;
    }
    manual(card, def = card.def) {
      return parsed(def).manual;
    }
    isCreature(card) {
      return !NON_CREATURE.includes(card.def.type);
    }

    power(card) {
      if (card.def.power == null || !this.isCreature(card)) return 0;
      const hp = card.hyper && parsed(card.def).kw.hyperPower;
      let extra = this.powerExtra(card);
      const meP = this.p[card.owner];
      for (const tp of meP.tempPowers || []) if (tp.until >= this.turn && tp.except !== card.uid) extra += tp.n;
      for (const tg of meP.tempGrants || []) if (tg.power && tg.until >= this.turn && (!tg.uids || tg.uids.includes(card.uid))) extra += tg.power;
      const kb = parsed(card.def).kw;
      if (kb.aloneBuff && meP.battle.filter((c) => this.isCreature(c)).length === 1) extra += kb.aloneBuff;
      if (kb.selfBuff) extra += kb.selfBuff.n;
      for (const cgr of kb.condGrants || []) if (cgr.power && this.condOk2(card.owner, cgr.cond, card)) extra += cgr.power;
      for (const src of this.p[card.owner].battle) {
        const tp = this.kwBase(src).teamPower;
        if (!tp || (tp.others && src === card)) continue;
        if (tp.oppTurnOnly && this.active === card.owner) continue;
        if (tp.who && !((card.def.races || []).join('/') + card.def.name).includes(tp.who.replace(/(・)?クリーチャー$/, ''))) continue;
        extra += tp.n;
      }
      for (const src of this.p[card.owner].battle) {
        for (const tp of this.kwBase(src).teamPowers || []) {
          if (tp.others && src === card) continue;
          if (tp.civ && !(card.def.civs || []).includes(tp.civ)) continue;
          if (tp.who && !((card.def.races || []).join('/') + card.def.name).includes(tp.who)) continue;
          extra += tp.n;
        }
      }
      const mb = parsed(card.def).kw.manaArmedBuff;
      if (mb && this.p[card.owner].mana.filter((m) => (m.def.civs || []).includes(mb.civ)).length >= mb.n) extra += mb.power;
      if (card.blocking) extra += parsed(card.def).kw.blockPower || 0;
      return (hp || +card.def.power || 0) + extra + card.tempPower + (card.attacking ? this.kw(card).powerAttacker : 0);
    }

    // マナ・墓地・場の数に応じたパワー
    powerExtra(card) {
      const pu = parsed(card.def).kw.powerPerUnder;
      if (pu) return Math.floor((card.under || []).length / pu.per) * pu.n + this.powerExtra2(card);
      return this.powerExtra2(card);
    }
    powerExtra2(card) {
      const pp = parsed(card.def).kw.powerPer;
      if (!pp) return 0;
      if (pp.all && pp.zone === '墓地') {
        const all = [...this.p[0].grave, ...this.p[1].grave].filter((c) => !pp.what || (pp.what === '呪文' ? c.def.type === 'spell' : this.isCreature(c)));
        return Math.floor(all.length / pp.per) * pp.n;
      }
      if (pp.zone === '墓地' && pp.what === '呪文') return Math.floor(this.p[card.owner].grave.filter((c) => c.def.type === 'spell').length / pp.per) * pp.n;
      const me = this.p[pp.side === 'opp' ? 1 - card.owner : card.owner];
      const zone = pp.zone === 'マナゾーン' ? me.mana : pp.zone === '墓地' ? me.grave : me.battle;
      const w = (pp.what || '').replace(/^の/, '').replace(/(クリーチャー|カード)$/, '');
      const cnt = zone.filter((c) => (!pp.others || c !== card) && (pp.zone !== 'バトルゾーン' || this.isCreature(c)) && (!w || ((c.def.races || []).join('/') + c.def.name + (c.def.type === 'spell' ? '呪文' : '')).includes(w))).length;
      return Math.floor(cnt / pp.per) * pp.n;
    }

    log(msg) {
      this.logs.push(msg);
      this.opts.onLog?.(msg);
    }

    changed() {
      this.checkState();
      this.opts.onChange?.(this);
    }

    abort() {
      this.aborted = true;
      this.releaseWait();
    }

    async pause(mult = 1) {
      if (this.aborted) throw new GameOver(null, '中断');
      this.changed();
      const d = this.opts.aiDelay || 0;
      if (d > 0) await sleep(d * mult);
    }

    opp(pi) {
      return this.p[1 - pi];
    }

    find(uid) {
      for (const pl of this.p) {
        for (const z of ZONES) {
          const i = pl[z].findIndex((c) => c.uid === uid);
          if (i >= 0) return { card: pl[z][i], zone: z, player: pl, index: i };
        }
      }
      return null;
    }

    zoneOf(card) {
      const f = this.find(card.uid);
      return f ? f.zone : null;
    }

    // カードを owner の指定ゾーンへ移す（ルール無視の基本操作）
    moveTo(card, zone, o) {
      o = o || {};
      const top = o.top !== false;
      const tapped = !!o.tapped;
      const f = this.find(card.uid);
      if (f) f.player[f.zone].splice(f.index, 1);
      const from = f ? f.zone : null;
      const owner = this.p[card.owner];
      if (zone !== 'battle' || from !== 'battle') {
        card.tapped = tapped;
        card.tempPower = 0;
        card.attacking = false;
        card.sick = false;
      }
      if (from === 'shields' && zone !== 'shields') {
        card.faceUp = false;
        for (const c of this.p[card.owner].battle) {
          if (parsed(c.def).kw.zRush) {
            if (!c.hyper) this.log(`「${c.def.name}」のZラッシュ：次の自分のターンのはじめまでハイパーモード`);
            c.hyper = true;
            c.hyperUntil = this.nextTurnOf(c.owner);
          }
        }
      }
      if (from === 'battle' && zone !== 'battle') {
        // 残っている封印は墓地へ
        if (card.sealCards && card.sealCards.length) {
          const rest = card.sealCards.splice(0);
          for (const sc of rest) this.p[sc.owner].grave.push(sc);
        }
        delete card.sealCards;
        // 場を離れたら、場にいた間の状態を消す
        for (const k of ['seals', 'exLife', 'forceShield', 'noLeaveUntil', 'frozenUntil', 'noAttackTurn', 'modesUsed', 'flipped', 'usedTurn', 'ignoreName', 'hyper', 'hyperUntil', 'jdUntil', 'returnAtEnd', 'badEnd', 'spellShieldUntil', 'blocking', 'protectUntil', 'allyUsed', 'winAllUntil', 'firstAttackDone', 'lockedUntil', 'unblockableTurn', 'noDestroyUntil', 'abUsed']) delete card[k];
      }
      if (zone === 'grave') this.graveThisTurn = true;
      if (zone === 'deck' && top) owner.deck.unshift(card);
      else owner[zone].push(card);
      if (zone === 'battle' && from !== 'battle') {
        card.sick = !this.kw(card).speedAttacker;
        card.enteredTurn = this.turn;
        if (this.kw(card).enterTapped) card.tapped = true;
      }
      return from;
    }

    checkState() {
      if (this.winner != null) return;
      for (const pl of this.p) {
        if (this.started && pl.deck.length === 0 && !this.cantLose(pl.idx)) {
          this.winner = 1 - pl.idx;
          this.endReason = `${pl.name}の山札が0枚になった`;
        }
      }
      if (this.winner != null) {
        this.releaseWait();
        this.log(`■ 勝者: ${this.p[this.winner].name}（${this.endReason}）`);
        this.opts.onChange?.(this);
        throw new GameOver(this.winner, this.endReason);
      }
    }

    cantLose(pi) {
      return (this.p[pi].noLoseUntil || 0) >= this.turn;
    }

    win(pi, reason) {
      if (this.winner != null) return;
      if (this.cantLose(1 - pi)) {
        this.log(`${this.p[1 - pi].name}はこのターン負けない（${reason}は無効）`);
        return;
      }
      this.winner = pi;
      this.endReason = reason;
      this.releaseWait();
      this.log(`■ 勝者: ${this.p[pi].name}（${reason}）`);
      this.opts.onChange?.(this);
      throw new GameOver(pi, reason);
    }

    releaseWait() {
      const r = this._endTurnResolve;
      this._endTurnResolve = null;
      if (r) r();
    }

    async choose(pi, req) {
      if (this.p[pi].isAI) return this.AI.choose(this, pi, req);
      this.changed();
      return this.opts.chooser(this, pi, req);
    }
    // 複数の選択肢から、先に処理内容をすべて選ぶ（repeat: 同じものを複数回選べる）
    async chooseModes(pi, prompt, options, o = {}) {
      const min = o.min ?? 1;
      const max = o.max ?? 1;
      const r = await this.choose(pi, {
        kind: 'modes',
        prompt,
        options,
        min,
        max,
        repeat: !!o.repeat,
        aiPick: o.aiPick ? [].concat(o.aiPick).slice(0, max) : options.slice(0, Math.max(min, 1)).map((x) => x.id),
      });
      if (r.length) this.log(`選んだ処理: ${r.map((id) => options.find((x) => x.id === id)?.label || id).join(' → ')}`);
      return r;
    }

    // 山札を見る効果の条件にカードが合うか
    fitLook(c, cd) {
      cd = cd || {};
      if (cd.any) return cd.any.some((x) => this.fitLook(c, x));
      const hay = (c.def.races || []).join('/') + '/' + c.def.name;
      return (
        (cd.maxCost == null || (+c.def.cost || 0) <= cd.maxCost) &&
        (cd.minCost == null || (+c.def.cost || 0) >= cd.minCost) &&
        (!cd.notEvo || !this.evoKind(c.def)) &&
        (!cd.types || cd.types.includes(c.def.type === 'creature' || !NON_CREATURE.includes(c.def.type) ? 'creature' : c.def.type)) &&
        (!cd.civs || !cd.civs.length || (c.def.civs || []).some((x) => cd.civs.includes(x))) &&
        (!cd.race || hay.includes(cd.race)) &&
        (!cd.races || cd.races.some((r) => hay.includes(r))) &&
        (!cd.hasText || (c.def.text || '').includes(cd.hasText)) &&
        (!cd.nameHas || c.def.name.includes(cd.nameHas)) &&
        (!cd.colorless || !(c.def.civs || []).some((x) => x !== 'zero'))
      );
    }
    // 効果の前後で盤面が変わったか（「そうしたら」の判定用）
    stateSig() {
      return this.p.map((pl) => ['hand', 'mana', 'battle', 'grave', 'shields', 'deck'].map((z) => pl[z].length).join(',') + ':' + [...pl.battle, ...pl.mana].filter((c) => c.tapped).length).join('|');
    }

    async yesNo(pi, prompt, card) {
      const r = await this.choose(pi, {
        kind: 'yesno',
        prompt,
        card,
        options: [
          { id: 'yes', label: 'はい' },
          { id: 'no', label: 'いいえ' },
        ],
        min: 1,
        max: 1,
      });
      return r[0] === 'yes';
    }

    // ===== 進行 =====
    async run() {
      try {
        const [a, b] = this.p;
        for (const pl of [a, b]) shuffle(pl.deck, this.rng);
        for (const pl of [a, b]) {
          for (let i = 0; i < 5; i++) this.moveTo(pl.deck[0], 'shields');
          for (let i = 0; i < 5; i++) this.moveTo(pl.deck[0], 'hand');
        }
        this.started = true;
        this.log(`対戦開始。先攻: ${this.p[this.active].name}`);
        for (;;) {
          await this.beginTurn();
          const me = this.p[this.active];
          if (me.isAI) await this.AI.takeTurn(this, this.active);
          else await new Promise((res) => (this._endTurnResolve = res));
          if (this._undoTo) this._undoTo = null;
          if (this.winner != null || this.aborted) break;
          for (const c of this.permanents(this.active)) if (this.isOnField(c)) await this.trigger(c, 'turnEnd', c.owner, c.def, null, { defer: true });
          await this.resolvePending();
          await this.endTurnEffects();
          this.endTurnCleanup();
          const xt = this.p[this.active].extraTurns || 0;
          if (xt > 0) {
            this.p[this.active].extraTurns = xt - 1;
            this.inExtraTurn = true;
            this.log(`${this.p[this.active].name}の追加ターン！`);
          } else {
            this.inExtraTurn = false;
            this.active = 1 - this.active;
          }
          if (this.turn > 400) this.win(this.first, '規定ターン超過');
        }
      } catch (e) {
        if (!(e instanceof GameOver)) {
          console.error(e);
          this.log('エラー: ' + e.message);
          throw e;
        }
      }
      this.opts.onChange?.(this);
      return this.winner;
    }

    async beginTurn() {
      this.turn++;
      const me = this.p[this.active];
      this.manaCharged = false;
      this.log(`―― ターン${this.turn}: ${me.name} ――`);
      this.graveThisTurn = false;
      this.spellsThisTurn = [0, 0];
      this.creaturesThisTurn = [0, 0];
      for (const c of me.mana) if (!((c.frozenUntil || 0) >= this.turn)) c.tapped = false;
      for (const c of me.battle) if (c.hyper && c.hyperUntil && c.hyperUntil <= this.turn) {
        c.hyper = false;
        this.log(`「${c.def.name}」のハイパーモードが終わった`);
      }
      const untappedNow = [];
      for (const c of me.battle) {
        if (!this.kw(c).noUntap && !((c.frozenUntil || 0) >= this.turn)) {
          if (c.tapped) untappedNow.push(c);
          c.tapped = false;
        }
        c.sick = false;
      }
      this.untappedNow = untappedNow;
      for (const c of this.permanents(this.active)) {
        if (this.isOnField(c)) await this.trigger(c, 'turnStart', c.owner, c.def, null, { defer: true });
      }
      for (const c of this.permanents(1 - this.active)) {
        if (this.isOnField(c)) await this.trigger(c, 'oppTurnStart', c.owner, c.def, null, { defer: true });
      }
      for (const c of this.untappedNow || []) if (this.zoneOf(c) === 'battle') await this.trigger(c, 'untapped', c.owner, c.def, null, { defer: true });
      await this.resolvePending();
      // ドロー（先攻1ターン目は引かない）
      const skipDraw = this.turn === 1;
      if (!skipDraw) this.draw(this.active, 1);
      this.changed();
    }

    async endTurnEffects() {
      const me = this.p[this.active];
      for (const c of me.battle) if (c.tapped && this.kw(c).untapAtEnd) {
        c.tapped = false;
        this.log(`「${c.def.name}」はターンの終わりにアンタップした`);
      }
      for (const eu of (me.endUntaps || []).filter((x) => x.turn === this.turn)) {
        const r = await this.pickCards(this.active, me.battle.filter((c) => this.isCreature(c) && c.tapped), eu.n, true, 'ターンの終わりにアンタップするクリーチャー', 'recover');
        for (const c of r) c.tapped = false;
        if (r.length) this.log(`${me.name}はクリーチャーを${r.length}体アンタップした`);
      }
      me.endUntaps = (me.endUntaps || []).filter((x) => x.turn !== this.turn);
      for (const ea of (me.endTurnActs || []).filter((x) => x.turn === this.turn)) {
        const f = this.find(ea.uid);
        if (!f || this.zoneOf(f.card) !== 'battle') continue;
        if (ea.to === 'destroy') await this.destroyMany([f.card], { byOpp: false });
        else if (ea.to === 'deckBottom') await this.leave(f.card, 'deck', { moveOpt: { top: false } });
        else await this.leave(f.card, ea.to);
        this.log(`ターンの終わり：「${f.card.def.name}」を${{ destroy: '破壊した', hand: '手札に戻した', deckBottom: '山札の下に置いた', mana: 'マナゾーンに置いた' }[ea.to]}`);
      }
      me.endTurnActs = (me.endTurnActs || []).filter((x) => x.turn !== this.turn);
      for (const pl of this.p) {
        for (const c of [...pl.battle]) {
          if (c.returnAtEnd) {
            await this.leave(c, 'deck', { byOpp: false, moveOpt: { top: false } });
            this.log(`ニンジャ・ストライクで出た「${c.def.name}」は山札の下に戻った`);
          } else if (c.badEnd === this.turn) {
            this.log(`B・A・Dで出た「${c.def.name}」はターンの終わりに破壊される`);
            await this.destroyMany([c], { byOpp: false });
          }
        }
      }
    }
    endTurnCleanup() {
      for (const pl of this.p) for (const c of pl.battle) c.tempPower = 0;
    }

    // 人間側のターン終了ボタン
    endTurn() {
      if (this.busy || this.p[this.active].isAI || !this._endTurnResolve) return;
      const r = this._endTurnResolve;
      this._endTurnResolve = null;
      this.log(`${this.p[this.active].name}はターンを終了した`);
      r();
    }

    // ===== 巻き戻し =====
    cloneCard(c) {
      if (!c) return c;
      return {
        ...c,
        sealCards: c.sealCards ? c.sealCards.map((x) => this.cloneCard(x)) : c.sealCards,
        under: c.under ? c.under.map((x) => this.cloneCard(x)) : c.under,
        modesUsed: c.modesUsed ? c.modesUsed.slice() : c.modesUsed,
      };
    }
    snapshot(label) {
      if (this.winner != null) return;
      this.history = this.history || [];
      this.history.push({
        label,
        turn: this.turn,
        active: this.active,
        manaCharged: this.manaCharged,
        graveThisTurn: this.graveThisTurn,
        spellsThisTurn: (this.spellsThisTurn || [0, 0]).slice(),
        creaturesThisTurn: (this.creaturesThisTurn || [0, 0]).slice(),
        logs: this.logs.length,
        p: this.p.map((pl) => {
          const o = { ...pl };
          for (const z of ZONES) o[z] = pl[z].map((c) => this.cloneCard(c));
          return o;
        }),
      });
      if (this.history.length > 60) this.history.shift();
    }
    // 巻き戻せるか（自分の手番で、何も処理していない時）
    canUndo() {
      return !!(this.history && this.history.length) && !this.busy && this.winner == null && !!this._endTurnResolve;
    }
    undo() {
      if (!this.canUndo()) return false;
      const h = this.history.pop();
      // 巻き戻し先が別の手番なら、その手番を人間が持っている時だけ
      if (this.p[h.active].isAI) return false;
      this.turn = h.turn;
      this.active = h.active;
      this.manaCharged = h.manaCharged;
      this.graveThisTurn = h.graveThisTurn;
      this.spellsThisTurn = h.spellsThisTurn;
      this.creaturesThisTurn = h.creaturesThisTurn;
      this.p.forEach((pl, i) => {
        const src = h.p[i];
        for (const k of Object.keys(pl)) if (!(k in src)) delete pl[k];
        Object.assign(pl, src);
        for (const z of ZONES) pl[z] = src[z].map((c) => this.cloneCard(c));
      });
      this.logs.length = h.logs;
      this.log(`↶ 巻き戻した（${h.label}の前）`);
      this.opts.onUndo?.(this);
      this.changed();
      return true;
    }

    // 人間の操作をまとめて実行（同時実行を防ぐ）
    async act(fn, label = '操作') {
      if (this.busy || this.winner != null) return;
      this.snapshot(label);
      this.busy = true;
      try {
        await fn();
      } catch (e) {
        if (!(e instanceof GameOver)) {
          console.error(e);
          this.log('エラー: ' + e.message);
        }
      } finally {
        this.busy = false;
        try {
          this.changed();
        } catch (e) {
          /* 決着済み */
        }
      }
    }

    draw(pi, n) {
      const pl = this.p[pi];
      for (let i = 0; i < n; i++) {
        if (!pl.deck.length) break;
        this.moveTo(pl.deck[0], 'hand');
      }
      this.changed();
    }

    // ===== マナ・コスト =====
    canCharge(pi, card) {
      return this.active === pi && !this.manaCharged && this.zoneOf(card) === 'hand' && card.owner === pi;
    }

    async chargeMana(pi, uid) {
      const f = this.find(uid);
      if (!f || !this.canCharge(pi, f.card)) return false;
      const multi = (f.card.def.civs || []).length > 1;
      this.moveTo(f.card, 'mana', { tapped: multi });
      this.manaCharged = true;
      this.log(`${this.p[pi].name}は「${f.card.def.name}」をマナに置いた`);
      this.changed();
      return true;
    }

    // コスト（軽減込み）と、支払った時に起きること
    costPlan(pi, card, def = card.def, sasSrc = null, bad = false) {
      let cost = +def.cost || 0;
      const uses = [];
      const self = this.script(def);
      if (self && self.selfCost) {
        const r = self.selfCost(this, card, pi, def);
        if (r != null) cost = Math.min(cost, r);
      }
      for (const src of this.permanents(pi)) {
        const sc = this.sc(src);
        if (!sc || !sc.costMod) continue;
        const r = sc.costMod(this, src, pi, card, def, sasSrc);
        if (r && r.n) {
          cost -= r.n;
          if (r.use) uses.push(r.use);
        }
      }
      const k = parsed(def).kw;
      const me = this.p[pi];
      if (k.sympathy) {
        const w = k.sympathy.replace(/^自分の/, '');
        const n = me.battle.filter((c) => this.isCreature(c) && (w === 'クリーチャー' || ((c.def.races || []).join('/') + c.def.name).includes(w))).length;
        cost -= n;
      }
      if (def.type === 'spell') for (const src of this.permanents(1 - pi)) cost += this.kw(src).spellTax || 0;
      // 場にある間コストを増減する能力
      for (const q of [pi, 1 - pi]) for (const src of this.permanents(q)) {
        for (const au of this.kw(src).costAura || []) {
          if ((au.side === 'self') !== (q === pi)) continue;
          if (this.costAuraFits(au, def)) cost += au.n;
        }
      }
      if (k.costIfCount && this.countOwn(pi, k.costIfCount.what) >= k.costIfCount.n) cost -= k.costIfCount.minus;
      if (k.costPerShield) cost += Math.floor(me.shields.length / k.costPerShield.per) * k.costPerShield.n;
      if (def.type === 'spell') {
        for (const q of [0, 1]) for (const src of this.permanents(q)) {
          const gt = this.kw(src).globalSpellTax;
          if (gt && !(def.civs || []).includes(gt.exceptCiv)) cost += gt.n;
        }
      }
      if (k.tamaEvoDiscount && this.pendingEvoBase && this.pendingEvoBase.def.type === 'tamaseed') cost -= k.tamaEvoDiscount;
      if (k.costPer) {
        const pl = k.costPer.side === 'opp' ? this.p[1 - pi] : me;
        const w = k.costPer.what.replace(/^(自分の|相手の)/, '');
        const cnt = pl.battle.filter((c) => this.isCreature(c) && (!w || w === 'クリーチャー' || ((c.def.races || []).join('/') + c.def.name).includes(w.replace(/クリーチャー$/, '')))).length;
        cost -= Math.floor(cnt / k.costPer.per) * k.costPer.n;
      }
      if (k.manaArmedCost) {
        const mc = k.manaArmedCost;
        const have = me.mana.filter((m) => !mc.manaCiv || (m.def.civs || []).includes(mc.manaCiv)).length;
        if (have >= mc.n) cost -= mc.n2;
      }
      // 汎用ササゲール（テキストの「ササゲール N」）
      if (sasSrc && !this.sc(sasSrc)?.costMod) {
        const sk = this.kw(sasSrc);
        if (sk.sasage) {
          cost -= sk.sasage;
          uses.push(async () => {
            this.log(`ササゲール：「${sasSrc.def.name}」を破壊してコストを${sk.sasage}下げた`);
            await this.destroyMany([sasSrc], { byOpp: false });
          });
        }
      }
      if (me.nextSummonDiscount && me.nextSummonDiscount.turn === this.turn && !NON_CREATURE.includes(def.type)) {
        cost -= me.nextSummonDiscount.n;
        uses.push(() => (me.nextSummonDiscount = null));
      }
      if (bad && k.bad) {
        cost -= k.bad;
        uses.push(() => (card.badEnd = this.turn));
      }
      const base = +def.cost || 0;
      cost = Math.max(base > 0 ? 1 : 0, cost);
      if (sasSrc) cost = Math.max(base > 0 ? 1 : 0, cost); // ササゲールでも0以下にはならない
      // G・ゼロ：条件を満たせばコスト0
      if (k.gZero && this.gZeroOk(pi, k.gZero)) cost = 0;
      return { cost, uses };
    }
    costAuraFits(au, def) {
      if (!au.cond) {
        let t = au.subj.replace(/^(、)/, '');
        au.notCreature = /クリーチャーではない/.test(t);
        au.multi = /^多色/.test(t);
        t = t.replace(/クリーチャーではない(、)?/, '').replace(/^多色(の)?/, '');
        au.cond = G.TextParse && G.TextParse.lookCond ? G.TextParse.lookCond(t) : {};
        if (/呪文.*タマシード|タマシード.*呪文/.test(t)) au.cond.types = ['spell', 'tamaseed'];
        else if (/クリーチャー(と|または|か)(.+?)タマシード/.test(t)) au.cond.types = ['creature', 'tamaseed'];
      }
      const c = { def };
      if (au.notCreature && !NON_CREATURE.includes(def.type)) return false;
      if (au.multi && (def.civs || []).filter((x) => x !== 'zero').length < 2) return false;
      return this.fitLook(c, au.cond);
    }
    gZeroOk(pi, text) {
      const m = String(text).match(/自分の(.+?)(が|を)(\d+体以上)?(いれば|あれば)/);
      if (!m) return false;
      const w = m[1].replace(/^(クリーチャー|カード)$/, '');
      const need = m[3] ? parseInt(m[3]) : 1;
      const n = this.p[pi].battle.filter((c) => !w || ((c.def.races || []).join('/') + c.def.name).includes(w)).length;
      return n >= need;
    }

    // 支払いに使うマナを決める。払えなければ null
    payment(pi, card, def = card.def) {
      return this.paymentPlan(pi, card, def)?.mana || null;
    }
    // ササゲールに使える自分のカード
    sasageSources(pi, def) {
      if (def.type === 'spell') return [];
      return this.permanents(pi).filter((src) => {
        const sc = this.sc(src);
        if (sc && sc.sasage) return sc.sasage(this, src, pi, def);
        const k = this.kw(src);
        if (!k.sasage || this.zoneOf(src) !== 'battle') return false;
        if (!k.sasageFor) return true;
        return ((def.races || []).join('/') + def.name).includes(k.sasageFor.replace(/^自分の/, ''));
      });
    }
    // 払い方の候補（ササゲールなし／各ササゲール）
    paymentPlans(pi, card, def = card.def) {
      const out = [];
      for (const sas of [null, ...this.sasageSources(pi, def)]) {
        const plan = this.costPlan(pi, card, def, sas);
        const mana = this.payWith(pi, def, plan.cost);
        if (mana) out.push({ mana, uses: plan.uses, cost: plan.cost, sas });
      }
      const atc = parsed(def).kw.altTapCost;
      if (atc && def.type === 'spell') {
        const tappers = this.p[pi].battle.filter((c) => this.isCreature(c) && !c.tapped && (!atc.civ || (c.def.civs || []).includes(atc.civ)));
        if (tappers.length >= atc.n) out.push({ mana: [], uses: [() => { for (const c of tappers.slice(0, atc.n)) c.tapped = true; this.log(`クリーチャー${atc.n}体をタップして唱える`); }], cost: 0, tapAlt: atc.n });
      }
      if (parsed(def).kw.bad) {
        const plan = this.costPlan(pi, card, def, null, true);
        const mana = this.payWith(pi, def, plan.cost);
        if (mana) out.push({ mana, uses: plan.uses, cost: plan.cost, bad: true });
      }
      return out;
    }
    paymentPlan(pi, card, def = card.def) {
      return this.paymentPlans(pi, card, def)[0] || null;
    }
    payWith(pi, def, cost) {
      const pl = this.p[pi];
      const need = (def.civs || []).filter((c) => c !== 'zero');
      const avail = pl.mana.filter((m) => !m.tapped);
      if (cost <= 0) return [];
      if (avail.length < cost) return null;
      const chosen = [];
      const civsOf = (m) => m.def.civs || [];
      // 必要な文明を1枚ずつ確保（文明数が少ないカードから）
      const sorted = [...avail].sort((a, b) => civsOf(a).length - civsOf(b).length);
      const covered = new Set();
      for (const civ of need) {
        if (covered.has(civ)) continue;
        const m = sorted.find((x) => !chosen.includes(x) && civsOf(x).includes(civ));
        if (!m) return null;
        chosen.push(m);
        civsOf(m).forEach((c) => covered.add(c));
      }
      if (chosen.length > cost) return null;
      // 残りは、他で使いにくそうな（必要文明と関係ない・単色）マナから
      const rest = sorted.filter((x) => !chosen.includes(x));
      rest.sort((a, b) => {
        const ua = civsOf(a).some((c) => need.includes(c)) ? 1 : 0;
        const ub = civsOf(b).some((c) => need.includes(c)) ? 1 : 0;
        return ua - ub || civsOf(a).length - civsOf(b).length;
      });
      while (chosen.length < cost) chosen.push(rest.shift());
      return chosen;
    }

    // ロック（一音の妖精など）で使えないか
    locked(pi, def) {
      if (parsed(def).kw.summonAfterSpell && !((this.spellsThisTurn || [0, 0])[pi] > 0)) return true;
      const sl = this.p[pi].summonLock;
      if (sl && sl.until >= this.turn && !NON_CREATURE.includes(def.type) && (+def.cost || 0) <= sl.maxCost) return true;
      for (const lk of this.p[pi].locks || []) {
        if (lk.until < this.turn) continue;
        if (lk.spell !== (def.type === 'spell')) continue;
        if (lk.maxCost == null || (+def.cost || 0) <= lk.maxCost) return true;
      }
      for (const src of this.permanents(1 - pi)) {
        const l2 = this.kw(src).spellLock2;
        if (!l2 || def.type !== 'spell') continue;
        if (l2.myTurnOnly && this.active !== src.owner) continue;
        if (l2.notCiv && (def.civs || []).includes(l2.notCiv)) continue;
        if (l2.maxCost != null && (+def.cost || 0) > l2.maxCost) continue;
        return true;
      }
      for (const q of [0, 1]) for (const src of this.permanents(q)) {
        const kq = this.kw(src);
        const gb = kq.globalBan;
        if (gb && (gb.oppShieldsLE == null || this.p[1 - q].shields.length <= gb.oppShieldsLE)) {
          const isSp = def.type === 'spell';
          if ((isSp || (gb.creature && !NON_CREATURE.includes(def.type))) && !(def.civs || []).includes(gb.exceptCiv)) return true;
        }
        for (const tl of kq.turnLimit || []) {
          if (tl.side === 'opp' && q === pi) continue;
          if (tl.oppTurnOnly && this.active !== pi) continue;
          const isSp = def.type === 'spell';
          if (tl.spell !== isSp || (!isSp && NON_CREATURE.includes(def.type))) continue;
          const used = (tl.spell ? this.spellsThisTurn : this.creaturesThisTurn) || [0, 0];
          if ((used[pi] || 0) >= tl.n) return true;
        }
      }
      for (const src of this.permanents(1 - pi)) {
        const sc = this.sc(src);
        if (sc && sc.lock && sc.lock(this, src, pi, def)) return true;
        const k = this.kw(src);
        if (def.type === 'spell' && k.spellLockMax != null && (+def.cost || 0) <= k.spellLockMax) return true;
      }
      return false;
    }

    // 進化の種類（'evo' 必ず重ねる / 'neo' 重ねてもよい）
    evoKind(def) {
      return parsed(def).kw.evolution || def.evolution || '';
    }
    evoBases(pi, def) {
      const civs = def ? parsed(def).kw.evoCivs || [] : [];
      return this.p[pi].battle.filter((c) => (this.isCreature(c) || this.kw(c).sinkarize) && (!civs.length || (c.def.civs || []).some((x) => civs.includes(x))));
    }
    canPlay(pi, card) {
      if (this.evoKind(card.def) === 'evo' && !this.evoBases(pi, card.def).length) return false;
      return this.active === pi && card.owner === pi && this.zoneOf(card) === 'hand' && !this.locked(pi, card.def) && !!this.payment(pi, card);
    }

    async pay(pi, card, def) {
      const plans = this.paymentPlans(pi, card, def);
      let plan = plans[0];
      const withSas = plans.filter((x) => x.sas || x.bad || x.tapAlt);
      if (withSas.length && !this.p[pi].isAI) {
        const opts = plans.map((x, i) => ({
          id: String(i),
          label: x.sas
            ? `ササゲール：「${x.sas.def.name}」を破壊してコスト${x.cost}で出す`
            : x.bad
              ? `B・A・D：コスト${x.cost}で出す（ターンの終わりに破壊）`
              : x.tapAlt
                ? `自分のクリーチャーを${x.tapAlt}体タップして唱える`
              : `通常どおり（コスト${x.cost}）`,
        }));
        const r = await this.choose(pi, { kind: 'mode', prompt: `「${def.name}」: どう払いますか？`, options: opts, min: 1, max: 1 });
        plan = plans[+r[0]] || plans[0];
      }
      for (const m of plan.mana) m.tapped = true;
      for (const u of plan.uses) await u();
    }

    async play(pi, uid) {
      const f = this.find(uid);
      if (!f || !this.canPlay(pi, f.card)) return false;
      const card = f.card;
      // 進化元を選ぶ
      let evolveFrom = null;
      const ek = this.evoKind(card.def);
      if (ek) {
        const bases = this.evoBases(pi, card.def);
        const r = await this.pickCards(pi, bases, 1, ek === 'neo', `「${card.def.name}」の進化元を選んでください${ek === 'neo' ? '（選ばなければ普通に出す）' : ''}`, 'recover');
        evolveFrom = r[0] || null;
        if (ek === 'evo' && !evolveFrom) return false;
      }
      this.pendingEvoBase = evolveFrom;
      if (!this.payment(pi, card)) {
        this.pendingEvoBase = null;
        return false;
      }
      await this.pay(pi, card, card.def);
      this.pendingEvoBase = null;
      await this.putIntoPlay(pi, card, false, card.def, { evolveFrom });
      return true;
    }

    // 墓地から使えるか（ア・ストラ・ゼーレ、アビス記号など）
    graveUse(pi, card) {
      if (this.active !== pi || card.owner !== pi || this.zoneOf(card) !== 'grave') return null;
      if (parsed(card.def).kw.graveSummon) return card;
      for (const src of this.permanents(pi)) {
        const sc = this.sc(src);
        if (sc && sc.graveUse && sc.graveUse(this, src, pi, card)) return src;
      }
      return null;
    }
    canPlayFromGrave(pi, card) {
      return !!this.graveUse(pi, card) && !this.locked(pi, card.def) && !!this.payment(pi, card);
    }
    async playFromGrave(pi, uid) {
      const f = this.find(uid);
      if (!f || !this.canPlayFromGrave(pi, f.card)) return false;
      const src = this.graveUse(pi, f.card);
      await this.pay(pi, f.card, f.card.def);
      if (src !== f.card) src.usedTurn = this.turn;
      this.log(src === f.card ? `${this.p[pi].name}は「${src.def.name}」を墓地から召喚する` : `${this.p[pi].name}は「${src.def.name}」の効果で墓地から使う`);
      await this.putIntoPlay(pi, f.card, false);
      if (this.sc(src)?.graveCastTo === 'deckBottom' && this.zoneOf(f.card) === 'grave') {
        this.moveTo(f.card, 'deck', { top: false });
        this.log(`「${f.card.def.name}」は墓地のかわりに山札の下に置かれた`);
      }
      return true;
    }

    // ツインパクトの呪文側
    twin(card) {
      return twinDef(card.def);
    }
    canPlayTwin(pi, card) {
      const t = this.twin(card);
      return !!t && this.active === pi && card.owner === pi && this.zoneOf(card) === 'hand' && !this.locked(pi, t) && !!this.payment(pi, card, t);
    }
    async playTwin(pi, uid) {
      const f = this.find(uid);
      if (!f || !this.canPlayTwin(pi, f.card)) return false;
      const t = this.twin(f.card);
      await this.pay(pi, f.card, t);
      await this.putIntoPlay(pi, f.card, false, t);
      return true;
    }

    // 召喚 or 呪文の使用（free=S・トリガーなど）。def を渡すとツインパクトの呪文側として扱う
    async putIntoPlay(pi, card, free, def = card.def, po = {}) {
      const name = this.p[pi].name;
      const fr = free ? 'コストを払わずに' : '';
      if (def.type === 'spell') {
        this.log(`${name}は呪文「${def.name}」を${fr}唱えた`);
        this.spellsThisTurn[pi]++;
        // 解決中は墓地へ（DMでは唱えた後に墓地）
        this.moveTo(card, 'grave');
        this.noteManual(card, def);
        this.resolving = (this.resolving || 0) + 1;
        try {
          await this.trigger(card, 'cast', pi, def);
        } finally {
          this.resolving--;
        }
        await this.notifyAll('onAnyCast', card, def);
        await this.fireAll(pi, 'allyCast');
        await this.fireAll(1 - pi, 'oppCast');
        await this.resolvePending();
        if (parsed(def).kw.returnAfterCast && this.zoneOf(card) === 'grave') {
          this.moveTo(card, 'hand');
          this.log(`「${def.name}」は唱えた後、手札に戻った`);
        }
        if (parsed(def).kw.fortifyAfterCast && this.zoneOf(card) === 'grave' && this.p[pi].shields.length) {
          this.moveTo(card, 'shields');
          card.faceUp = true;
          this.log(`「${def.name}」はシールドの上に表向きで置かれた`);
        }
        if (parsed(def).kw.charger && this.zoneOf(card) === 'grave') {
          this.moveTo(card, 'mana', { tapped: true });
          this.log(`「${def.name}」はチャージャーでマナに置かれた`);
        }
      } else if (def.type === 'castle') {
        // 城：自分のシールド1つに付ける扱い。表向きのシールドとして置く
        this.moveTo(card, 'shields');
        card.faceUp = true;
        this.log(`${name}は城「${def.name}」を${fr}シールドに要塞化した`);
        this.noteManual(card);
        await this.trigger(card, 'summon', pi);
        await this.shieldAdded(pi);
      } else if (def !== card.def && def.type === 'field') {
        // WDフィールド：裏面で出す
        this.log(`${name}はフィールド「${def.name}」（「${card.def.name}」の裏面）を${fr}出した`);
        await this.enterBattle(card, pi, 'summon', { ...po, flipped: true });
      } else {
        const verb = this.isCreature(card) ? '召喚した' : '出した';
        this.log(`${name}は${this.isCreature(card) ? '' : TYPE_LABEL[def.type]}「${def.name}」を${fr}${verb}`);
        await this.enterBattle(card, pi, 'summon', po);
      }
      this.changed();
    }

    // バトルゾーンに出す（召喚・踏み倒し共通）。how: 'summon' | 'other'
    async enterBattle(card, pi, how = 'other', o = {}) {
      // 相手の置換効果（キャディ・ビートル、ハッスル・キャッスルなど）
      for (const src of this.permanents(1 - pi)) {
        const sc = this.sc(src);
        const gate = this.kw(src).manaGate && this.isCreature(card) && (+card.def.cost || 0) > this.p[pi].mana.length;
        if (gate || (sc && sc.replaceEnter && this.isCreature(card) && sc.replaceEnter(this, src, card, how))) {
          this.moveTo(card, 'mana', { tapped: true });
          this.log(`「${src.def.name}」の効果で「${card.def.name}」はかわりにマナゾーンに置かれた`);
          await this.pause();
          return false;
        }
      }
      // 「クリーチャーが出る時、かわりに墓地（マナ）に置く」
      if (this.isCreature(card)) {
        for (const q of [1 - pi, pi]) for (const src of this.permanents(q)) {
          for (const er of this.kw(src).enterReplace || []) {
            if (er.side === 'opp' && q === pi) continue;
            if (er.oppTurnOnly && this.active === q) continue;
            if (er.nonSummon && how === 'summon') continue;
            if (this.sc(src) && this.sc(src).replaceEnter) continue; // カード個別の処理がある時はそちらに任せる
            if (er.who) {
              const sw = er.who.match(/「(.+?)」で始まる能力を持つ/);
              const hit = sw ? (card.def.text || '').split('\n').some((l) => l.startsWith(sw[1])) : er.who.split(/または/).some((w) => this.fitLook(card, G.TextParse.lookCond(w)));
              if (hit === er.neg) continue;
            }
            if (er.to === 'deckBottom') this.moveTo(card, 'deck', { top: false });
            else this.moveTo(card, er.to);
            this.log(`「${src.def.name}」の効果で「${card.def.name}」はかわりに${{ grave: '墓地', mana: 'マナゾーン', deckBottom: '山札の下' }[er.to]}に置かれた`);
            return false;
          }
        }
      }
      const fromZone = this.zoneOf(card);
      if (fromZone && fromZone !== 'hand' && [0, 1].some((q) => this.permanents(q).some((s) => { const nh = this.kw(s).noNonHandPut; return nh === 'all' || (nh === 'opp' && q !== pi); }))) {
        this.log(`「${card.def.name}」は手札以外からは出せない`);
        return false;
      }
      if (fromZone && fromZone !== 'hand' && [0, 1].some((q) => this.permanents(q).some((s) => this.kw(s).noNonHandEntry))) {
        this.moveTo(card, 'hand');
        this.log(`「${card.def.name}」は手札以外から出ようとしたので、かわりに手札に戻った`);
        return false;
      }
      const base = o.evolveFrom;
      if (base && this.zoneOf(base) === 'battle') {
        // 進化：進化元をこのカードの下に重ねる（進化元の状態は引き継ぐ）
        const pl = this.p[base.owner];
        pl.battle.splice(pl.battle.indexOf(base), 1);
        this.moveTo(card, 'battle');
        card.under = [base, ...(base.under || [])];
        base.under = null;
        card.tapped = base.tapped;
        card.sick = false; // 進化クリーチャーは召喚酔いしない
        this.log(`「${card.def.name}」が「${base.def.name}」から進化した`);
        // シンカパワー：進化元の能力を、進化したクリーチャーに対して使う
        if (this.hasAbility(base, 'evolveSource')) await this.trigger(card, 'evolveSource', pi, base.def, null, { defer: true });
      } else {
        this.moveTo(card, 'battle');
      }
      if (!this.isCreature(card)) card.sick = false;
      if (o.flipped) card.flipped = true;
      this.lastEntered = card;
      this.lastEnteredSeq = (this._seq = (this._seq || 0) + 1);
      if (this.isCreature(card)) this.creaturesThisTurn[pi]++;
      if (how !== 'summon' && !base) this.log(`「${card.def.name}」がバトルゾーンに出た`);
      if (this.kw(card).justDiver) card.jdUntil = this.nextTurnOf(pi) - 1;
      // 自分のコマンドが出たら、同じ文明の自分の封印を1つ外す
      if (this.isCreature(card) && (card.def.races || []).some((r) => r.includes('コマンド'))) {
        const sealed = this.p[pi].battle.find((c) => c !== card && c.seals > 0 && (c.def.civs || []).some((x) => (card.def.civs || []).includes(x)));
        if (sealed) {
          this.log(`コマンド「${card.def.name}」が出たので封印を外す`);
          await this.removeSeal(sealed);
        }
      }
      // EXライフ：山札の上を、このクリーチャー専用のシールドにする
      if (this.kw(card).exLife && this.p[pi].deck.length) {
        const sh = this.p[pi].deck[0];
        this.moveTo(sh, 'shields');
        card.exLife = sh.uid;
        this.log(`「${card.def.name}」のEXライフ（シールド＋1）`);
      }
      this.noteManual(card);
      await this.pause();
      await this.trigger(card, 'summon', pi);
      if (how === 'summon' && this.zoneOf(card) === 'battle') await this.trigger(card, 'summonOnly', pi);
      if (how === 'summon' && this.zoneOf(card) === 'battle' && this.kw(card).yobinion) await this.queueFn(card, pi, `「${card.def.name}」のヨビニオン`, () => this.yobinion(card, pi));
      if (this.zoneOf(card) === 'battle') await this.notifyAll('onAnyEnter', card);
      if (this.zoneOf(card) === 'battle' && this.isCreature(card)) {
        for (const src of this.permanents(pi)) {
          if (src === card || !this.isOnField(src)) continue;
          for (const ab of this.abilities(src)) {
            if (ab.when !== 'allyEnter' || !ab.ally) continue;
            const al = ab.ally;
            if (al.race && !((card.def.races || []).join('/') + card.def.name).includes(al.race)) continue;
            if (al.perTurn) {
              src.allyUsed = src.allyUsed || {};
              const key = ab.text;
              if (src.allyUsed[key] === this.turn) continue;
              src.allyUsed[key] = this.turn;
            }
            await this.queueFn(src, pi, `「${src.def.name}」の能力`, async () => {
              for (const a of ab.acts) await this.doAction(a, src, pi);
            });
          }
        }
      }
      if (this.kw(card).exLife && card.exLife) await this.shieldAdded(pi);
      return true;
    }

    // ヨビニオン：このクリーチャーよりコストが小さいクリーチャーが出るまで表向きにして出す
    async yobinion(card, pi) {
      const me = this.p[pi];
      const cost = +card.def.cost || 0;
      const shown = [];
      let hit = null;
      while (me.deck.length) {
        const c = me.deck[0];
        me.deck.shift();
        shown.push(c);
        if (this.isCreature(c) && !this.evoKind(c.def) && (+c.def.cost || 0) < cost) {
          hit = c;
          break;
        }
      }
      this.log(`「${card.def.name}」のヨビニオン：${shown.map((c) => c.def.name).join('、') || 'なし'} を表向きにした`);
      for (const c of shown) if (c !== hit) {
        me.deck.push(c);
        c.tapped = false;
      }
      if (hit) {
        me.deck.push(hit); // いったん山札に戻してから出す（移動の処理をそろえるため）
        await this.enterBattle(hit, pi, 'other');
      } else this.log('ヨビニオン：出せるクリーチャーがなかった');
      this.changed();
    }

    // pi の場のカードで、when の能力を持つものをすべて待機させて解決
    async fireAll(pi, when) {
      for (const c of this.permanents(pi)) if (this.isOnField(c) && this.hasAbility(c, when)) await this.trigger(c, when, pi, c.def, null, { defer: true });
      await this.resolvePending();
    }

    // 「自分の○○が攻撃する時／離れた時」
    async allyEvent(card, pi, when) {
      for (const src of this.permanents(pi)) {
        if (!this.isOnField(src)) continue;
        for (const ab of this.abilities(src)) {
          if (ab.when !== when || !ab.ally) continue;
          if (ab.ally.others && src === card) continue;
          if (ab.ally.race && !((card.def.races || []).join('/') + card.def.name).includes(ab.ally.race)) continue;
          if (ab.ally.perTurn) {
            src.allyUsed = src.allyUsed || {};
            if (src.allyUsed[ab.text + when] === this.turn) continue;
            src.allyUsed[ab.text + when] = this.turn;
          }
          await this.queueFn(src, pi, `「${src.def.name}」の能力`, async () => {
            for (const a of ab.acts) await this.doAction(a, src, pi);
          }, { defer: true });
        }
      }
    }

    // 場のすべてのカードに「何かが出た／唱えられた」を知らせる
    async notifyAll(hook, card, def) {
      for (const pi of [this.active, 1 - this.active]) {
        for (const src of this.permanents(pi)) {
          if (src === card || !this.isOnField(src)) continue;
          const sc = this.sc(src);
          if (sc && sc[hook]) await this.queueFn(src, src.owner, `「${src.def.name}」の能力`, () => (this.isOnField(src) ? sc[hook](this, src, card, def) : null), { defer: true });
        }
      }
      await this.resolvePending();
    }

    // 離れられない状態か（封印・シールド・フォース・極限ファイナル革命など）
    cannotLeave(card) {
      if (card.seals > 0) return '封印';
      if ((card.noLeaveUntil || 0) >= this.turn) return '離れない';
      const pl = this.p[card.owner];
      if (this.isCreature(card) && (pl.noLeaveUntil || 0) >= this.turn) return '離れない';
      if (this.isCreature(card)) {
        for (const src of pl.battle) {
          if (src.forceShield && pl.shields.some((s) => s.uid === src.forceShield)) return 'シールド・フォース';
        }
      }
      return null;
    }

    // バトルゾーンから離す。離れなかったら false
    async leave(card, toZone, o = {}) {
      if (this.zoneOf(card) !== 'battle') return false;
      const sp = this.kw(card).stayIfPower;
      if (sp != null && this.power(card) > sp) {
        this.log(`「${card.def.name}」はパワーが${sp}より大きいので離れない`);
        return false;
      }
      if (o.byOpp !== false) {
        const why = this.cannotLeave(card);
        if (why) {
          this.log(`「${card.def.name}」は離れない（${why}）`);
          return false;
        }
      }
      if (card.exLife) {
        const sh = this.p[card.owner].shields.find((s) => s.uid === card.exLife);
        card.exLife = null;
        if (sh) {
          this.moveTo(sh, 'grave');
          this.log(`「${card.def.name}」はかわりにEXライフのシールドを墓地に置いた`);
          await this.trigger(card, 'exLifeLost', card.owner);
          return false;
        }
      }
      // エスケープ：かわりに自分のシールドを1つ手札へ
      const k = this.kw(card);
      if (k.escape && (o.destroy || o.byOpp !== false) && this.p[card.owner].shields.length) {
        if (await this.yesNo(card.owner, `「${card.def.name}」のエスケープ：かわりにシールドを1つ手札に戻しますか？`, card)) {
          const sh = this.p[card.owner].shields[this.p[card.owner].shields.length - 1];
          this.moveTo(sh, 'hand');
          this.log(`「${card.def.name}」はエスケープした（シールドを1つ手札へ）`);
          return false;
        }
      }
      for (const src of this.permanents(card.owner)) {
        const sc = this.sc(src);
        if (sc && sc.replaceLeave && this.isCreature(card) && (await sc.replaceLeave(this, src, card))) return false;
      }
      const ls = this.kw(card).leaveSub;
      if (ls && !this._inLeaveSub && (!ls.destroyOnly || o.destroy)) {
        if (ls.who && !ls._cond) ls._cond = G.TextParse && G.TextParse.lookCond ? G.TextParse.lookCond(ls.who) : {};
        const pool = this.p[card.owner].battle.filter((c) => c !== card && (ls.who ? this.fitLook(c, ls._cond) : ls.name ? c.def.name.includes(ls.name) : this.isCreature(c)));
        if (pool.length) {
          const r = await this.pickCards(card.owner, pool, 1, ls.optional, `「${card.def.name}」が離れるかわりに破壊するカード${ls.optional ? '（任意）' : ''}`, 'discard');
          if (r[0]) {
            this._inLeaveSub = true;
            try {
              await this.destroyMany([r[0]], { byOpp: false });
            } finally {
              this._inLeaveSub = false;
            }
            this.log(`「${card.def.name}」は離れず、かわりに「${r[0].def.name}」を破壊した`);
            return false;
          }
        }
      }
      const ld = this.kw(card).leaveSubDiscard;
      if (ld && (!ld.destroyOnly || o.destroy)) {
        if (!ld._cond) ld._cond = G.TextParse && G.TextParse.lookCond ? G.TextParse.lookCond(ld.who || '') : {};
        const pool = this.p[card.owner].hand.filter((c) => !ld.who || this.fitLook(c, ld._cond));
        if (pool.length) {
          const r = await this.pickCards(card.owner, pool, 1, true, `「${card.def.name}」が離れるかわりに捨てる手札（任意）`, 'discard');
          if (r[0]) {
            this.moveTo(r[0], 'grave');
            this.log(`「${card.def.name}」は離れず、かわりに手札の「${r[0].def.name}」を捨てた`);
            return false;
          }
        }
      }
      if (this.kw(card).leaveSubShield && this.p[card.owner].shields.length) {
        const r = await this.pickCards(card.owner, this.p[card.owner].shields.slice(), 1, true, `「${card.def.name}」が離れるかわりに墓地に置くシールド（任意）`, 'discard');
        if (r[0]) {
          this.moveTo(r[0], 'grave');
          this.log(`「${card.def.name}」は離れず、かわりにシールドを1つ墓地に置いた`);
          await this.shieldsLeft(card.owner);
          return false;
        }
      }
      let faceUp = false;
      if (o.destroy) {
        const own = this.sc(card);
        if (own && own.wouldDestroy) {
          const z = own.wouldDestroy(this, card);
          if (z) toZone = z;
        }
        if (k.shieldGo) {
          toZone = 'shields';
          faceUp = true;
        }
        if (k.destroyToMana) toZone = 'mana';
        if (k.destroyTo) {
          if (k.destroyTo === 'shields') toZone = 'shields';
          else if (k.destroyTo === 'deckTop') ((toZone = 'deck'), (o.moveOpt = { top: true }));
          else if (k.destroyTo === 'deckBottom') ((toZone = 'deck'), (o.moveOpt = { top: false }));
          else if (k.destroyTo === 'deckShuffle') ((toZone = 'deck'), (o.shuffleAfter = true));
          else toZone = k.destroyTo;
        }
        if (k.destroyToManaIf && this.p[card.owner].battle.some((c) => c !== card && this.isCreature(c) && (c.def.civs || []).includes(k.destroyToManaIf))) toZone = 'mana';
        for (const src of this.permanents(card.owner)) {
          const sc = this.sc(src);
          if (sc && sc.protectDestroy && (await sc.protectDestroy(this, src, card))) return false;
        }
      }
      // 進化元も一緒に移す（シールドへ行く場合、進化元は墓地へ）
      const under = card.under || [];
      card.under = null;
      this.moveTo(card, toZone, o.moveOpt);
      card.lastUnder = under.slice();
      if (faceUp) {
        card.faceUp = true;
        this.log(`「${card.def.name}」はシールド・ゴーで表向きのシールドになった`);
      }
      for (const u of under) this.moveTo(u, toZone === 'shields' ? 'grave' : toZone, o.moveOpt);
      if (o.shuffleAfter) shuffle(this.p[card.owner].deck, this.rng);
      if (this.hasAbility(card, 'left')) await this.trigger(card, 'left', card.owner, card.def, null, { defer: !!o.destroy });
      if (this.isCreature(card)) await this.allyEvent(card, card.owner, 'allyLeft');
      return true;
    }

    noteManual(card, def = card.def) {
      if (this.isIgnored(def.name)) return this.log(`「${def.name}」の能力は無視されている`);
      if (this.script(def)) return; // 専用スクリプトで処理
      const m = this.manual(card, def);
      if (m.length) this.log(`【手動】「${def.name}」: ${m.join(' / ')}`);
      else if (!def.text) this.log(`【手動】「${def.name}」: 効果テキスト未登録（必要なら手動で処理）`);
    }

    // 自分のシールドゾーンにカードが置かれた時の誘発
    async shieldAdded(pi) {
      this.p[pi].shieldAddedTurn = this.turn;
      for (const h of [...this.p[pi].hand]) {
        if (!parsed(h.def).kw.enterOnShieldAdd || this.zoneOf(h) !== 'hand') continue;
        if (await this.yesNo(pi, `シールドが増えたので「${h.def.name}」を手札から出しますか？`, h)) {
          await this.queueFn(h, pi, `「${h.def.name}」を出す`, () => this.enterBattle(h, pi, 'other'), { defer: true });
        }
      }
      for (const c of this.permanents(pi)) if (this.isOnField(c)) await this.trigger(c, 'shieldAdded', pi, c.def, null, { defer: true });
      await this.resolvePending();
    }
    // 自分のシールドが離れた時（獄鬼夜城など）
    async shieldsLeft(pi) {
      for (const c of this.permanents(pi)) {
        if (!this.isOnField(c)) continue;
        for (const ab of this.abilities(c)) {
          if (ab.when !== 'ownShieldLeft') continue;
          if (/各ターンに1度/.test(ab.text)) {
            if (c.shieldLeftTurn === this.turn) continue;
            c.shieldLeftTurn = this.turn;
          }
          await this.queueFn(c, pi, `「${c.def.name}」の能力`, async () => {
            for (const a of ab.acts) await this.doAction(a, c, pi);
          }, { defer: true });
        }
      }
      for (const c of this.permanents(pi)) {
        const sc = this.sc(c);
        if (sc && sc.onShieldsLeft && this.isOnField(c)) await sc.onShieldsLeft(this, c);
      }
    }
    isOnField(c) {
      const z = this.zoneOf(c);
      return z === 'battle' || (z === 'shields' && c.faceUp);
    }

    // 誘発した能力は「待機」させ、まとめて解決する（ターンプレイヤーの能力から、選んだ順に）。
    // 呪文の効果（cast）だけはその場で解決する。
    async trigger(card, when, controller = card.owner, def = card.def, extra, o = {}) {
      if (when === 'cast') return this.runAbility(card, when, controller, def, extra);
      if (!this.hasAbility(card, when, def)) return;
      this.pending = this.pending || [];
      this.pending.push({ card, when, controller, def, extra, label: `「${def.name}」の${WHEN_J[when] || when}` });
      if (!o.defer) await this.resolvePending();
    }
    // 任意の処理を待機させる（場のカードの「〜した時」能力など）
    async queueFn(src, controller, label, fn, o = {}) {
      this.pending = this.pending || [];
      this.pending.push({ card: src, controller, fn, label });
      if (!o.defer) await this.resolvePending();
    }
    hasAbility(card, when, def = card.def) {
      const sc = this.script(def);
      if (sc && sc[when]) return true;
      return this.abilities(card, def).some((ab) => ab.when === when);
    }
    // 待機中の能力を解決する。何かを解決している最中なら、終わってからまとめて解決
    async resolvePending() {
      if (this.resolving > 0 || this.inPending) return;
      this.inPending = true;
      try {
        while (this.pending && this.pending.length) {
          const ap = this.active;
          let mine = this.pending.filter((x) => x.controller === ap);
          if (!mine.length) mine = this.pending.filter((x) => x.controller !== ap);
          let item = mine[0];
          if (mine.length > 1) {
            const opts = mine.map((x, i) => ({ id: String(i), label: x.label }));
            const r = await this.choose(item.controller, {
              kind: 'mode',
              prompt: `待機中の能力が${mine.length}つあります。先に解決するものを選んでください`,
              options: opts,
              min: 1,
              max: 1,
            });
            item = mine[+r[0]] || mine[0];
          }
          this.pending.splice(this.pending.indexOf(item), 1);
          this.resolving = (this.resolving || 0) + 1;
          try {
            if (item.fn) await item.fn();
            else await this.runAbility(item.card, item.when, item.controller, item.def, item.extra);
          } finally {
            this.resolving--;
          }
        }
      } finally {
        this.inPending = false;
      }
    }

    async runAbility(card, when, controller = card.owner, def = card.def, extra) {
      const sc = this.script(def);
      if (sc && sc[when]) {
        await sc[when](this, card, controller, extra);
        this.changed();
        return;
      }
      for (const ab of this.abilities(card, def)) {
        if (ab.when !== when) continue;
        if (ab.cond && ab.cond.n != null) {
          const have = this.p[controller].mana.filter((m) => !ab.cond.manaCiv || (m.def.civs || []).includes(ab.cond.manaCiv)).length;
          if (have < ab.cond.n) {
            this.log(`「${def.name}」: マナ武装の条件を満たしていない`);
            continue;
          }
        }
        if (ab.cond && ab.cond.oppTurn && this.active === controller) continue;
        if (ab.cond && ab.cond.enteredThisTurn && card.enteredTurn !== this.turn) continue;
        if (ab.cond && (ab.cond.firstPerTurn || ab.cond.oncePerTurn)) {
          card.abUsed = card.abUsed || {};
          const key = ab.text + when;
          if (card.abUsed[key] === this.turn) continue;
          card.abUsed[key] = this.turn;
        }
        if (ab.cond && !this.condOk(controller, ab.cond)) {
          this.log(`「${def.name}」: 条件を満たしていない`);
          continue;
        }
        if (ab.cond && ab.cond.count && this.countOwn(controller, ab.cond.count.what) < ab.cond.count.n) {
          this.log(`「${def.name}」: 「${ab.cond.count.what}が${ab.cond.count.n}以上」の条件を満たしていない`);
          continue;
        }
        if (ab.modal) {
          await this.runModal(ab.modal, card, controller, def);
          continue;
        }
        for (const a of ab.acts) {
          await this.doAction(a, card, controller);
        }
      }
    }

    // テキストの「次の中から選ぶ」を処理する。先に全部選んでから順に実行
    async runModal(m, card, pi, def) {
      let max = m.count;
      if (m.bothCond && this.modalCondOk(pi, m.bothCond)) {
        max = m.options.length;
        this.log(`「${def.name}」: 条件を満たしているので全部選べる`);
      }
      const options = m.options.map((o, i) => ({ id: String(i), label: o.text.replace(/^[▶►]\s*/, '') }));
      const auto = m.options.map((o, i) => (o.acts ? String(i) : null)).filter((x) => x != null);
      const aiPick = [];
      for (let i = 0; aiPick.length < max && i < 10; i++) aiPick.push(auto[m.repeat ? 0 : i] ?? '0');
      const ids = await this.chooseModes(pi, `「${def.name}」: ${m.repeat ? max + '回' : max > 1 ? max + 'つまで' : '1つ'}選んでください`, options, {
        min: m.count === 'any' ? 0 : Math.min(1, max),
        max: m.count === 'any' ? options.length : max,
        repeat: m.repeat,
        aiPick: [...new Set(m.repeat ? aiPick : aiPick)].slice(0, max),
      });
      for (const id of ids) {
        const o = m.options[+id];
        if (!o) continue;
        if (o.acts) for (const a of o.acts) await this.doAction(a, card, pi);
        else this.log(`【手動】「${def.name}」: ${o.text}`);
        await this.pause(0.4);
      }
    }
    // 「自分の…に水と闇の両方があれば」などの条件
    modalCondOk(pi, cond) {
      const civs = cond.civs || [];
      const pool = this.p[pi].battle;
      return civs.every((c) => pool.some((x) => (x.def.civs || []).includes(c)));
    }

    targetsFor(a, pi) {
      let pool = [];
      if (a.side === 'opp' || a.side === 'any') pool.push(...this.opp(pi).battle);
      if (a.side === 'self' || a.side === 'any') pool.push(...this.p[pi].battle);
      if (!a.any) pool = pool.filter((c) => this.isCreature(c));
      if (a.civs && a.civs.length) pool = pool.filter((c) => (c.def.civs || []).some((x) => a.civs.includes(x)));
      if (a.maxPower != null) pool = pool.filter((c) => this.power(c) <= a.maxPower);
      if (a.maxCost != null) pool = pool.filter((c) => (+c.def.cost || 0) <= a.maxCost);
      if (a.act === 'tap') pool = pool.filter((c) => !c.tapped);
      if (a.tappedOnly) pool = pool.filter((c) => c.tapped);
      if (a.untappedOnly) pool = pool.filter((c) => !c.tapped);
      if (a.others && this._actSrc) pool = pool.filter((c) => c !== this._actSrc);
      if (a.races && a.races.length) pool = pool.filter((c) => c.owner !== pi || a.races.some((r) => ((c.def.races || []).join('/') + '/' + c.def.name).includes(r)));
      return pool;
    }

    async pickCards(pi, pool, n, optional, prompt, kind = 'target', act) {
      pool = pool.filter((c) => this.selectable(c, pi));
      const forced = pool.filter((c) => c.owner !== pi && this.zoneOf(c) === 'battle' && this.kw(c).forceChoose);
      // 「可能ならこのクリーチャーを選ぶ」：選べるなら、それを選ばなければならない
      if (forced.length && kind === 'target') pool = forced.length >= n ? forced : forced.concat(pool.filter((c) => !forced.includes(c)));
      if (!pool.length) return [];
      const max = Math.min(n, pool.length);
      const ids = await this.choose(pi, {
        kind,
        act,
        prompt,
        options: pool.map((c) => ({ id: c.uid, label: c.def.name, card: c })),
        min: optional ? 0 : max,
        max,
      });
      const chosen = ids.map((id) => pool.find((c) => c.uid === id)).filter(Boolean);
      if (chosen.length) {
        this.lastChosen = chosen;
        this.lastChosenSeq = (this._seq = (this._seq || 0) + 1);
      }
      for (const c of chosen) if (c.owner !== pi && this.zoneOf(c) === 'battle' && this.hasAbility(c, 'targeted')) await this.trigger(c, 'targeted', c.owner, c.def, null, { defer: true });
      return chosen;
    }

    async doAction(a, src, pi) {
      this.currentSource = src && src.def;
      this._actSrc = src;
      const me = this.p[pi];
      const op = this.opp(pi);
      const nm = `「${src.def.name}」`;
      switch (a.act) {
        case 'draw': {
          let n = a.n;
          if (a.optional) {
            if (n === 1) {
              if (!(await this.yesNo(pi, `${nm}: カードを1枚引きますか？`, src))) return;
            } else {
              const opts = [];
              for (let i = 0; i <= n; i++) opts.push({ id: String(i), label: `${i}枚` });
              const r = await this.choose(pi, { kind: 'number', prompt: `${nm}: 何枚引きますか？`, options: opts, min: 1, max: 1 });
              n = +r[0];
            }
          }
          this.draw(pi, n);
          if (n) this.log(`${me.name}はカードを${n}枚引いた`);
          break;
        }
        case 'manaBoost': {
          if (a.optional && !(await this.yesNo(pi, `${nm}: 山札の上から${a.n}枚をマナに置きますか？`, src))) return;
          for (let i = 0; i < a.n && me.deck.length; i++) {
            const c = me.deck[0];
            this.moveTo(c, 'mana', { tapped: a.tapped || (c.def.civs || []).length > 1 });
            this._lastMoved = c;
            this.log(`${me.name}は山札の上の「${c.def.name}」をマナに置いた`);
          }
          break;
        }
        case 'shieldAdd': {
          if (a.optional && !(await this.yesNo(pi, `${nm}: 山札の上から${a.n}枚をシールド化しますか？`, src))) return;
          const added = await this.addShieldFromDeck(pi, a.n);
          if (added) {
            this.log(`${me.name}はシールドを${added}つ追加した`);
            await this.shieldAdded(pi);
          }
          break;
        }
        case 'deckBottom':
        case 'toMana': {
          const pool = this.targetsFor(a, pi);
          const picked = a.all ? pool : await this.pickCards(pi, pool, a.n, a.optional, `${nm}: ${a.act === 'toMana' ? 'マナゾーンに置く' : '山札の下に置く'}クリーチャーを選んでください`, 'target', 'bounce');
          if (!pool.length) this.log(`${nm}の対象がいなかった`);
          for (const c of picked) {
            const z = a.act === 'toMana' ? 'mana' : 'deck';
            if (await this.leave(c, z, { byOpp: c.owner !== pi, moveOpt: z === 'deck' ? { top: false } : {} })) this.log(`「${c.def.name}」は${a.act === 'toMana' ? 'マナゾーン' : '山札の下'}に置かれた`);
          }
          break;
        }
        case 'shieldBurn': {
          const r = await this.pickCards(pi, op.shields.slice(), a.n, false, `${nm}: 墓地に置く相手のシールド`, 'shield');
          for (const c of r) this.moveTo(c, 'grave');
          if (r.length) {
            this.log(`${op.name}のシールド${r.length}つが墓地に置かれた`);
            await this.shieldsLeft(op.idx);
          }
          break;
        }
        case 'powerDown': {
          const pool = this.targetsFor({ side: 'opp' }, pi);
          const r = await this.pickCards(pi, pool, a.n, false, `${nm}: パワーを下げるクリーチャー`, 'target', 'destroy');
          for (const c of r) {
            const amt = a.amount === 'all' ? this.power(c) : a.amount === 'grave' ? me.grave.length * (a.per || 1000) : a.amount;
            c.tempPower -= amt;
            this.log(`「${c.def.name}」のパワーが${a.amount === 'all' ? '0になった' : '-' + amt + 'された'}`);
            if (this.power(c) <= 0) await this.destroyMany([c]);
          }
          break;
        }
        case 'destroy':
        case 'bounce':
        case 'tap': {
          const pool = this.targetsFor(a, pi);
          const verb = { destroy: '破壊', bounce: '手札に戻す', tap: 'タップ' }[a.act];
          let picked;
          if (a.all) picked = pool;
          else picked = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: ${verb}するクリーチャーを選んでください`, 'target', a.act);
          if (!picked.length) {
            if (!pool.length) this.log(`${nm}の対象がいなかった`);
            return;
          }
          if (a.act === 'destroy') await this.destroyMany(picked, { byOpp: picked.some((c) => c.owner !== pi) });
          else if (a.act === 'bounce') {
            for (const c of picked) {
              if (await this.leave(c, 'hand', { byOpp: c.owner !== pi })) this.log(`「${c.def.name}」は持ち主の手札に戻った`);
            }
          } else {
            for (const c of picked) {
              c.tapped = true;
              this.log(`「${c.def.name}」はタップされた`);
            }
          }
          this.lastPicked = picked;
          break;
        }
        case 'discard': {
          for (let i = 0; i < a.n && op.hand.length; i++) {
            let c;
            if (a.random) c = op.hand[Math.floor(this.rng() * op.hand.length)];
            else if (a.byMe) {
              // 相手の手札を見て自分が選ぶ
              const r = await this.pickCards(pi, op.hand.slice(), 1, !!a.optional, `${nm}: 相手の手札から捨てさせるカード`, 'target');
              c = r[0];
              if (!c) break;
            } else {
              const r = await this.pickCards(op.idx, op.hand, 1, false, `${nm}: 捨てる手札を選んでください`, 'discard');
              c = r[0];
            }
            await this.discardCard(c, pi);
          }
          break;
        }
        case 'graveToHand':
        case 'manaToHand': {
          const zone = a.act === 'graveToHand' ? 'grave' : 'mana';
          let pool = [...me[zone], ...(a.alsoGrave && zone === 'mana' ? me.grave : [])];
          if (a.civ) pool = pool.filter((c) => (c.def.civs || []).includes(a.civ));
          if (a.creatureOnly) pool = pool.filter((c) => !NON_CREATURE.includes(c.def.type));
          if (a.spellOnly) pool = pool.filter((c) => c.def.type === 'spell');
          if (a.maxCost != null) pool = pool.filter((c) => (+c.def.cost || 0) <= a.maxCost);
          if (a.minCost != null) pool = pool.filter((c) => (+c.def.cost || 0) >= a.minCost);
          const picked = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: 手札に戻すカードを選んでください`, 'recover');
          for (const c of picked) {
            this.moveTo(c, 'hand');
            this.log(`${me.name}は「${c.def.name}」を${ZONE_LABEL[zone]}から手札に戻した`);
          }
          break;
        }
        case 'selfDiscard': {
          const picked = await this.pickCards(pi, me.hand.slice(), a.n, false, `${nm}: 捨てる手札を${a.n}枚選んでください`, 'discard');
          for (const c of picked) {
            this.moveTo(c, 'grave');
            this.log(`${me.name}は手札の「${c.def.name}」を捨てた`);
          }
          break;
        }
        case 'lookTop': {
          const look = me.deck.slice(0, a.n);
          if (!look.length) break;
          for (const c of look) me.deck.splice(me.deck.indexOf(c), 1); // 見ている間は山札から外す
          this.log(`${me.name}は山札の上から${look.length}枚を${a.reveal ? '表向きにした：' + look.map((c) => c.def.name).join('、') : '見た'}`);
          const cd = a.cond || {};
          const fit = (c) => this.fitLook(c, cd);
          const ok = look.filter(fit);
          let chosen;
          const maxTake = a.take === 'any' ? ok.length : a.take === 'each' ? a.each * (cd.races ? cd.races.length : 1) : a.take;
          if (a.take === 'all') chosen = ok;
          else if (a.take === 'any' || a.take === 'each') {
            me.deck.unshift(...look);
            chosen = await this.pickCards(pi, ok, maxTake, true, `${nm}: ${cd.text || 'カード'}を選んでください（${a.take === 'any' ? '好きな数' : '種類ごとに' + a.each + '枚まで'}）`, 'recover');
            if (a.take === 'each' && cd.races) {
              // 種類ごとの上限を守る
              const cnt = {};
              chosen = chosen.filter((c) => {
                const r = cd.races.find((x) => ((c.def.races || []).join('/') + '/' + c.def.name).includes(x));
                cnt[r] = (cnt[r] || 0) + 1;
                return cnt[r] <= a.each;
              });
            }
            for (const c of look) if (me.deck.includes(c)) me.deck.splice(me.deck.indexOf(c), 1);
          }
          else {
            // 一時的に山札に戻して選ぶ（選択画面にカードを出すため）
            me.deck.unshift(...look);
            chosen = await this.pickCards(pi, ok, a.take, a.upTo || !ok.length, `${nm}: ${cd.text || 'カード'}を選んでください（${look.map((c) => c.def.name).join('、')}）`, 'recover');
            for (const c of look) if (me.deck.includes(c)) me.deck.splice(me.deck.indexOf(c), 1);
          }
          const zoneJ = { hand: '手札', battle: 'バトルゾーン', mana: 'マナゾーン', grave: '墓地', shields: 'シールド' };
          for (const c of chosen) {
            me.deck.unshift(c);
            if (a.dest === 'battle') await this.enterBattle(c, pi, 'other');
            else {
              this.moveTo(c, a.dest, { tapped: a.dest === 'mana' && (c.def.civs || []).length > 1 });
              this.log(`「${c.def.name}」を${zoneJ[a.dest]}に置いた`);
            }
          }
          if (a.dest === 'shields' && chosen.length) await this.shieldAdded(pi);
          const rest = look.filter((c) => !chosen.includes(c));
          for (const c of rest) {
            me.deck.unshift(c);
            if (a.rest === 'deckBottom') this.moveTo(c, 'deck', { top: false });
            else if (a.rest === 'deckTop') this.moveTo(c, 'deck', { top: true });
            else this.moveTo(c, a.rest, { tapped: a.rest === 'mana' && (a.restTapped || (c.def.civs || []).length > 1) });
          }
          if (a.rest === 'shields' && rest.length) await this.shieldAdded(pi);
          if (rest.length) this.log(`残り${rest.length}枚を${{ deckBottom: '山札の下', grave: '墓地', mana: 'マナゾーン', hand: '手札', deckTop: '山札の上', shields: 'シールド' }[a.rest]}に置いた`);
          break;
        }
        case 'mekuraid': {
          // 山札の上から3枚を見て、コストN以下を1枚コストを払わずに使ってよい。残りは山札の下へ
          const look = me.deck.slice(0, a.look || 3);
          if (!look.length) break;
          this.log(`${me.name}のメクレイド${a.n}：山札の上から${look.length}枚を見た`);
          const ok = look.filter((c) => (+c.def.cost || 0) <= a.n && (!a.race || ((c.def.races || []).join('/') + c.def.name).includes(a.race)) && (c.def.type !== 'spell' || !this.locked(pi, c.def)));
          const r = await this.pickCards(pi, ok, 1, true, `メクレイド${a.n}: コストを払わずに使うカード（${look.map((c) => c.def.name).join('、')}）`, 'recover');
          const used = r[0];
          // 残りは山札の下へ
          for (const c of look) if (c !== used) this.moveTo(c, 'deck', { top: false });
          if (used) {
            this.log(`メクレイドで「${used.def.name}」を使う`);
            await this.putIntoPlay(pi, used, true);
          } else this.log('メクレイド：何も使わなかった');
          break;
        }
        case 'manualNote':
          this.log(`【手動】${nm}: ${a.text}`);
          break;
        case 'untapAll': {
          const r = me.battle.filter(
            (c) => this.isCreature(c) && c.tapped && (!a.others || c !== src) && (!a.nameHas || c.def.name.includes(a.nameHas)) && (!a.evoOnly || this.evoKind(c.def)) && (!a.race || ((c.def.races || []).join('/') + c.def.name).includes(a.race))
          );
          for (const c of r) c.tapped = false;
          this.log(`${me.name}はクリーチャーを${r.length}体アンタップした`);
          break;
        }
        case 'manaToGrave': {
          const r = await this.pickCards(pi, me.mana.slice(), a.n, a.optional, `${nm}: マナゾーンから墓地に置くカード`, 'discard');
          for (const c of r) {
            this.moveTo(c, 'grave');
            this.log(`${me.name}はマナゾーンの「${c.def.name}」を墓地に置いた`);
          }
          break;
        }
        case 'lastIf':
          if (this._lastMoved && this.fitLook(this._lastMoved, a.cond)) for (const x of a.acts) await this.doAction(x, src, pi);
          break;
        case 'ifCond':
          if (!this.condOk2(pi, a.cond, src)) {
            this.log(`${nm}: 条件（${a.text}）を満たしていない`);
            break;
          }
          for (const x of a.acts) await this.doAction(x, src, pi);
          break;
        case 'freezeAll':
          for (const c of op.battle) {
            if (!this.isCreature(c) || (a.tappedOnly && !c.tapped)) continue;
            c.frozenUntil = this.nextTurnOf(c.owner);
          }
          this.log(`${op.name}の${a.tappedOnly ? 'タップしている' : ''}クリーチャーは次のターンのはじめにアンタップしない`);
          break;
        case 'grantLast':
        case 'guardLast':
        case 'untapLast':
        case 'endTurnLast': {
          // 直前に出したカード、なければ直前に選んだカード
          const useEntered = this.lastEntered && this.lastEntered !== src && (this.lastEnteredSeq || 0) > (this.lastChosenSeq || 0);
          const tg = (useEntered ? [this.lastEntered] : this.lastChosen || []).filter((c) => this.zoneOf(c) === 'battle');
          if (!tg.length) break;
          const until = a.until === 'perm' ? 1e9 : a.until === 'next' ? this.nextTurnOf(pi) - 1 : this.turn;
          for (const c of tg) {
            if (a.act === 'grantLast') {
              const pl = this.p[c.owner];
              pl.tempGrants = pl.tempGrants || [];
              pl.tempGrants.push({ names: a.names, until, uids: [c.uid], power: 0 });
              this.log(`「${c.def.name}」に${a.names.map((x) => '「' + x + '」').join('と')}を与えた`);
            } else if (a.act === 'guardLast') {
              if (a.kind === 'noLeave') c.noLeaveUntil = until;
              else c.noDestroyUntil = until;
              this.log(`「${c.def.name}」は${a.until === 'next' ? '次のターンのはじめまで' : 'このターン'}${a.kind === 'noLeave' ? '離れない' : '破壊されない'}`);
            } else if (a.act === 'untapLast') {
              c.tapped = false;
              this.log(`「${c.def.name}」をアンタップした`);
            } else {
              this.p[pi].endTurnActs = this.p[pi].endTurnActs || [];
              this.p[pi].endTurnActs.push({ uid: c.uid, to: a.to, turn: this.turn });
              this.log(`ターンの終わりに「${c.def.name}」を${{ destroy: '破壊する', hand: '手札に戻す', deckBottom: '山札の下に置く', mana: 'マナゾーンに置く' }[a.to]}`);
            }
          }
          break;
        }
        case 'tapOwnCost': {
          if (!a._cond) a._cond = a.who ? G.TextParse.lookCond(a.who.replace(/または/g, 'か、')) : {};
          const pool = me.battle.filter((c) => !c.tapped && (!a.others || c !== src) && this.isCreature(c) && (!a.who || a.who.split(/または/).some((w) => this.fitLook(c, G.TextParse.lookCond(w)))));
          if (pool.length < a.n) {
            this.log(`${nm}: タップできる${a.who || 'クリーチャー'}が足りない`);
            break;
          }
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: タップする自分の${a.who || 'クリーチャー'}（${a.n}体）`, 'recover');
          if (r.length < a.n) break;
          for (const c of r) c.tapped = true;
          this.log(`${me.name}は${r.map((c) => '「' + c.def.name + '」').join('、')}をタップした`);
          break;
        }
        case 'topHandOrMana': {
          const c = me.deck[0];
          if (!c) break;
          let toHand;
          if (me.isAI) toHand = me.mana.length >= 6 || (+c.def.cost || 0) <= me.mana.length + 1;
          else {
            const [ch] = await this.choose(pi, { kind: 'mode', prompt: `${nm}: 山札の上は「${c.def.name}」。どうしますか？`, options: [{ id: 'hand', label: '手札に加える', card: c }, { id: 'mana', label: 'マナゾーンに置く', card: c }], min: 1, max: 1, aiPick: ['hand'] });
            toHand = ch !== 'mana';
          }
          if (toHand) this.moveTo(c, 'hand');
          else this.moveTo(c, 'mana', { tapped: a.tapped || (c.def.civs || []).length > 1 });
          this.log(`${me.name}は山札の上のカードを${toHand ? '手札に加えた' : 'マナゾーンに置いた（「' + c.def.name + '」）'}`);
          break;
        }
        case 'oppMill':
          for (let i = 0; i < a.n && op.deck.length; i++) {
            const c = op.deck[0];
            this.moveTo(c, 'grave');
            this.log(`${op.name}の山札の上の「${c.def.name}」を墓地に置いた`);
          }
          break;
        case 'selfToHand':
          if (src && this.zoneOf(src) === 'grave' && (!a.optional || (await this.yesNo(pi, `${nm}を墓地から手札に戻しますか？`, src)))) {
            this.moveTo(src, 'hand');
            this.log(`${nm}を墓地から手札に戻した`);
          }
          break;
        case 'graveToDeck':
          for (const c of me.grave.slice()) this.moveTo(c, 'deck', { top: false });
          shuffle(me.deck, this.rng);
          this.log(`${me.name}は墓地のカードをすべて山札に加えてシャッフルした`);
          break;
        case 'underToHand': {
          const und = (src && src.lastUnder) || [];
          for (const c of und) if (this.zoneOf(c) && this.zoneOf(c) !== 'hand') this.moveTo(c, 'hand');
          if (und.length) this.log(`${nm}の下にあったカード${und.length}枚を手札に加えた`);
          break;
        }
        case 'pairFight': {
          const mine = await this.pickCards(pi, me.battle.filter((c) => this.isCreature(c)), 1, a.optional, `${nm}: バトルさせる自分のクリーチャー`, 'recover');
          if (!mine.length) break;
          const theirs = await this.pickCards(pi, op.battle.filter((c) => this.isCreature(c)), 1, a.optional, `${nm}: バトルさせる相手のクリーチャー`, 'target', 'destroy');
          if (!theirs.length) break;
          await this.battle(mine[0], theirs[0]);
          break;
        }
        case 'selfDestroy':
          if (src && this.zoneOf(src) === 'battle') await this.destroyMany([src], { byOpp: false });
          break;
        case 'selfToGrave':
          if (src && this.zoneOf(src) && this.zoneOf(src) !== 'grave') {
            this.moveTo(src, 'grave');
            this.log(`${nm}を墓地に置いた`);
          }
          break;
        case 'shuffleDeck':
          shuffle(me.deck, this.rng);
          this.log(`${me.name}は山札をシャッフルした`);
          break;
        case 'searchDeck': {
          const pool = me.deck.filter((c) => this.fitLook(c, a.cond) && (a.dest !== 'battle' || this.isCreature(c)) && (a.dest !== 'cast' || (c.def.type === 'spell' && !this.locked(pi, c.def))));
          const r = await this.pickCards(pi, pool, a.n, a.upTo || !pool.length, `${nm}: 山札から${(a.cond && a.cond.text) || 'カード'}を選んでください`, 'recover');
          if (a.dest === 'cast') {
            shuffle(me.deck, this.rng);
            this.log(`${me.name}は山札をシャッフルした`);
            for (const c of r) await this.putIntoPlay(pi, c, true);
            break;
          }
          for (const c of r) {
            if (a.dest === 'battle') await this.enterBattle(c, pi, 'other');
            else {
              this.moveTo(c, a.dest === 'shields' ? 'shields' : a.dest);
              this.log(`${me.name}は山札から「${c.def.name}」を${ZONE_LABEL[a.dest] || a.dest}に置いた`);
            }
          }
          if (!r.length) this.log(`${nm}: 山札から何も選ばなかった`);
          shuffle(me.deck, this.rng);
          this.log(`${me.name}は山札をシャッフルした`);
          break;
        }
        case 'arrangeTop': {
          const look = me.deck.slice(0, a.n);
          if (!look.length) break;
          this.log(`${me.name}は山札の上から${look.length}枚を見た`);
          let bottom = [];
          if (a.where === 'bottom') bottom = look.slice();
          else if (a.where === 'both') {
            if (me.isAI) bottom = look.filter((c) => (+c.def.cost || 0) > me.mana.length + 2);
            else bottom = await this.pickCards(pi, look, look.length, true, `${nm}: 山札の下に置くカード（選ばなかったカードは上に戻す）`, 'discard');
          }
          let top = look.filter((c) => !bottom.includes(c));
          if (top.length > 1 && me.isAI) top.sort((x, y) => (+x.def.cost || 0) - (+y.def.cost || 0));
          else if (top.length > 1) {
            const ord = await this.pickCards(pi, top, top.length, false, `${nm}: 山札の上に置く順番に選んでください（最初が一番上）`, 'recover');
            if (ord.length === top.length) top = ord;
          }
          for (const c of look) me.deck.splice(me.deck.indexOf(c), 1);
          me.deck.unshift(...top);
          me.deck.push(...bottom);
          this.log(`${me.name}は${top.length}枚を山札の上、${bottom.length}枚を山札の下に置いた`);
          break;
        }
        case 'topCheck': {
          const c = me.deck[0];
          if (!c) break;
          if (a.optional0 && !(await this.yesNo(pi, `${nm}: 山札の上を${a.reveal ? '表向きに' : '見'}しますか？`, src))) break;
          if (a.reveal) this.log(`${me.name}は山札の上の「${c.def.name}」を表向きにした`);
          else this.log(`${me.name}は山札の上を見た`);
          let then = a.then;
          if (then === 'use') then = c.def.type === 'spell' ? 'cast' : 'battle';
          const ok = this.fitLook(c, a.cond) && (then !== 'battle' || this.isCreature(c)) && (then !== 'cast' || (c.def.type === 'spell' && !this.locked(pi, c.def)));
          if (ok && (!a.optional || (await this.yesNo(pi, `${nm}: 「${c.def.name}」を${{ hand: '手札に加え', battle: '出し', mana: 'マナゾーンに置き', grave: '墓地に置き', cast: '唱え', shields: 'シールド化し' }[then]}ますか？`, c)))) {
            if (then === 'battle') await this.enterBattle(c, pi, 'other');
            else if (then === 'cast') await this.putIntoPlay(pi, c, true);
            else {
              this.moveTo(c, then);
              this.log(`「${c.def.name}」を${ZONE_LABEL[then] || then}に置いた`);
              if (then === 'shields') await this.shieldAdded(pi);
            }
          } else if (a.else === 'deckBottom') {
            this.moveTo(c, 'deck', { top: false });
            this.log(`${a.reveal ? '「' + c.def.name + '」' : 'そのカード'}を山札の下に置いた`);
          } else if (a.else && a.else !== 'deckTop') {
            this.moveTo(c, a.else);
            this.log(`「${c.def.name}」を${ZONE_LABEL[a.else] || a.else}に置いた`);
          }
          break;
        }
        case 'ifDo': {
          if (a.optional && !(await this.yesNo(pi, `${nm}: ${a.text}`, src))) break;
          const before = this.stateSig();
          await this.doAction(a.first, src, pi);
          if (this.stateSig() === before) {
            this.log(`${nm}: できなかったので、その後の効果はない`);
            break;
          }
          for (const x of a.acts) await this.doAction(x, src, pi);
          break;
        }
        case 'mill':
          if (a.optional && !(await this.yesNo(pi, `${nm}: 山札の上から${a.n}枚を墓地に置きますか？`, src))) return;
          for (let i = 0; i < a.n && me.deck.length; i++) {
            const c = me.deck[0];
            this.moveTo(c, 'grave');
            this.log(`${me.name}は山札の上の「${c.def.name}」を墓地に置いた`);
          }
          break;
        case 'reanimate': {
          let pool = me.grave.filter((c) => (a.kinds.includes('creature') && this.isCreature(c)) || (a.kinds.includes('tamaseed') && c.def.type === 'tamaseed'));
          if (a.maxCost != null) pool = pool.filter((c) => (+c.def.cost || 0) <= a.maxCost);
          if (a.civ) pool = pool.filter((c) => (c.def.civs || []).includes(a.civ));
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: 墓地から出すカードを選んでください`, 'recover');
          if (!pool.length) this.log(`${nm}: 墓地に出せるカードがない`);
          for (const c of r) await this.enterBattle(c, pi, 'other');
          break;
        }
        case 'handToShield': {
          const r = await this.pickCards(pi, me.hand.slice(), a.n, a.optional, `${nm}: シールドにする手札`, 'recover');
          for (const c of r) this.moveTo(c, 'shields');
          if (r.length) {
            this.log(`${me.name}は手札を${r.length}枚シールドにした`);
            await this.shieldAdded(pi);
          }
          break;
        }
        case 'selfGuard':
          if (this.zoneOf(src) === 'battle') {
            if (a.kind === 'noLeave') src.noLeaveUntil = this.nextTurnOf(pi) - 1;
            else if (a.kind === 'noDestroy') src.noDestroyUntil = this.nextTurnOf(pi) - 1;
            else src.jdUntil = this.nextTurnOf(pi) - 1;
            this.log(`「${src.def.name}」は次の自分のターンのはじめまで${a.kind === 'noLeave' ? '離れない' : a.kind === 'noDestroy' ? '破壊されない' : '相手に選ばれない'}`);
          }
          break;
        case 'toShield': {
          const pool = op.battle.filter((c) => (a.any || this.isCreature(c)) && (a.maxCost == null || (+c.def.cost || 0) <= a.maxCost));
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: シールド化する相手の${a.any ? 'エレメント' : 'クリーチャー'}`, 'target', 'bounce');
          for (const c of r) {
            if (await this.leave(c, 'shields', { byOpp: true })) {
              this.log(`「${c.def.name}」は持ち主のシールドになった`);
              await this.shieldAdded(c.owner);
            }
          }
          break;
        }
        case 'ownShieldToGrave': {
          const r = await this.pickCards(pi, me.shields.slice(), a.n, false, `${nm}: 墓地に置く自分のシールド`, 'discard');
          for (const c of r) this.moveTo(c, 'grave');
          if (r.length) {
            this.log(`${me.name}はシールドを${r.length}つ墓地に置いた`);
            await this.shieldsLeft(pi);
          }
          break;
        }
        case 'shieldToDeckDraw': {
          if (me.shields.length < a.n) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: シールドを${a.n}枚山札の下に置いて、${a.draw}枚引きますか？`, src))) break;
          const r = await this.pickCards(pi, me.shields.slice(), a.n, false, '山札の下に置くシールド', 'discard');
          for (const c of r) this.moveTo(c, 'deck', { top: false });
          this.draw(pi, a.draw);
          this.log(`${me.name}はシールドを${r.length}枚山札の下に置き、${a.draw}枚引いた`);
          await this.shieldsLeft(pi);
          break;
        }
        case 'protectDestroy': {
          const r = await this.pickCards(pi, me.battle.filter((c) => this.isCreature(c)), a.n, false, `${nm}: 破壊されなくする自分のクリーチャー`, 'recover');
          for (const c of r) {
            c.noDestroyUntil = this.nextTurnOf(pi) - 1;
            this.log(`「${c.def.name}」は次の自分のターンのはじめまで破壊されない`);
          }
          break;
        }
        case 'teamTempPower':
          me.tempPowers = me.tempPowers || [];
          me.tempPowers.push({ n: a.n, until: this.nextTurnOf(pi) - 1, except: a.others ? src.uid : null });
          this.log(`次の自分のターンのはじめまで、${me.name}の${a.others ? '他の' : ''}クリーチャーのパワー+${a.n}`);
          break;
        case 'untapAtEnd':
          me.endUntaps = me.endUntaps || [];
          me.endUntaps.push({ n: a.n, turn: this.turn });
          this.log(`このターンの終わりに、${me.name}のクリーチャーを${a.n}体アンタップする`);
          break;
        case 'drawPer': {
          const cnt = Math.floor(this.countOwn(pi, a.what) / a.per) * a.n;
          if (!cnt) {
            this.log(`${nm}: 数えるものがないので引けない`);
            break;
          }
          if (a.optional && !(await this.yesNo(pi, `${nm}: カードを${cnt}枚引きますか？`, src))) break;
          this.draw(pi, cnt);
          this.log(`${me.name}はカードを${cnt}枚引いた`);
          break;
        }
        case 'revealTop': {
          const c = me.deck[0];
          if (!c) break;
          this.log(`${me.name}は山札の上の「${c.def.name}」を表向きにした`);
          const cd = a.cond || {};
          const hay = (c.def.races || []).join('/') + '/' + c.def.name;
          const ok =
            (!cd.types || cd.types.includes(this.isCreature(c) ? 'creature' : c.def.type)) &&
            (cd.maxCost == null || (+c.def.cost || 0) <= cd.maxCost) &&
            (!cd.race || hay.includes(cd.race)) &&
            (!cd.races || cd.races.some((r) => hay.includes(r))) &&
            (!cd.civs || !cd.civs.length || (c.def.civs || []).some((x) => cd.civs.includes(x)));
          if (ok && (!a.optional || (await this.yesNo(pi, `${nm}: 「${c.def.name}」を出しますか？`, c)))) {
            await this.enterBattle(c, pi, 'other');
          } else {
            if (a.rest === 'deckBottom') this.moveTo(c, 'deck', { top: false });
            else this.moveTo(c, a.rest || 'deck', { top: false });
            this.log(`「${c.def.name}」を${{ deckBottom: '山札の下', mana: 'マナゾーン', grave: '墓地', hand: '手札' }[a.rest] || '山札の下'}に置いた`);
          }
          break;
        }
        case 'lockCreature': {
          const r = await this.pickCards(pi, op.battle.filter((c) => this.isCreature(c)), a.n, false, `${nm}: 攻撃もブロックもできなくする相手のクリーチャー`, 'target', 'tap');
          for (const c of r) {
            c.lockedUntil = this.nextTurnOf(pi) - 1;
            this.log(`「${c.def.name}」は次の${me.name}のターンのはじめまで攻撃もブロックもできない`);
          }
          break;
        }
        case 'tempUnblockable': {
          const r = await this.pickCards(pi, me.battle.filter((c) => this.isCreature(c)), a.n, a.optional, `${nm}: このターンブロックされなくする自分のクリーチャー`, 'recover');
          for (const c of r) {
            c.unblockableTurn = this.turn;
            this.log(`「${c.def.name}」はこのターンブロックされない`);
          }
          break;
        }
        case 'oppLock':
          op.locks = op.locks || [];
          op.locks.push({ spell: a.spell, maxCost: a.maxCost, until: a.until === 'turn' ? this.turn : this.nextTurnOf(pi) - 1 });
          this.log(`${op.name}は${a.until === 'turn' ? 'このターン' : '次の' + me.name + 'のターンのはじめまで'}${a.maxCost ? 'コスト' + a.maxCost + '以下の' : ''}${a.spell ? '呪文を唱えられない' : 'クリーチャーを出せない'}`);
          break;
        case 'discardAll':
          for (const c of [...op.hand]) await this.discardCard(c, pi);
          break;
        case 'revealHand':
          this.log(`${op.name}の手札：${op.hand.map((c) => c.def.name).join('、') || 'なし'}`);
          break;
        case 'untapMana':
          for (const c of me.mana) c.tapped = false;
          this.log(`${me.name}はマナをすべてアンタップした`);
          break;
        case 'teamWinTurn':
          me.teamWinTurn = this.turn;
          this.log(`このターン、${me.name}のクリーチャーはすべてのバトルに勝つ`);
          break;
        case 'turnGrant': {
          const r = await this.pickCards(pi, me.battle.filter((c) => this.isCreature(c)), a.n, false, `${nm}: 能力を与える自分のクリーチャー`, 'recover');
          me.tempGrants = me.tempGrants || [];
          me.tempGrants.push({ names: a.names, until: this.turn, uids: r.map((c) => c.uid) });
          if (r.length) this.log(`このターン、${r.map((c) => '「' + c.def.name + '」').join('')}に${a.names.map((x) => '「' + x + '」').join('と')}`);
          break;
        }
        case 'extraTurn':
          if (a.notInExtra && this.inExtraTurn) {
            this.log('追加ターン中なので、追加ターンは得られない');
            break;
          }
          me.extraTurns = (me.extraTurns || 0) + 1;
          this.log(`${me.name}はこのターンの後にもう1ターン行う`);
          break;
        case 'tempWinAll':
          if (this.zoneOf(src) === 'battle') {
            src.winAllUntil = a.until === 'turn' ? this.turn : this.nextTurnOf(pi) - 1;
            this.log(`「${src.def.name}」は${a.until === 'turn' ? 'このターン' : '次の自分のターンのはじめまで'}すべてのバトルに勝つ`);
          }
          break;
        case 'selfTempGrant':
          if (this.zoneOf(src) === 'battle') {
            me.tempGrants = me.tempGrants || [];
            me.tempGrants.push({ names: a.names, until: this.nextTurnOf(pi) - 1, uids: [src.uid] });
            this.log(`「${src.def.name}」は次の自分のターンのはじめまで${a.names.map((x) => '「' + x + '」').join('と')}を得た`);
          }
          break;
        case 'protectOwn': {
          const r = await this.pickCards(pi, me.battle.filter((c) => this.isCreature(c)), a.n, false, `${nm}: 選ばれなくする自分のクリーチャー`, 'recover');
          for (const c of r) {
            c.protectUntil = this.nextTurnOf(pi) - 1;
            this.log(`「${c.def.name}」は次の自分のターンのはじめまで相手に選ばれない`);
          }
          break;
        }
        case 'tapSameName': {
          const r = await this.pickCards(pi, op.battle.filter((c) => this.isCreature(c)), a.n, false, `${nm}: タップするクリーチャー（同じ名前もすべて）`, 'target', 'tap');
          for (const c of r) {
            for (const x of [...op.battle, ...me.battle]) if (x.def.name === c.def.name && this.isCreature(x)) x.tapped = true;
            this.log(`「${c.def.name}」と同じ名前のクリーチャーをすべてタップした`);
          }
          break;
        }
        case 'untapOwn': {
          const r = await this.pickCards(pi, me.battle.filter((c) => this.isCreature(c) && c.tapped), a.n, a.optional, `${nm}: アンタップする自分のクリーチャー`, 'recover');
          for (const c of r) c.tapped = false;
          if (r.length) this.log(`${me.name}はクリーチャーを${r.length}体アンタップした`);
          break;
        }
        case 'summonLock':
          op.summonLock = { maxCost: a.maxCost, until: this.nextTurnOf(pi) - 1 };
          this.log(`次の${me.name}のターンのはじめまで、${op.name}はコスト${a.maxCost}以下のクリーチャーを召喚できない`);
          break;
        case 'summonFromShield':
          if (this.zoneOf(src) === 'shields' && src.faceUp) {
            this.log(`「${src.def.name}」をシールドから召喚する`);
            await this.putIntoPlay(pi, src, true);
          }
          break;
        case 'fight': {
          if (this.zoneOf(src) !== 'battle') break;
          const pool = op.battle.filter((c) => this.isCreature(c));
          const r = await this.pickCards(pi, pool, 1, a.optional, `${nm}: バトルさせる相手のクリーチャー`, 'target', 'destroy');
          if (r[0]) await this.battle(src, r[0]);
          break;
        }
        case 'putFromHand':
        case 'castFromHand': {
          let pool = [...me.hand, ...(a.alsoGrave ? me.grave : [])].filter((c) => (a.act === 'castFromHand' ? c.def.type === 'spell' : (a.kinds || ['creature']).includes(this.isCreature(c) ? 'creature' : c.def.type)));
          if (a.maxCost != null) pool = pool.filter((c) => (+c.def.cost || 0) <= a.maxCost);
          if (a.notEvo) pool = pool.filter((c) => !this.evoKind(c.def));
          if (a.civ) pool = pool.filter((c) => (c.def.civs || []).includes(a.civ));
          if (a.nameHas) pool = pool.filter((c) => c.def.name.includes(a.nameHas));
          if (a.hasText) pool = pool.filter((c) => (c.def.text || '').includes(a.hasText));
          if (a.act === 'castFromHand') pool = pool.filter((c) => !this.locked(pi, c.def));
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: 手札から${a.act === 'castFromHand' ? '唱える呪文' : '出すクリーチャー'}`, 'recover');
          for (const c of r) {
            if (a.act === 'castFromHand') await this.putIntoPlay(pi, c, true);
            else await this.enterBattle(c, pi, 'other');
          }
          break;
        }
        case 'tapOrUntap': {
          const pool = [...op.battle, ...me.battle].filter((c) => this.isCreature(c));
          const r = await this.pickCards(pi, pool, a.n, false, `${nm}: タップまたはアンタップするクリーチャー`, 'target', 'tap');
          for (const c of r) {
            c.tapped = !c.tapped;
            this.log(`「${c.def.name}」を${c.tapped ? 'タップ' : 'アンタップ'}した`);
          }
          break;
        }
        case 'tempGrant': {
          let uids = null;
          if (!a.all) {
            const r = await this.pickCards(pi, me.battle.filter((c) => this.isCreature(c)), a.n, false, `${nm}: 能力を与える自分のクリーチャー`, 'recover');
            uids = r.map((c) => c.uid);
          }
          me.tempGrants = me.tempGrants || [];
          me.tempGrants.push({ names: a.names, until: this.nextTurnOf(pi) - 1, uids, power: a.power || 0 });
          this.log(`次の自分のターンのはじめまで、${a.all ? '自分のクリーチャーすべて' : '選んだクリーチャー'}に${a.names.map((x) => '「' + x + '」').join('と')}`);
          break;
        }
        case 'freezeLast':
          for (const c of this.lastPicked || []) {
            if (this.zoneOf(c) !== 'battle') continue;
            c.frozenUntil = this.nextTurnOf(c.owner);
            this.log(`「${c.def.name}」は次のターンのはじめにアンタップしない`);
          }
          break;
        case 'shieldToHand': {
          const r = await this.pickCards(pi, me.shields.slice(), a.n, a.optional, `${nm}: 手札に加える自分のシールド`, 'recover');
          for (const c of r) this.moveTo(c, 'hand');
          if (r.length) {
            this.log(`${me.name}はシールドを${r.length}つ手札に加えた（S・トリガーは使えない）`);
            await this.shieldsLeft(pi);
          }
          break;
        }
        case 'loseGame':
          this.win(1 - pi, `${src.def.name}の効果`);
          break;
        case 'winGame':
          this.win(pi, `${src.def.name}の効果`);
          break;
        case 'seal':
          if (this.zoneOf(src) === 'battle') this.addSeals(src, a.n);
          break;
        case 'untapSelf':
          if (a.optional && this.zoneOf(src) === 'battle' && src.tapped && !(await this.yesNo(pi, `${nm}: このクリーチャーをアンタップしますか？`, src))) break;
          if (this.zoneOf(src) === 'battle' && src.tapped) {
            src.tapped = false;
            this.log(`「${src.def.name}」はアンタップした`);
          }
          break;
        case 'breakShield':
          if (a.optional && !(await this.yesNo(pi, `${nm}: 相手のシールドを${a.n}つブレイクしますか？`, src))) break;
          await this.breakShields(pi, a.n, src);
          break;
        case 'powerUp':
          if (this.zoneOf(src) === 'battle') {
            src.tempPower += a.n;
            this.log(`「${src.def.name}」のパワーが+${a.n}された`);
          }
          break;
      }
      this.changed();
      await this.pause(0.6);
    }

    async destroyMany(cards, o = {}) {
      const gone = [];
      for (const c of cards) {
        if (this.zoneOf(c) !== 'battle') continue;
        if ((c.noDestroyUntil || 0) >= this.turn) {
          this.log(`「${c.def.name}」は破壊されない`);
          continue;
        }
        if (!(await this.leave(c, 'grave', { destroy: true, byOpp: o.byOpp }))) continue;
        this.log(`「${c.def.name}」は破壊された${this.zoneOf(c) === 'mana' ? '（マナゾーンへ）' : ''}`);
        gone.push(c);
      }
      this.changed();
      for (const c of gone) await this.trigger(c, 'destroyed', c.owner, c.def, null, { defer: true });
      for (const c of gone) if (this.isCreature(c)) for (const src of this.permanents(1 - c.owner)) if (this.isOnField(src) && this.hasAbility(src, 'oppDestroyed')) await this.trigger(src, 'oppDestroyed', src.owner, src.def, null, { defer: true });
      await this.resolvePending();
    }

    // ===== 攻撃 =====
    attackTargets(card) {
      const pi = card.owner;
      if (this.active !== pi || this.zoneOf(card) !== 'battle' || card.tapped || !this.isCreature(card)) return [];
      const k0 = this.kw(card);
      // 「攻撃できない」を無視する能力
      const ign = this.permanents(pi).map((s) => this.kw(s).ignoreCantAttack).filter(Boolean).find((ig) => !ig.who || ((card.def.races || []).join('/') + card.def.name + (card.def.text || '')).includes(ig.who.replace(/^「(.+?)」を持つ$/, '$1').replace(/(・)?クリーチャー$/, '')));
      const k = ign ? { ...k0, cantAttack: ign.playerOnly ? k0.cantAttack : false, cantAttackPlayer: false } : k0;
      if (k.cantAttack) return [];
      if (card.noAttackTurn === this.turn) return [];
      for (const q of [0, 1]) for (const s of this.permanents(q)) {
        const ab = this.kw(s).attackBan;
        if (!ab || (ab.oppOnly && q === pi)) continue;
        const pw = this.power(card);
        if (ab.maxPower != null && pw <= ab.maxPower) return [];
        if (ab.minPower != null && pw >= ab.minPower) return [];
        if (ab.lessThanSelf && s !== card && this.isCreature(s) && pw < this.power(s)) return [];
      }
      let needNoPlayer = false;
      if (k.attackNeedWhat) {
        const an = k.attackNeedWhat;
        if (!an._cond) an._cond = G.TextParse && G.TextParse.lookCond ? G.TextParse.lookCond(an.what) : {};
        const has = this.p[pi].battle.some((c) => (!an.others || c !== card) && this.fitLook(c, an._cond));
        if (!has && !an.playerOnly) return [];
        if (!has) needNoPlayer = true;
      }
      if ((card.lockedUntil || 0) >= this.turn) return [];
      if (k.attackNeedGrave && this.p[pi].grave.length < k.attackNeedGrave) return [];
      const lackCreatures = k.attackNeedCreatures && this.p[pi].battle.filter((c) => this.isCreature(c)).length < k.attackNeedCreatures.n;
      if (lackCreatures && !k.attackNeedCreatures.playerOnly) return [];
      if (card.enteredTurn === this.turn && this.permanents(1 - pi).some((s) => this.kw(s).oppNoAttackOnEntry)) return [];
      for (const src of this.permanents(1 - pi)) {
        const sc = this.sc(src);
        if (sc && sc.forbidAttack && sc.forbidAttack(this, src, card)) return [];
      }
      const op = this.opp(pi);
      const t = [];
      const canHit = (c) => {
        if (!this.isCreature(c) || (c.jdUntil || 0) >= this.turn) return false;
        const nb = this.kw(c).noBeAttacked;
        if (nb === true) return false;
        if (nb && nb.byCiv && (card.def.civs || []).includes(nb.byCiv)) return false;
        if (nb && nb.needOther && op.battle.some((x) => x !== c && this.isCreature(x))) return false;
        return true;
      };
      // 「可能ならこのクリーチャーを攻撃する」
      const forced = op.battle.filter((c) => canHit(c) && this.kw(c).forceAttack && (c.tapped || k.attackUntapped || card.sick));
      if (card.sick) {
        if (k.machFighter && card.enteredTurn === this.turn) t.push(...op.battle.filter(canHit));
        return t;
      }
      const guard = op.battle.some((s) => this.isCreature(s) && this.kw(s).playerGuardPower && this.power(card) < this.power(s)) || this.permanents(1 - pi).some((s) => this.kw(s).noPlayerAttack);
      const noPlayer = guard || needNoPlayer || k.cantAttackPlayer || lackCreatures || (k.playerAttackNeedShieldAdded && this.p[pi].shieldAddedTurn !== this.turn);
      if (!noPlayer) t.push('player');
      t.push(...op.battle.filter((c) => canHit(c) && (c.tapped || k.attackUntapped)));
      if (forced.length) return t.filter((x) => x !== 'player' && forced.includes(x));
      return t;
    }

    async attack(pi, uid, target) {
      const f = this.find(uid);
      if (!f) return false;
      let card = f.card;
      const tg = this.attackTargets(card);
      let tgtCard = target === 'player' ? 'player' : tg.find((x) => x !== 'player' && x.uid === target);
      if (!tgtCard || (tgtCard === 'player' && !tg.includes('player'))) return false;
      const me = this.p[pi];
      const op = this.opp(pi);
      card.tapped = true;
      card.attacking = true;
      if (this.hasAbility(card, 'tapped')) await this.trigger(card, 'tapped', pi, card.def, null, { defer: true });
      await this.allyEvent(card, pi, 'allyAttack');
      await this.fireAll(1 - pi, 'oppAttack');
      this.log(`${me.name}の「${card.def.name}」が${tgtCard === 'player' ? op.name : '「' + tgtCard.def.name + '」'}を攻撃！`);
      await this.pause();
      try {
        await this.trigger(card, 'attack', pi);
        if (this.zoneOf(card) !== 'battle') return true;
        // スマッシュ・バースト
        if (this.kw(card).smashBurst && this.twin(card) && this.zoneOf(card) === 'battle') {
          const t = this.twin(card);
          if (await this.yesNo(pi, `スマッシュ・バースト：「${t.name}」をコストを払わずに唱えますか？`, card)) {
            this.log(`スマッシュ・バースト！「${t.name}」を唱えた`);
            this.resolving = (this.resolving || 0) + 1;
            try {
              await this.runAbility(card, 'cast', pi, t);
            } finally {
              this.resolving--;
            }
            await this.resolvePending();
            if (this.zoneOf(card) !== 'battle') return true;
          }
        }
        // 攻撃時に手札から使えるもの：侵略・革命チェンジ
        const swaps = [];
        for (const h of me.hand) {
          const sc = this.sc(h);
          const hk = parsed(h.def).kw;
          if ((sc && sc.revChange && sc.revChange(this, h, card)) || (hk.revChange && h !== card && this.matchCond(card, hk.revChange)))
            swaps.push({ id: 'rc' + h.uid, label: `革命チェンジ：「${h.def.name}」と入れ替える`, card: h, how: 'rc' });
          if (hk.invasion && this.matchCond(card, hk.invasion))
            swaps.push({ id: 'iv' + h.uid, label: `侵略：「${h.def.name}」を上に重ねる`, card: h, how: 'iv' });
        }
        if (swaps.length) {
          const opts = [{ id: 'none', label: '使わない' }, ...swaps.map((x) => ({ id: x.id, label: x.label }))];
          const best = swaps.slice().sort((a, b) => (+b.card.def.cost || 0) - (+a.card.def.cost || 0))[0];
          const r = await this.choose(pi, { kind: 'mode', prompt: `「${card.def.name}」の攻撃時に使いますか？`, options: opts, min: 1, max: 1, aiPick: [best.id] });
          const sw = swaps.find((x) => x.id === r[0]);
          if (sw) {
            const nc = sw.card;
            card.attacking = false;
            if (sw.how === 'rc') {
              this.moveTo(card, 'hand');
              this.log(`革命チェンジ！「${card.def.name}」→「${nc.def.name}」`);
              await this.enterBattle(nc, pi, 'other');
            } else {
              this.log(`侵略！「${card.def.name}」の上に「${nc.def.name}」`);
              await this.enterBattle(nc, pi, 'other', { evolveFrom: card });
            }
            if (this.zoneOf(nc) !== 'battle') return true;
            card = nc;
            card.tapped = true;
            card.attacking = true;
            await this.trigger(card, 'attack', pi);
            if (this.zoneOf(card) !== 'battle') return true;
          }
        }
        // ニンジャ・ストライク：防御側が手札からコストを払わずに出す
        const ninjas = op.hand.filter((h) => parsed(h.def).kw.ninjaStrike && op.mana.length >= parsed(h.def).kw.ninjaStrike);
        if (ninjas.length) {
          const r = await this.pickCards(op.idx, ninjas, 1, true, 'ニンジャ・ストライクで出すクリーチャー（任意）', 'recover');
          if (r[0]) {
            this.log(`${op.name}: ニンジャ・ストライク！`);
            await this.enterBattle(r[0], op.idx, 'other');
            if (this.zoneOf(r[0]) === 'battle') r[0].returnAtEnd = true;
          }
        }
        // 攻撃された時
        if (tgtCard !== 'player' && this.zoneOf(tgtCard) === 'battle') await this.trigger(tgtCard, 'attacked', tgtCard.owner);
        // ガードマン：自分の他のクリーチャーへの攻撃を引き受ける
        if (tgtCard !== 'player') {
          const guards = op.battle.filter((c) => c !== tgtCard && (!c.tapped || this.kw(c).guardTapped) && this.isCreature(c) && this.kw(c).guardman);
          if (guards.length) {
            const r = await this.pickCards(op.idx, guards, 1, true, `ガードマン：「${tgtCard.def.name}」への攻撃を引き受けるクリーチャー（任意）`, 'recover');
            if (r[0]) {
              r[0].tapped = !this.kw(r[0]).guardTapped;
              tgtCard = r[0];
              this.log(`ガードマン：攻撃先が「${tgtCard.def.name}」に変わった`);
            }
          }
        }
        // ブロック
        const teamUnb = this.permanents(pi).some((s) => {
          const tu = this.kw(s).teamUnblock;
          return tu && (!tu.who || ((card.def.races || []).join('/') + card.def.name).includes(tu.who));
        });
        if (!teamUnb && !this.kw(card).unblockable && !((card.unblockableTurn || 0) === this.turn)) {
          const blockers = op.battle.filter((c) => !c.tapped && this.isCreature(c) && this.kw(c).blocker && c !== tgtCard && !((c.lockedUntil || 0) >= this.turn));
          if (blockers.length) {
            const r = await this.choose(op.idx, {
              kind: 'block',
              prompt: `「${card.def.name}」(パワー${this.power(card)})の攻撃をブロックしますか？`,
              attacker: card,
              target: tgtCard,
              options: blockers.map((c) => ({ id: c.uid, label: `${c.def.name} (${this.power(c)})`, card: c })),
              min: 0,
              max: 1,
            });
            const bl = blockers.find((c) => c.uid === r[0]);
            if (bl) {
              bl.tapped = true;
              this.log(`${op.name}の「${bl.def.name}」がブロック！`);
              await this.pause();
              await this.trigger(bl, 'block', op.idx);
              bl.blocking = true;
              try {
                await this.battle(card, bl);
              } finally {
                bl.blocking = false;
              }
              if (this.zoneOf(bl) === 'battle' && this.kw(bl).untapAfterBlock) {
                bl.tapped = false;
                this.log(`「${bl.def.name}」はバトルの後でアンタップした`);
              }
              return true;
            }
          }
        }
        if (tgtCard === 'player') {
          if (this.hasAbility(card, 'unblocked')) await this.trigger(card, 'unblocked', pi);
          if (this.zoneOf(card) !== 'battle') return true;
          if (op.shields.length === 0) {
            this.log(`「${card.def.name}」のダイレクトアタック！`);
            this.win(pi, 'ダイレクトアタック');
          }
          if (this.hasAbility(card, 'beforeBreak')) await this.trigger(card, 'beforeBreak', pi);
          await this.breakShields(pi, this.breakCount(card), card);
        } else if (this.zoneOf(tgtCard) === 'battle') {
          await this.battle(card, tgtCard);
        }
      } finally {
        card.attacking = false;
        this.changed();
      }
      await this.attackEnd(card, pi);
      return true;
    }

    // 攻撃の終わりの効果
    async attackEnd(card, pi) {
      if (this.zoneOf(card) !== 'battle') return;
      if (this.hasAbility(card, 'attackEnd')) await this.trigger(card, 'attackEnd', pi);
      if (this.zoneOf(card) !== 'battle') return;
      for (const src of this.permanents(1 - pi)) {
        const nc = this.kw(src).attackEndDestroyNot;
        if (nc && !(card.def.civs || []).includes(nc)) {
          this.log(`「${src.def.name}」の効果で、攻撃を終えた「${card.def.name}」は破壊される`);
          await this.destroyMany([card], { byOpp: true });
          return;
        }
      }
      for (const src of this.p[pi].battle) {
        const fu = this.kw(src).firstAttackUntap;
        if (!fu || card.firstAttackDone === this.turn) continue;
        if (fu.who && !((card.def.races || []).join('/') + card.def.name).includes(fu.who.replace(/(・)?クリーチャー$/, ''))) continue;
        card.firstAttackDone = this.turn;
        card.tapped = false;
        this.log(`「${card.def.name}」は最初の攻撃の終わりにアンタップした`);
        break;
      }
      if (card.firstAttackDone !== this.turn) card.firstAttackDone = this.turn;
    }

    // タップ能力：攻撃するかわりにタップして使う
    canTapAbility(card) {
      const k = this.kw(card);
      if (!k.tapAbility || !this.isCreature(card) || this.zoneOf(card) !== 'battle' || card.tapped || card.sick || this.active !== card.owner) return false;
      if (k.tapAbility.mana && this.p[card.owner].mana.filter((m) => !m.tapped).length < k.tapAbility.mana) return false;
      return this.hasAbility(card, 'tapAbility');
    }
    async useTapAbility(pi, uid) {
      const f = this.find(uid);
      if (!f || !this.canTapAbility(f.card)) return false;
      const card = f.card;
      card.tapped = true;
      const need = this.kw(card).tapAbility.mana || 0;
      for (const m of this.p[pi].mana.filter((x) => !x.tapped).slice(0, need)) m.tapped = true;
      this.log(`${this.p[pi].name}は「${card.def.name}」をタップして能力を使った`);
      if (this.hasAbility(card, 'tapped')) await this.trigger(card, 'tapped', pi, card.def, null, { defer: true });
      await this.trigger(card, 'tapAbility', pi);
      return true;
    }

    async battle(a, d) {
      a.inBattle = d;
      d.inBattle = a;
      const pa = this.power(a);
      const pd = this.power(d);
      a.inBattle = d.inBattle = null;
      this.log(`バトル: 「${a.def.name}」${pa} vs 「${d.def.name}」${pd}`);
      const lose = [];
      const teamWin = (c) => this.permanents(c.owner).some((s) => this.kw(s).teamWinAll) || (this.p[c.owner].teamWinTurn || 0) === this.turn;
      const wa = this.kw(a).winAllBattles || (a.winAllUntil || 0) >= this.turn || teamWin(a);
      const wd = this.kw(d).winAllBattles || (d.winAllUntil || 0) >= this.turn || teamWin(d);
      if ((pa >= pd || wa) && !wd) lose.push(d);
      if ((pd >= pa || wd) && !wa) lose.push(a);
      if (wa && wd) lose.push(a, d);
      if (lose.length === 1) {
        const loser = lose[0];
        const winner = loser === a ? d : a;
        if (this.kw(loser).slayer) lose.push(winner);
      }
      await this.destroyMany(lose);
      for (const w of [a, d]) if (!lose.includes(w) && this.zoneOf(w) === 'battle') {
        await this.trigger(w, 'battleWin', w.owner);
        await this.fireAll(w.owner, 'allyBattleWin');
      }
      for (const l of lose) if (this.hasAbility(l, 'battleLose')) await this.trigger(l, 'battleLose', l.owner);
    }

    async breakShields(pi, n, src) {
      const op = this.opp(pi);
      n = Math.min(n, op.shields.length);
      if (!n) return;
      // ブレイク身代わり（セイント・キャッスルなど）
      const sub = op.shields.find((s) => s.faceUp && this.kw(s).breakSubstitute);
      if (sub && src && this.isCreature(src)) {
        if (await this.yesNo(op.idx, `「${sub.def.name}」でブレイクを身代わりしますか？（${n}枚分）`, sub)) {
          this.moveTo(sub, 'grave');
          this.log(`${op.name}の「${sub.def.name}」がかわりにブレイクされ、墓地に置かれた`);
          await this.pause();
          if (src && this.zoneOf(src) === 'battle') await this.notifyAll('onBreak', src);
          await this.shieldsLeft(op.idx);
          return;
        }
      }
      // 置き換え：ブレイクされる時、かわりに〜
      for (let i = n; i > 0; i--) {
        const opts = [];
        if (op.permanents ? false : true) {
          for (const src of this.permanents(op.idx)) {
            const k = this.kw(src);
            if (k.breakSubTap && op.battle.some((c) => this.isCreature(c) && !c.tapped)) opts.push({ id: 'tap', label: `「${src.def.name}」：かわりに自分のクリーチャーを1体タップする` });
            if (k.firstBreakNewShield && op.firstBreakTurn !== this.turn && op.deck.length) opts.push({ id: 'shield', label: `「${src.def.name}」：かわりに山札の上から新しいシールドを置く` });
          }
        }
        if (!opts.length) break;
        const uniq = opts.filter((o, j) => opts.findIndex((x) => x.id === o.id) === j);
        const [m] = await this.chooseModes(op.idx, `シールドがブレイクされます（残り${i}つ）。かわりにどうしますか？`, [...uniq, { id: 'none', label: 'そのままブレイクされる' }], { aiPick: [uniq[0].id] });
        if (m === 'tap') {
          const r = await this.pickCards(op.idx, op.battle.filter((c) => this.isCreature(c) && !c.tapped), 1, false, 'かわりにタップするクリーチャー', 'recover');
          if (r[0]) {
            r[0].tapped = true;
            this.log(`${op.name}は「${r[0].def.name}」をタップして、ブレイクを1つ防いだ`);
            n--;
          }
        } else if (m === 'shield') {
          op.firstBreakTurn = this.turn;
          this.moveTo(op.deck[0], 'shields');
          this.log(`${op.name}はブレイクのかわりに、山札の上から新しいシールドを置いた`);
          n--;
        } else break;
      }
      n = Math.min(n, op.shields.length);
      if (!n) return;
      // ブレイクするシールドは攻撃側が選ぶ
      let picked;
      if (n >= op.shields.length) picked = op.shields.slice();
      else {
        picked = await this.pickCards(pi, op.shields, n, false, `ブレイクするシールドを${n}つ選んでください`, 'shield');
      }
      const toGrave = src && this.kw(src).breakToGrave;
      for (const s of picked) {
        if (toGrave && !s.faceUp) {
          this.moveTo(s, 'grave');
          this.log(`ブレイクされたシールドは、手札ではなく墓地に置かれた`);
          continue;
        }
        if (s.faceUp) {
          // 表向き（城など）は手札ではなく墓地へ
          this.moveTo(s, 'grave');
          this.log(`城「${s.def.name}」は墓地に置かれた`);
        } else this.moveTo(s, 'hand');
      }
      this.log(`${op.name}のシールドを${picked.length}つブレイクした（残り${op.shields.length}）`);
      await this.pause();
      // ブレイクした時の効果（ニガ=アブシュームなど）
      if (src && this.zoneOf(src) === 'battle') await this.trigger(src, 'broke', src.owner);
      if (src && this.zoneOf(src) === 'battle') await this.notifyAll('onBreak', src);
      await this.shieldsLeft(op.idx);
      // 手札に加わったシールドの中から、使うS・トリガー／G・ストライクを先に宣言し、選んだ順に使う
      const cands = [];
      for (const sh of picked) {
        if (this.zoneOf(sh) !== 'hand') continue;
        const ssc = this.sc(sh);
        if (this.kw(sh).shieldTrigger || (ssc && ssc.dynamicTrigger && ssc.dynamicTrigger(this, sh))) cands.push({ id: 'st' + sh.uid, label: `S・トリガー「${sh.def.name}」`, card: sh, def: sh.def, kind: 'st' });
        const t = this.twin(sh);
        if (t && parsed(t).kw.shieldTrigger) cands.push({ id: 'tw' + sh.uid, label: `S・トリガー「${t.name}」（ツインパクトの呪文側）`, card: sh, def: t, kind: 'st' });
        if (this.kw(sh).gStrike) cands.push({ id: 'gs' + sh.uid, label: `G・ストライク「${sh.def.name}」`, card: sh, def: sh.def, kind: 'gs' });
      }
      if (cands.length) {
        const ids = await this.chooseModes(op.idx, `${op.name}: 使うS・トリガー／G・ストライクを、使う順に選んでください`, cands.map((c) => ({ id: c.id, label: c.label })), {
          min: 0,
          max: cands.length,
          aiPick: cands.filter((c, i) => cands.findIndex((x) => x.card === c.card) === i).map((c) => c.id),
        });
        const used = new Set();
        for (const id of ids) {
          const c = cands.find((x) => x.id === id);
          if (!c || used.has(c.card) || this.zoneOf(c.card) !== 'hand') continue;
          used.add(c.card);
          if (c.kind === 'gs') {
            const pool = this.p[pi].battle.filter((x) => this.isCreature(x));
            const r = await this.pickCards(op.idx, pool, 1, false, 'G・ストライク：このターン攻撃できなくするクリーチャー', 'target', 'tap');
            if (r[0]) {
              r[0].noAttackTurn = this.turn;
              this.log(`G・ストライク：「${r[0].def.name}」はこのターン攻撃できない`);
            }
          } else {
            this.log(`${op.name}: S・トリガー発動！`);
            await this.putIntoPlay(op.idx, c.card, true, c.def);
          }
        }
      }
    }

    // ===== 手動操作（ルールを無視して動かす） =====
    manualMove(uid, zone, opt = {}) {
      if (!this.busy && this._endTurnResolve) this.snapshot('手動移動');
      const f = this.find(uid);
      if (!f) return;
      const from = this.moveTo(f.card, zone, opt || {});
      if (zone === 'shields' && opt && opt.faceUp) f.card.faceUp = true;
      this.log(`[手動] 「${f.card.def.name}」を${ZONE_LABEL[from]}から${this.p[f.card.owner].name}の${ZONE_LABEL[zone]}へ`);
      this.safeChanged();
    }
    manualTap(uid) {
      if (!this.busy && this._endTurnResolve) this.snapshot('タップ切替');
      const f = this.find(uid);
      if (!f) return;
      f.card.tapped = !f.card.tapped;
      this.safeChanged();
    }
    manualShuffle(pi) {
      if (!this.busy && this._endTurnResolve) this.snapshot('シャッフル');
      shuffle(this.p[pi].deck, this.rng);
      this.log(`[手動] ${this.p[pi].name}は山札をシャッフルした`);
      this.safeChanged();
    }
    manualDraw(pi) {
      if (!this.busy && this._endTurnResolve) this.snapshot('手動ドロー');
      try {
        this.draw(pi, 1);
        this.log(`[手動] ${this.p[pi].name}は1枚引いた`);
      } catch (e) {
        if (!(e instanceof GameOver)) throw e;
      }
      this.safeChanged();
    }
    safeChanged() {
      try {
        this.changed();
      } catch (e) {
        if (!(e instanceof GameOver)) throw e;
      }
    }
  }

  G.Engine = { Game, GameOver, parsed, twinDef, CIV_LABEL, ZONE_LABEL, TYPE_LABEL, NON_CREATURE, shuffle };
  if (typeof module !== 'undefined') module.exports = G.Engine;
})(typeof globalThis !== 'undefined' ? globalThis : window);
