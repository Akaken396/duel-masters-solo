// 対戦の進行とルール処理
(function (G) {
  'use strict';
  const TP = G.TextParse || (typeof require !== 'undefined' ? require('./textparse.js') : null);

  const CIV_LABEL = { light: '光', water: '水', darkness: '闇', fire: '火', nature: '自然', zero: 'ゼロ' };
  const ZONES = ['deck', 'hand', 'mana', 'shields', 'battle', 'grave', 'hyper', 'gr'];
  // 山札に入れず、超次元ゾーン／超GRに置くカード（サイキック・ドラグハート／GRクリーチャー）
  const HOME_RE = /(サイキック・クリーチャー|ドラグハート|サイキック)は(、)?(山札には含め|自身の超次元|自分の超次元)/;
  function homeZone(def) {
    if (!def) return null;
    if (def._home !== undefined) return def._home;
    const t = def.text || '';
    let h = null;
    if (def.type !== 'spell' && HOME_RE.test(t) && ((def.twin && def.twin.type !== 'spell') || /^時空の/.test(def.name) || /ループ覚醒|龍解|このドラグハート|これを装備した/.test(t))) h = 'hyper';
    else if (/GRクリーチャーは(、)?山札には含め/.test(t) && (/ GR$/.test(def.name) || !/GR召喚/.test(t))) h = 'gr';
    try {
      Object.defineProperty(def, '_home', { value: h, enumerable: false, configurable: true });
    } catch (e) {
      /* 凍結されたオブジェクト */
    }
    return h;
  }
  // ドラグハートのウエポン・フォートレス（クリーチャーではない）
  function isDragheartItem(def) {
    return homeZone(def) === 'hyper' && def.power == null;
  }
  // クリーチャーに付けて使うカード：'weapon' ウエポン / 'cross' クロスギア / 'aura' オーラ
  function attachKind(def) {
    if (!def || def.type !== 'creature') return null;
    if (def._ak !== undefined) return def._ak;
    const t = def.text || '';
    let k = null;
    if (isDragheartItem(def)) k = /これを装備した|ウエポン/.test(t) && !/フォートレス/.test(def.name + t.slice(0, 0)) ? 'weapon' : null;
    else if (def.power == null && /クロスギア|これをクロスした/.test(t)) k = 'cross';
    else if (/このオーラ|オレガ・オーラ|これを付けたクリーチャー|これをクリーチャーに付けた/.test(t) && !/このクリーチャー(が|は|を|の)/.test(t)) k = 'aura';
    try {
      Object.defineProperty(def, '_ak', { value: k, enumerable: false, configurable: true });
    } catch (e) {
      /* */
    }
    return k;
  }
  const ZONE_LABEL = { deck: '山札', hand: '手札', mana: 'マナ', shields: 'シールド', battle: 'バトルゾーン', grave: '墓地', hyper: '超次元ゾーン', gr: '超GR' };

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

  const WHEN_J = { oppJanken: '相手のジャンケンの手で誘発する能力', ownToGrave: 'カードが自分の墓地に置かれた時の能力', selfShieldLeft: '表向きでシールドゾーンを離れた時の能力', oppTapped: '相手のクリーチャーがタップした時の能力', allyBattleWinR: '自分の（指定の）クリーチャーがバトルに勝った時の能力', allyUnblocked: '自分のクリーチャーの攻撃が通った時の能力', oppToGrave: 'カードが相手の墓地に置かれた時の能力', manaPut: 'スペース・チャージ', allyTapped: '自分のクリーチャーがタップした時の能力', linked: 'リンクした時の能力', oppEnterNonSummon: '相手が召喚以外でクリーチャーを出した時の能力', enteredByChange: '革命チェンジ・侵略で出た時の能力', allyEvolved: '進化クリーチャーを置いた時の能力', oppDiscarded: '相手が手札を捨てた時の能力', graveLeft: '墓地からカードが離れた時の能力', allyEnterAny: '自分のクリーチャーが出た時の能力', selfPlay: '重いカードを使った時の能力', selfDiscarded: '手札を捨てた時の能力', selfDraw: 'カードを引いた時の能力', oppPlay: '相手がカードを使った時の能力', oppEnterFree: '相手のクリーチャーがコストなしで出た時の能力', oppEnterBig: '相手のマナより重いクリーチャーが出た時の能力', allyDestroyed: '自分の（指定の）クリーチャーが破壊された時の能力', toGrave: '墓地に置かれた時の能力', hostDestroyed: '付けたクリーチャーが破壊された時の能力', charged: 'マナに置いた時の能力', hostAttack: '付いているクリーチャーの攻撃時の能力', hostAttackEnd: '付いているクリーチャーの攻撃の終わりの能力', eachTurnEnd: 'ターンの終わりの能力', oppTurnEnd: '相手のターンの終わりの能力', oppEnter: '相手のクリーチャーが出た時の能力', anyEnter: 'クリーチャーが出た時の能力', anyDestroyed: 'クリーチャーが破壊された時の能力', selfOrAllyDestroyed: '破壊された時の能力', blocked: 'ブロックされた時の能力', oppUnblocked: '相手の攻撃が通った時の能力', battled: 'バトルした時の能力', targeted: '選ばれた時の能力', oppAttack: '相手の攻撃時の能力', allyCast: '呪文を唱えた時の能力', oppCast: '相手が呪文を唱えた時の能力', allyBattleWin: '自分の（指定の）クリーチャーがバトルに勝った時の能力', oppDestroyed: '相手のクリーチャーが破壊された時の能力', ownShieldLeft: 'シールドが離れた時の能力', attackEnd: '攻撃の終わりの能力', beforeBreak: 'ブレイクの前の能力', unblocked: 'ブロックされなかった時の能力', allyAttack: '自分の（指定の）クリーチャーの攻撃時の能力', allyLeft: '自分の（指定の）クリーチャーが離れた時の能力', tapped: 'タップした時の能力', untapped: 'アンタップした時の能力', evolveSource: 'シンカパワー', tapAbility: 'タップ能力', battleLose: 'バトルに負けた時の能力', left: '離れた時の能力', attacked: '攻撃された時の能力', summonOnly: '召喚で出た時の能力', battleWin: 'バトルに勝った時の能力', oppTurnStart: '相手のターンのはじめの能力', broke: 'ブレイクした時の能力', summon: '出た時の能力', attack: '攻撃する時の能力', destroyed: '破壊された時の能力', turnStart: 'ターンのはじめの能力', turnEnd: 'ターンの終わりの能力', shieldAdded: 'シールドが置かれた時の能力', exLifeLost: 'EXライフが離れた時の能力', block: 'ブロックした時の能力', sealsGone: '封印が外れた時の能力' };

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
        deck: opts.decks[i].filter((def) => !homeZone(def)).map((def) => this.mk(def, i)),
        hand: [],
        mana: [],
        shields: [],
        battle: [],
        grave: [],
        hyper: opts.decks[i].filter((def) => homeZone(def) === 'hyper').map((def) => this.mk(def, i)),
        gr: opts.decks[i].filter((def) => homeZone(def) === 'gr').map((def) => this.mk(def, i)),
      }));
    }

    mk(def, owner) {
      return { uid: uidSeq++, def, owner, tapped: false, sick: false, tempPower: 0, attacking: false, enteredTurn: -1 };
    }

    kw(card) {
      // 条件の判定でまた能力を調べる時の、深い入れ子を防ぐ
      if ((this._kwDepth || 0) > 2) return this.kwBase(card);
      this._kwDepth = (this._kwDepth || 0) + 1;
      try {
        return this.kwInner(card);
      } finally {
        this._kwDepth--;
      }
    }
    kwInner(card) {
      const base = this.kwBase(card);
      if (!this.isCreature(card) || this._granting) return base;
      // 自分の場のカードが与える能力
      let out = base;
      this._granting = true;
      try {
        for (const x of this.p[card.owner].battle) {
          if (x.attachedTo !== card.uid) continue;
          const hb = this.kwBase(x).hostBuff;
          for (const nm of (hb && hb.names) || []) {
            const hit = G.Keywords && G.Keywords.match(nm, nm);
            if (hit && hit.e.set) {
              if (out === base) out = { ...base };
              hit.e.set(out, hit.m, nm);
            }
          }
          if (hb && hb.unblockable) {
            if (out === base) out = { ...base };
            out.unblockable = true;
          }
        }
        for (const src of this.permanents(card.owner)) {
          const g = this.kwSelf(src).grant;
          if (!g || (g.others && src === card)) continue;
          if (g.who && !((card.def.races || []).join('/') + card.def.name).includes(g.who.replace(/(クリーチャー|カード)$/, ''))) continue;
          if (g.civ && !(card.def.civs || []).includes(g.civ)) continue;
          if (g.civs && !(card.def.civs || []).some((x) => g.civs.includes(x))) continue;
          if (g.maxCost != null && (+card.def.cost || 0) > g.maxCost) continue;
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
    // そのカード自身の能力＋条件つきで得る能力（他のカードから与えられる能力は含まない）
    kwSelf(card) {
      const base = this.kwBase(card);
      if (!base.condGrants || this._kwSelfDepth > 1) return base;
      this._kwSelfDepth = (this._kwSelfDepth || 0) + 1;
      let out = base;
      try {
        for (const cgr of base.condGrants) {
          if (!cgr.names.length || !this.condOk2(card.owner, cgr.cond, card)) continue;
          for (const nm of cgr.names) {
            const hit = G.Keywords && G.Keywords.match(nm, nm);
            if (hit && hit.e.set) {
              if (out === base) out = { ...base };
              hit.e.set(out, hit.m, nm);
            }
          }
        }
      } finally {
        this._kwSelfDepth--;
      }
      return out;
    }
    kwBase(card) {
      if (this.isIgnored(card.def.name)) return { breaker: 1, powerAttacker: 0 };
      const p = parsed(card.def);
      let out = p.kw;
      if (card.hyper && p.hyper) {
        const h = p.hyper.kw;
        out = { ...p.kw, ...h, breaker: Math.max(p.kw.breaker, h.breaker || 1), powerAttacker: Math.max(p.kw.powerAttacker, h.powerAttacker || 0) };
      }
      // 超魂X：下にあるカードが与える能力
      const souls = this.soulsOf(card);
      if (souls.length) {
        out = { ...out };
        for (const sk of souls.map((x) => x.kw)) {
          for (const [k, v] of Object.entries(sk)) {
            if (k === 'breaker') out.breaker = Math.max(out.breaker || 1, v || 1);
            else if (k === 'powerAttacker' || k === 'soulPower') out[k] = (out[k] || 0) + (v || 0);
            else if (out[k] == null || out[k] === false) out[k] = v;
          }
        }
      }
      return out;
    }
    soulsOf(card) {
      if (!card || !(card.under || []).length || this.zoneOf(card) !== 'battle') return [];
      return card.under.map((u) => !this.isIgnored(u.def.name) && parsed(u.def).soul).filter(Boolean);
    }
    abilities(card, def = card.def) {
      if (this.isIgnored(def.name)) return [];
      const p = parsed(def);
      let out = p.abilities;
      if (card && card.hyper && p.hyper && def === card.def) out = [...p.abilities, ...p.hyper.abilities];
      if (card && def === card.def) {
        const souls = this.soulsOf(card);
        if (souls.length) out = [...out, ...souls.flatMap((x) => x.abilities)];
      }
      return out;
    }
    // ブレイク数（パワード・ブレイカー込み）
    breakCount(card) {
      if (this.permanents(1 - card.owner).some((s) => this.kw(s).oppBreakCap)) return 1;
      if (this.kw(card).nullBreaker) return 0;
      const mem = this.linkMembers(card);
      let best = 1;
      let extra = 0;
      for (const x of mem) {
        const k = this.kw(x);
        best = Math.max(best, k.poweredBreaker ? Math.max(1, Math.floor(this.power(card) / 6000), k.breaker) : k.breaker);
        extra += k.breakExtra || 0;
        if (k.crewBreaker) extra += this.p[x.owner].battle.filter((o2) => o2 !== x && this.isCreature(o2) && ((o2.def.races || []).join('/') + o2.def.name).includes(k.crewBreaker)).length;
        if (x.tempBreak && x.tempBreak.turn === this.turn) extra += x.tempBreak.n;
      }
      return best + extra;
    }
    // 相手に選ばれるか（ジャストダイバー・選べない）
    selectable(card, chooserPi) {
      if (card.owner === chooserPi || this.zoneOf(card) !== 'battle') return true;
      const k = this.kw(card);
      if (k.untargetable === true) return false;
      if (k.untargetableSpell && this.currentSource && this.currentSource.type === 'spell') return false;
      if (k.ignoreMono && this.currentSource && (this.currentSource.civs || []).filter((x) => x !== 'zero').length < 2) return false;
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
    // ハイパー化：自分の他のクリーチャーをN体タップして、次の自分のターンのはじめまでハイパーモード
    canHyperize(pi, card) {
      const hz = this.kw(card).hyperize;
      if (!hz || card.hyper || this.active !== pi || card.owner !== pi || this.zoneOf(card) !== 'battle') return false;
      return this.p[pi].battle.filter((c) => c !== card && this.isCreature(c) && !c.tapped).length >= hz.tapOthers;
    }
    async hyperize(pi, uid, tapUids) {
      const f = this.find(uid);
      if (!f || !this.canHyperize(pi, f.card)) return false;
      const card = f.card;
      const n = this.kw(card).hyperize.tapOthers;
      const pool = this.p[pi].battle.filter((c) => c !== card && this.isCreature(c) && !c.tapped);
      const r = tapUids ? pool.filter((c) => tapUids.includes(c.uid)).slice(0, n) : await this.pickCards(pi, pool, n, false, `「${card.def.name}」のハイパー化：タップする自分の他のクリーチャー（${n}体）`, 'recover');
      if (r.length < n) return false;
      for (const c of r) c.tapped = true;
      card.hyper = true;
      card.hyperUntil = this.nextTurnOf(pi);
      this.log(`「${card.def.name}」をハイパー化した（${r.map((c) => '「' + c.def.name + '」').join('')}をタップ）。次の自分のターンのはじめまでハイパーモード`);
      for (const c of r) if (this.hasAbility(c, 'tapped')) await this.trigger(c, 'tapped', pi, c.def, null, { defer: true });
      await this.resolvePending();
      this.changed();
      return true;
    }
    // オーラ：自分のクリーチャーに付ける（オレガ・オーラはGRクリーチャー。いなければGR召喚して付ける）
    async playAura(pi, card, fr = '') {
      const me = this.p[pi];
      const orega = /オレガ・オーラ/.test(card.def.text || '');
      const hosts = () => me.battle.filter((c) => this.isCreature(c) && (!orega || homeZone(c.frontDef || c.def) === 'gr'));
      let pool = hosts();
      if ((!pool.length || orega) && me.gr.length && orega) {
        const ids = pool.length ? await this.choose(pi, { kind: 'mode', prompt: `オーラ「${card.def.name}」をどこに付けますか？`, options: [{ id: 'gr', label: 'GR召喚して、そのクリーチャーに付ける' }, ...pool.map((c) => ({ id: String(c.uid), label: `「${c.def.name}」に付ける`, card: c }))], min: 1, max: 1, aiPick: ['gr'] }) : ['gr'];
        if (ids[0] === 'gr') {
          await this.doAction({ act: 'grSummon', n: 1 }, card, pi);
          pool = [this.lastEntered].filter((c) => c && this.zoneOf(c) === 'battle');
        } else pool = pool.filter((c) => String(c.uid) === ids[0]);
      }
      const host = pool.length === 1 ? pool[0] : (await this.pickCards(pi, pool, 1, false, `オーラ「${card.def.name}」を付けるクリーチャー`, 'recover'))[0];
      if (!host) {
        this.moveTo(card, 'grave');
        this.log(`オーラ「${card.def.name}」を付けるクリーチャーがいないので墓地に置いた`);
        return;
      }
      this.moveTo(card, 'battle');
      card.sick = false;
      card.attachedTo = host.uid;
      card.enteredTurn = this.turn;
      this.log(`${me.name}はオーラ「${card.def.name}」を${fr}「${host.def.name}」に付けた`);
      this.noteManual(card);
      await this.trigger(card, 'summon', pi);
      await this.resolvePending();
    }
    // クロスギアをクリーチャーにクロスする（コストを支払う）
    canCross(pi, gear) {
      return this.active === pi && gear.owner === pi && this.zoneOf(gear) === 'battle' && attachKind(gear.def) === 'cross' && this.p[pi].battle.some((c) => this.isCreature(c) && c.uid !== gear.attachedTo) && !!this.payment(pi, gear);
    }
    async crossGear(pi, gearUid, hostUid) {
      const f = this.find(gearUid);
      if (!f || !this.canCross(pi, f.card)) return false;
      const gear = f.card;
      const pool = this.p[pi].battle.filter((c) => this.isCreature(c) && c.uid !== gear.attachedTo);
      const host = hostUid ? pool.find((c) => c.uid === hostUid) : (await this.pickCards(pi, pool, 1, false, `クロスギア「${gear.def.name}」をクロスするクリーチャー`, 'recover'))[0];
      if (!host) return false;
      await this.pay(pi, gear, gear.def);
      gear.attachedTo = host.uid;
      this.log(`${this.p[pi].name}はクロスギア「${gear.def.name}」を「${host.def.name}」にクロスした`);
      this.changed();
      return true;
    }
    // 覚醒・龍解：裏面にする
    flipCard(card) {
      if (card.frontDef) return false;
      const d = card.def;
      const t = d.twin;
      if (!t || t.type === 'spell') return false;
      let power = t.power != null ? +t.power : null;
      if (power == null && (t.type || 'creature') === 'creature') {
        power = +d.power || 0;
        this.log(`「${d.name}」の裏面のパワーが登録されていないので、表面のパワーで扱う（公式から取り込み直すと直る）`);
      }
      card.frontDef = d;
      card.def = { id: d.id + '#back', name: t.name || d.name, civs: t.civs && t.civs.length ? t.civs : d.civs, cost: +t.cost || d.cost, type: t.type || 'creature', power, races: t.races || d.races || [], text: t.text || '', evolution: '', officialUrl: d.officialUrl, imageUrl: d.imageUrl, twin: null };
      if (card.attachedTo) card.attachedTo = null;
      return true;
    }
    unflip(card) {
      if (!card.frontDef) return;
      card.def = card.frontDef;
      delete card.frontDef;
    }
    // 「可能なら毎ターン攻撃する」
    mustAttack(card) {
      if (this.kw(card).mustAttack === 'self') return true;
      if ((card.mustAttackUntil || 0) >= this.turn) return true;
      for (const q of [0, 1]) for (const s of this.permanents(q)) {
        const m = this.kw(s).mustAttack;
        if (m === 'all' || (m === 'opp' && q !== card.owner)) return true;
      }
      return false;
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
      const op = this.p[1 - pi];
      if (!c) return true;
      if (c.not) return !this.condOk2(pi, c.not, card);
      if (c.and) return c.and.every((x) => this.condOk2(pi, x, card));
      if (c.wonBattleThisTurn && me.battleWonTurn !== this.turn) return false;
      if (c.notExtraTurn && this.inExtraTurn) return false;
      if (c.graveCountGE != null && me.grave.length < c.graveCountGE) return false;
      if (c.notCrossed && card && card.attachedTo) return false;
      if (c.crossedGE != null && (!card || this.p[card.owner].battle.filter((x) => x.attachedTo === card.uid && attachKind(x.def) === 'cross').length < c.crossedGE)) return false;
      if (c.countAny && !me.battle.some((x) => c.countAny.races.some((r) => ((x.def.races || []).join('/') + x.def.name).includes(r.replace(/(・)?クリーチャー$/, ''))))) return false;
      if (c.evolvedFromTama && !(card && (card.under || []).some((u) => u.def.type === 'tamaseed'))) return false;
      if (c.oppManaMore && !(op.mana.length > me.mana.length)) return false;
      if (c.creaturesMore && !(me.battle.filter((x) => this.isCreature(x)).length > op.battle.filter((x) => this.isCreature(x)).length)) return false;
      if (c.attackingPlayer && !(card && card._attackingPlayer)) return false;
      if (c.attackingCreature && !(card && card.attacking && !card._attackingPlayer)) return false;
      if (c.evAttackingPlayer && !(this._eventCard && this._eventCard._attackingPlayer)) return false;
      if (c.evAuraGE != null && !(this._eventCard && this.p[this._eventCard.owner].battle.filter((x) => x.attachedTo === this._eventCard.uid && attachKind(x.def) === 'aura').length >= c.evAuraGE)) return false;
      if (c.evSummoned && !(this._eventCard && this._eventCard._enterHow === 'summon')) return false;
      if (c.evMaxCost != null && !(this._eventCard && (+this._eventCard.def.cost || 0) <= c.evMaxCost)) return false;
      if (c.evCreature && !(this._eventCard && this.isCreatureDef(this._eventCard))) return false;
      if (c.myMaxPower) {
        const mx = (arr) => Math.max(0, ...arr.filter((x) => this.isCreature(x)).map((x) => this.power(x)));
        if (!(mx(me.battle) > mx(op.battle))) return false;
      }
      if (c.selfWasUnder && !(card && card._wasUnderOnGrave)) return false;
      if (c.jankenHand && !(this._lastJanken && this._lastJanken.by !== pi && this._lastJanken.hand === c.jankenHand)) return false;
      if (c.oppHas && !op.battle.some((x) => this.fitLook(x, G.TextParse.lookCond(c.oppHas)))) return false;
      if (c.manaAllTapped && me.mana.some((x) => !x.tapped)) return false;
      if (c.viaDDD && !(card && card._viaDDD === this.turn)) return false;
      if (c.shieldsTotalLE != null && me.shields.length + op.shields.length > c.shieldsTotalLE) return false;
      if (c.civElemGE && me.battle.filter((x) => (this.isCreature(x) || x.def.type === 'tamaseed') && (x.def.civs || []).includes(c.civElemGE.civ)).length < c.civElemGE.n) return false;
      if (c.waveGE != null && [...me.battle, ...op.battle].filter((x) => x !== card && this.isCreature(x) && /ウェーブストライカー/.test(x.def.text || '')).length < c.waveGE) return false;
      if (c.evTwin && !(this._eventCard && this._eventCard.def.twin)) return false;
      if (c.evNotFromHand && !(this._eventCard && this._eventCard._enterFrom !== 'hand')) return false;
      if (c.spellsGE != null && (this.spellsThisTurn || [0, 0])[pi] < c.spellsGE) return false;
      if (c.anyBattleGE && this.countOwn(pi, c.anyBattleGE.what) + this.countOwn(1 - pi, c.anyBattleGE.what) < c.anyBattleGE.n) return false;
      if (c.graveTypeGE) {
        const gt = c.graveTypeGE;
        const gp = (gt.side === 'opp' ? op : me).grave.filter((x) => gt.type === 'カード' || (gt.type === '呪文' ? x.def.type === 'spell' : this.isCreatureDef(x)));
        if (gp.length < gt.n) return false;
      }
      if (c.manaLEOpp && !(me.mana.length <= op.mana.length)) return false;
      if (c.shieldsGEOpp && !(me.shields.length >= op.shields.length)) return false;
      if (c.handLEOpp && !(me.hand.length <= op.hand.length)) return false;
      if (c.countBattleMana) {
        const has = (x) => ((x.def.races || []).join('/') + x.def.name).includes(c.countBattleMana.race);
        if (me.battle.filter(has).length + me.mana.filter(has).length < c.countBattleMana.n) return false;
      }
      if (c.oppHandGE != null && op.hand.length < c.oppHandGE) return false;
      if (c.shieldAddedThisTurn && me.shieldAddedTurn !== this.turn) return false;
      if (c.shieldsLess && !(me.shields.length < op.shields.length)) return false;
      if (c.paidWithRace && !(card && (card._paidWith || []).some((m) => ((m.def.races || []).join('/') + m.def.name).includes(c.paidWithRace.replace(/(・)?クリーチャー$/, ''))))) return false;
      if (c.enteredThisTurn && !(card && card.enteredTurn === this.turn)) return false;
      if (c.manaTappedAny && !me.mana.some((x) => x.tapped)) return false;
      if (c.noSpellThisTurn && (this.spellsThisTurn || [0, 0])[pi] > 0) return false;
      if (c.graveNameHas && !me.grave.some((x) => x.def.name.includes(c.graveNameHas))) return false;
      if (c.manaFaceDownGE != null && me.mana.filter((x) => x.faceDown).length < c.manaFaceDownGE) return false;
      if (c.noAttackThisTurn && this.attackTurnMark === this.turn && ((this.attacksThisTurn || [0, 0])[0] + (this.attacksThisTurn || [0, 0])[1]) > 0) return false;
      if (c.linked && this.linkMembers(card).length < c.linked) return false;
      if (c.selfPowerGE) {
        if (this._pge) return false;
        this._pge = true;
        try {
          if (this.power(card) < c.selfPowerGE) return false;
        } finally {
          this._pge = false;
        }
      }
      if (c.distinctCosts && new Set(me.battle.map((x) => +x.def.cost || 0)).size < c.distinctCosts) return false;
      if (c.nthCreature && (this.creaturesThisTurn || [0, 0])[pi] !== c.nthCreature) return false;
      if (c.evMinCost && (+(this._eventCard?.def.cost) || 0) < c.evMinCost) return false;
      if (c.myTurnOnly && this.active !== pi) return false;
      if (c.battleCivAll && !c.battleCivAll.every((cv) => me.battle.some((x) => this.isCreature(x) && (x.def.civs || []).includes(cv)))) return false;
      if (c.firstAttack && (this.attacksThisTurn || [0, 0])[pi] !== 1) return false;
      if (c.notFirstAttack && (this.attacksThisTurn || [0, 0])[pi] <= 1) return false;
      if (c.underGE != null && !(card && (card.under || []).length >= Math.max(1, c.underGE))) return false;
      if (c.oppHandLE != null && op.hand.length > c.oppHandLE) return false;
      if (c.selfPowerGE != null && !(card && this.power(card) >= c.selfPowerGE)) return false;
      if (c.oppManaMulti && !op.mana.some((m) => (m.def.civs || []).filter((x) => x !== 'zero').length > 1)) return false;
      if (c.hasField && !me.battle.some((x) => x.def.type === 'field')) return false;
      const manaCivs = (m) => (m.faceDown ? [] : m.def.civs || []);
      if (c.manaCivGE && me.mana.filter((m) => manaCivs(m).some((x) => c.manaCivGE.civs.includes(x))).length < c.manaCivGE.n) return false;
      if (c.manaCivAll && !c.manaCivAll.every((cv) => me.mana.some((m) => manaCivs(m).includes(cv)))) return false;
      if (c.manaMultiGE != null && me.mana.filter((m) => manaCivs(m).filter((x) => x !== 'zero').length > 1).length < c.manaMultiGE) return false;
      if (c.manaOnlyCivs && !me.mana.every((m) => { const cs = manaCivs(m).filter((x) => x !== 'zero'); return cs.length ? cs.every((x) => c.manaOnlyCivs.includes(x)) : c.manaOnlyCivs.includes('zero'); })) return false;
      if (c.manaRaceGE && me.mana.filter((m) => ((m.def.races || []).join('/') + m.def.name).includes(c.manaRaceGE.what.replace(/(・)?(カード|クリーチャー)$/, ''))).length < c.manaRaceGE.n) return false;
      if (c.oppShieldsLE != null && op.shields.length > c.oppShieldsLE) return false;
      if (c.oppShieldsGE != null && op.shields.length < c.oppShieldsGE) return false;
      if (c.handGE != null && me.hand.length < c.handGE) return false;
      if (c.graveTypeGE && me.grave.filter((x) => (c.graveTypeGE.type === 'spell' ? x.def.type === 'spell' : x.def.type === 'creature')).length < c.graveTypeGE.n) return false;
      if (c.graveWhatGE && me.grave.filter((x) => this.fitLook(x, G.TextParse.lookCond(c.graveWhatGE.what))).length < c.graveWhatGE.n) return false;
      if (c.faceUpShieldHas && !me.shields.some((x) => x.faceUp && (x.def.text || '').includes(c.faceUpShieldHas))) return false;
      if (c.selfFaceUpShield && !(card && ((this.zoneOf(card) === 'shields' && card.faceUp) || (c.orBattle && this.zoneOf(card) === 'battle')))) return false;
      if (c.namesPresent && !c.namesPresent.every((n) => me.battle.some((x) => x.def.name === n || x.def.name.includes(n)))) return false;
      if (c.nameAbsent && me.battle.some((x) => x.def.name.includes(c.nameAbsent))) return false;
      if (c.oppCount && op.battle.filter((x) => this.allyMatch(x, c.oppCount.what.replace(/(・)?クリーチャー$/, ''))).length < c.oppCount.n) return false;
      if (c.selfTapped && !(card && card.tapped)) return false;
      if (c.selfUntapped && !(card && !card.tapped)) return false;
      if (c.selfEvo && !(card && (this.evoKind(card.def) || (card.under || []).length))) return false;
      if (c.selfInGrave && !(card && this.zoneOf(card) === 'grave')) return false;
      if (c.alone && me.battle.filter((x) => this.isCreature(x) && x !== card).length) return false;
      if (c.creaturesGEShields && me.battle.filter((x) => this.isCreature(x)).length < me.shields.length) return false;
      if (c.battleManaGE) {
        const w = c.battleManaGE.what;
        const hit = (x) => ((x.def.races || []).join('/') + x.def.name).includes(w);
        if (me.battle.filter(hit).length + me.mana.filter(hit).length < c.battleManaGE.n) return false;
      }
      if (c.selfAttacking && !(card && card.attacking)) return false;
      if (c.selfBlocking && !(card && card.blocking)) return false;
      if (c.equippedTapped) {
        const h = card && card.attachedTo && me.battle.find((x) => x.uid === card.attachedTo);
        if (!h || !h.tapped) return false;
      }
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
      if (c.faceUpShieldsGE != null && this.faceUpInShields(pi) < c.faceUpShieldsGE) return false;
      if (c.faceUpAllShieldsGE != null && this.faceUpInShields(0) + this.faceUpInShields(1) < c.faceUpAllShieldsGE) return false;
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
      if (byPi !== c.owner && this.permanents(c.owner).some((s2) => this.kw(s2).noDiscardByOpp)) {
        this.log(`${owner.name}の手札は相手の効果では捨てられない`);
        return;
      }
      if (parsed(c.def).kw.madness && byPi !== c.owner && (!parsed(c.def).kw.madness.turnOnly || this.active !== c.owner)) {
        if (await this.yesNo(c.owner, `「${c.def.name}」は捨てられるかわりにバトルゾーンに出せます。出しますか？`, c)) {
          this.log(`「${c.def.name}」は捨てられるかわりに出た`);
          await this.enterBattle(c, c.owner, 'other');
          return;
        }
      }
      const dtm = this.permanents(c.owner).some((s) => this.kw(s).discardToMana);
      this.moveTo(c, dtm ? 'mana' : 'grave');
      this.log(`${owner.name}は手札の「${c.def.name}」を捨てた${dtm ? '（墓地のかわりにマナへ）' : ''}`);
      for (const s of this.permanents(1 - c.owner)) if (this.isOnField(s) && this.hasAbility(s, 'oppDiscarded')) await this.trigger(s, 'oppDiscarded', s.owner, s.def, c, { defer: true });
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
      const w = String(what || '').replace(/^(バトルゾーンにある)?(、)?(自分の)?(他の)?(、)?/, '');
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
      if (/^進化(クリーチャー)?$/.test(w)) return pool.filter((c) => this.evoKind(c.def)).length;
      if (/^無色(クリーチャー)?$/.test(w)) return pool.filter((c) => !(c.def.civs || []).some((x) => x !== 'zero')).length;
      if (/^GR(クリーチャー)?$/.test(w)) return pool.filter((c) => homeZone(c.frontDef || c.def) === 'gr').length;
      if (/^サイキック(・クリーチャー)?$/.test(w)) return pool.filter((c) => homeZone(c.frontDef || c.def) === 'hyper').length;
      if (/^多色(クリーチャー)?$/.test(w)) return pool.filter((c) => (c.def.civs || []).filter((x) => x !== 'zero').length > 1).length;
      const civ = w.match(/^(光|水|闇|火|自然)の/);
      if (civ) pool = pool.filter((c) => (c.def.civs || []).includes({ 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[civ[1]]));
      const race = w
        .replace(/「.+?」を持つ/, '')
        .replace(/(タップしている|アンタップしている|(光|水|闇|火|自然)の)/g, '')
        .replace(/(・)?(クリーチャー|カード|タマシード)$/, '')
        .trim();
      if (race) {
        const alts = race.split(/または|および|か、|、/).map((x) => x.replace(/(・)?(クリーチャー|カード)$/, '').trim()).filter(Boolean);
        pool = pool.filter((c) => alts.some((r) => ((c.def.races || []).join('/') + c.def.name).includes(r)));
      }
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
      return [...pl.battle, ...pl.shields.filter((s) => s.faceUp), ...pl.shields.flatMap((s) => (s.under || []).filter((u) => u.faceUp))];
    }
    // その手番プレイヤー pi にとっての「次の pi のターン」
    nextTurnOf(pi) {
      return this.active === pi ? this.turn + 2 : this.turn + 1;
    }
    manual(card, def = card.def) {
      return parsed(def).manual;
    }
    civMatch(card, cv) {
      const cs = (card.def.civs || []).filter((x) => x !== 'zero');
      return cv === 'multi' ? cs.length >= 2 : cs.includes(cv);
    }
    isCreatureDef(card) {
      return !NON_CREATURE.includes(card.def.type) && !attachKind(card.def);
    }
    isCreature(card) {
      if (card.def.type === 'tamaseed') {
        const ci = parsed(card.def).kw.creatureIf;
        if (!ci || card.def.power == null || this.zoneOf(card) !== 'battle') return false;
        const n = this.p[card.owner].battle.filter((x) => (x.def.type === 'tamaseed' || !NON_CREATURE.includes(x.def.type)) && (x.def.civs || []).includes(ci.civ)).length;
        return n >= ci.n;
      }
      return !NON_CREATURE.includes(card.def.type) && !isDragheartItem(card.def) && !attachKind(card.def);
    }
    // G・リンク：同じグループの自分のカード
    linkMembers(card) {
      if (!card || !card.linkGroup || this.zoneOf(card) !== 'battle') return card ? [card] : [];
      const m = this.p[card.owner].battle.filter((x) => x.linkGroup === card.linkGroup);
      return m.length >= 2 ? m : [card];
    }
    async tryLink(card, pi) {
      const gl = parsed(card.def).kw.gLink;
      if (!gl) return;
      const okSide = { L: ['C', 'R'], R: ['C', 'L'], C: ['L', 'R'] };
      const pool = this.p[pi].battle.filter((x) => {
        if (x === card || !this.isCreature(x)) return false;
        const grp = this.linkMembers(x);
        if (grp.length >= 3) return false;
        if (gl.side) {
          const xs = parsed(x.def).kw.gLink?.side;
          return !!xs && okSide[gl.side].includes(xs) && !grp.some((g) => parsed(g.def).kw.gLink?.side === gl.side);
        }
        return (gl.names || []).some((n) => x.def.name.includes(n));
      });
      if (!pool.length) return;
      const r = await this.pickCards(pi, pool, 1, true, `「${card.def.name}」: リンクするゴッド（選ばなければリンクしない）`, 'recover');
      if (!r.length) return;
      const g = r[0].linkGroup || (r[0].linkGroup = 'L' + card.uid);
      card.linkGroup = g;
      const mem = this.linkMembers(card);
      card.tapped = mem.some((x) => x !== card && x.tapped);
      card.sick = mem.filter((x) => x !== card).every((x) => x.sick);
      this.log(`G・リンク：${mem.map((x) => '「' + x.def.name + '」').join('と')}がリンクして1体のクリーチャーになった`);
      for (const x of mem) if (this.hasAbility(x, 'linked')) await this.trigger(x, 'linked', pi, x.def, null, { defer: true });
    }

    power(card) {
      if (card.def.power == null || !this.isCreature(card)) return 0;
      if (card.linkGroup && !this._linkPow) {
        const mem = this.linkMembers(card);
        if (mem.length > 1) {
          this._linkPow = true;
          try {
            return mem.reduce((t, x) => t + this.power(x), 0);
          } finally {
            this._linkPow = false;
          }
        }
      }
      const hp = card.hyper && parsed(card.def).kw.hyperPower;
      let extra = this.powerExtra(card);
      const meP = this.p[card.owner];
      for (const tp of meP.tempPowers || []) if (tp.until >= this.turn && tp.except !== card.uid) extra += tp.n;
      for (const tg of meP.tempGrants || []) if (tg.power && tg.until >= this.turn && (!tg.uids || tg.uids.includes(card.uid))) extra += tg.power;
      const kb = parsed(card.def).kw;
      if (kb.aloneBuff && meP.battle.filter((c) => this.isCreature(c)).length === 1) extra += kb.aloneBuff;
      if (kb.selfBuff) extra += kb.selfBuff.n;
      for (const cgr of kb.condGrants || []) if (cgr.power && this.condOk2(card.owner, cgr.cond, card)) extra += cgr.power;
      for (const cp of kb.condPowerPers || []) {
        if (!this.condOk2(card.owner, cp.cond, card)) continue;
        const zone = this.p[card.owner][cp.zone];
        const cd = cp.what && !/^カード$/.test(cp.what) ? G.TextParse.lookCond(cp.what.replace(/(・)?カード$/, '')) : null;
        extra += Math.floor(zone.filter((x) => !cd || this.fitLook(x, cd)).length / cp.per) * cp.n;
      }
      for (const src of this.p[card.owner].battle) {
        const tp = this.kwSelf(src).teamPower;
        if (!tp || (tp.others && src === card)) continue;
        if (tp.oppTurnOnly && this.active === card.owner) continue;
        if (tp.who && !((card.def.races || []).join('/') + card.def.name).includes(tp.who.replace(/(・)?クリーチャー$/, ''))) continue;
        extra += tp.n;
      }
      for (const src of this.p[card.owner].battle) {
        for (const tp of this.kwSelf(src).teamPowers || []) {
          if (tp.others && src === card) continue;
          if (tp.civ && !(card.def.civs || []).includes(tp.civ)) continue;
          if (tp.who && !((card.def.races || []).join('/') + card.def.name).includes(tp.who)) continue;
          extra += tp.n;
        }
      }
      for (const x of this.p[card.owner].battle) {
        if (x.attachedTo !== card.uid) continue;
        const hb = parsed(x.def).kw.hostBuff;
        if (hb && hb.power) extra += hb.power;
        if (attachKind(x.def) === 'aura') extra += +x.def.power || 0;
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
      const pc = parsed(card.def).kw.powerPerCiv;
      const pcv = pc ? Math.floor([...this.p[0].battle, ...this.p[1].battle].filter((c) => c !== card && this.isCreature(c) && (c.def.civs || []).some((x) => pc.civs.includes(x))).length / pc.per) * pc.n : 0;
      const pps = parsed(card.def).kw.powerPerShield;
      const psv = pps ? Math.floor(this.p[card.owner].shields.length / pps.per) * pps.n : 0;
      const ppt = parsed(card.def).kw.powerPerMyTurn;
      const ptv = ppt && this.active === card.owner ? Math.floor(this.p[card.owner].battle.filter((c) => (!ppt.others || c !== card) && ((c.def.races || []).join('/') + c.def.name).includes(ppt.who.replace(/(・)?(クリーチャー|カード)$/, ''))).length / ppt.per) * ppt.n : 0;
      const pohs = parsed(card.def).kw.powerPerOppHandSpell;
      const pohv = pohs ? Math.floor(this.p[1 - card.owner].hand.filter((c) => c.def.type === 'spell').length / pohs.per) * pohs.n : 0;
      const spw = this.kwBase(card).soulPower || 0;
      const hun = card.inBattle && this.kwBase(card).hunting ? this.p[card.owner].battle.filter((x) => this.isCreature(x) && ((x.def.races || []).join('/')).includes('ハンター')).length * this.kwBase(card).hunting : 0;
      const pph = parsed(card.def).kw.powerPerHand;
      const pphv = pph && (!pph.oppTurn || this.active !== card.owner) ? Math.floor(this.p[pph.opp ? 1 - card.owner : card.owner].hand.length / pph.per) * pph.n : 0;
      let aura = pohv + pphv + spw + hun;
      for (const s2 of this.p[1 - card.owner].battle) if (this.isOnField(s2)) aura += parsed(s2.def).kw.oppPowerAura || 0;
      return pcv + psv + ptv + aura + this.powerExtra3(card);
    }
    powerExtra3(card) {
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
      // シールドの上に重ねて置かれたカード（裁きの紋章など）は、シールドゾーンにある扱い
      for (const pl of this.p) {
        for (const sh of pl.shields) {
          const i = (sh.under || []).findIndex((c) => c.uid === uid);
          if (i >= 0) return { card: sh.under[i], zone: 'shields', player: pl, index: i, arr: sh.under, host: sh };
        }
      }
      return null;
    }
    // シールドゾーンにある表向きのカードの数（束に重なったものも数える）
    faceUpInShields(pi) {
      const sh = this.p[pi].shields;
      return sh.filter((s) => s.faceUp).length + sh.reduce((t, s) => t + (s.under || []).filter((u) => u.faceUp).length, 0);
    }
    isSabakiCrest(card) {
      return (card.def.races || []).some((r) => /^裁きの紋章/.test(r));
    }
    // サバキZ：裁きの紋章がシールドゾーンから手札に加わったら、それを捨ててサバキZの呪文を唱えてよい
    async sabakiZ(pi) {
      const came = (this._stackToHand || []).filter((c) => c.owner === pi && this.zoneOf(c) === 'hand' && this.isSabakiCrest(c));
      this._stackToHand = (this._stackToHand || []).filter((c) => c.owner !== pi);
      for (const crest of came) {
        const zs = this.p[pi].hand.filter((c) => c !== crest && parsed(c.def).kw.sabakiZ && !this.locked(pi, c.def));
        if (!zs.length || this.zoneOf(crest) !== 'hand') continue;
        const r = await this.pickCards(pi, zs, 1, true, `サバキZ：「${crest.def.name}」を捨てて、コストを支払わずに唱える呪文`, 'recover');
        if (!r.length) continue;
        await this.discardCard(crest, pi);
        this.log(`サバキZ：「${crest.def.name}」を捨てて「${r[0].def.name}」を唱える`);
        await this.putIntoPlay(pi, r[0], true);
      }
    }
    // カードを自分（owner）のシールド1つの上に表向きで重ねる
    async stackOnShield(card, chooser = card.owner) {
      const pl = this.p[card.owner];
      if (!pl.shields.length) {
        this.log(`${pl.name}にシールドがないので、「${card.def.name}」はシールドの上に置けない`);
        return;
      }
      const host = (pl.isAI && chooser === card.owner ? pl.shields[pl.shields.length - 1] : (await this.pickCards(chooser, pl.shields, 1, false, `「${card.def.name}」を上に重ねるシールド`, 'shield'))[0]) || pl.shields[pl.shields.length - 1];
      const f = this.find(card.uid);
      if (f) (f.arr || f.player[f.zone]).splice(f.index, 1);
      card.tapped = false;
      card.under = null;
      card.faceUp = true;
      host.under = host.under || [];
      host.under.push(card);
      this.log(`「${card.def.name}」を${pl.name}のシールドの上に表向きで置いた（シールドの束は1つと数える）`);
    }

    zoneOf(card) {
      const f = this.find(card.uid);
      return f ? f.zone : null;
    }

    // カードを owner の指定ゾーンへ移す（ルール無視の基本操作）
    moveTo(card, zone, o) {
      o = o || {};
      // サイキック・ドラグハートは超次元ゾーンへ、GRクリーチャーは超GRの下へ戻る
      const home = homeZone(card.frontDef || card.def);
      if (card.frontDef && zone !== 'battle') this.unflip(card);
      if (home && zone !== 'battle' && zone !== home) {
        if (zone !== home) this.log(`「${card.def.name}」は${home === 'hyper' ? '超次元ゾーン' : '超GRの下'}に戻った`);
        zone = home;
        o = { ...o, top: home === 'hyper' };
        card.flipped = false;
      }
      const top = o.top !== false;
      let tapped = !!o.tapped;
      const f = this.find(card.uid);
      if (f) (f.arr || f.player[f.zone]).splice(f.index, 1);
      const from = f ? f.zone : card._fromUnder ? 'under' : null;
      const fromUnder = !!card._fromUnder;
      delete card._fromUnder;
      if (zone === 'grave') card._wasUnderOnGrave = fromUnder;
      const owner = this.p[card.owner];
      if (from === 'mana' && zone !== 'mana') delete card.faceDown;
      if (zone === 'mana' && tapped && this.p[card.owner].battle.some((s) => { const w = this.kwBase(s).manaUntapWho; return w && w.split(/・カードまたは|カードまたは|または/).some((x) => ((card.def.races || []).join('/') + card.def.name).includes(x)); })) tapped = false;
      if (zone === 'mana' && this.started && this.permanents(1 - card.owner).some((s) => this.kwBase(s).oppManaTapped)) tapped = true;
      let fmDraw = false;
      if (zone === 'mana' && this.started && (card.def.civs || []).filter((x) => x !== 'zero').length >= 2) {
        const own = this.p[card.owner];
        if (own.multiManaTurn !== this.turn) {
          own.multiManaTurn = this.turn;
          const fm = own.battle.map((s) => this.kwBase(s).firstMultiUntap).find(Boolean);
          if (fm) {
            tapped = false;
            fmDraw = fm.draw;
            this._fmLog = `「${card.def.name}」は今ターン最初の多色マナなのでアンタップで置かれた`;
          }
        }
      }
      if (zone !== 'battle' || from !== 'battle') {
        card.tapped = tapped;
        card.tempPower = 0;
        card.attacking = false;
        card.sick = false;
      }
      if (from === 'shields' && zone !== 'shields' && !(f && f.arr) && (card.under || []).length) {
        const stack = card.under.splice(0);
        card.under = null;
        const dest = zone === 'battle' ? 'hand' : zone;
        for (const u of stack) {
          u.faceUp = false;
          (dest === 'deck' ? owner.deck : this.p[u.owner][dest]).push(u);
          if (dest === 'hand') this._stackToHand = (this._stackToHand || []).concat(u);
        }
        this.log(`シールドの束に重なっていた${stack.map((u) => '「' + u.def.name + '」').join('')}も${{ hand: '手札', grave: '墓地', mana: 'マナゾーン', deck: '山札' }[dest] || dest}へ`);
      }
      if (from === 'shields' && zone !== 'shields' && this.started) {
        // EXライフのシールドが離れた
        for (const pl2 of this.p) for (const bc of pl2.battle) {
          if (bc.exLife === card.uid) bc.exLife = null;
          else if ((bc.exLifes || []).includes(card.uid)) bc.exLifes = bc.exLifes.filter((u) => u !== card.uid);
          else continue;
          if (!this._exLifeByLeave && this.hasAbility(bc, 'exLifeLost')) {
            this.pending = this.pending || [];
            this.pending.push({ card: bc, when: 'exLifeLost', controller: bc.owner, def: bc.def, label: `【${pl2.name}】「${bc.def.name}」のEXライフシールドが離れた時の能力` });
          }
        }
      }
      if (from === 'shields' && zone !== 'shields' && card.faceUp && this.started && this.hasAbility(card, 'selfShieldLeft')) {
        this.pending = this.pending || [];
        this.pending.push({ card, when: 'selfShieldLeft', controller: card.owner, def: card.def, label: `【${this.p[card.owner].name}】「${card.def.name}」がシールドゾーンを離れた時の能力` });
      }
      if (from === 'shields' && zone !== 'shields') {
        if (zone === 'hand' && this.isSabakiCrest(card)) this._stackToHand = (this._stackToHand || []).concat(card);
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
        for (const k of ['linkGroup', 'vividTurn', 'seals', 'exLife', 'exLifes', 'forceShield', 'noLeaveUntil', 'frozenUntil', 'noAttackTurn', 'modesUsed', 'flipped', 'usedTurn', 'ignoreName', 'hyper', 'hyperUntil', 'jdUntil', 'returnAtEnd', 'badEnd', 'spellShieldUntil', 'blocking', 'protectUntil', 'allyUsed', 'winAllUntil', 'firstAttackDone', 'lockedUntil', 'unblockableTurn', 'noDestroyUntil', 'abUsed', 'mustAttackUntil']) delete card[k];
      }
      if (from === 'grave' && zone !== 'grave' && this.started) {
        for (const s of this.permanents(card.owner)) if (this.isOnField(s) && this.hasAbility(s, 'graveLeft')) {
          this.pending = this.pending || [];
          this.pending.push({ card: s, when: 'graveLeft', controller: s.owner, def: s.def, extra: card, label: `「${s.def.name}」のカードが墓地から離れた時の能力` });
        }
      }
      if (zone === 'grave') {
        this.graveThisTurn = true;
        if (from !== 'grave' && this.started) for (const s of this.permanents(card.owner)) if (s !== card && this.isOnField(s) && this.hasAbility(s, 'ownToGrave')) {
          this.pending = this.pending || [];
          this.pending.push({ card: s, when: 'ownToGrave', controller: s.owner, def: s.def, extra: card, label: `【${this.p[s.owner].name}】「${s.def.name}」の、カードが墓地に置かれた時の能力` });
        }
        if (from !== 'grave' && this.started) for (const s of this.permanents(1 - card.owner)) if (this.isOnField(s) && this.hasAbility(s, 'oppToGrave')) {
          this.pending = this.pending || [];
          this.pending.push({ card: s, when: 'oppToGrave', controller: s.owner, def: s.def, extra: card, label: `【${this.p[s.owner].name}】「${s.def.name}」の、カードが相手の墓地に置かれた時の能力` });
        }
        // 「墓地に置かれた時」の能力
        if (from && from !== 'grave' && this.started && this.hasAbility(card, 'toGrave')) {
          this.pending = this.pending || [];
          this.pending.push({ card, when: 'toGrave', controller: card.owner, def: card.def, label: `「${card.def.name}」の墓地に置かれた時の能力` });
        }
      }
      if (zone === 'deck' && top) owner.deck.unshift(card);
      else owner[zone].push(card);
      if (zone === 'mana' && from !== 'mana' && this.started) {
        // スペース・チャージ（自分のマナゾーンにカードが置かれた時）
        for (const s of this.p[card.owner].battle) if (this.isOnField(s) && this.hasAbility(s, 'manaPut') && this.abilities(s).some((ab) => ab.when === 'manaPut' && (!ab.cond || !ab.cond.evCivAny || ab.cond.evCivAny.some((cv) => this.civMatch(card, cv))))) {
          this.pending = this.pending || [];
          this.pending.push({ card: s, when: 'manaPut', controller: s.owner, def: s.def, extra: card, label: `【${this.p[s.owner].name}】「${s.def.name}」の、マナゾーンにカードが置かれた時の能力（「${card.def.name}」）` });
        }
      }
      if (zone === 'battle' && from !== 'battle') {
        card.sick = !this.kw(card).speedAttacker;
        card.enteredTurn = this.turn;
        if (this.kw(card).enterTapped) card.tapped = true;
        if (card._enterTappedOnce) {
          card.tapped = true;
          delete card._enterTappedOnce;
        }
        if (this.isCreature(card) && [0, 1].some((q) => this.permanents(q).some((s) => {
          const et = s !== card && this.kw(s).enterTappedAura;
          if (!et) return false;
          if (et.opp && q === card.owner) return false;
          if (et.exceptCiv && (card.def.civs || []).includes(et.exceptCiv)) return false;
          if (et.onlyCivs && !(card.def.civs || []).some((x) => et.onlyCivs.includes(x))) return false;
          if (et.lessThanMana && (+card.def.cost || 0) >= this.p[q].mana.length) return false;
          return true;
        }))) card.tapped = true;
      }
      if (this._fmLog) {
        const m = this._fmLog;
        this._fmLog = null;
        this.log(m);
        if (fmDraw) this.draw(card.owner, 1);
      }
      return from;
    }

    checkState() {
      if (this.winner != null) return;
      // 「条件を満たせば自分はゲームに勝つ」
      if (this.started) for (const pl of this.p) {
        const w = this.permanents(pl.idx).find((s) => this.kw(s).winStatic);
        if (w && !this.cantLose(1 - pl.idx)) {
          this.winner = pl.idx;
          this.endReason = `「${w.def.name}」の効果`;
        }
      }
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
      if (this.permanents(pi).some((s) => this.kw(s).noLoseStatic)) return true;
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
      if (cd.unknown) return false;
      if (cd.nameIs) return c.def.name === cd.nameIs || c.def.name.replace(/\s/g, '') === cd.nameIs.replace(/\s/g, '');
      if (cd.any) return cd.any.some((x) => this.fitLook(c, x));
      if (cd.evoOnly && !this.evoKind(c.def)) return false;
      if (cd.notGR && homeZone(c.frontDef || c.def) === 'gr') return false;
      if (cd.race === 'サイキック') return homeZone(c.frontDef || c.def) === 'hyper' && (!cd.types || !cd.types.includes('creature') || !NON_CREATURE.includes(c.def.type));
      if (cd.notPsychic && homeZone(c.frontDef || c.def) === 'hyper') return false;
      if (cd.twinpact && !(c.def.twin && c.def.twin.type === 'spell')) return false;
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
        (!cd.nameNot || c.def.name !== cd.nameNot) &&
        (!cd.colorless || !(c.def.civs || []).some((x) => x !== 'zero'))
      );
    }
    // 効果の前後で盤面が変わったか（「そうしたら」の判定用）
    stateSig() {
      return this.p.map((pl) => ['hand', 'mana', 'battle', 'grave', 'shields', 'deck'].map((z) => pl[z].length).join(',') + ':' + [...pl.battle, ...pl.mana].filter((c) => c.tapped).length + ':' + pl.battle.reduce((s, c) => s + (c.under || []).length, 0)).join('|') + '#' + (this.showCount || 0);
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
        for (const pl of [a, b]) {
          shuffle(pl.deck, this.rng);
          shuffle(pl.gr, this.rng);
        }
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
          if (!me.isAI) for (const c of me.battle) if (this.isCreature(c) && this.mustAttack(c) && this.attackTargets(c).length) this.log(`【注意】「${c.def.name}」は可能なら攻撃しなければならない（まだ攻撃できる）`);
          for (const c of this.permanents(this.active)) if (this.isOnField(c)) await this.trigger(c, 'turnEnd', c.owner, c.def, null, { defer: true });
          await this.fireGrave(this.active, 'turnEnd');
          for (const q of [this.active, 1 - this.active]) for (const c of this.permanents(q)) if (this.isOnField(c)) {
            if (this.hasAbility(c, 'eachTurnEnd')) await this.trigger(c, 'eachTurnEnd', c.owner, c.def, null, { defer: true });
            if (q !== this.active && this.hasAbility(c, 'oppTurnEnd')) await this.trigger(c, 'oppTurnEnd', c.owner, c.def, null, { defer: true });
          }
          await this.resolvePending();
          for (const q of [this.active, 1 - this.active]) await this.mugetsuCheck(q, 'end');
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
      for (const c of me.battle.slice()) {
        if (c.tapped && this.kw(c).silentSkill && this.isCreature(c) && this.abilities(c).some((ab) => ab.when === 'silentSkill') && !((c.frozenUntil || 0) >= this.turn) && (await this.yesNo(this.active, `サイレントスキル：「${c.def.name}」をアンタップするかわりに能力を使いますか？`, c))) {
          c.sick = false;
          this.log(`サイレントスキル：「${c.def.name}」はアンタップせずに能力を使う`);
          for (const ab of this.abilities(c)) if (ab.when === 'silentSkill') for (const a2 of ab.acts) await this.doAction(a2, c, this.active);
          continue;
        }
        if (!this.kw(c).noUntap && !((c.frozenUntil || 0) >= this.turn)) {
          if (c.tapped) untappedNow.push(c), (c.untappedTurn = this.turn);
          c.tapped = false;
        }
        c.sick = false;
      }
      this.untappedNow = untappedNow;
      for (const c of this.permanents(this.active)) {
        if (this.isOnField(c)) await this.trigger(c, 'turnStart', c.owner, c.def, null, { defer: true });
      }
      await this.fireGrave(this.active, 'turnStart');
      // 「次の自分のターンのはじめに〜」
      const nsa = (me.nextStartActs || []).filter((x) => x.turn <= this.turn);
      me.nextStartActs = (me.nextStartActs || []).filter((x) => x.turn > this.turn);
      for (const ns of nsa) {
        const nsrc = ns.src;
        await this.queueFn(nsrc, this.active, `「${nsrc.def.name}」の次のターンのはじめの効果`, async () => {
          for (const x of ns.acts) await this.doAction(x, nsrc, this.active);
        }, { defer: true });
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
      for (const ea of [...(me.endTurnActs || []), ...(this.p[1 - this.active].endTurnActs || [])].filter((x) => x.turn === this.turn)) {
        const f = this.find(ea.uid);
        if (ea.to === 'reviveFromGrave') {
          if (f && this.zoneOf(f.card) === 'grave') {
            this.log(`ターンの終わり：「${f.card.def.name}」を墓地から出す`);
            await this.enterBattle(f.card, this.active, 'other');
          }
          continue;
        }
        if (!f || this.zoneOf(f.card) !== 'battle') continue;
        if (ea.to === 'untap') {
          f.card.tapped = false;
          this.log(`ターンの終わり：「${f.card.def.name}」をアンタップした`);
          continue;
        }
        if (ea.to === 'destroy') await this.destroyMany([f.card], { byOpp: false });
        else if (ea.to === 'deckBottom') await this.leave(f.card, 'deck', { moveOpt: { top: false } });
        else await this.leave(f.card, ea.to);
        this.log(`ターンの終わり：「${f.card.def.name}」を${{ destroy: '破壊した', hand: '手札に戻した', deckBottom: '山札の下に置いた', mana: 'マナゾーンに置いた' }[ea.to]}`);
      }
      for (const pl of this.p) pl.endTurnActs = (pl.endTurnActs || []).filter((x) => x.turn !== this.turn);
      for (const pl of this.p) {
        const fns = (pl.endTurnFns || []).filter((x) => x.turn === this.turn);
        pl.endTurnFns = (pl.endTurnFns || []).filter((x) => x.turn !== this.turn);
        for (const ef of fns) {
          this.log(`ターンの終わり：「${ef.src.def.name}」の効果`);
          for (const x of ef.acts) await this.doAction(x, ef.src, ef.pi);
        }
      }
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
      let drawn = 0;
      for (let i = 0; i < n; i++) {
        if (!pl.deck.length) break;
        const dc = pl.deck[0];
        this.moveTo(dc, 'hand');
        drawn++;
        if (pl.drawTurnMark !== this.turn) (pl.drawTurnMark = this.turn), (pl.drawsThisTurn = 0);
        pl.drawsThisTurn++;
        // ビビッドロー：自分のターンの攻撃前に引いたら、表向きにしてもよい
        if (this.started && parsed(dc.def).kw.vivid && this.active === pi && !(this.attackTurnMark === this.turn && (this.attacksThisTurn || [0, 0])[pi] > 0)) {
          this.pending = this.pending || [];
          this.pending.push({
            card: dc,
            controller: pi,
            label: `【${pl.name}】「${dc.def.name}」のビビッドロー（表向きにするか）`,
            fn: async () => {
              if (this.zoneOf(dc) !== 'hand') return;
              if (!(await this.yesNo(pi, `ビビッドロー：引いた「${dc.def.name}」を表向きにしますか？（このターン、軽いコストで使えます）`, dc))) return;
              dc.vividTurn = this.turn;
              this.log(`${pl.name}は引いた「${dc.def.name}」を表向きにした（ビビッドロー）`);
            },
          });
        }
      }
      // 「自分がカードを引いた時」：引いた枚数だけ待機する
      if (drawn && this.started) for (const s of this.permanents(pi)) if (this.isOnField(s) && this.hasAbility(s, 'selfDraw')) {
        this.pending = this.pending || [];
        for (let i = 0; i < drawn; i++) this.pending.push({ card: s, when: 'selfDraw', controller: pi, def: s.def, label: `【${pl.name}】「${s.def.name}」のカードを引いた時の能力` });
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
      const multi = ((f.card.def.civs || []).length > 1 || !!parsed(f.card.def).kw.manaTapped) && !parsed(f.card.def).kw.chargeUntapped;
      this.moveTo(f.card, 'mana', { tapped: multi });
      this.manaCharged = true;
      this.log(`${this.p[pi].name}は「${f.card.def.name}」をマナに置いた`);
      const crv = parsed(f.card.def).kw.chargeReveal;
      if (crv && f.card.tapped) {
        const pool = this.p[pi].hand.filter((c) => (crv === '多色' ? (c.def.civs || []).filter((x) => x !== 'zero').length >= 2 : ((c.def.races || []).join('/') + c.def.name).includes(crv)));
        if (pool.length) {
          const r = await this.pickCards(pi, pool, 1, true, `「${f.card.def.name}」: 見せる${crv}カード（見せればアンタップ）`, 'recover');
          if (r.length) {
            f.card.tapped = false;
            this.log(`${this.p[pi].name}は「${r[0].def.name}」を見せて「${f.card.def.name}」をアンタップした`);
          }
        }
      }
      if (this.hasAbility(f.card, 'charged')) await this.trigger(f.card, 'charged', pi);
      this.changed();
      return true;
    }

    // コスト（軽減込み）と、支払った時に起きること
    costPlan(pi, card, def = card.def, sasSrc = null, bad = false) {
      let cost = +def.cost || 0;
      const mb = parsed(def).kw.manaBirth;
      if (mb != null && card && card._mbPlay && def === card.def) cost = mb;
      const rcy = parsed(def).kw.recycle;
      if (rcy && card && def === card.def && (this.zoneOf(card) === 'grave' || card._recyc)) cost = rcy.cost;
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
      if (k.sympathy && /シールドゾーンにある表向き/.test(k.sympathy)) cost -= this.faceUpInShields(pi) * (k.sympathyMul || 1);
      else if (k.sympathy) {
        const w = k.sympathy.replace(/^自分の/, '');
        const n = me.battle.filter((c) => this.isCreature(c) && (w === 'クリーチャー' || ((c.def.races || []).join('/') + c.def.name).includes(w))).length;
        cost -= n * (k.sympathyMul || 1);
      }
      if (def.type === 'spell') for (const src of this.permanents(1 - pi)) {
        cost += this.kw(src).spellTax || 0;
        const stp = this.kw(src).spellTaxPer;
        if (stp) cost += Math.floor(this.p[1 - pi].battle.filter((c) => c !== src && this.isCreature(c)).length / stp.per) * stp.n;
      }
      // 場にある間コストを増減する能力
      for (const q of [pi, 1 - pi]) for (const src of this.permanents(q)) {
        for (const au of this.kw(src).costAura || []) {
          if ((au.side === 'self') !== (q === pi)) continue;
          if (au.once && src.discUsed === this.turn) continue;
          if (au.needFaceUp && !this.faceUpInShields(q)) continue;
          if (this.sc(src) && this.sc(src).costMod) continue; // カード個別の処理を優先
          if (this.costAuraFits(au, def)) {
            cost += au.n;
            if (au.once) uses.push(() => (src.discUsed = this.turn));
          }
        }
      }
      if (k.costIfCount && this.countOwn(pi, k.costIfCount.what) >= k.costIfCount.n) cost -= k.costIfCount.minus;
      for (const sc2 of k.selfCostIf || []) if (this.condOk2(pi, sc2.cond, card)) cost -= sc2.n;
      if (k.costPerShield) cost += Math.floor(me.shields.length / k.costPerShield.per) * k.costPerShield.n;
      if (def.type === 'spell') {
        for (const q of [0, 1]) for (const src of this.permanents(q)) {
          const gt = this.kw(src).globalSpellTax;
          if (gt && !(def.civs || []).includes(gt.exceptCiv)) cost += gt.n;
        }
      }
      if (this.pendingEvoBase && this.zoneOf(this.pendingEvoBase) === 'battle') {
        const ebd = this.kw(this.pendingEvoBase).evoBaseDiscount;
        if (ebd && (!ebd.cond || this.fitLook({ def }, G.TextParse.lookCond(ebd.cond + 'クリーチャー')))) cost -= ebd.n;
      }
      if (k.tamaEvoDiscount && this.pendingEvoBase && this.pendingEvoBase.def.type === 'tamaseed') cost -= k.tamaEvoDiscount;
      if (k.costPer) {
        const pl = k.costPer.side === 'opp' ? this.p[1 - pi] : me;
        const w = k.costPer.what.replace(/^(自分の|相手の)/, '');
        const cnt = k.costPer.spellName ? pl.grave.filter((c) => c.def.type === 'spell' && c.def.name.includes(k.costPer.what)).length : pl[k.costPer.zone || 'battle'].filter((c) => (k.costPer.zone === 'mana' || k.costPer.zone === 'grave' ? !NON_CREATURE.includes(c.def.type) : this.isCreature(c)) && (!w || w === 'クリーチャー' || ((c.def.races || []).join('/') + c.def.name).includes(w.replace(/クリーチャー$/, '')))).length;
        cost -= Math.floor(cnt / k.costPer.per) * k.costPer.n;
      }
      if (k.handSummonTax && this.zoneOf(card) === 'hand' && !NON_CREATURE.includes(def.type)) cost += k.handSummonTax;
      if (k.costPerSmallElem) cost -= me.battle.filter((x) => x !== card && (+x.def.cost || 0) <= k.costPerSmallElem.maxCost && !x.attachedTo).length * k.costPerSmallElem.n;
      if (k.costPerUntapped) {
        const cnt = [...me.battle, ...this.p[1 - pi].battle].filter((x) => this.isCreature(x) && x.untappedTurn === this.turn).length;
        cost -= cnt * k.costPerUntapped;
      }
      if (k.costPer2) {
        const c2 = k.costPer2;
        const op2 = this.p[1 - pi];
        const pool = c2.where === 'allGrave' ? [...me.grave, ...op2.grave] : c2.where === 'grave' ? me.grave : c2.where === 'allBattle' ? [...me.battle, ...op2.battle] : c2.where === 'oppMana' ? op2.mana : c2.where === 'hand' ? me.hand.filter((x) => x !== card) : me.mana;
        const cnt = pool.filter((x) => c2.type === 'カード' || (c2.type === '呪文' ? x.def.type === 'spell' || (x.def.twin && x.def.twin.type === 'spell') : c2.where === 'allBattle' ? this.isCreature(x) : this.isCreatureDef(x))).length;
        cost -= Math.floor(cnt / c2.per) * c2.n;
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
      if (me.nextSummonDiscount && me.nextSummonDiscount.turn === this.turn && (!me.nextSummonDiscount.creatureOnly || !NON_CREATURE.includes(def.type)) && (me.nextSummonDiscount.anyType || !NON_CREATURE.includes(def.type)) && (!me.nextSummonDiscount.spellOnly || def.type === 'spell') && (!me.nextSummonDiscount.civ || (def.civs || []).includes(me.nextSummonDiscount.civ))) {
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
      if (this.permanents(1 - pi).some((s2) => this.kw(s2).oppNoDiscount)) cost = Math.max(cost, base);
      // 手札が多ければターンに1度タダ（アルケミック・プラチナムなど）
      if (card && this.zoneOf(card) === 'hand' && this.active === pi) {
        const fs = this.permanents(pi).find((s) => { const f = this.kw(s).freeIfHand; return f && s.fihTurn !== this.turn && me.hand.length >= f.n && (!f.civ || (def.civs || []).includes(f.civ)); });
        if (fs) {
          cost = 0;
          uses.push(() => (fs.fihTurn = this.turn));
        }
      }
      // G・ゼロ：条件を満たせばコスト0
      if (k.gZero && (k.gZeroCond ? this.condOk2(pi, k.gZeroCond, card) : this.gZeroOk(pi, k.gZero))) cost = 0;
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
      if (au.evoOnly && !(parsed(def).kw.evolution || def.evolution)) return false;
      if (au.nameHas && !String(def.name).includes(au.nameHas)) return false;
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
      // ムゲンクライムN：自分のクリーチャーをN体タップし、指定のコストを払って、手札か墓地から召喚する
      const mgc = parsed(def).kw.mugenClimb;
      if (mgc && def === card.def && ['hand', 'grave'].includes(this.zoneOf(card))) {
        const tappers = this.p[pi].battle.filter((c) => this.isCreature(c) && !c.tapped);
        const mana = tappers.length >= mgc.n && this.payWith(pi, { civs: mgc.civs }, mgc.cost);
        if (mana) out.push({ mana, mugen: true, uses: [async () => {
          const pool = this.p[pi].battle.filter((c) => this.isCreature(c) && !c.tapped);
          const r = this.p[pi].isAI ? pool.slice(0, mgc.n) : await this.pickCards(pi, pool, mgc.n, false, `ムゲンクライム：タップするクリーチャーを${mgc.n}体選んでください`, 'recover');
          for (const c of r) c.tapped = true;
          for (const s2 of this.permanents(pi)) if (this.isOnField(s2) && this.hasAbility(s2, 'mugenTapped')) for (const c of r) if (c === s2) await this.trigger(s2, 'mugenTapped', pi, s2.def, null, { defer: true });
          this.log(`ムゲンクライム：クリーチャー${r.length}体をタップした`);
        }], cost: mgc.cost, opt: { text: `ムゲンクライム（${mgc.n}体タップ＋コスト${mgc.cost}）` } });
      }
      // フシギバース：自分のクリーチャーを1体タップしてマナに置き、そのコストを引いた数を払って墓地から召喚
      const fsg = parsed(def).kw.fushigi;
      if (fsg && def === card.def && this.zoneOf(card) === 'grave') {
        const seen = new Set();
        for (const fc of this.p[pi].battle.filter((c) => this.isCreature(c)).sort((x, y) => (+y.def.cost || 0) - (+x.def.cost || 0))) {
          const cst = Math.max(fsg.min, fsg.n - (+fc.def.cost || 0));
          if (seen.has(cst)) continue;
          seen.add(cst);
          const mana = this.payWith(pi, { civs: fsg.civs }, cst);
          if (mana) out.push({ mana, mugen: true, uses: [async () => {
            this.log(`フシギバース：「${fc.def.name}」をタップしてマナゾーンに置いた`);
            fc.tapped = true;
            await this.leave(fc, 'mana', { byOpp: false });
          }], cost: cst, opt: { text: `フシギバース（「${fc.def.name}」をマナに置いてコスト${cst}）` } });
        }
      }
      // ギャラクシールド：代わりのコストを払って、表向きのシールドとして置く
      const gxs = parsed(def).kw.galaxy;
      if (gxs && def === card.def && this.zoneOf(card) === 'hand') {
        const mana = this.payWith(pi, { civs: gxs.civs }, gxs.cost);
        if (mana) out.push({ mana, uses: [() => (card._galaxy = true)], cost: gxs.cost, opt: { text: `ギャラクシールド（コスト${gxs.cost}で表向きのシールドに）` } });
      }
      // 無月の大罪N：コストをN少なくしてもよい。そうしたら、このターンの終わりに自分のクリーチャーを1体破壊する
      const tsn = parsed(def).kw.mugetsuSin;
      if (tsn && def === card.def) {
        const base = this.costPlan(pi, card, def, null);
        const cst = Math.max(1, base.cost - tsn);
        const mana = this.payWith(pi, def, cst);
        if (mana && cst < base.cost) out.push({ mana, uses: [...base.uses, async () => this.doAction({ act: 'atEndOfTurn', acts: [{ act: 'destroyOwn', who: null, others: false, n: 1, optional: false }] }, card, pi)], cost: cst, opt: { text: `無月の大罪（ターンの終わりに自分のクリーチャーを1体破壊）` } });
      }
      // ハイパーエナジー：自分のクリーチャーを1体タップするごとに召喚コストを2少なくする（1より少なくならない）
      if (parsed(def).kw.hyperEnergy && def === card.def && !NON_CREATURE.includes(def.type)) {
        const tappers = this.p[pi].battle.filter((c) => this.isCreature(c) && !c.tapped);
        const base = this.costPlan(pi, card, def, null);
        for (let n = 1; n <= tappers.length && base.cost - 2 * (n - 1) > 1; n++) {
          const cst = Math.max(1, base.cost - 2 * n);
          const mana = this.payWith(pi, def, cst);
          if (!mana) continue;
          const nn = n;
          out.push({ mana, uses: [...base.uses, async () => {
            const pool = this.p[pi].battle.filter((c) => this.isCreature(c) && !c.tapped);
            const r = this.p[pi].isAI ? pool.slice(0, nn) : await this.pickCards(pi, pool, Math.min(nn, pool.length), false, `ハイパーエナジー：タップするクリーチャーを${nn}体選んでください`, 'recover');
            for (const c of r) c.tapped = true;
            this.log(`ハイパーエナジー：クリーチャー${r.length}体をタップしてコストを${2 * r.length}下げた`);
          }], cost: cst, opt: { text: `ハイパーエナジー（${nn}体タップ）` } });
        }
      }
      // 召喚する時に○○すればコストが下がる
      const sco = parsed(def).kw.summonCostOpt;
      if (sco && def === card.def && this.canDoCost(pi, card, sco.act)) {
        const plan = this.costPlan(pi, card, def, null);
        const cost = Math.max(1, plan.cost - sco.n);
        const mana = this.payWith(pi, def, cost);
        if (mana) out.push({ mana, uses: [...plan.uses, async () => { this.log(`「${def.name}」: ${sco.text}してコストを${sco.n}下げた`); await this.doAction(sco.act, card, pi); }], cost, opt: sco });
      }
      const vv = parsed(def).kw.vivid;
      if (vv && def === card.def && card.vividTurn === this.turn && this.zoneOf(card) === 'hand') {
        const mana = this.payWith(pi, { civs: vv.civs }, vv.cost);
        if (mana) out.unshift({ mana, uses: [() => { card.usedVivid = this.turn; this.log(`「${def.name}」: ビビッドローのコスト${vv.cost}を支払った`); }], cost: vv.cost, alt: { text: 'ビビッドロー' } });
      }
      const dct = parsed(def).kw.discountTapped;
      if (dct && def === card.def) {
        const plan = this.costPlan(pi, card, def, null);
        const cost = Math.max(1, plan.cost - dct);
        const mana = this.payWith(pi, def, cost);
        if (mana) out.push({ mana, uses: [...plan.uses, () => (card._enterTappedOnce = true)], cost, alt: { text: `コストを${dct}下げてタップして出す` } });
      }
      const alp = parsed(def).kw.altPay;
      if (alp && def === card.def && (!alp.manaGE || this.p[pi].mana.length >= alp.manaGE) && (!alp.cond || this.condOk2(pi, alp.cond, card))) {
        const mana = this.payWith(pi, { civs: alp.civs }, alp.cost);
        if (mana) out.push({ mana, uses: [async () => { this.log(`「${def.name}」: 代わりのコスト${alp.cost}を支払った`); for (const x of alp.then) await this.doAction(x, card, pi); }], cost: alp.cost, alt: alp });
      }
      if (this.zoneOf(card) === 'grave' && (mgc || fsg) && !parsed(def).kw.graveSummon) return out.filter((x) => x.mugen);
      if (parsed(def).kw.bad) {
        const plan = this.costPlan(pi, card, def, null, true);
        const mana = this.payWith(pi, def, plan.cost);
        if (mana) out.push({ mana, uses: plan.uses, cost: plan.cost, bad: true });
      }
      return out;
    }
    // コストとして行う処理ができるか
    canDoCost(pi, card, a) {
      const me = this.p[pi];
      const n = a.n || 1;
      switch (a.act) {
        case 'selfDiscard':
          return me.hand.filter((c) => c !== card && (!a.cond || this.fitLook(c, a.cond))).length >= n;
        case 'showOwn':
          return me.hand.filter((c) => c !== card && this.fitLook(c, a.cond)).length >= n;
        case 'tapOwnCost':
        case 'tap':
          return me.battle.filter((c) => this.isCreature(c) && !c.tapped).length >= n;
        case 'destroyOwn':
        case 'destroy':
        case 'bounce':
          return me.battle.filter((c) => this.isCreature(c)).length >= n;
        case 'ownShieldToGrave':
        case 'shieldToHand':
          return me.shields.length >= n;
        default:
          return false;
      }
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
      const rainbow = this.permanents(pi).some((s) => this.kw(s).rainbowMana || (this.kw(s).rainbowFor && ((def.races || []).join('/') + (def.name || '')).includes(this.kw(s).rainbowFor)));
      const civsOf = (m) => (rainbow ? ['light', 'water', 'darkness', 'fire', 'nature'] : m.faceDown ? [] : m.def.civs || []);
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
      if (parsed(def).kw.ignoreLock) return false;
      if ((def.races || []).some((r) => /^裁きの紋章/.test(r)) && this.permanents(pi).some((s) => this.kw(s).ignoreCrestLock)) return false;
      if (def.type === 'spell' && parsed(def).kw.noCastExtra && this.inExtraTurn) return true;
      if (this.permanents(1 - pi).some((s) => this.kw(s).oppPlayLimit != null && ((this.spellsThisTurn || [0, 0])[pi] + (this.creaturesThisTurn || [0, 0])[pi]) >= this.kw(s).oppPlayLimit)) return true;
      if (def.type === 'spell' && [0, 1].some((q) => this.permanents(q).some((s) => this.kw(s).allSpellLimit != null && (this.spellsThisTurn || [0, 0])[pi] >= this.kw(s).allSpellLimit))) return true;
      if (def.type === 'spell' && this.permanents(1 - pi).some((s) => this.kw(s).oppSpellBan || (this.kw(s).oppNoMonoSpell && (def.civs || []).filter((x) => x !== 'zero').length < 2))) return true;
      for (const src of this.p[pi].battle) {
        const ex = this.kw(src).exileLock;
        if (ex && def.name.includes(ex) && src.def.name !== undefined) return true;
      }
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
      const k = def ? parsed(def).kw : {};
      if (k.evolution === 'grave') {
        const ge = k.graveEvo;
        return this.p[pi][ge.zone || 'grave'].filter((c) => c.def !== def && !NON_CREATURE.includes(c.def.type) && (!ge.civs.length || (c.def.civs || []).some((x) => ge.civs.includes(x))));
      }
      const civs = k.evoCivs || [];
      return this.p[pi].battle.filter((c) => {
        if (!(this.isCreature(c) || this.kw(c).sinkarize) || (civs.length && !(c.def.civs || []).some((x) => civs.includes(x)) && !(k.evoRaceOr && this.allyMatch(c, k.evoRaceOr)))) return false;
        if (k.evoNeedEvo === 'evo') return !!this.evoKind(c.def) && (c.under || []).length > 0;
        if (k.evoNeedEvo === 'ultimate') return parsed(c.def).kw.evoNeedEvo === 'evo' && (c.under || []).length > 0;
        return true;
      });
    }
    canPlay(pi, card) {
      if (parsed(card.def).kw.cannotSummon) return false;
      if (parsed(card.def).kw.summonNeedHandLE != null && this.zoneOf(card) === 'hand' && this.p[pi].hand.length - 1 > parsed(card.def).kw.summonNeedHandLE) return false;
      const ek0 = this.evoKind(card.def);
      if (ek0 === 'evo' && !this.evoBases(pi, card.def).length) return false;
      if (ek0 === 'grave' && this.evoBases(pi, card.def).length < parsed(card.def).kw.graveEvo.n) return false;
      if (ek0 === 'deck' && this.p[pi].deck.length < parsed(card.def).kw.deckEvo.n) return false;
      return this.active === pi && card.owner === pi && this.zoneOf(card) === 'hand' && !this.locked(pi, card.def) && !!this.payment(pi, card);
    }

    async pay(pi, card, def) {
      const plans = this.paymentPlans(pi, card, def);
      let plan = plans[0];
      const withSas = plans.filter((x) => x.sas || x.bad || x.tapAlt || x.opt || x.alt);
      if (withSas.length && !this.p[pi].isAI) {
        const opts = plans.map((x, i) => ({
          id: String(i),
          label: x.sas
            ? `ササゲール：「${x.sas.def.name}」を破壊してコスト${x.cost}で出す`
            : x.bad
              ? `B・A・D：コスト${x.cost}で出す（ターンの終わりに破壊）`
              : x.tapAlt
                ? `自分のクリーチャーを${x.tapAlt}体タップして唱える`
                : x.alt
                  ? `代わりのコスト${x.cost}を支払う${x.alt.text ? '（そうしたら：' + x.alt.text + '）' : ''}`
                  : x.opt
                  ? `${x.opt.text}して、コスト${x.cost}で出す`
                  : `通常どおり（コスト${x.cost}）`,
        }));
        const r = await this.choose(pi, { kind: 'mode', prompt: `「${def.name}」: どう払いますか？`, options: opts, min: 1, max: 1 });
        plan = plans[+r[0]] || plans[0];
      }
      for (const m of plan.mana) m.tapped = true;
      card._paidWith = plan.mana.slice();
      for (const u of plan.uses) await u();
      const bz = parsed(def).kw.buzz;
      if (bz && def === card.def && bz.cost > 0) {
        const free = this.p[pi].mana.filter((m) => !m.tapped);
        const maxN = Math.floor(free.length / bz.cost);
        card._buzzN = 0;
        if (maxN > 0) {
          const opts = [];
          for (let i = 0; i <= maxN; i++) opts.push({ id: String(i), label: `${i}回（追加でマナ${i * bz.cost}枚）` });
          const r = await this.choose(pi, { kind: 'number', prompt: `バズレンダ：「${def.name}」の追加コストを何回支払いますか？`, options: opts, min: 1, max: 1 });
          const k = +r[0] || 0;
          for (const m of free.slice(0, k * bz.cost)) m.tapped = true;
          card._buzzN = k;
          if (k) this.log(`バズレンダ：追加コストを${k}回支払った`);
        }
      }
    }

    async play(pi, uid) {
      const f = this.find(uid);
      if (!f || !this.canPlay(pi, f.card)) return false;
      const card = f.card;
      // 進化元を選ぶ
      let evolveFrom = null;
      const ek = this.evoKind(card.def);
      if (ek === 'grave' || ek === 'deck') {
        const k = parsed(card.def).kw;
        let under = [];
        if (ek === 'grave') {
          const pool = this.evoBases(pi, card.def);
          const n = k.graveEvo.n;
          under = await this.pickCards(pi, pool, k.graveEvo.any ? pool.length : n, false, `「${card.def.name}」: 下に重ねる${k.graveEvo.zone === 'hand' ? '手札' : '墓地'}のクリーチャー${k.graveEvo.any ? '（1体以上）' : n + '体'}`, 'recover');
          if (under.length < (k.graveEvo.any ? 1 : n)) return false;
        }
        if (!this.payment(pi, card)) return false;
        await this.pay(pi, card, card.def);
        if (ek === 'deck') {
          const me = this.p[pi];
          if (k.deckEvo.reveal) {
            const top = me.deck[0];
            this.log(`デッキ進化：山札の上の「${top ? top.def.name : 'なし'}」を表向きにした`);
            if (!top || NON_CREATURE.includes(top.def.type)) {
              this.log(`クリーチャーではないので「${card.def.name}」は手札に戻った`);
              return true;
            }
            under = [top];
          } else under = me.deck.slice(0, k.deckEvo.n);
        }
        await this.putIntoPlay(pi, card, false, card.def, { underCards: under });
        return true;
      }
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
      if (card._galaxy) {
        delete card._galaxy;
        this.moveTo(card, 'shields');
        card.faceUp = true;
        this.log(`${this.p[pi].name}はギャラクシールドで「${card.def.name}」を表向きのシールドとして置いた`);
        await this.shieldAdded(pi);
        return true;
      }
      await this.putIntoPlay(pi, card, false, card.def, { evolveFrom, evoChosen: true });
      return true;
    }

    // 墓地から使えるか（ア・ストラ・ゼーレ、アビス記号など）
    graveUse(pi, card) {
      if (this.active !== pi || card.owner !== pi) return null;
      if (this.zoneOf(card) !== 'deck' && this.permanents(1 - pi).some((s) => this.kw(s).oppUseOnlyHandDeck)) return null;
      const z = this.zoneOf(card);
      // 場のカードが与える「墓地・マナ・山札の上から使ってもよい」
      if (z === 'grave' || z === 'mana' || (z === 'deck' && this.p[pi].deck[0] === card)) {
        for (const src of this.permanents(pi)) {
          if (this.sc(src) && this.sc(src).graveUse) continue; // カード個別の処理を優先
          for (const zp of this.kw(src).zonePlay || []) {
            if (zp.zone !== z || (zp.once && src.zpUsed === this.turn)) continue;
            if (zp.emptyHand && this.p[pi].hand.length) continue;
            if (zp.summon && !this.isCreature(card)) continue;
            if (zp.what && !/^(カード|クリーチャー)$/.test(zp.what)) {
              if (!zp._cond) zp._cond = G.TextParse.lookCond(zp.what.replace(/・カード$/, ''));
              if (!this.fitLook(card, zp._cond)) continue;
            }
            this._zpHit = { src, zp };
            return src;
          }
        }
      }
      this._zpHit = null;
      if (z === 'mana') return parsed(card.def).kw.manaSummon || parsed(card.def).kw.manaCast ? card : null;
      if (z === 'hyper') return parsed(card.def).kw.hyperSummon ? card : null;
      if (z !== 'grave') return null;
      if (parsed(card.def).kw.graveSummon) return card;
      if (parsed(card.def).kw.mugenClimb) return card;
      if (parsed(card.def).kw.fushigi) return card;
      if (parsed(card.def).kw.graveSummonIf && this.condOk2(pi, parsed(card.def).kw.graveSummonIf, card)) return card;
      if (card.def.type === 'spell' && parsed(card.def).kw.recycle) return card;
      for (const src of this.permanents(pi)) {
        const sc = this.sc(src);
        if (sc && sc.graveUse && sc.graveUse(this, src, pi, card)) return src;
      }
      return null;
    }
    canPlayFromGrave(pi, card) {
      if (!this.graveUse(pi, card) || this.locked(pi, card.def)) return false;
      if (card.def.type === 'spell' && this.permanents(1 - pi).some((s) => this.kw(s).oppSpellHandOnly)) return false;
      if (this._zpHit && this._zpHit.zp.free) return true;
      const mb = !this._zpHit && this.zoneOf(card) === 'mana' && parsed(card.def).kw.manaBirth != null;
      if (mb) card._mbPlay = true;
      try {
        return this.withoutMana(pi, card, () => !!this.payment(pi, card));
      } finally {
        if (mb) delete card._mbPlay;
      }
    }
    // マナゾーンから召喚する時、そのカード自身は支払いに使えない
    withoutMana(pi, card, fn) {
      const mana = this.p[pi].mana;
      const i = mana.indexOf(card);
      if (i < 0) return fn();
      mana.splice(i, 1);
      try {
        return fn();
      } finally {
        mana.splice(i, 0, card);
      }
    }
    async playFromGrave(pi, uid) {
      const f = this.find(uid);
      if (!f || !this.canPlayFromGrave(pi, f.card)) return false;
      const src = this.graveUse(pi, f.card);
      const zh = this._zpHit;
      if (zh) {
        // 場のカードの能力で、墓地・マナ・山札の上から使う
        if (zh.zp.once) zh.src.zpUsed = this.turn;
        const fromZ = this.zoneOf(f.card);
        if (fromZ === 'mana') {
          const mana = this.p[pi].mana;
          mana.splice(mana.indexOf(f.card), 1);
          this.p[pi].hand.push(f.card);
          f.card.tapped = false;
        }
        if (!zh.zp.free) await this.pay(pi, f.card, f.card.def);
        this.log(`${this.p[pi].name}は「${zh.src.def.name}」の能力で「${f.card.def.name}」を${{ grave: '墓地', mana: 'マナゾーン', deck: '山札の上' }[fromZ] || ''}から${zh.zp.free ? 'コストを払わずに' : ''}使う`);
        await this.putIntoPlay(pi, f.card, !!zh.zp.free);
        return true;
      }
      const fromMana = this.zoneOf(f.card) === 'mana';
      if (fromMana) {
        const mana = this.p[pi].mana;
        mana.splice(mana.indexOf(f.card), 1);
        this.p[pi].hand.push(f.card); // 支払いの間は手札扱い（自分自身は支払いに使えない）
        f.card.tapped = false;
      }
      if (fromMana && parsed(f.card.def).kw.manaBirth != null) f.card._mbPlay = true;
      if (!fromMana && f.card.def.type === 'spell' && parsed(f.card.def).kw.recycle) f.card._recyc = true;
      try {
        await this.pay(pi, f.card, f.card.def);
      } finally {
        delete f.card._mbPlay;
      }
      if (fromMana) {
        this.log(`${this.p[pi].name}は「${f.card.def.name}」をマナゾーンから召喚する${parsed(f.card.def).kw.manaBirth != null ? '（マナ爆誕）' : ''}`);
        await this.putIntoPlay(pi, f.card, false);
        return true;
      }
      if (src !== f.card) src.usedTurn = this.turn;
      if (src === f.card && f.card.def.type === 'spell' && parsed(f.card.def).kw.recycle) {
        f.card._recyc = true;
        this.log(`${this.p[pi].name}は「${f.card.def.name}」をリサイクルで墓地から唱える`);
        await this.putIntoPlay(pi, f.card, false);
        return true;
      }
      this.log(src === f.card ? `${this.p[pi].name}は「${src.def.name}」を墓地から召喚する` : `${this.p[pi].name}は「${src.def.name}」の効果で墓地から使う`);
      await this.putIntoPlay(pi, f.card, false);
      if (src === f.card && parsed(f.card.def).kw.abyssRush && this.zoneOf(f.card) === 'battle') {
        f.card.abyssTurn = this.turn;
        const me = this.p[pi];
        me.endTurnActs = me.endTurnActs || [];
        me.endTurnActs.push({ uid: f.card.uid, to: 'deckBottom', turn: this.turn });
        this.log(`アビスラッシュ：「${f.card.def.name}」はこのターン、プレイヤーを攻撃できる`);
      }
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
      card._free = !!free;
      if (NON_CREATURE.includes(def.type)) this.p[pi].nonCreaturePlayed = this.turn;
      const fr = free ? 'コストを払わずに' : '';
      if (def.type === 'spell') {
        this.log(`${name}は呪文「${def.name}」を${fr}唱えた`);
        const castFrom = this.zoneOf(card);
        this._lastCast = card;
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
        await this.fireAll(1 - pi, 'oppPlay');
        await this.fireAll(pi, 'allyCast');
        if (this.isSabakiCrest(card)) for (const s2 of this.permanents(pi)) if (this.isOnField(s2) && this.hasAbility(s2, 'allyCastCrest')) await this.trigger(s2, 'allyCastCrest', pi, s2.def, card, { defer: true });
        for (const src of this.permanents(pi)) if (this.isOnField(src) && this.hasAbility(src, 'selfPlay')) await this.trigger(src, 'selfPlay', pi, src.def, card, { defer: true });
        await this.fireAll(1 - pi, 'oppCast');
        await this.resolvePending();
        if (parsed(def).kw.returnAfterCast && this.zoneOf(card) === 'grave') {
          this.moveTo(card, 'hand');
          this.log(`「${def.name}」は唱えた後、手札に戻った`);
        }
        if (parsed(def).kw.fortifyAfterCast && this.zoneOf(card) === 'grave' && (!parsed(def).kw.fortifyFromHand || castFrom === 'hand')) {
          await this.stackOnShield(card, pi);
        }
        if (false) {
          this.moveTo(card, 'shields');
          card.faceUp = true;
          this.log(`「${def.name}」はシールドの上に表向きで置かれた`);
        }
        const kd = parsed(def).kw;
        if (card._recyc && this.zoneOf(card) === 'grave') {
          this.moveTo(card, 'deck', { top: false });
          this.log(`「${def.name}」はリサイクルで唱えた後、山札の下に置かれた`);
        } else if (kd.afterCastTo && this.zoneOf(card) === 'grave') {
          if (kd.afterCastTo === 'deckShuffle') {
            this.moveTo(card, 'deck');
            shuffle(this.p[pi].deck, this.rng);
            this.log(`「${def.name}」は唱えた後、山札に加えてシャッフルした`);
          } else {
            this.moveTo(card, 'deck', { top: false });
            this.log(`「${def.name}」は唱えた後、山札の下に置かれた`);
          }
        } else if (kd.evoCharger && this.zoneOf(card) === 'grave') {
          this.moveTo(card, 'mana', { tapped: true });
          this.log(`「${def.name}」はEvoチャージャーでマナに置かれた`);
          const evos = this.p[pi].battle.filter((c) => (c.under || []).length && this.evoKind(c.def));
          const mc = this.p[pi].mana.filter((c) => !NON_CREATURE.includes(c.def.type));
          if (evos.length && mc.length) {
            const r = await this.pickCards(pi, mc, 1, true, 'Evoチャージャー：進化クリーチャーの下に置くマナのクリーチャー', 'recover');
            if (r.length) {
              const host = (await this.pickCards(pi, evos, 1, false, '下に置く進化クリーチャー', 'recover'))[0];
              const ml = this.p[pi].mana;
              ml.splice(ml.indexOf(r[0]), 1);
              host.under.push(r[0]);
              this.log(`「${r[0].def.name}」を「${host.def.name}」の下に置いた`);
            }
          }
        } else if (kd.castAgain && !card._castAgain && !free && this.zoneOf(card) === 'grave' && (await this.yesNo(pi, `「${def.name}」をもう一度、墓地からコストを支払わずに唱えますか？`, card))) {
          card._castAgain = true;
          try {
            await this.putIntoPlay(pi, card, true, def);
          } finally {
            delete card._castAgain;
          }
        }
        delete card._recyc;
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
      } else if (attachKind(def) === 'aura') {
        await this.playAura(pi, card, fr);
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
      card._enterFrom = this.zoneOf(card);
      card._enterHow = how;
      if (card._enterFrom && card._enterFrom !== 'hand' && this.permanents(1 - pi).some((s) => this.isOnField(s) && this.kw(s).oppOnlyFromHand)) {
        this.log(`「${card.def.name}」は手札以外からは出られない`);
        return false;
      }
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
      if (this.isCreature(card) && this.p[1 - pi].battle.some((s) => s.attacking && this.kw(s).noEnterWhileAttack)) {
        this.log(`攻撃中の効果で「${card.def.name}」は出せない`);
        return false;
      }
      if (this.isCreature(card) && ([0, 1].some((q) => this.permanents(q).some((s2) => this.kw(s2).allEnterLimit != null && (this.creaturesThisTurn || [0, 0])[pi] >= this.kw(s2).allEnterLimit)) || (how === 'summon' && this.active !== pi && this.permanents(1 - pi).some((s2) => this.kw(s2).oppNoSummonMyTurn)))) {
        this.log(`「${card.def.name}」は出せない`);
        return false;
      }
      if (this.isCreature(card) && this.permanents(1 - pi).some((s2) => this.kw(s2).oppEnterLimit != null && (this.creaturesThisTurn || [0, 0])[pi] >= this.kw(s2).oppEnterLimit)) {
        this.log(`「${card.def.name}」はこのターンもう出せない`);
        return false;
      }
      if (how !== 'summon' && parsed(card.def).kw.summonOnlyEntry) {
        this.log(`「${card.def.name}」は召喚以外の方法では出ない`);
        return false;
      }
      if (this.isCreature(card) && (card.def.civs || []).filter((x) => x !== 'zero').length < 2 && this.permanents(1 - pi).some((s) => { const o = this.kw(s).oppNoMono; return o && (!o.myTurnOnly || this.active === s.owner); })) {
        this.log(`「${card.def.name}」は多色ではないので出せない`);
        return false;
      }
      if (fromZone && fromZone !== 'hand' && fromZone !== 'deck' && this.permanents(1 - pi).some((s) => this.kw(s).oppEnterOnlyHandDeck)) {
        this.log(`「${card.def.name}」は手札と山札以外からは出せない`);
        return false;
      }
      if (fromZone && fromZone !== 'hand' && [0, 1].some((q) => this.permanents(q).some((s) => { const nh = this.kw(s).noNonHandPut; return nh === 'all' || (nh === 'opp' && q !== pi); }))) {
        this.log(`「${card.def.name}」は手札以外からは出せない`);
        return false;
      }
      if (fromZone && fromZone !== 'hand' && [0, 1].some((q) => this.permanents(q).some((s) => this.kw(s).noNonHandEntry))) {
        this.moveTo(card, 'hand');
        this.log(`「${card.def.name}」は手札以外から出ようとしたので、かわりに手札に戻った`);
        return false;
      }
      let base = o.evolveFrom;
      // 効果で出す時（墓地・山札・マナなどから）も、進化・NEO進化クリーチャーは進化元の上に重ねて出せる
      if (!base && !o.evoChosen && !(o.underCards && o.underCards.length) && o.via !== 'change' && this.zoneOf(card) !== 'battle') {
        const ek = this.evoKind(card.def);
        if (ek === 'neo' || ek === 'evo') {
          const bases = this.evoBases(pi, card.def).filter((c) => c !== card);
          if (bases.length) {
            const r = await this.pickCards(pi, bases, 1, ek === 'neo', `「${card.def.name}」の進化元を選んでください${ek === 'neo' ? '（選ばなければ進化せずに出す）' : ''}`, 'recover');
            base = r[0] || null;
          }
        }
      }
      if (base && this.zoneOf(base) === 'battle') {
        // 進化：進化元をこのカードの下に重ねる（進化元の状態は引き継ぐ）
        const pl = this.p[base.owner];
        pl.battle.splice(pl.battle.indexOf(base), 1);
        this.moveTo(card, 'battle');
        card.under = [base, ...(base.under || [])];
        base.under = null;
        card.tapped = base.tapped;
        card.sick = false; // 進化クリーチャーは召喚酔いしない
        // 進化元にかかっていた効果は、進化したクリーチャーに引き継ぐ
        for (const k of ['tempPower', 'noAttackTurn', 'lockedUntil', 'frozenUntil', 'noDestroyUntil', 'noLeaveUntil', 'winAllUntil', 'unblockableTurn', 'protectUntil', 'spellShieldUntil', 'jdUntil', 'tempBreak', 'untapAfterAttackTurn', 'returnAtEnd', 'badEnd', 'attacking', 'enteredTurn']) {
          if (base[k] != null && base[k] !== false && base[k] !== 0) card[k] = base[k];
          delete base[k];
        }
        for (const q of this.p) {
          for (const tg of q.tempGrants || []) if (tg.uids && tg.uids.includes(base.uid)) tg.uids = tg.uids.map((u) => (u === base.uid ? card.uid : u));
          for (const ea of q.endTurnActs || []) if (ea.uid === base.uid) ea.uid = card.uid;
        }
        // EXライフのシールドも引き継ぐ（進化したクリーチャーのEXライフと合わせて複数になる）
        const inh = [...(base.exLifes || []), base.exLife].filter((u) => u && this.p[base.owner].shields.some((s) => s.uid === u));
        if (inh.length) {
          card.exLifes = [...(card.exLifes || []), ...inh];
          this.log(`「${base.def.name}」のEXライフのシールド${inh.length}つを「${card.def.name}」が引き継いだ`);
        }
        delete base.exLife;
        delete base.exLifes;
        this.log(`「${card.def.name}」が「${base.def.name}」から進化した`);
        // シンカパワー：進化元の能力を、進化したクリーチャーに対して使う
        if (this.hasAbility(base, 'evolveSource')) await this.trigger(card, 'evolveSource', pi, base.def, null, { defer: true });
      } else if (o.underCards && o.underCards.length) {
        for (const x of o.underCards) {
          const z = this.zoneOf(x);
          if (z && this.p[x.owner][z]) this.p[x.owner][z].splice(this.p[x.owner][z].indexOf(x), 1);
          x.tapped = false;
        }
        this.moveTo(card, 'battle');
        card.under = o.underCards.slice();
        card.sick = false;
        this.log(`「${card.def.name}」が${o.underCards.length}枚のカードの上に重なって進化した`);
      } else {
        this.moveTo(card, 'battle');
        if (parsed(card.def).kw.gLink) await this.tryLink(card, pi);
      }
      if (!this.isCreature(card)) card.sick = false;
      if (o.flipped) card.flipped = true;
      if (parsed(card.def).kw.enterTappedOpt && this.zoneOf(card) === 'battle' && !card.tapped && !this.p[pi].isAI && (await this.yesNo(pi, `「${card.def.name}」をタップして出しますか？`, card))) card.tapped = true;
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
      if (this._suppressEnter) return true; // 出ることで起こる効果を無視する時
      await this.trigger(card, 'summon', pi);
      if (how === 'summon' && this.zoneOf(card) === 'battle') await this.trigger(card, 'summonOnly', pi);
      if (this.zoneOf(card) === 'battle' && this.kw(card).kizuna === 'enter') await this.kizunaUse(card, pi, 'one');
      if (card._toHyperAfterEnter) {
        delete card._toHyperAfterEnter;
        if (this.zoneOf(card) === 'battle') {
          await this.leave(card, 'hyper', { byOpp: false });
          this.log(`「${card.def.name}」はバトルゾーンから超次元ゾーンに置かれた`);
        }
      }
      if (how === 'summon') await this.fireAll(1 - pi, 'oppPlay');
      if (how === 'summon' && this.zoneOf(card) === 'battle' && this.kw(card).yobinion) await this.queueFn(card, pi, `「${card.def.name}」のヨビニオン`, () => this.yobinion(card, pi));
      if (this.zoneOf(card) === 'battle') await this.notifyAll('onAnyEnter', card);
      if (this.zoneOf(card) === 'battle' && this.isCreature(card) && (this.p[1 - pi].tempBigBottomUntil || 0) >= this.turn && (+card.def.cost || 0) > this.p[pi].mana.length) {
        this.log(`「${card.def.name}」はマナの枚数より重いので、山札の一番下に置かれる`);
        await this.leave(card, 'deck', { byOpp: true, moveOpt: { top: false } });
      }
      if (o.via === 'change' && this.zoneOf(card) === 'battle' && this.hasAbility(card, 'enteredByChange')) await this.trigger(card, 'enteredByChange', pi, card.def, null, { defer: true });
      if (base && this.zoneOf(card) === 'battle') for (const src of this.permanents(pi)) if (this.isOnField(src) && this.hasAbility(src, 'allyEvolved')) await this.trigger(src, 'allyEvolved', pi, src.def, card, { defer: true });
      if (this.zoneOf(card) === 'battle' && this.isCreature(card)) for (const src of this.permanents(pi)) if (this.isOnField(src) && this.hasAbility(src, 'allyEnterAny')) await this.trigger(src, 'allyEnterAny', pi, src.def, card, { defer: true });
      if (how === 'summon' && this.isCreature(card)) for (const src of this.permanents(pi)) if (src !== card && this.isOnField(src) && this.hasAbility(src, 'selfPlay')) await this.trigger(src, 'selfPlay', pi, src.def, card, { defer: true });
      if (this.zoneOf(card) === 'battle' && this.isCreature(card)) {
        for (const q of [0, 1]) for (const src of this.permanents(q)) {
          if (src === card || !this.isOnField(src)) continue;
          if (q !== pi && how !== 'summon' && this.hasAbility(src, 'oppEnterNonSummon')) await this.trigger(src, 'oppEnterNonSummon', q, src.def, card, { defer: true });
          if (q !== pi && this.hasAbility(src, 'oppEnter')) await this.trigger(src, 'oppEnter', q, src.def, card, { defer: true });
          if (q !== pi && this.hasAbility(src, 'oppEnterBig') && (+card.def.cost || 0) > this.p[pi].mana.length) await this.trigger(src, 'oppEnterBig', q, src.def, card, { defer: true });
          if (q !== pi && this.hasAbility(src, 'oppEnterFree') && (how !== 'summon' || card._free)) await this.trigger(src, 'oppEnterFree', q, src.def, card, { defer: true });
          if (this.hasAbility(src, 'anyEnter')) await this.trigger(src, 'anyEnter', q, src.def, null, { defer: true });
        }
        await this.resolvePending();
      }
      if (this.zoneOf(card) === 'battle' && ((card.def.races || []).join('/') + card.def.name).includes('魔導具') && !this._inMugetsu) await this.mugetsuCheck(pi, 'enter');
      if (this.zoneOf(card) === 'battle' && this.isCreature(card)) {
        await this.fireHand(pi, 'allyEnter', (ab) => ab.ally && this.allyMatch(card, ab.ally.race));
        await this.resolvePending();
        for (const src of this.permanents(pi)) {
          if (src === card || !this.isOnField(src)) continue;
          for (const ab of this.abilities(src)) {
            if (ab.when !== 'allyEnter' || !ab.ally) continue;
            const al = ab.ally;
            if (!this.allyMatch(card, al.race)) continue;
            if (ab.cond) this._eventCard = card;
            if (ab.cond && !this.condOk2(pi, ab.cond, src)) continue;
            if (al.perTurn) {
              src.allyUsed = src.allyUsed || {};
              const key = ab.text;
              if (src.allyUsed[key] === this.turn) continue;
              src.allyUsed[key] = this.turn;
            }
            await this.queueFn(src, pi, `「${src.def.name}」の能力`, async () => {
              this._eventCard = card;
              this.lastChosen = [card];
              if (ab.modal) await this.runModal(ab.modal, src, pi, src.def);
              else for (const a of ab.acts) await this.doAction(a, src, pi);
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
    // 「自分の○○が出た時」の○○に合うか（種族名のほか、コスト・文明などの条件も読む）
    allyMatch(card, race) {
      if (!race) return true;
      if (race === 'GR') return homeZone(card.frontDef || card.def) === 'gr';
      if (((card.def.races || []).join('/') + card.def.name).includes(race)) return true;
      const cd = G.TextParse.lookCond(race.replace(/の$/, 'の') + (/(クリーチャー|カード|エレメント)$/.test(race) ? '' : 'クリーチャー'));
      return !cd.unknown && this.fitLook(card, cd);
    }
    // 墓地にある時に働く能力（「このクリーチャーを自分の墓地から出してもよい」など）
    async fireGrave(pi, when) {
      for (const c of this.p[pi].grave.slice()) {
        for (const ab of this.abilities(c)) {
          if (ab.when !== when || !ab.fromGrave) continue;
          await this.queueFn(c, pi, `墓地の「${c.def.name}」の能力`, async () => {
            if (this.zoneOf(c) !== 'grave') return;
            if (ab.cond && !this.condOk2(pi, ab.cond, c)) return;
            for (const a of ab.acts) await this.doAction(a, c, pi);
          }, { defer: true });
          break;
        }
      }
    }
    // 手札にある時に働く能力（「〜した時、このクリーチャーを手札から出してもよい」など）
    async fireHand(pi, when, filterAb, evCard) {
      for (const c of this.p[pi].hand.slice()) {
        for (const ab of this.abilities(c)) {
          if (ab.when !== when || !ab.fromHand) continue;
          if (filterAb && !filterAb(ab, c)) continue;
          await this.queueFn(c, pi, `手札の「${c.def.name}」の能力`, async () => {
            if (this.zoneOf(c) !== 'hand') return;
            if (evCard) this._eventCard = evCard;
            if (ab.cond && !this.condOk2(pi, ab.cond, c)) return;
            for (const a of ab.acts) await this.doAction(a, c, pi);
          }, { defer: true });
          break;
        }
      }
    }
    async allyEvent(card, pi, when) {
      await this.fireHand(pi, when, (ab, c) => ab.ally && this.allyMatch(card, ab.ally.race), card);
      // 離れた・破壊された時は「場を離れる直前」を見る：離れたカード自身や、同時に離れたカードの能力も誘発する
      const lookback = when === 'allyLeft' || when === 'allyDestroyed';
      const srcs = this.permanents(pi).filter((x) => this.isOnField(x));
      if (lookback) for (const x of [card, ...(this._goneBatch || [])]) if (x.owner === pi && !srcs.includes(x) && !this.isOnField(x)) srcs.push(x);
      const evJ = { allyBattleWinR: 'バトルに勝った', allyLeft: '離れた', allyDestroyed: '破壊された', allyAttack: '攻撃する', allyUnblocked: '攻撃してブロックされなかった' }[when] || '';
      for (const src of srcs) {
        for (const ab of this.abilities(src)) {
          if (ab.when !== when || !ab.ally) continue;
          if (ab.ally.others && src === card) continue;
          if (!this.allyMatch(card, ab.ally.race)) continue;
          if (ab.cond && ab.cond.evAttackingPlayer && !card._attackingPlayer) continue;
          if (ab.cond) this._eventCard = card;
          if (ab.cond && !this.condOk2(pi, ab.cond, src)) continue;
          if (ab.ally.perTurn) {
            src.allyUsed = src.allyUsed || {};
            if (src.allyUsed[ab.text + when] === this.turn) continue;
            src.allyUsed[ab.text + when] = this.turn;
          }
          const who = src === card ? 'このクリーチャー自身' : `「${card.def.name}」`;
          await this.queueFn(src, pi, `${this.isOnField(src) ? '' : '（離れた）'}「${src.def.name}」の「自分の${ab.ally.race || 'クリーチャー'}が${evJ}時」の能力（${who}）`, async () => {
            this._eventCard = card;
            this.lastChosen = [card];
            if (ab.modal) await this.runModal(ab.modal, src, pi, src.def);
            else for (const a of ab.acts) await this.doAction(a, src, pi);
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
      if (this.zoneOf(card) === 'battle' && this.kw(card).noLeaveBySpell && this.currentSource && this.currentSource.type === 'spell' && this._actSrc && this._actSrc.owner !== card.owner) return '相手の呪文では離れない';
      if ((card.noLeaveUntil || 0) >= this.turn || (this.zoneOf(card) === 'battle' && (this.kw(card).noLeave || (this.kw(card).zeroNoLeave && this.power(card) <= 0)))) return '離れない';
      if (!this._leavingByDestroy && this.isCreature(card) && this.zoneOf(card) === 'battle' && (this.permanents(card.owner).some((s) => this.kw(s).teamOnlyDestroy || (s !== card && this.kw(s).teamOnlyDestroyOthers)) || this.kw(card).selfOnlyDestroy)) return '破壊以外では離れない';
      if (this.zoneOf(card) === 'battle' && this.isCreature(card) && this.permanents(card.owner).some((s) => this.kw(s).teamNoLeave)) return '離れない';
      if (this.zoneOf(card) === 'battle' && this.kw(card).noLeaveEnteredTurn && card.enteredTurn === this.turn) return '出たターンは離れない';
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
      if (card.frontDef && this.zoneOf(card) === 'battle' && parsed(card.def).kw.release) {
        this.unflip(card);
        this.log(`解除：「${card.def.name}」は離れるかわりに表に戻った`);
        return false;
      }
      if (this.zoneOf(card) !== 'battle') return false;
      if (toZone !== 'grave' && toZone !== 'battle' && this.isCreature(card) && this.permanents(card.owner).some((s) => this.kw(s).teamStayNonGrave)) {
        this.log(`「${card.def.name}」は墓地以外へは離れず、バトルゾーンにとどまった`);
        return false;
      }
      if (toZone !== 'battle' && this.isCreature(card)) {
        const lf = this.permanents(card.owner).find((s2) => { const f2 = this.kw(s2).leaveSubFlip; return f2 && this.allyMatch(card, f2.who); });
        const fus = [...this.p[card.owner].shields.filter((x) => x.faceUp), ...this.p[card.owner].shields.flatMap((x) => (x.under || []).filter((u) => u.faceUp))];
        if (lf && fus.length && (await this.yesNo(card.owner, `「${card.def.name}」が離れるかわりに、表向きのカードを1枚裏向きにしますか？`, card))) {
          const pick = this.p[card.owner].isAI ? [fus[0]] : await this.pickCards(card.owner, fus, 1, false, '裏向きにする表向きのカード', 'recover');
          if (pick[0]) {
            pick[0].faceUp = false;
            this.log(`「${card.def.name}」は離れるかわりに、表向きの「${pick[0].def.name}」を裏向きにした`);
            return false;
          }
        }
      }
      if (toZone !== 'battle' && this.isCreature(card) && this.permanents(card.owner).some((s2) => this.kw(s2).leaveSubFaceUp)) {
        const fu = [0, 1].flatMap((q) => [...this.p[q].shields.filter((x) => x.faceUp), ...this.p[q].shields.flatMap((x) => (x.under || []).filter((u) => u.faceUp))]);
        if (fu.length && (await this.yesNo(card.owner, `「${card.def.name}」が離れるかわりに、シールドゾーンの表向きのカードを1枚墓地に置きますか？`, card))) {
          const pick = this.p[card.owner].isAI ? [fu.find((x) => x.owner !== card.owner) || fu[0]] : await this.pickCards(card.owner, fu, 1, false, '墓地に置く表向きのカード', 'discard');
          if (pick[0]) {
            const wasShield = this.p[pick[0].owner].shields.includes(pick[0]);
            this.moveTo(pick[0], 'grave');
            this.log(`「${card.def.name}」は離れるかわりに、表向きの「${pick[0].def.name}」を墓地に置いた`);
            if (wasShield) await this.shieldsLeft(pick[0].owner);
            return false;
          }
        }
      }
      if (toZone !== 'battle' && this.isCreature(card) && this.p[card.owner].shields.length) {
        for (const s2 of this.permanents(card.owner)) {
          const lh = this.kw(s2).leaveSubHand;
          if (!lh || (lh.others && s2 === card) || (lh.once && s2.lshTurn === this.turn) || this.p[card.owner].shields.length < lh.n) continue;
          if (lh.who && lh.who !== 'クリーチャー' && !this.allyMatch(card, lh.who)) continue;
          if (!(await this.yesNo(card.owner, `「${s2.def.name}」：「${card.def.name}」が離れるかわりに、シールドを${lh.n}つ手札に加えますか？`, card))) continue;
          s2.lshTurn = this.turn;
          const sh = this.p[card.owner].isAI ? this.p[card.owner].shields.slice(0, lh.n) : await this.pickCards(card.owner, this.p[card.owner].shields, lh.n, false, '手札に加えるシールド', 'shield');
          for (const x of sh) this.moveTo(x, 'hand');
          this.log(`「${card.def.name}」は離れるかわりに、シールドを${sh.length}つ手札に加えた`);
          await this.shieldsLeft(card.owner);
          return false;
        }
      }
      if (this.kw(card).underShield && (card.under || []).length && toZone !== 'battle') {
        const u = card.under.splice(0);
        for (const x of u) this.p[x.owner].grave.push(x);
        this.log(`「${card.def.name}」は離れるかわりに、下のカード${u.length}枚を墓地に置いた`);
        return false;
      }
      const ek = this.kw(card).eternalK;
      if (ek && toZone !== 'battle') {
        const fd = this.p[card.owner].mana.filter((m) => m.faceDown);
        if (fd.length >= ek && (await this.yesNo(card.owner, `エターナル・Κ：「${card.def.name}」が離れるかわりに、裏向きのマナ${ek}枚を表向きにしますか？`, card))) {
          for (const m of fd.slice(0, ek)) delete m.faceDown;
          this.log(`エターナル・Κ：「${card.def.name}」は離れるかわりに、裏向きのマナ${ek}枚を表向きにした`);
          return false;
        }
      }
      if (card.linkGroup && this.linkMembers(card).length > 1 && this.linkMembers(card).some((x) => x !== card && this.kw(x).linkNoLeave)) return false;
      if (this.kw(card).stayIfUntapped && !card.tapped && toZone !== 'battle') {
        this.log(`「${card.def.name}」はアンタップしているので離れない`);
        return false;
      }
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
      if (!card.exLife && (card.exLifes || []).length) card.exLife = card.exLifes.pop();
      while (!this.p[card.owner].shields.some((s) => s.uid === card.exLife) && (card.exLifes || []).length) card.exLife = card.exLifes.pop();
      if (card.exLife) {
        const sh = this.p[card.owner].shields.find((s) => s.uid === card.exLife);
        card.exLife = null;
        if (sh) {
          this._exLifeByLeave = true;
          try {
            this.moveTo(sh, 'grave');
          } finally {
            this._exLifeByLeave = false;
          }
          this.log(`「${card.def.name}」はかわりにEXライフのシールドを墓地に置いた`);
          await this.trigger(card, 'exLifeLost', card.owner);
          return false;
        }
      }
      // エスケープ：かわりに自分のシールドを1つ手札へ
      const k = this.kw(card);
      const zeroP = this.isCreature(card) && this.power(card) <= 0;
      if (k.escape && (o.destroy || o.byOpp !== false) && this.p[card.owner].shields.length && !(zeroP && this.p[card.owner].isAI)) {
        if (await this.yesNo(card.owner, `「${card.def.name}」のエスケープ：かわりにシールドを1つ手札に戻しますか？${zeroP ? '（パワーが0以下なので、戻してもまた破壊されます）' : ''}`, card)) {
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
      const drg = this.kw(card).destroyRepGraveBottom;
      if (o.destroy && toZone === 'grave' && drg && this.p[card.owner].grave.length >= drg && (await this.yesNo(card.owner, `「${card.def.name}」が破壊されるかわりに、墓地のカードを${drg}枚山札の下に置きますか？`, card))) {
        const gp = this.p[card.owner].isAI ? this.p[card.owner].grave.slice(0, drg) : await this.pickCards(card.owner, this.p[card.owner].grave, drg, false, '山札の下に置く墓地のカード', 'recover');
        for (const x of gp) this.moveTo(x, 'deck', { top: false });
        this.log(`「${card.def.name}」は破壊されるかわりに、墓地のカード${gp.length}枚を山札の下に置いた`);
        return false;
      }
      // 「このクリーチャーが破壊される時、墓地に置くかわりにマナ／手札へ」
      const sdt = this.kw(card).selfDestroyTo;
      if ((o.destroy || (sdt && sdt.any)) && toZone === 'grave' && sdt && (!sdt.optional || (await this.yesNo(card.owner, `「${card.def.name}」を墓地のかわりに${sdt.to === 'hand' ? '手札' : 'マナゾーン'}に置きますか？`, card)))) {
        toZone = sdt.to;
        this.log(`「${card.def.name}」は破壊され、墓地のかわりに${{ hand: '手札', mana: 'マナゾーン', shields: 'シールド' }[sdt.to]}へ`);
      }
      // 「自分の○○が破壊される時、墓地に置くかわりにマナ／手札へ」
      if (o.destroy && toZone === 'grave') {
        for (const s of this.p[card.owner].battle) {
          let done = false;
          for (const ad of this.kw(s).allyDestroyTo || []) {
            if (ad.others && s === card) continue;
            if (!this.allyMatch(card, ad.who.replace(/(・)?クリーチャー$/, ''))) continue;
            if (ad.optional && !(await this.yesNo(card.owner, `「${card.def.name}」を墓地のかわりに${ad.to === 'hand' ? '手札' : ad.to === 'shields' ? 'シールドゾーン' : 'マナゾーン'}に置きますか？`, card))) continue;
            toZone = ad.to;
            this.log(`「${s.def.name}」の効果で「${card.def.name}」は${ad.to === 'hand' ? '手札' : ad.to === 'shields' ? 'シールドゾーン' : 'マナゾーン'}へ`);
            done = true;
            break;
          }
          if (done) break;
        }
      }
      // 「破壊される時、墓地に置くかわりに〜の下に置いてもよい」
      if (o.destroy) {
        const opts = [];
        for (const ur of this.kw(card).underRepl || []) if (ur.self) opts.push({ ur, src: card });
        for (const s of this.p[card.owner].battle) if (s !== card) for (const ur of this.kw(s).underRepl || []) if (!ur.self && this.fitLook(card, G.TextParse.lookCond(ur.who))) opts.push({ ur, src: s });
        for (const { ur, src } of opts) {
          const hosts = ur.self ? this.p[card.owner].battle.filter((c) => c !== card && this.isCreature(c) && (!ur.host || this.fitLook(c, G.TextParse.lookCond(ur.host.replace(/NEOクリーチャー|NEO/, ''))) && (!/NEO|進化/.test(ur.host) || this.evoKind(c.def) || c.under?.length))) : [src];
          if (!hosts.length) continue;
          if (!(await this.yesNo(card.owner, `「${card.def.name}」を墓地に置くかわりに${ur.self ? 'クリーチャー' : '「' + src.def.name + '」'}の下に置きますか？`, card))) continue;
          const host = hosts.length === 1 ? hosts[0] : (await this.pickCards(card.owner, hosts, 1, false, `「${card.def.name}」を下に置くクリーチャー`, 'recover'))[0];
          const pl = this.p[card.owner];
          pl.battle.splice(pl.battle.indexOf(card), 1);
          host.under = [...(host.under || []), card, ...(card.under || [])];
          card.under = null;
          card.tapped = false;
          this.log(`「${card.def.name}」は破壊されるかわりに「${host.def.name}」の下に置かれた`);
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
        for (const sv of this.p[card.owner].battle) {
          const sf = sv !== card && !this._saving && this.isCreature(sv) && this.kw(sv).saverFor;
          if (!sf || !this.allyMatch(card, sf.replace(/(・)?クリーチャー$/, ''))) continue;
          if (!(await this.yesNo(card.owner, `セイバー：「${card.def.name}」のかわりに「${sv.def.name}」を破壊しますか？`, sv))) continue;
          this.log(`セイバー：「${sv.def.name}」が「${card.def.name}」の身代わりになった`);
          this._saving = true;
          try {
            await this.destroyMany([sv], { byOpp: false });
          } finally {
            this._saving = false;
          }
          return false;
        }
      }
      if (this.kw(card).eternalOmega && toZone !== 'battle' && toZone !== 'hand' && this.zoneOf(card) === 'battle' && !homeZone(card.frontDef || card.def)) {
        this.log(`エターナル・Ω：「${card.def.name}」は${ZONE_LABEL[toZone] || toZone}のかわりに手札に戻る`);
        toZone = 'hand';
        o = { ...o, moveOpt: undefined };
      }
      // スター進化：離れる時、かわりに一番上のカードだけが離れる
      if (this.kw(card).starEvo && (card.under || []).length && toZone !== 'battle' && this.zoneOf(card) === 'battle') {
        const stack = card.under;
        card.under = null;
        const nb = stack[0];
        nb.under = stack.slice(1);
        const arr = this.p[card.owner].battle;
        arr.splice(arr.indexOf(card) + 1, 0, nb);
        nb.tapped = card.tapped;
        nb.sick = card.sick;
        nb.enteredTurn = card.enteredTurn;
        nb.faceUp = false;
        this.log(`スター進化：「${card.def.name}」だけが離れ、下の「${nb.def.name}」はバトルゾーンに残る`);
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
      for (const u of under) {
        u._fromUnder = true;
        this.moveTo(u, toZone === 'shields' ? 'grave' : toZone, o.moveOpt);
      }
      for (const pl of this.p) for (const w of pl.battle.filter((x) => x.attachedTo === card.uid)) {
        w.attachedTo = null;
        if (o.destroy && this.hasAbility(w, 'hostDestroyed')) await this.trigger(w, 'hostDestroyed', w.owner, w.def, null, { defer: true });
        const k = attachKind(w.def);
        if (k === 'weapon') this.moveTo(w, 'hyper');
        else if (k === 'aura') {
          this.moveTo(w, 'grave');
          this.log(`オーラ「${w.def.name}」は墓地に置かれた`);
        } else this.log(`クロスギア「${w.def.name}」はバトルゾーンに残った`);
      }
      if (o.shuffleAfter) shuffle(this.p[card.owner].deck, this.rng);
      if (this.hasAbility(card, 'left')) await this.trigger(card, 'left', card.owner, card.def, null, { defer: !!o.destroy });
      if (this.isCreature(card)) await this.allyEvent(card, card.owner, 'allyLeft');
      if (this.isCreature(card)) for (const q of [0, 1]) for (const s2 of this.permanents(q)) if (s2 !== card && this.isOnField(s2) && this.hasAbility(s2, 'anyLeft')) await this.trigger(s2, 'anyLeft', q, s2.def, card, { defer: true });
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
      for (const c of this.permanents(1 - pi)) if (this.isOnField(c) && this.hasAbility(c, 'oppShieldAdded')) await this.trigger(c, 'oppShieldAdded', 1 - pi, c.def, null, { defer: true });
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
      const zj = { hand: '手札の', grave: '墓地の', mana: 'マナの', shields: 'シールドの', hyper: '超次元の' }[this.zoneOf(card)] || '';
      this.pending.push({ card, when, controller, def, extra, label: `【${this.p[controller].name}】${zj}「${def.name}」の${WHEN_J[when] || when}` });
      if (!o.defer) await this.resolvePending();
    }
    // 任意の処理を待機させる（場のカードの「〜した時」能力など）
    async queueFn(src, controller, label, fn, o = {}) {
      this.pending = this.pending || [];
      if (!/^【/.test(label)) label = `【${this.p[controller].name}】${label}`;
      this.pending.push({ card: src, controller, fn, label });
      if (!o.defer) await this.resolvePending();
    }
    hasAbility(card, when, def = card.def) {
      const sc = this.script(def);
      if (sc && sc[when]) return true;
      return this.abilities(card, def).some((ab) => ab.when === when);
    }
    // キズナ：自分のクリーチャーのP能力を使う
    hasP(c) {
      return this.abilities(c).some((ab) => ab.when === 'kizunaP');
    }
    async runP(c, pi) {
      for (const ab of this.abilities(c)) {
        if (ab.when !== 'kizunaP') continue;
        this.log(`「${c.def.name}」のP能力を使う`);
        for (const a of ab.acts) await this.doAction(a, c, pi);
      }
    }
    async kizunaUse(src, pi, mode) {
      const pool = this.p[pi].battle.filter((c) => this.isCreature(c) && this.hasP(c) && (mode !== 'other' || c !== src));
      if (!pool.length) return;
      const n = mode === 'any' ? pool.length : 1;
      const r = await this.pickCards(pi, pool, n, mode === 'any', `キズナ：P能力を使うクリーチャーを${mode === 'any' ? '好きな数' : '1体'}選んでください`, 'recover');
      for (const c of r) await this.runP(c, pi);
    }
    // 無月の門：魔導具を重ねて、手札か墓地から召喚する
    async mugetsuCheck(pi, when) {
      const me = this.p[pi];
      const isM = (c) => ((c.def.races || []).join('/') + c.def.name).includes('魔導具');
      for (const c of [...me.hand, ...me.grave]) {
        const mg = parsed(c.def).kw.mugetsu;
        if (!mg || mg.when !== when) continue;
        if (!['hand', 'grave'].includes(this.zoneOf(c))) continue;
        const bpool = me.battle.filter((x) => isM(x) && !x.attachedTo);
        const gpool = me.grave.filter((x) => x !== c && isM(x));
        const ok = mg.total ? bpool.length + gpool.length >= mg.total : bpool.length >= mg.battle && gpool.length >= mg.grave;
        if (!ok) continue;
        if (!(await this.yesNo(pi, `無月の門：「${c.def.name}」を魔導具の上に召喚しますか？`, c))) continue;
        let picked;
        if (mg.total) picked = await this.pickCards(pi, [...bpool, ...gpool], mg.total, false, `無月の門：重ねる魔導具を${mg.total}つ選んでください`, 'recover');
        else picked = [...(await this.pickCards(pi, bpool, mg.battle, false, `無月の門：重ねるバトルゾーンの魔導具を${mg.battle}つ`, 'recover')), ...(await this.pickCards(pi, gpool, mg.grave, false, `無月の門：重ねる墓地の魔導具を${mg.grave}つ`, 'recover'))];
        if (picked.length < (mg.total || mg.battle + mg.grave)) continue;
        this.log(`${me.name}は無月の門で「${c.def.name}」を召喚する`);
        for (const x of picked) for (const u of (x.under || []).splice(0)) picked.push(u);
        this._inMugetsu = true;
        try {
          await this.enterBattle(c, pi, 'summon', { underCards: picked, evoChosen: true });
        } finally {
          this._inMugetsu = false;
        }
        // 「無月の門」能力を使った時
        for (const x of [...me.hand, ...me.grave].filter((y) => y !== c)) {
          for (const ab of this.abilities(x)) {
            if (ab.when !== 'mugetsuUsed') continue;
            await this.queueFn(x, pi, `「${x.def.name}」の無月の門を使った時の能力`, async () => {
              if (!['hand', 'grave'].includes(this.zoneOf(x)) || (this.zoneOf(x) === 'hand' && !ab.fromHand)) return;
              if (!(await this.yesNo(pi, `「${x.def.name}」をバトルゾーンにタップして出しますか？`, x))) return;
              x._enterTappedOnce = true;
              await this.enterBattle(x, pi, 'other');
            }, { defer: true });
            break;
          }
        }
        await this.resolvePending();
        return;
      }
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
            const opts = mine.map((x, i) => ({ id: String(i), label: x.label, card: x.card }));
            const others = this.pending.filter((x) => !mine.includes(x));
            const r = await this.choose(item.controller, {
              kind: 'mode',
              prompt: `待機中の能力が${mine.length}つあります。次に解決するものを選んでください（残りはその後、また選べます）` + (others.length ? `\n相手側で待機中：${others.map((x) => x.label).join(' / ')}` : ''),
              options: opts,
              min: 1,
              max: 1,
            });
            item = mine[+r[0]] || mine[0];
          }
          this.pending.splice(this.pending.indexOf(item), 1);
          this.log(`▶ 解決：${item.label}`);
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
      if (extra && extra.uid != null) this._eventCard = extra;
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
        if (ab.cond && ab.cond.evCivAny && !(this._eventCard && ab.cond.evCivAny.some((cv) => this.civMatch(this._eventCard, cv)))) continue;
        if (ab.cond && ab.cond.oppTurn && this.active === controller) continue;
        if (ab.cond && ab.cond.enteredThisTurn && card.enteredTurn !== this.turn) continue;
        if (ab.cond && (ab.cond.firstPerTurn || ab.cond.oncePerTurn)) {
          card.abUsed = card.abUsed || {};
          const key = ab.text + when;
          if (card.abUsed[key] === this.turn) continue;
          card.abUsed[key] = this.turn;
        }
        if (ab.cond && !this.condOk2(controller, ab.cond, card)) {
          this.log(`「${def.name}」: 条件を満たしていない`);
          continue;
        }
        if (ab.cond && ab.cond.count && this.countOwn(controller, ab.cond.count.what) < ab.cond.count.n) {
          this.log(`「${def.name}」: 「${ab.cond.count.what}が${ab.cond.count.n}以上」の条件を満たしていない`);
          continue;
        }
        if (ab.cond && ab.cond.askUse && !(await this.yesNo(controller, `「${def.name}」の能力（${String(ab.text || '').slice(0, 40)}）を使いますか？`, card))) continue;
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
      if (cond.count && this.countOwn(pi, cond.count.what) < cond.count.n) return false;
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
      if (a.notEvo) pool = pool.filter((c) => !this.evoKind(c.def));
      if (a.maxCostDyn) {
        const pl = this.p[pi];
        const mx = { grave: pl.grave.length, mana: pl.mana.length, hand: pl.hand.length, shields: pl.shields.length }[a.maxCostDyn];
        pool = pool.filter((c) => (+c.def.cost || 0) <= mx);
      }
      if (a.minCostDyn === 'oppManaPlus1') pool = pool.filter((c) => (+c.def.cost || 0) > this.p[c.owner].mana.length);
      if (a.maxCostDiscardN) {
        const d0 = this._eventCard || (this.lastDiscarded || [])[0];
        pool = d0 ? pool.filter((c) => (+c.def.cost || 0) <= (+d0.def.cost || 0)) : [];
      }
      if (a.maxCostPicked) pool = pool.filter((c) => (+c.def.cost || 0) <= (this.pickedCount || 0));
      if (a.costEqDiscard) {
        const costs = (this.lastDiscarded || []).map((c) => +c.def.cost || 0);
        pool = pool.filter((c) => costs.includes(+c.def.cost || 0));
      }
      if (a.powerLtSelf && this._actSrc) pool = pool.filter((c) => this.power(c) < this.power(this._actSrc));
      if (a.costLtSelf && this._actSrc) pool = pool.filter((c) => (+c.def.cost || 0) < (+this._actSrc.def.cost || 0));
      if (a.notColorless) pool = pool.filter((c) => (c.def.civs || []).some((x) => x !== 'zero'));
      if (a.notMulti) pool = pool.filter((c) => (c.def.civs || []).filter((x) => x !== 'zero').length < 2);
      if (a.exceptCiv) pool = pool.filter((c) => !(c.def.civs || []).includes(a.exceptCiv));
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

    // 効果を1つ行い、盤面が変わったかを覚えておく（直後の「そうしたら」の判定に使う）
    async doAction(a, src, pi) {
      if (a.act === 'ifDidPrev') {
        if (!this._lastChanged) {
          this.log(`「${src.def.name}」: できなかったので、その後の効果はない`);
          return;
        }
        for (const x of a.acts) await this.doAction(x, src, pi);
        return;
      }
      if (a.act === 'noop') return;
      if (a.act === 'ifNotDidPrev') {
        if (this._lastChanged) return;
        for (const x of a.acts) await this.doAction(x, src, pi);
        return;
      }
      const before = this.stateSig() + '#' + (this.pickedCount || 0);
      await this.doActionInner(a, src, pi);
      this._lastChanged = this.stateSig() + '#' + (this.pickedCount || 0) !== before;
    }
    async doActionInner(a, src, pi) {
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
          const mbN = a.n === 'lastCount' ? this.lastCount || 0 : a.n;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 山札の上から${mbN}枚をマナに置きますか？`, src))) return;
          for (let i = 0; i < mbN && me.deck.length; i++) {
            const c = me.deck[0];
            this.moveTo(c, 'mana', { tapped: a.tapped || (c.def.civs || []).length > 1 });
            if (a.faceDown) c.faceDown = true;
            this._lastMoved = c;
            this.log(`${me.name}は山札の上の「${c.def.name}」をマナに置いた`);
          }
          break;
        }
        case 'shieldAdd': {
          if (a.optional && !(await this.yesNo(pi, `${nm}: 山札の上から${a.n}枚をシールド化しますか？`, src))) return;
          const added = await this.addShieldFromDeck(pi, a.n);
          if (added) {
            if (a.faceUp) for (const c of me.shields.slice(-added)) c.faceUp = true;
            this.log(`${me.name}はシールドを${added}つ${a.faceUp ? '表向きで' : ''}追加した`);
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
            const amt = a.amount === 'all' ? this.power(c) : a.amount === 'grave' ? me.grave.length * (a.per || 1000) : a.amount === 'mana' ? me.mana.length * (a.per || 1000) : a.amount;
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
              const was = c.tapped;
              c.tapped = true;
              this.log(`「${c.def.name}」はタップされた`);
              if (!was) for (const s2 of this.permanents(1 - c.owner)) if (this.isOnField(s2) && this.hasAbility(s2, 'oppTapped')) await this.trigger(s2, 'oppTapped', 1 - c.owner, s2.def, c, { defer: true });
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
              if (i === 0) this.log(`${op.name}の手札：${op.hand.map((x) => x.def.name).join('、')}`);
              const pool = op.hand.filter((x) => !a.cond || this.fitLook(x, a.cond));
              const r = await this.pickCards(pi, pool, 1, !!a.optional, `${nm}: 相手の手札から捨てさせるカード`, 'target');
              c = r[0];
              if (!c) break;
            } else {
              const r = await this.pickCards(op.idx, op.hand, 1, false, `${nm}: 捨てる手札を選んでください`, 'discard');
              c = r[0];
            }
            await this.discardCard(c, pi);
            this.lastDiscarded = [c];
          }
          break;
        }
        case 'graveToHand':
        case 'manaToHand': {
          const zone = a.act === 'graveToHand' ? 'grave' : 'mana';
          let pool = [...me[zone], ...(a.alsoGrave && zone === 'mana' ? me.grave : [])].filter((c) => !a.notSelf || c !== src);
          if (a.civ) pool = pool.filter((c) => (c.def.civs || []).includes(a.civ));
          if (a.cond) pool = pool.filter((c) => this.fitLook(c, a.cond));
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
          const dpool = me.hand.filter((c) => c !== src && (!a.cond || this.fitLook(c, a.cond)));
          if (a.cond && dpool.length < a.n) break;
          const picked = a.random ? dpool.slice().sort(() => this.rng() - 0.5).slice(0, a.n) : await this.pickCards(pi, dpool, a.n, !!a.optional, `${nm}: 捨てる手札を${a.n}枚選んでください`, 'discard');
          const dtm = this.permanents(pi).some((s) => this.kw(s).discardToMana);
          for (const c of picked) {
            this.moveTo(c, dtm ? 'mana' : 'grave');
            this.log(`${me.name}は手札の「${c.def.name}」を捨てた${dtm ? '（墓地のかわりにマナへ）' : ''}`);
          }
          this.lastDiscarded = picked;
          if (picked.length) for (const s of this.permanents(1 - pi)) if (this.isOnField(s) && this.hasAbility(s, 'oppDiscarded')) await this.trigger(s, 'oppDiscarded', s.owner, s.def, picked[0], { defer: true });
          if (picked.length) for (const s of this.permanents(pi)) if (this.isOnField(s) && this.hasAbility(s, 'selfDiscarded')) await this.trigger(s, 'selfDiscarded', pi, s.def, picked[0], { defer: true });
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
          this.lastPutGroup = a.dest === 'battle' ? chosen.slice() : [];
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
            (c) => (this.isCreature(c) || (a.withTama && c.def.type === 'tamaseed')) && c.tapped && (!a.hasKw || this.kw(c)[{ ブロッカー: 'blocker' }[a.hasKw] || 'blocker']) && (!a.multiOnly || (c.def.civs || []).filter((x) => x !== 'zero').length >= 2) && (!a.others || c !== src) && (!a.nameHas || c.def.name.includes(a.nameHas)) && (!a.evoOnly || this.evoKind(c.def)) && (!a.race || ((c.def.races || []).join('/') + c.def.name).includes(a.race))
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
        case 'moveTarget': {
          const pool = this.targetsFor(a, pi);
          const r = a.all ? pool : await this.pickCards(pi, pool, a.n, a.optional, `${nm}: ${ZONE_LABEL[a.to] || a.to}に置くカード`, 'target', 'bounce');
          for (const c of r) {
            const ok = a.to === 'deckBottom' ? await this.leave(c, 'deck', { byOpp: c.owner !== pi, moveOpt: { top: false } }) : await this.leave(c, a.to, { byOpp: c.owner !== pi });
            if (ok && a.to === 'hyper') this.log(`「${c.def.name}」は超次元ゾーンに置かれた`);
            if (ok) {
              this.log(`「${c.def.name}」は持ち主の${{ grave: '墓地', mana: 'マナゾーン', shields: 'シールド', deckBottom: '山札の下', hand: '手札' }[a.to]}に置かれた`);
              if (a.to === 'shields') await this.shieldAdded(c.owner);
            }
          }
          break;
        }
        case 'handToMana': {
          if (a.all && a.optional && !(await this.yesNo(pi, `${nm}: 手札をすべてマナゾーンに置きますか？`, src))) break;
          const r = a.all ? me.hand.slice() : await this.pickCards(pi, me.hand.slice(), a.n, a.optional, `${nm}: マナゾーンに置く手札`, 'discard');
          for (const c of r) {
            this.moveTo(c, 'mana', { tapped: a.tapped || (c.def.civs || []).length > 1 });
            this.log(`${me.name}は手札の「${c.def.name}」をマナゾーンに置いた`);
          }
          break;
        }
        case 'oppTeamPower': {
          for (const c of op.battle) if (this.isCreature(c)) c.tempPower = (c.tempPower || 0) + a.n;
          this.log(`${op.name}のクリーチャーすべてのパワーがこのターン${a.n}`);
          const dead = op.battle.filter((c) => this.isCreature(c) && this.power(c) <= 0);
          if (dead.length) await this.destroyMany(dead);
          break;
        }
        case 'hyperPut': {
          // 超次元ゾーンから出す（サイキック・クリーチャー／ドラグハート）
          let pool = me.hyper.filter((c) => {
            if (a.kind === 'psychic' && isDragheartItem(c.def)) return false;
            if (a.kind === 'dragheart' && !/ドラグハート/.test(c.def.text || '')) return false;
            if (a.maxCost != null && (+c.def.cost || 0) > a.maxCost) return false;
            if (a.civs && a.civs.length && !(c.def.civs || []).some((x) => a.civs.includes(x))) return false;
            if (a.race && !((c.def.races || []).join('/') + c.def.name).includes(a.race)) return false;
            return true;
          });
          let chosen = [];
          if (a.sumCost != null) {
            let left = a.sumCost;
            const cand = pool.slice();
            for (;;) {
              const ok = cand.filter((c) => !chosen.includes(c) && (+c.def.cost || 0) <= left);
              if (!ok.length) break;
              const r = await this.pickCards(pi, ok, 1, true, `${nm}: 超次元ゾーンから出すカード（残りコスト${left}）`, 'recover');
              if (!r.length) break;
              chosen.push(r[0]);
              left -= +r[0].def.cost || 0;
            }
          } else chosen = await this.pickCards(pi, pool, a.n, a.optional || !pool.length, `${nm}: 超次元ゾーンから出すカード`, 'recover');
          if (!pool.length) this.log(`${nm}: 超次元ゾーンに出せるカードがない`);
          for (const c of chosen) {
            await this.enterBattle(c, pi, 'other');
            if (isDragheartItem(c.def) && /ウエポン|これを装備した/.test(c.def.text || '') && this.zoneOf(c) === 'battle') {
              const holder = src && this.zoneOf(src) === 'battle' && this.isCreature(src) ? src : (await this.pickCards(pi, me.battle.filter((x) => this.isCreature(x)), 1, false, `「${c.def.name}」を装備するクリーチャー`, 'recover'))[0];
              if (holder) {
                c.attachedTo = holder.uid;
                this.log(`「${c.def.name}」を「${holder.def.name}」に装備した`);
              }
            }
          }
          break;
        }
        case 'grSummon': {
          for (let i = 0; i < (a.n || 1); i++) {
            const c = me.gr.shift();
            if (!c) {
              this.log(`${me.name}の超GRにカードがない`);
              break;
            }
            me.gr.push(c); // いったん戻してから出す
            this.log(`${me.name}はGR召喚した`);
            if (i === 0) this.lastPutGroup = [];
            await this.enterBattle(c, pi, 'gr');
            this.lastPutGroup.push(c);
          }
          break;
        }
        case 'untapManaN': {
          const r = me.mana.filter((c) => c.tapped).slice(0, a.n);
          for (const c of r) c.tapped = false;
          this.log(`${me.name}はマナを${r.length}枚アンタップした`);
          break;
        }
        case 'castFromGrave': {
          if ((this._castDepth || 0) > 6) break; // 念のための無限ループ防止
          const graves = a.anyGrave ? [...me.grave, ...op.grave] : me.grave;
          const pool = graves.filter((c) => c !== src && c.def.type === 'spell' && (a.maxCost == null || (+c.def.cost || 0) <= a.maxCost) && (!a.civ || (c.def.civs || []).includes(a.civ)) && !this.locked(pi, c.def));
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: 墓地から唱える呪文`, 'recover');
          for (const c of r) {
            this._castDepth = (this._castDepth || 0) + 1;
            try {
              await this.putIntoPlay(pi, c, true);
            } finally {
              this._castDepth--;
            }
            if (a.bottomAfter && this.zoneOf(c) === 'grave') {
              this.moveTo(c, 'deck', { top: false });
              this.log(`「${c.def.name}」は唱えた後、墓地のかわりに山札の下に置かれた`);
            }
          }
          break;
        }
        case 'putFromMana': {
          const pool = me.mana.filter((c) => this.fitLook(c, a.cond) && (!a.maxCostMana || (+c.def.cost || 0) <= me.mana.length) && (this.isCreature(c) || c.def.type === 'tamaseed' || c.def.type === 'field'));
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: マナゾーンから出すカード`, 'recover');
          for (const c of r) await this.enterBattle(c, pi, 'other');
          break;
        }
        case 'selfFromHand':
          if (!src || this.zoneOf(src) !== 'hand') break;
          if (a.optional && !(await this.yesNo(pi, `手札の${nm}を出しますか？`, src))) break;
          this.log(`${me.name}は手札から${nm}を出した`);
          await this.enterBattle(src, pi, a.summon ? 'summon' : 'other');
          break;
        case 'selfDiscardFromHand':
          if (!src || this.zoneOf(src) !== 'hand') break;
          if (a.optional && !(await this.yesNo(pi, `手札の${nm}を捨てますか？`, src))) break;
          this.moveTo(src, 'grave');
          this.log(`${me.name}は手札の${nm}を捨てた`);
          break;
        case 'noop':
          break;
        case 'discardDrawPlus': {
          const r = await this.pickCards(pi, me.hand.filter((c) => c !== src), a.n, true, `${nm}: 捨てる手札（${a.n}枚まで）`, 'discard');
          for (const c of r) await this.discardCard(c, pi);
          this.draw(pi, r.length + a.plus);
          this.log(`${me.name}は${r.length}枚捨てて${r.length + a.plus}枚引いた`);
          break;
        }
        case 'gearToGrave': {
          const pool = [...op.battle, ...(a.side === 'any' ? me.battle : [])].filter((c) => attachKind(c.def) === 'cross');
          const r = await this.pickCards(pi, pool, a.n, !!a.optional, `${nm}: 墓地に置くクロスギア`, 'target', 'destroy');
          for (const c of r) if (await this.leave(c, 'grave', { byOpp: c.owner !== pi })) this.log(`クロスギア「${c.def.name}」は墓地に置かれた`);
          break;
        }
        case 'oppManaToGrave': {
          const r = await this.pickCards(pi, op.mana, Math.min(a.n, op.mana.length), false, `${nm}: 墓地に置く相手のマナ`, 'target');
          for (const c of r) this.moveTo(c, 'grave');
          if (r.length) this.log(`${op.name}のマナ${r.length}枚を墓地に置いた`);
          break;
        }
        case 'tempBreakExtra':
          src.tempBreak = { turn: this.turn, n: a.n };
          break;
        case 'tempBreakExtraLast':
          for (const c of this.lastChosen || []) c.tempBreak = { turn: this.turn, n: a.n };
          break;
        case 'selfFromHandOrGrave': {
          const z = this.zoneOf(src);
          if (z !== 'hand' && z !== 'grave') break;
          if (a.optional && !(await this.yesNo(pi, `${nm}を${z === 'hand' ? '手札' : '墓地'}から出しますか？`, src))) break;
          await this.enterBattle(src, pi, 'other');
          if (a.tapped && this.zoneOf(src) === 'battle') src.tapped = true;
          break;
        }
        case 'oppShieldTo': {
          const r = await this.pickCards(pi, op.shields, Math.min(a.n, op.shields.length), false, `${nm}: 相手のシールド`, 'shield');
          for (const c of r) this.moveTo(c, a.to);
          if (r.length) {
            this.log(`${op.name}のシールドを${r.length}つ${a.to === 'grave' ? '墓地' : 'マナゾーン'}に置いた`);
            await this.shieldsLeft(op.idx);
          }
          break;
        }
        case 'teamNoAttackOthers':
          for (const c of me.battle) if (c !== src) c.noAttackTurn = this.turn;
          this.log(`このターン、${me.name}の他のクリーチャーは攻撃できない`);
          break;
        case 'fightEvent': {
          const ev = this._eventCard;
          if (!ev || this.zoneOf(ev) !== 'battle' || this.zoneOf(src) !== 'battle' || ev === src) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 「${ev.def.name}」とバトルさせますか？`, src))) break;
          await this.battle(src, ev);
          break;
        }
        case 'tempTapDraw':
          me.tempTapDrawUntil = this.nextTurnOf(pi) - 1;
          this.log(`${nm}: 次の自分のターンのはじめまで、自分のクリーチャーがタップした時1枚引ける`);
          break;
        case 'tempBigBottom':
          me.tempBigBottomUntil = this.nextTurnOf(pi) - 1;
          this.log(`${nm}: 次の自分のターンのはじめまで、相手がマナより重いクリーチャーを出したら山札の下へ`);
          break;
        case 'nextCostDiscount':
          if (!(await this.yesNo(pi, `${nm}: 次に使う${a.civ ? '' : ''}カードのコストを最大${a.n}下げますか？`, src))) break;
          me.nextSummonDiscount = { turn: this.turn, n: a.n, civ: a.civ, anyType: !a.creatureOnly, creatureOnly: !!a.creatureOnly, spellOnly: !!a.spellOnly };
          break;
        case 'drawIfOppMoreHand':
          if (op.hand.length > me.hand.length) this.draw(pi, 1);
          break;
        case 'freezeOppAll':
          for (const c of op.battle) if (this.isCreature(c) && this.power(c) <= a.maxPower) c.frozenUntil = this.nextTurnOf(op.idx);
          this.log(`${op.name}のパワー${a.maxPower}以下のクリーチャーは、次のターンのはじめにアンタップしない`);
          break;
        case 'teamNoDestroyTurn':
          for (const c of me.battle) if (this.isCreature(c)) c.noDestroyUntil = Math.max(c.noDestroyUntil || 0, this.turn);
          this.log(`このターン、${me.name}のクリーチャーは破壊されない`);
          break;
        case 'useTrigger': {
          const w = a.when;
          let c = null;
          if (a.from === 'pick') {
            const pool = me.battle.filter((x) => this.isCreature(x) && x !== src && this.hasAbility(x, w));
            c = (await this.pickCards(pi, pool, 1, !!a.optional, `${nm}: 能力を使うクリーチャーを選んでください`, 'recover'))[0];
          } else if (a.from === 'event') c = this._eventCard;
          else if (a.from === 'self') c = src;
          else c = (this.lastChosen || [])[0];
          if (!c || !this.hasAbility(c, w)) break;
          if (a.optional && a.from !== 'pick' && !(await this.yesNo(pi, `${nm}: 「${c.def.name}」の${w === 'attack' ? '攻撃する時' : '出た時'}の能力を使いますか？`, c))) break;
          this.log(`${nm}: 「${c.def.name}」の${w === 'attack' ? '攻撃する時' : '出た時'}の能力を使う`);
          await this.runAbility(c, w, pi, c.def);
          break;
        }
        case 'repeatCount': {
          const cnt = a.count === 'selfCards' ? 1 + (src.under || []).length : 0;
          const times = Math.floor(cnt / (a.per || 1));
          if (times > 0) this.log(`${nm}: ${times}回くり返す`);
          const allChosen = [];
          for (let i = 0; i < times; i++) {
            for (const x of a.acts) await this.doAction(x, src, pi);
            for (const c of this.lastChosen || []) if (!allChosen.includes(c)) allChosen.push(c);
          }
          this.lastChosen = allChosen;
          break;
        }
        case 'evolveOntoSelf': {
          if (this.zoneOf(src) !== 'battle') break;
          const pool = me.hand.filter((c) => this.evoKind(c.def) && !/grave/.test(this.evoKind(c.def)) && (a.maxCost == null || (+c.def.cost || 0) <= a.maxCost) && (!a.neo || /NEO/i.test(this.evoKind(c.def) + (c.def.text || '').slice(0, 30))) && this.evoBases(pi, c.def).includes(src) && (!a.cond || this.fitLook(c, a.cond)));
          const r = await this.pickCards(pi, pool, 1, true, `${nm}: この上に置く進化クリーチャーを選んでください`, 'recover');
          if (r[0]) {
            this.log(`${me.name}は「${r[0].def.name}」を「${src.def.name}」の上に置いた`);
            await this.enterBattle(r[0], pi, 'other', { evolveFrom: src, evoChosen: true });
          }
          this._lastChanged = !!r[0];
          break;
        }
        case 'breakAnyOne': {
          const sides = [];
          if (op.shields.length) sides.push({ id: 'opp', label: `${op.name}のシールド` });
          if (me.shields.length) sides.push({ id: 'own', label: `${me.name}のシールド` });
          if (!sides.length) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: シールドを1つブレイクしますか？`, src))) break;
          const side = sides.length === 1 ? sides[0].id : (await this.chooseModes(pi, `${nm}: どちらのシールドをブレイクしますか？`, sides, { min: 1, max: 1, aiPick: ['opp'] }))[0];
          await this.breakShields(side === 'opp' ? pi : 1 - pi, 1, src);
          break;
        }
        case 'drawSelfCards':
          this.draw(pi, 1 + (src.under || []).length);
          this.log(`${me.name}は${nm}に含まれるカードと同じ${1 + (src.under || []).length}枚を引いた`);
          break;
        case 'ownShieldToGrave': {
          if (!me.shields.length) break;
          const r = await this.pickCards(pi, me.shields.slice(), Math.min(a.n, me.shields.length), false, `${nm}: 墓地に置く自分のシールド（裏向きのまま）`, 'shield', 'discard');
          for (const c of r) {
            this.moveTo(c, 'grave');
            this.log(`${me.name}はシールドを1つ墓地に置いた（S・トリガーは使えない）`);
          }
          break;
        }
        case 'breakBonus': {
          if (this.zoneOf(src) !== 'battle') break;
          const times = src._brokeN || 0;
          for (let i = 0; i < times; i++) {
            if (!(await this.yesNo(pi, `${nm}: ブレイク・ボーナスを使いますか？（${i + 1}/${times}回目）`, src))) break;
            for (const x of a.acts) await this.doAction(x, src, pi);
          }
          break;
        }
        case 'attachSelfFromHand': {
          const host = this._eventCard;
          if (this.zoneOf(src) !== 'hand' || !host || this.zoneOf(host) !== 'battle') break;
          if (!(await this.yesNo(pi, `${nm}: 手札から「${host.def.name}」に付けますか？`, src))) break;
          this.moveTo(src, 'battle');
          src.sick = false;
          src.attachedTo = host.uid;
          src.enteredTurn = this.turn;
          this.log(`${me.name}は手札の「${src.def.name}」を「${host.def.name}」に付けた`);
          await this.trigger(src, 'summon', pi);
          break;
        }
        case 'drawBoth':
          this.draw(pi, a.n);
          this.draw(1 - pi, a.n);
          this.log(`各プレイヤーはカードを${a.n}枚引いた`);
          break;
        case 'oppSacToGrave': {
          const pool = op.battle.filter((c) => this.isCreature(c));
          const r = await this.pickCards(1 - pi, pool, Math.min(a.n, pool.length), false, `${nm}: 墓地に置く自分のクリーチャーを選んでください`, 'discard');
          for (const c of r) {
            if (this.cannotLeave(c)) {
              this.log(`「${c.def.name}」は離れない`);
              continue;
            }
            await this.leave(c, 'grave', { byOpp: true });
            this.log(`${op.name}は「${c.def.name}」を墓地に置いた`);
          }
          break;
        }
        case 'deckUnderSelfShield': {
          if (this.zoneOf(src) !== 'shields') break;
          const cs = me.deck.splice(0, Math.min(a.n, me.deck.length));
          src.under = (src.under || []).concat(cs.map((c) => ((c.faceUp = false), c)));
          this.log(`${nm}: 山札の上から${cs.length}枚を裏向きでこのシールドの下に置いた`);
          break;
        }
        case 'eventUnderSelfShield': {
          const c = this._eventCard;
          if (this.zoneOf(src) !== 'shields' || !c || this.zoneOf(c) !== 'grave') break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 「${c.def.name}」を墓地からこのシールドの下に置きますか？`, src))) break;
          const f = this.find(c.uid);
          if (f) (f.arr || f.player[f.zone]).splice(f.index, 1);
          c.faceUp = false;
          src.under = (src.under || []).concat(c);
          this.log(`${nm}: 「${c.def.name}」を裏向きでこのシールドの下に置いた`);
          break;
        }
        case 'destroyPowerSum': {
          const lim = a.max === 'self' ? this.power(src) : a.max;
          const pool = op.battle.filter((c) => this.isCreature(c) && this.selectable(c, pi)).sort((x, y) => this.power(y) - this.power(x));
          const chosen = [];
          let sum = 0;
          if (me.isAI) {
            for (const c of pool) if (sum + this.power(c) <= lim) chosen.push(c), (sum += this.power(c));
          } else {
            for (;;) {
              const rest = pool.filter((c) => !chosen.includes(c) && sum + this.power(c) <= lim);
              if (!rest.length) break;
              const r = await this.pickCards(pi, rest, 1, true, `${nm}: 破壊する相手のクリーチャー（パワー合計${sum}/${lim}）`, 'target', 'destroy');
              if (!r[0]) break;
              chosen.push(r[0]);
              sum += this.power(r[0]);
            }
          }
          if (chosen.length) await this.destroyMany(chosen, { byOpp: true });
          break;
        }
        case 'tapOrUntap': {
          const pool = [...me.battle, ...op.battle].filter((c) => c !== src && this.isCreature(c));
          const r = await this.pickCards(pi, pool, 1, false, `${nm}: タップまたはアンタップするクリーチャー`, 'target');
          if (r[0]) {
            r[0].tapped = !r[0].tapped;
            this.log(`「${r[0].def.name}」を${r[0].tapped ? 'タップ' : 'アンタップ'}した`);
          }
          break;
        }
        case 'distribute': {
          const look = me.deck.splice(0, Math.min(a.n, me.deck.length));
          if (!look.length) break;
          this.log(`${nm}: 山札の上から${look.length}枚を見た`);
          let rest = look.slice();
          for (const dz of a.dests) {
            if (!rest.length) break;
            const r = rest.length === 1 ? rest : await this.pickCards(pi, rest, 1, false, `${nm}: ${{ hand: '手札', mana: 'マナゾーン', grave: '墓地', bottom: '山札の下' }[dz]}に置くカード`, 'recover');
            const c = r[0];
            rest = rest.filter((x) => x !== c);
            if (dz === 'bottom') me.deck.push(c);
            else this.moveTo(c, dz);
            if (dz !== 'bottom') this.log(`「${c.def.name}」を${{ hand: '手札', mana: 'マナゾーン', grave: '墓地' }[dz]}に置いた`);
          }
          me.deck.push(...rest);
          break;
        }
        case 'oppHandPickPut': {
          if (!op.hand.length) break;
          this.log(`${me.name}は${op.name}の手札を見た：${op.hand.map((c) => c.def.name).join('、')}`);
          const pool = op.hand.filter((c) => this.isCreatureDef(c));
          const r = await this.pickCards(pi, pool, 1, false, `${nm}: ${op.name}の手札からクリーチャーを1体選んでください`, 'target');
          if (r[0] && (await this.yesNo(1 - pi, `${nm}: 選ばれた「${r[0].def.name}」を出しますか？`, r[0]))) await this.enterBattle(r[0], 1 - pi, 'other');
          break;
        }
        case 'chooseRace': {
          const cnt = {};
          for (const pl of this.p) for (const z of ['battle', 'hand', 'grave', 'mana', 'deck']) for (const c of pl[z]) for (const r of c.def.races || []) cnt[r] = (cnt[r] || 0) + (pl === me && z === 'battle' ? 5 : pl === me ? 1 : 0.5);
          const races = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x]);
          if (!races.length) break;
          const ids = await this.chooseModes(pi, `${nm}: 種族を1つ選んでください`, races.slice(0, 40).map((r) => ({ id: r, label: r })), { min: 1, max: 1, aiPick: [races[0]] });
          const race = ids[0] || races[0];
          this.log(`${me.name}は種族「${race}」を選んだ`);
          const acts = JSON.parse(JSON.stringify(a.acts).split('センタクシュゾク・').join(race).split('センタクシュゾク').join(race));
          for (const x of acts) await this.doAction(x, src, pi);
          break;
        }
        case 'janken': {
          if (a.optional && !(await this.yesNo(pi, `${nm}: 相手とジャンケンしますか？`, src))) break;
          const HANDS = ['グー', 'チョキ', 'パー'];
          const pickHand = async (q) => (this.p[q].isAI ? HANDS[Math.floor(Math.random() * 3)] : (await this.chooseModes(q, 'ジャンケン：手を選んでください', HANDS.map((h) => ({ id: h, label: h })), { min: 1, max: 1, aiPick: ['グー'] }))[0] || 'グー');
          let res = 0;
          for (let i = 0; i < 20 && !res; i++) {
            const h1 = await pickHand(pi);
            const h2 = await pickHand(1 - pi);
            this.log(`ジャンケン：${me.name}は${h1}、${op.name}は${h2}`);
            this._lastJanken = { by: 1 - pi, hand: h2 };
            for (const s2 of this.permanents(pi)) if (this.isOnField(s2) && this.hasAbility(s2, 'oppJanken')) await this.trigger(s2, 'oppJanken', pi, s2.def, null, { defer: true });
            if (h1 !== h2) res = (HANDS.indexOf(h1) + 1) % 3 === HANDS.indexOf(h2) ? 1 : -1;
          }
          await this.resolvePending();
          this.log(`ジャンケン：${me.name}の${res > 0 ? '勝ち' : '負け'}`);
          for (const x of res > 0 ? a.win : a.lose) await this.doAction(x, src, pi);
          break;
        }
        case 'gachinko': {
          if (a.optional && !(await this.yesNo(pi, `${nm}: ガチンコ・ジャッジしますか？`, src))) break;
          const t1 = me.deck[0];
          const t2 = op.deck[0];
          const c1 = t1 ? +t1.def.cost || 0 : -1;
          const c2 = t2 ? +t2.def.cost || 0 : -1;
          this.log(`ガチンコ・ジャッジ：${me.name}「${t1 ? t1.def.name : 'なし'}」(${c1}) vs ${op.name}「${t2 ? t2.def.name : 'なし'}」(${c2})`);
          if (t1) me.deck.push(me.deck.shift());
          if (t2) op.deck.push(op.deck.shift());
          const win = t1 && c1 >= c2;
          this.log(`ガチンコ・ジャッジ：${me.name}の${win ? '勝ち' : '負け'}`);
          this._lastChanged = !!win;
          if (win) for (const x of a.win) await this.doAction(x, src, pi);
          break;
        }
        case 'majiBomber': {
          const top = me.deck[0];
          if (top) this.log(`マジボンバー：${me.name}は山札の上を見た${me.isAI ? '' : '（「' + top.def.name + '」）'}`);
          const pool = [...me.hand, ...(top ? [top] : [])].filter((c) => this.isCreatureDef(c) && (+c.def.cost || 0) <= a.n);
          const r = await this.pickCards(pi, pool, 1, true, `マジボンバー：手札か山札の上からコスト${a.n}以下のクリーチャーを出してもよい`, 'recover');
          if (r[0]) await this.enterBattle(r[0], pi, 'other');
          break;
        }
        case 'jChange': {
          if (this.zoneOf(src) !== 'battle') break;
          const pool = me.mana.filter((c) => this.isCreatureDef(c) && ((c.def.races || []).join('/')).includes('ジョーカーズ') && (+c.def.cost || 0) <= a.n);
          if (!pool.length) break;
          const r = await this.pickCards(pi, pool, 1, true, `Jチェンジ：このクリーチャーと入れ替えるマナのジョーカーズ（コスト${a.n}以下）`, 'recover');
          if (!r[0]) break;
          this.log(`Jチェンジ：「${src.def.name}」と「${r[0].def.name}」を入れ替えた`);
          await this.leave(src, 'mana', { byOpp: false });
          await this.enterBattle(r[0], pi, 'other');
          break;
        }
        case 'useDyn': {
          const lim = me[a.cmp].filter((c) => c !== src).length;
          const pool = me.hand.filter((c) => c !== src && (+c.def.cost || 0) <= lim && (!a.nonCreature || NON_CREATURE.includes(c.def.type)) && !this.locked(pi, c.def));
          const r = await this.pickCards(pi, pool, a.n, true, `${nm}: 手札からコストなしで使うカード（コスト${lim}以下）`, 'recover');
          for (const c of r) await this.putIntoPlay(pi, c, true);
          break;
        }
        case 'breakOppOne':
          if (op.shields.length) await this.breakShields(pi, 1, src);
          break;
        case 'putDyn': {
          const lim = (a.cmp === 'shields' ? me.shields : me[a.cmp]).filter((c) => c !== src).length;
          const pool = me[a.from].filter((c) => c !== src && (this.isCreatureDef(c) || ['tamaseed', 'field'].includes(c.def.type)) && this.fitLook(c, a.cond) && (a.lt ? (+c.def.cost || 0) < lim : (+c.def.cost || 0) <= lim));
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: 出すカード（コスト${a.lt ? lim + '未満' : lim + '以下'}）`, 'recover');
          for (const c of r) await this.enterBattle(c, pi, 'other');
          this._lastChanged = r.length > 0;
          break;
        }
        case 'eventBuff': {
          const c = this._eventCard;
          if (!c || this.zoneOf(c) !== 'battle') break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 「${c.def.name}」を強化しますか？`, c))) break;
          c.tempPower = (c.tempPower || 0) + a.power;
          const pl = this.p[c.owner];
          (pl.tempGrants = pl.tempGrants || []).push({ names: a.names, until: this.turn, uids: [c.uid], power: 0 });
          this.log(`「${c.def.name}」はこのターン、パワー+${a.power}${a.names.map((x) => '・「' + x + '」').join('')}`);
          break;
        }
        case 'reviveEvent': {
          const c = this._eventCard;
          if (!c || !['grave', 'hand', 'mana'].includes(this.zoneOf(c)) || !this.isCreatureDef(c)) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 「${c.def.name}」を出しますか？`, c))) break;
          await this.enterBattle(c, c.owner === pi ? pi : pi, 'other');
          break;
        }
        case 'selfToHyperAfterEnter':
          src._toHyperAfterEnter = true;
          break;
        case 'teamNoLeaveMine':
          me.noLeaveUntil = this.nextTurnOf(pi) - 1;
          this.log(`次の${me.name}のターンのはじめまで、${me.name}の${a.elements ? 'エレメント' : 'クリーチャー'}は離れない`);
          break;
        case 'teamNoLeaveNext':
          me.noLeaveUntil = this.nextTurnOf(1 - pi);
          this.log(`次の${op.name}のターン中、${me.name}のクリーチャーは離れない`);
          break;
        case 'oppGraveToBottom': {
          const g2 = op.grave.slice();
          shuffle(g2, this.rng);
          for (const c of g2) this.moveTo(c, 'deck', { top: false });
          this.log(`${op.name}は墓地${g2.length}枚をシャッフルして山札の下に置いた`);
          break;
        }
        case 'oppAllCreaturesToDeck': {
          const pool = op.battle.filter((c) => this.isCreature(c));
          for (const c of pool) await this.leave(c, 'deck', { byOpp: true });
          shuffle(op.deck, this.rng);
          this.log(`${op.name}はクリーチャー${pool.length}体を山札に加えてシャッフルした`);
          break;
        }
        case 'drawToMatch': {
          const n = op.hand.length - me.hand.length;
          if (n > 0) this.draw(pi, n);
          break;
        }
        case 'oppBigToBottom': {
          const pool = op.battle.filter((c) => this.isCreature(c) && (+c.def.cost || 0) > op.mana.length);
          for (const c of pool) await this.leave(c, 'deck', { byOpp: true, moveOpt: { top: false } });
          if (pool.length) this.log(`${op.name}のマナより重いクリーチャー${pool.length}体を山札の下に置いた`);
          break;
        }
        case 'allNoAttackTurn':
          for (const pl of [me, op]) for (const c of pl.battle) c.noAttackTurn = this.turn;
          this.log('このターン、クリーチャーは攻撃できない');
          break;
        case 'selfToShield':
          if (this.zoneOf(src) && this.zoneOf(src) !== 'shields') {
            this.moveTo(src, 'shields');
            this.log(`${nm}を裏向きでシールドに加えた`);
            await this.shieldAdded(pi);
          }
          break;
        case 'selfToHand':
          if (!['battle', 'grave', 'mana'].includes(this.zoneOf(src))) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}を手札に戻しますか？`, src))) break;
          if (this.zoneOf(src) === 'battle') await this.leave(src, 'hand', { byOpp: false });
          else this.moveTo(src, 'hand');
          this.log(`${nm}を手札に戻した`);
          break;
        case 'selfAtEnd':
          if (this.zoneOf(src) === 'battle') {
            me.endTurnActs = me.endTurnActs || [];
            me.endTurnActs.push({ uid: src.uid, to: a.to, turn: this.turn });
          }
          break;
        case 'oppSpellLockNext':
          op.locks = op.locks || [];
          op.locks.push({ spell: true, until: this.nextTurnOf(1 - pi), maxCost: null });
          this.log(`次の${op.name}のターンの終わりまで、${op.name}は呪文を唱えられない`);
          break;
        case 'graveAllToMana': {
          if (!me.grave.length) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 墓地のカードをすべてマナゾーンに置きますか？`, src))) break;
          const n = me.grave.length;
          for (const c of me.grave.slice()) this.moveTo(c, 'mana', { tapped: true });
          this.log(`${me.name}は墓地の${n}枚をタップしてマナゾーンに置いた`);
          break;
        }
        case 'lastCastToBottom':
          if (this._lastCast && this.zoneOf(this._lastCast) === 'grave') {
            this.moveTo(this._lastCast, 'deck', { top: false });
            this.log(`「${this._lastCast.def.name}」は唱えた後、山札の下に置かれた`);
          }
          break;
        case 'useFromHand': {
          const pool = me.hand.filter((c) => c !== src && (+c.def.cost || 0) <= a.maxCost && (!a.nonCreature || NON_CREATURE.includes(c.def.type)) && !this.locked(pi, c.def));
          const r = await this.pickCards(pi, pool, a.n, true, `${nm}: 手札からコストなしで使うカード`, 'recover');
          for (const c of r) await this.putIntoPlay(pi, c, true);
          break;
        }
        case 'teamUnblockCiv':
          for (const c of me.battle) if (this.isCreature(c) && (c.def.civs || []).includes(a.civ)) c.unblockableTurn = this.turn;
          this.log(`このターン、${me.name}の指定の文明のクリーチャーはブロックされない`);
          break;
        case 'putFromZones': {
          const pool = a.zones.flatMap((z) => me[z]).filter((c) => this.isCreatureDef(c) && (+c.def.cost || 0) <= a.maxCost && this.fitLook(c, a.cond));
          const r = await this.pickCards(pi, pool, a.n, !!a.optional, `${nm}: 出すクリーチャー`, 'recover');
          for (const c of r) await this.enterBattle(c, pi, 'other');
          break;
        }
        case 'mustAttackLast':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) {
            c.mustAttackUntil = a.next ? this.nextTurnOf(pi) - 1 : this.turn;
            this.log(`「${c.def.name}」は${a.next ? '次の' + me.name + 'のターンのはじめまで' : 'このターン'}、可能なら攻撃する`);
          }
          break;
        case 'shieldToMana': {
          const pool = me.shields.slice();
          const r = await this.pickCards(pi, pool, Math.min(a.n, pool.length), a.optional, `${nm}: マナゾーンに置くシールドを選んでください`, 'shield');
          for (const c of r) {
            this.moveTo(c, 'mana');
            this.log(`${me.name}はシールドを1つマナゾーンに置いた`);
          }
          this._lastChanged = r.length > 0;
          break;
        }
        case 'noAttackLast':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) c.noAttackTurn = this.turn;
          break;
        case 'manaToDeckTop': {
          const r = await this.pickCards(pi, me.mana, Math.min(a.n, me.mana.length), false, `${nm}: 山札の上に置くマナ`, 'recover');
          for (const c of r) this.moveTo(c, 'deck', { top: true });
          if (r.length) this.log(`${me.name}はマナ${r.length}枚を山札の上に置いた`);
          break;
        }
        case 'castFromHandOrGrave': {
          const pool = [...me.hand, ...me.grave].filter((c) => c !== src && c.def.type === 'spell' && (+c.def.cost || 0) <= a.maxCost && (!a.civs.length || (c.def.civs || []).some((x) => a.civs.includes(x))) && !this.locked(pi, c.def));
          const r = await this.pickCards(pi, pool, a.n, true, `${nm}: 手札か墓地からコストなしで唱える呪文`, 'recover');
          for (const c of r) {
            this._castDepth = (this._castDepth || 0) + 1;
            try {
              await this.putIntoPlay(pi, c, true);
            } finally {
              this._castDepth--;
            }
            if (a.bottomAfter && this.zoneOf(c) === 'grave') {
              this.moveTo(c, 'deck', { top: false });
              this.log(`「${c.def.name}」は唱えた後、山札の下に置かれた`);
            }
          }
          break;
        }
        case 'thrillingThree': {
          const look = me.deck.slice(0, 3);
          if (!look.length) break;
          const hit = look.filter((c) => ((c.def.races || []).join('/') + c.def.name).includes(a.race));
          this.log(`スリリング・スリー：山札の上から${look.length}枚を表向きにした：${look.map((c) => c.def.name).join('、')}（${a.race}は${hit.length}枚）`);
          for (const c of look) me.deck.splice(me.deck.indexOf(c), 1);
          me.deck.push(...look);
          for (let i = 0; i < hit.length; i++) {
            if (!(await this.yesNo(pi, `スリリング・スリー：能力を使いますか？（${i + 1}/${hit.length}回目）`, src))) break;
            for (const x of a.acts) await this.doAction(x, src, pi);
          }
          break;
        }
        case 'oppAllToGrave': {
          const pool = op.battle.filter((c) => this.isCreature(c) && this.power(c) <= a.maxPower);
          for (const c of pool) await this.leave(c, 'grave', { byOpp: true });
          if (pool.length) this.log(`${op.name}はパワー${a.maxPower}以下のクリーチャー${pool.length}体を墓地に置いた`);
          break;
        }
        case 'powerMulLast':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) {
            c.tempPower = (c.tempPower || 0) + this.power(c) * (a.mul - 1);
            (this.p[c.owner].tempGrants = this.p[c.owner].tempGrants || []).push({ names: a.names, until: this.turn, uids: [c.uid], power: 0 });
            this.log(`「${c.def.name}」のパワーはこのターン${a.mul}倍（${this.power(c)}）`);
          }
          break;
        case 'grantLastNext':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) {
            (this.p[c.owner].tempGrants = this.p[c.owner].tempGrants || []).push({ names: a.names, until: this.nextTurnOf(pi) - 1, uids: [c.uid], power: a.power || 0 });
            this.log(`次の自分のターンのはじめまで、「${c.def.name}」はパワー+${a.power}・${a.names.map((x) => '「' + x + '」').join('')}`);
          }
          break;
        case 'handToShield': {
          const r = await this.pickCards(pi, me.hand.filter((c) => c !== src), Math.min(a.n, me.hand.length), !!a.optional, `${nm}: シールド化する手札`, 'discard');
          for (const c of r) {
            this.moveTo(c, 'shields');
            if (a.faceUp) c.faceUp = true;
          }
          if (r.length) {
            this.log(`${me.name}は手札を${r.length}枚シールド化した`);
            await this.shieldAdded(pi);
          }
          break;
        }
        case 'powerLastPerGrave':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) {
            const zl = me[a.zone || 'grave'].length;
            c.tempPower = (c.tempPower || 0) + Math.floor(zl / a.per) * a.n;
            this.log(`「${c.def.name}」のパワーはこのターン${Math.floor(zl / a.per) * a.n}（${this.power(c)}）`);
          }
          {
            const dead = (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle' && this.isCreature(x) && this.power(x) <= 0);
            if (dead.length) await this.destroyMany(dead);
          }
          break;
        case 'destroyAllBoth': {
          const pool = [...me.battle, ...op.battle].filter((c) => this.isCreature(c) && this.power(c) <= a.maxPower);
          await this.destroyMany(pool, { byOpp: true });
          break;
        }
        case 'ownOtherToGrave': {
          const pool = me.battle.filter((c) => c !== src && this.isCreature(c));
          const r = await this.pickCards(pi, pool, Math.min(a.n, pool.length), false, `${nm}: 墓地に置く自分の他のクリーチャー`, 'discard');
          for (const c of r) await this.leave(c, 'grave', { byOpp: false });
          break;
        }
        case 'selfUnderEvo': {
          if (!['battle', 'hand', 'grave'].includes(this.zoneOf(src))) break;
          const pool = me.battle.filter((c) => c !== src && this.isCreature(c) && this.evoKind(c.def) && (c.under || []).length);
          const r = await this.pickCards(pi, pool, 1, true, `${nm}: 下に置く進化クリーチャー`, 'recover');
          if (!r[0]) break;
          const f = this.find(src.uid);
          if (f) (f.arr || f.player[f.zone]).splice(f.index, 1);
          r[0].under = [...(r[0].under || []), src];
          this.log(`「${src.def.name}」を「${r[0].def.name}」の下に置いた`);
          break;
        }
        case 'choosePlayerDo': {
          const good = a.acts.some((x) => ['draw', 'manaBoost', 'shieldAdd', 'graveToHand'].includes(x.act));
          const r = await this.choose(pi, { kind: 'mode', prompt: `${nm}: プレイヤーを選ぶ`, options: [...(a.optional ? [{ id: 'none', label: '選ばない' }] : []), { id: 'me', label: `${me.name}（自分）` }, { id: 'op', label: `${op.name}（相手）` }], min: 1, max: 1, aiPick: [good ? 'me' : 'op'] });
          if (r[0] === 'none') break;
          const tp = r[0] === 'me' ? pi : 1 - pi;
          this.log(`${nm}: ${this.p[tp].name}を選んだ`);
          for (const x of a.acts) await this.doAction(x, src, tp);
          break;
        }
        case 'lookSeq': {
          if (a.optional && !(await this.yesNo(pi, `${nm}: 山札の${a.whole ? '中' : '上から' + a.n + '枚'}を${a.reveal ? '表向きにします' : '見ます'}か？`, src))) break;
          const look = a.whole ? me.deck.slice() : me.deck.slice(0, a.n);
          if (!look.length) break;
          for (const c of look) me.deck.splice(me.deck.indexOf(c), 1);
          this.log(`${me.name}は山札の${a.whole ? '中' : '上から' + look.length + '枚'}を${a.reveal ? '表向きにした：' + look.map((c) => c.def.name).join('、') : '見た'}`);
          let left = look.slice();
          const tutor = [];
          const worth = (c) => +c.def.cost || 0;
          for (const st0 of a.steps) {
            let st = st0;
            if (st.dest === 'choice') {
              const opts = st.choices.map((d) => ({ id: d, label: { hand: '手札に加える', mana: 'マナゾーンに置く', grave: '墓地に置く', battle: '出す', shields: 'シールド化する', deckTop: '山札の上に置く', deckBottom: '山札の下に置く' }[d] || d }));
              const r = await this.choose(pi, { kind: 'mode', prompt: `${nm}: どこに置きますか？`, options: opts, min: 1, max: 1, aiPick: [st.choices.includes('hand') ? 'hand' : st.choices[0]] });
              st = { ...st, dest: r[0] || st.choices[0] };
            }
            let pool = left.filter((c) => !st.cond || this.fitLook(c, st.cond));
            if (st.dest === 'battle') pool = pool.filter((c) => !NON_CREATURE.includes(c.def.type) || ['tamaseed', 'field'].includes(c.def.type));
            if (st.dest === 'use') pool = pool.filter((c) => !this.locked(pi, c.def));
            if (!pool.length) continue;
            let picked;
            if (st.n === 'all') picked = pool;
            else {
              const max = st.n === 'any' ? pool.length : Math.min(st.n, pool.length);
              const opt = st.n === 'any' || st.upTo;
              if (me.isAI) picked = pool.slice().sort((x, y) => (st.dest === 'grave' || st.dest === 'deckBottom' ? worth(x) - worth(y) : worth(y) - worth(x))).slice(0, max);
              else picked = await this.pickCards(pi, pool, max, opt, `${nm}: ${{ hand: '手札に加える', mana: 'マナゾーンに置く', grave: '墓地に置く', battle: '出す', shields: 'シールドにする', deckTop: '山札の上に置く', deckBottom: '山札の下に置く' }[st.dest]}カード${st.cond ? '（' + st.cond.text + '）' : ''}`, 'recover');
            }
            left = left.filter((c) => !picked.includes(c));
            for (const c of picked) {
              me.deck.unshift(c); // いったん山札に戻して、通常の移動で動かす
              if (st.dest === 'battle') await this.enterBattle(c, pi, 'other');
              else if (st.dest === 'use') {
                if (c.def.type === 'spell') {
                  me.deck.shift();
                  me.hand.push(c);
                  await this.putIntoPlay(pi, c, true);
                } else await this.enterBattle(c, pi, 'other');
              } else if (st.dest === 'tutorTop') {
                me.deck.shift();
                tutor.push(c);
                this.log(`「${c.def.name}」を相手に見せた`);
              } else if (st.dest === 'underSelf') {
                me.deck.shift();
                if (this.zoneOf(src) === 'battle') {
                  src.under = [...(src.under || []), c];
                  this.log(`「${c.def.name}」を${nm}の下に置いた`);
                } else me.grave.push(c);
              } else if (st.dest === 'shields') {
                this.moveTo(c, 'shields');
                if (st.faceUp) c.faceUp = true;
                await this.shieldAdded(pi);
              } else if (st.dest === 'deckTop') {
                /* そのまま上 */
              } else if (st.dest === 'deckBottom') this.moveTo(c, 'deck', { top: false });
              else this.moveTo(c, st.dest, { tapped: st.tapped });
              if (!['battle', 'deckTop', 'tutorTop', 'underSelf', 'use'].includes(st.dest)) this.log(`「${st.dest === 'hand' && !a.reveal ? '？' : c.def.name}」を${{ hand: '手札', mana: 'マナゾーン', grave: '墓地', shields: 'シールド', deckBottom: '山札の下' }[st.dest]}に置いた`);
            }
          }
          if (left.length) {
            const rt = a.restTo ? a.restTo.dest : a.whole ? 'deck' : 'deckTop';
            if (rt === 'deckTop' || rt === 'deck') me.deck.unshift(...left);
            else if (rt === 'deckBottom') me.deck.push(...left);
            else for (const c of left) {
              me.deck.unshift(c);
              if (rt === 'battle') await this.enterBattle(c, pi, 'other');
              else this.moveTo(c, rt, { tapped: a.restTo.tapped });
            }
            if (a.restTo) this.log(`残り${left.length}枚を${{ hand: '手札', mana: 'マナゾーン', grave: '墓地', deckTop: '山札の上', deckBottom: '山札の下', shields: 'シールド', battle: 'バトルゾーン' }[rt] || rt}に置いた`);
          }
          if (a.shuffleAfter) {
            shuffle(me.deck, this.rng);
            this.log(`${me.name}は山札をシャッフルした`);
          }
          if (tutor.length) {
            me.deck.unshift(...tutor);
            this.log(`「${tutor.map((c) => c.def.name).join('、')}」を山札の一番上に置いた`);
          }
          break;
        }
        case 'destroyCostLtGrave': {
          const lim = me.grave.length;
          const pool = op.battle.filter((c) => this.isCreature(c) && (+c.def.cost || 0) < lim);
          const r = await this.pickCards(pi, pool, a.n, false, `${nm}: 破壊する相手のクリーチャー（コスト${lim}未満）`, 'target', 'destroy');
          await this.destroyMany(r, { byOpp: true });
          break;
        }
        case 'castLtSelfHandGrave': {
          const lim = +src.def.cost || 0;
          const pool = [...me.hand, ...me.grave].filter((c) => c !== src && c.def.type === 'spell' && (+c.def.cost || 0) < lim && !this.locked(pi, c.def));
          const r = await this.pickCards(pi, pool, a.n, true, `${nm}: 手札か墓地からコストなしで唱える呪文（コスト${lim}未満）`, 'recover');
          for (const c of r) {
            this._castDepth = (this._castDepth || 0) + 1;
            try {
              await this.putIntoPlay(pi, c, true);
            } finally {
              this._castDepth--;
            }
            if (a.bottomAfter && this.zoneOf(c) === 'grave') {
              this.moveTo(c, 'deck', { top: false });
              this.log(`「${c.def.name}」は唱えた後、山札の下に置かれた`);
            }
          }
          break;
        }
        case 'mowjakinga': {
          const sh = op.shields.length ? (await this.pickCards(pi, op.shields, 1, false, `${nm}: 墓地に置く相手のシールド`, 'shield'))[0] : null;
          const cr = (await this.pickCards(pi, op.battle.filter((c) => this.isCreature(c)), 1, false, `${nm}: 墓地に置く相手のクリーチャー`, 'target', 'destroy'))[0];
          const hd = op.hand.length ? op.hand[Math.floor(this.rng() * op.hand.length)] : null;
          if (sh) this.moveTo(sh, 'grave');
          if (cr) await this.leave(cr, 'grave', { byOpp: true });
          if (hd) await this.discardCard(hd, pi);
          this.log(`${op.name}はシールド・クリーチャー・手札を墓地に置いた`);
          if (sh) await this.shieldsLeft(op.idx);
          break;
        }
        case 'putEachFromManaGrave': {
          const zonePool = [...me.mana, ...me.grave];
          const t = zonePool.filter((c) => c.def.type === 'tamaseed' && (+c.def.cost || 0) <= a.maxCost);
          const r1 = await this.pickCards(pi, t, 1, true, `${nm}: 出すタマシード（コスト${a.maxCost}以下）`, 'recover');
          for (const c of r1) await this.enterBattle(c, pi, 'other');
          const cr = zonePool.filter((c) => !r1.includes(c) && this.zoneOf(c) !== 'battle' && ((c.def.races || []).join('/') + c.def.name).includes(a.race) && (+c.def.cost || 0) <= a.maxCost);
          const r2 = await this.pickCards(pi, cr, 1, true, `${nm}: 出す${a.race}（コスト${a.maxCost}以下）`, 'recover');
          for (const c of r2) await this.enterBattle(c, pi, 'other');
          break;
        }
        case 'manaPutThenFight': {
          const lim = me.mana.length;
          const pool = me.mana.filter((c) => this.isCreatureDef(c) && (+c.def.cost || 0) < lim && !this.evoKind(c.def));
          const r = await this.pickCards(pi, pool, 1, false, `${nm}: マナゾーンから出すクリーチャー`, 'recover');
          const c = r[0];
          if (!c) break;
          await this.enterBattle(c, pi, 'other');
          if (this.zoneOf(c) === 'battle' && (c.def.civs || []).some((x) => a.civs.includes(x))) {
            const t = await this.pickCards(pi, op.battle.filter((x) => this.isCreature(x)), 1, true, `${nm}: 「${c.def.name}」とバトルさせる相手のクリーチャー`, 'target', 'destroy');
            if (t[0]) await this.battle(c, t[0]);
          }
          break;
        }
        case 'handToDeck': {
          if (a.top === 'choose') {
            const rr = await this.choose(pi, { kind: 'mode', prompt: `${nm}: 手札を山札の上と下のどちらに置きますか？`, options: [{ id: 'top', label: '山札の上' }, { id: 'bottom', label: '山札の下' }], min: 1, max: 1, aiPick: ['bottom'] });
            a = { ...a, top: rr[0] === 'top' };
          }
          if (a.n >= 99) {
            const all = me.hand.filter((c) => c !== src);
            for (const c of all) this.moveTo(c, 'deck', { top: a.top });
            this.log(`${me.name}は手札${all.length}枚を山札の${a.top ? '上' : '下'}に置いた`);
            break;
          }
          const r = me.isAI ? me.hand.filter((c) => c !== src).slice(0, a.n) : await this.pickCards(pi, me.hand.filter((c) => c !== src), Math.min(a.n, me.hand.length), false, `${nm}: 山札の${a.top ? '上' : '下'}に置く手札（${a.n}枚・選んだ順に上から）`, 'discard');
          for (const c of r.slice().reverse()) this.moveTo(c, 'deck', { top: a.top });
          this.log(`${me.name}は手札を${r.length}枚、山札の${a.top ? '上' : '下'}に置いた`);
          break;
        }
        case 'oppTeamLockTurn':
          for (const c of op.battle) if (this.isCreature(c)) c.lockedUntil = Math.max(c.lockedUntil || 0, this.turn);
          this.log(`このターン、${op.name}のクリーチャーは攻撃もブロックもできない`);
          break;
        case 'graveToDeckBottomPlayer': {
          const r = await this.choose(pi, { kind: 'mode', prompt: `${nm}: 墓地を山札の下に置くプレイヤー`, options: [{ id: 'none', label: '選ばない' }, { id: 'me', label: `${me.name}（自分）` }, { id: 'op', label: `${op.name}（相手）` }], min: 1, max: 1, aiPick: [op.grave.length >= me.grave.length ? 'op' : 'none'] });
          const pl = r[0] === 'me' ? me : r[0] === 'op' ? op : null;
          if (!pl) break;
          const g2 = pl.grave.slice();
          shuffle(g2, this.rng);
          for (const c of g2) this.moveTo(c, 'deck', { top: false });
          this.log(`${pl.name}の墓地${g2.length}枚をシャッフルして山札の下に置いた`);
          break;
        }
        case 'eventPowerZero': {
          const ev = this._eventCard;
          if (!ev || this.zoneOf(ev) !== 'battle') break;
          ev.tempPower = (ev.tempPower || 0) - this.power(ev);
          this.log(`このターン、「${ev.def.name}」のパワーは0になった`);
          break;
        }
        case 'discardAnyDestroy': {
          const r = await this.pickCards(pi, me.hand.filter((c) => c !== src), me.hand.length, true, `${nm}: 捨てる手札（好きな数・1枚につき相手を1体破壊）`, 'discard');
          for (const c of r) await this.discardCard(c, pi);
          if (r.length) {
            const pool = op.battle.filter((c) => this.isCreature(c) && this.power(c) <= a.maxPower);
            const t = await this.pickCards(pi, pool, Math.min(r.length, pool.length), false, `${nm}: 破壊する相手のクリーチャー（${r.length}体）`, 'target', 'destroy');
            await this.destroyMany(t, { byOpp: true });
          }
          break;
        }
        case 'useFromGraveLE': {
          const lim = me.grave.length;
          const pool = me.grave.filter((c) => c !== src && (+c.def.cost || 0) <= lim && (!a.civ || (c.def.civs || []).includes(a.civ)) && !this.locked(pi, c.def));
          const r = await this.pickCards(pi, pool, a.n, true, `${nm}: 墓地からコストなしで使うカード（コスト${lim}以下）`, 'recover');
          for (const c of r) {
            this._castDepth = (this._castDepth || 0) + 1;
            try {
              await this.putIntoPlay(pi, c, true);
            } finally {
              this._castDepth--;
            }
            if (a.bottomAfter && c.def.type === 'spell' && this.zoneOf(c) === 'grave') {
              this.moveTo(c, 'deck', { top: false });
              this.log(`「${c.def.name}」は墓地のかわりに山札の下に置かれた`);
            }
          }
          break;
        }
        case 'reviveDestroyedThisTurn': {
          const ids = new Set((me.destroyedLog || []).filter((x) => x.turn === this.turn).map((x) => x.uid));
          const pool = me.grave.filter((c) => ids.has(c.uid));
          if (!pool.length) break;
          const r = await this.pickCards(pi, pool, pool.length, true, `${nm}: このターンに破壊されたエレメントを墓地から出す（好きな数）`, 'recover');
          for (const c of r) await this.enterBattle(c, pi, 'other');
          break;
        }
        case 'bottomRevealPut': {
          const look = me.deck.slice(-a.n);
          if (!look.length) break;
          this.log(`${me.name}は山札の下から${look.length}枚を表向きにした：${look.map((c) => c.def.name).join('、')}`);
          const pool = look.filter((c) => this.isCreatureDef(c) && this.fitLook(c, a.cond));
          const r = await this.pickCards(pi, pool, a.k, true, `${nm}: 出すクリーチャー`, 'recover');
          for (const c of r) await this.enterBattle(c, pi, 'other');
          for (const c of look.filter((x) => !r.includes(x) && this.zoneOf(x) === 'deck')) {
            me.deck.splice(me.deck.indexOf(c), 1);
            me.deck.unshift(c);
          }
          break;
        }
        case 'lookElementsUse': {
          shuffle(me.deck, this.rng);
          const n = me.battle.length;
          const look = me.deck.slice(0, n);
          if (!look.length) break;
          this.log(`${me.name}は山札をシャッフルし、上から${look.length}枚を見た`);
          const r = await this.pickCards(pi, look.filter((c) => !this.locked(pi, c.def)), 1, true, `${nm}: コストを支払わずに使うカード`, 'recover');
          for (const c of r) {
            me.deck.splice(me.deck.indexOf(c), 1);
            me.hand.push(c);
            await this.putIntoPlay(pi, c, true);
          }
          for (const c of look.filter((x) => !r.includes(x) && this.zoneOf(x) === 'deck')) {
            me.deck.splice(me.deck.indexOf(c), 1);
            me.deck.push(c);
          }
          break;
        }
        case 'atNextTurnStart':
          me.nextStartActs = me.nextStartActs || [];
          me.nextStartActs.push({ turn: this.nextTurnOf(pi), acts: a.acts, src });
          this.log(`${nm}: 次の自分のターンのはじめに効果が起きる`);
          break;
        case 'toShieldAllDraw': {
          const pool = op.battle.filter((c) => this.isCreature(c) && this.power(c) <= a.maxPower);
          let n = 0;
          for (const c of pool) {
            if (await this.leave(c, 'shields', { byOpp: true })) {
              if (a.faceUp) c.faceUp = true;
              n++;
            }
          }
          this.log(`${op.name}のクリーチャー${n}体をシールド化した`);
          if (n) await this.shieldAdded(op.idx);
          this.draw(pi, n);
          break;
        }
        case 'breakBothOne':
          if (me.shields.length) await this.breakShields(1 - pi, 1, src);
          if (op.shields.length) await this.breakShields(pi, 1, src);
          break;
        case 'stackSelfOnShield':
          if (['grave', 'battle', 'hand'].includes(this.zoneOf(src))) await this.stackOnShield(src, pi);
          break;
        case 'stackOppOnShield': {
          const pool = op.battle.filter((c) => (a.any || this.isCreature(c)) && (a.maxCost == null || (+c.def.cost || 0) <= a.maxCost) && (!a.notEvo || !(c.under || []).length));
          const r = await this.pickCards(pi, pool, a.n, !!a.optional, `${nm}: 持ち主のシールドの上に置く相手のクリーチャー`, 'target', 'bounce');
          for (const c of r) {
            if (this.cannotLeave(c)) {
              this.log(`「${c.def.name}」は離れない`);
              continue;
            }
            const under = (c.under || []).splice(0);
            for (const u of under) this.p[u.owner].grave.push(u);
            await this.stackOnShield(c, pi);
          }
          break;
        }
        case 'breakOwn':
          if (!me.shields.length) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 自分のシールドを${a.n}つブレイクしますか？`, src))) break;
          await this.breakShields(1 - pi, Math.min(a.n, me.shields.length), src);
          break;
        case 'discardAllBoth':
          for (const pl of [me, op]) {
            const n = pl.hand.length;
            for (const c of pl.hand.slice()) await this.discardCard(c, pi);
            this.log(`${pl.name}は手札を${n}枚すべて捨てた`);
          }
          break;
        case 'untapAfterAttackSelf':
          src.untapAfterAttackTurn = this.turn;
          break;
        case 'repeatBuzz': {
          const times = 1 + (src._buzzN || 0);
          delete src._buzzN;
          for (let i = 0; i < times; i++) {
            if (times > 1) this.log(`${nm}: バズレンダの能力（${i + 1}/${times}回目）`);
            for (const x of a.acts) await this.doAction(x, src, pi);
          }
          break;
        }
        case 'graveAllToDeck': {
          const n = me.grave.length;
          for (const c of me.grave.slice()) this.moveTo(c, 'deck');
          shuffle(me.deck, this.rng);
          this.log(`${me.name}は墓地のカード${n}枚を山札に加えてシャッフルした`);
          break;
        }
        case 'resetHands':
          for (const pl of [me, op]) {
            for (const c of [...pl.hand, ...pl.grave]) this.moveTo(c, 'deck');
            shuffle(pl.deck, this.rng);
          }
          this.log(`各プレイヤーは手札と墓地を山札に加えてシャッフルした`);
          this.draw(pi, a.n);
          this.draw(1 - pi, a.n);
          break;
        case 'hyperSummonN': {
          const manaCivs = new Set(me.mana.flatMap((m) => m.def.civs || []));
          const pool = (me.hyper || []).filter((c) => this.isCreature(c) && (+c.def.cost || 0) <= a.n && (c.def.civs || []).filter((x) => x !== 'zero').every((x) => manaCivs.has(x)));
          const r = await this.pickCards(pi, pool, 1, true, `${nm}: 超次元ゾーンから召喚するクリーチャー（コスト${a.n}以下）`, 'recover');
          for (const c of r) await this.putIntoPlay(pi, c, true);
          break;
        }
        case 'revealSort': {
          const look = me.deck.slice(0, a.n);
          this.log(`${me.name}は山札の上から${look.length}枚を表向きにした：${look.map((c) => c.def.name).join('、')}`);
          for (const c of look) {
            if (this.fitLook(c, a.cond)) this.moveTo(c, a.to, { tapped: a.tapped });
            else if (a.rest === 'grave') this.moveTo(c, 'grave');
            else this.moveTo(c, 'deck', { top: false });
          }
          break;
        }
        case 'chainTop': {
          const top = me.deck[0];
          if (!top) break;
          this.log(`連鎖：山札の上は「${top.def.name}」`);
          if (!NON_CREATURE.includes(top.def.type) && (+top.def.cost || 0) < (+src.def.cost || 0) && (await this.yesNo(pi, `連鎖：「${top.def.name}」を出しますか？`, src))) await this.enterBattle(top, pi, 'other');
          break;
        }
        case 'revealMultiToHand': {
          const top = me.deck[0];
          if (!top || !(await this.yesNo(pi, `${nm}: ロスト・プリズムで山札の上を表向きにしますか？`, src))) break;
          this.log(`ロスト・プリズム：山札の上は「${top.def.name}」`);
          if ((top.def.civs || []).filter((x) => x !== 'zero').length >= 2) {
            this.moveTo(top, 'hand');
            this.log(`多色なので手札に加えた`);
          }
          break;
        }
        case 'graveToDeckBottomN': {
          if (me.grave.length < a.n) break;
          const r = me.isAI ? me.grave.slice(0, a.n) : await this.pickCards(pi, me.grave, a.n, false, `${nm}: 山札の下に置く墓地のカード（${a.n}枚）`, 'recover');
          if (r.length < a.n) break;
          for (const c of r) this.moveTo(c, 'deck', { top: false });
          this.log(`${me.name}は墓地から${r.length}枚を山札の下に置いた`);
          break;
        }
        case 'bounceOwnOther': {
          const pool = me.battle.filter((c) => c !== src && this.isCreature(c));
          const r = await this.pickCards(pi, pool, 1, false, `${nm}: 手札に戻す自分の他のクリーチャー`, 'recover');
          for (const c of r) if (await this.leave(c, 'hand', { byOpp: false })) this.log(`「${c.def.name}」を手札に戻した`);
          break;
        }
        case 'atEndOfTurn':
          me.endTurnFns = me.endTurnFns || [];
          me.endTurnFns.push({ turn: this.turn, acts: a.acts, src, pi });
          this.log(`${nm}: このターンの終わりに効果が起きる`);
          break;
        case 'generateFromHand': {
          const pool = me.hand.filter((c) => attachKind(c.def) === 'cross');
          const r = await this.pickCards(pi, pool, 1, a.optional !== false, `${nm}: コストを支払わずにジェネレートするクロスギア`, 'recover');
          for (const c of r) {
            this.moveTo(c, 'battle');
            this.log(`${me.name}はクロスギア「${c.def.name}」をジェネレートした`);
          }
          break;
        }
        case 'moveEvent': {
          const ev = this._eventCard;
          if (!ev || this.zoneOf(ev) !== 'battle') break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 「${ev.def.name}」を${ZONE_LABEL[a.to === 'deckBottom' ? 'deck' : a.to]}に置きますか？`, src))) break;
          const ok = a.to === 'deckBottom' ? await this.leave(ev, 'deck', { byOpp: ev.owner !== pi, moveOpt: { top: false } }) : await this.leave(ev, a.to, { byOpp: ev.owner !== pi });
          if (ok) {
            this.log(`「${ev.def.name}」は${a.to === 'deckBottom' ? '山札の下' : ZONE_LABEL[a.to]}に置かれた`);
            if (a.to === 'shields') await this.shieldAdded(ev.owner);
          }
          break;
        }
        case 'putSumCost': {
          let budget = a.max;
          const zoneArr = a.from === 'grave' ? me.grave : me.hand;
          const chosen = [];
          for (let g = 0; g < 40; g++) {
            const pool = zoneArr.filter((c) => c !== src && !chosen.includes(c) && this.isCreature(c) && (+c.def.cost || 0) <= budget && (!a.cond || this.fitLook(c, a.cond)));
            if (!pool.length) break;
            let c;
            if (me.isAI) c = pool.sort((x, y) => (+y.def.cost || 0) - (+x.def.cost || 0))[0];
            else c = (await this.pickCards(pi, pool, 1, true, `${nm}: 出すクリーチャー（残りコスト${budget}）`, 'recover'))[0];
            if (!c) break;
            chosen.push(c);
            budget -= +c.def.cost || 0;
          }
          for (const c of chosen) await this.enterBattle(c, pi, 'other');
          break;
        }
        case 'lastAtEnd':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) {
            me.endTurnActs = me.endTurnActs || [];
            me.endTurnActs.push({ uid: c.uid, to: a.to, turn: this.turn });
            this.log(`このターンの終わりに「${c.def.name}」を${{ destroy: '破壊する', hand: '手札に戻す', deckBottom: '山札の下に置く', untap: 'アンタップする' }[a.to]}`);
          }
          break;
        case 'payThen': {
          const mana = this.payWith(pi, { civs: a.civs }, a.cost);
          if (!mana) break;
          if (a.optional !== false && !(await this.yesNo(pi, `${nm}: コスト${a.cost}を支払って使いますか？`, src))) break;
          for (const m of mana) m.tapped = true;
          this.log(`${me.name}はコスト${a.cost}を支払った`);
          for (const x of a.acts) await this.doAction({ ...x, optional: false }, src, pi);
          break;
        }
        case 'asOpp':
          for (const x of a.acts) await this.doAction(x, src, 1 - pi);
          break;
        case 'repeatAsk': {
          if (a.upTo && a.i > 0 && !(await this.yesNo(pi, `${nm}: もう一度使いますか？（${a.i + 1}回目）`, src))) {
            this._repeatStop = this.turn + ':' + src.uid;
            break;
          }
          if (this._repeatStop === this.turn + ':' + src.uid && a.i > 0) break;
          if (a.i === 0) this._repeatStop = null;
          for (const x of a.acts) await this.doAction(x, src, pi);
          break;
        }
        case 'lookSplit': {
          const look = me.deck.slice(0, a.n);
          if (!look.length) break;
          this.log(`${me.name}は山札の上から${look.length}枚を見た`);
          let rest = look.slice();
          for (let i = 0; i < a.dests.length && rest.length; i++) {
            const dest = a.dests[i];
            let c;
            if (i === a.dests.length - 1) c = rest[0];
            else if (me.isAI) c = dest === 'hand' ? rest.slice().sort((x, y) => (+y.def.cost || 0) - (+x.def.cost || 0))[0] : rest[0];
            else c = (await this.pickCards(pi, rest, 1, false, `${nm}: ${{ hand: '手札に加える', mana: 'マナゾーンに置く', grave: '墓地に置く', shields: 'シールド化する' }[dest]}カード`, 'recover'))[0];
            if (!c) break;
            rest = rest.filter((x) => x !== c);
            this.moveTo(c, dest);
            this.log(`「${dest === 'hand' ? '？' : c.def.name}」を${ZONE_LABEL[dest]}に置いた`);
            if (dest === 'shields') await this.shieldAdded(pi);
          }
          break;
        }
        case 'revealUntil': {
          const found = [];
          const shown = [];
          while (me.deck.length && found.length < a.n) {
            const c = me.deck.shift();
            shown.push(c);
            if (this.isCreature(c) && this.fitLook(c, a.cond)) found.push(c);
          }
          this.log(`${me.name}は山札を${shown.length}枚めくった：${shown.map((c) => c.def.name).join('、')}`);
          const others = shown.filter((c) => !found.includes(c));
          me.deck.unshift(...shown);
          for (const c of found) await this.enterBattle(c, pi, 'other');
          for (const c of others) if (this.zoneOf(c) !== 'deck') this.moveTo(c, 'deck');
          shuffle(me.deck, this.rng);
          this.log(`${me.name}は山札をシャッフルした`);
          break;
        }
        case 'oppReanimateAny': {
          const pool = op.grave.filter((c) => this.isCreature(c));
          const r = op.isAI ? pool.slice() : await this.pickCards(op.idx, pool, pool.length, true, `${nm}: 墓地から出すクリーチャー（好きな数）`, 'recover');
          this._suppressEnter = !!a.suppress;
          try {
            for (const c of r) await this.enterBattle(c, op.idx, 'other');
          } finally {
            this._suppressEnter = false;
          }
          break;
        }
        case 'oppManaShieldToGrave': {
          const zs = a.zones || ['mana', 'shields'];
          const pool = zs.flatMap((z) => op[z]).filter((c) => (z0 => !a.faceUp || (z0 === 'battle' || z0 === 'mana' ? !c.faceDown : c.faceUp))(this.zoneOf(c)) && (this.zoneOf(c) !== 'battle' || !c.attachedTo || true));
          const r = op.isAI ? pool.slice().sort((x, y) => (this.zoneOf(x) === 'battle') - (this.zoneOf(y) === 'battle')).slice(0, a.n) : await this.pickCards(op.idx, pool, Math.min(a.n, pool.length), false, `${nm}: 墓地に置く自分のマナかシールド（合計${a.n}枚）`, 'discard');
          let sh = 0;
          for (const c of r) {
            if (this.zoneOf(c) === 'shields') sh++;
            if (this.zoneOf(c) === 'battle') await this.leave(c, 'grave', { byOpp: true });
            else this.moveTo(c, 'grave');
          }
          this.log(`${op.name}はマナ・シールドから${r.length}枚を墓地に置いた`);
          if (sh) await this.shieldsLeft(op.idx);
          break;
        }
        case 'eachPlayerToMana':
          for (const pl of [me, op]) {
            const pool = pl.battle.slice();
            const r = await this.pickCards(pi, pool, 1, true, `${nm}: ${pl.name}のエレメントを1つまで選んでマナゾーンへ`, pl === op ? 'target' : 'discard', 'bounce');
            for (const c of r) if (await this.leave(c, 'mana', { byOpp: c.owner !== pi })) this.log(`「${c.def.name}」は持ち主のマナゾーンに置かれた`);
          }
          break;
        case 'skipRestOfTurn':
          if (this.active !== pi) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: ターンの残りをとばしますか？`, src))) break;
          me.skipRestTurn = this.turn;
          this.log(`${me.name}はターンの残りをとばした`);
          if (!me.isAI) this.releaseWait();
          break;
        case 'pairPick': {
          const mine = await this.pickCards(pi, me.battle.filter((c) => this.isCreature(c)), 1, a.optional, `${nm}: 自分のクリーチャーを1体選ぶ`, 'recover');
          if (!mine.length) break;
          const theirs = await this.pickCards(pi, op.battle.filter((c) => this.isCreature(c)), 1, a.optional, `${nm}: 相手のクリーチャーを1体選ぶ`, 'target', 'destroy');
          if (!theirs.length) break;
          this.chosenHist = (this.chosenHist || []).concat(mine, theirs).slice(-4);
          break;
        }
        case 'oppHandToShield': {
          const r = op.isAI ? op.hand.slice(0, a.n) : await this.pickCards(op.idx, op.hand.slice(), a.n, false, `${nm}: シールド化する自分の手札`, 'discard');
          for (const c of r) this.moveTo(c, 'shields');
          if (r.length) {
            this.log(`${op.name}は手札を${r.length}枚シールド化した`);
            await this.shieldAdded(op.idx);
          }
          break;
        }
        case 'useEtbOfLast': {
          const c = (this.lastDiscarded || [])[0];
          if (!c || !this.hasAbility(c, 'summon')) break;
          if (!(await this.yesNo(pi, `捨てた「${c.def.name}」の「出た時」の能力を使いますか？`, c))) break;
          this.log(`「${c.def.name}」の「出た時」の能力を使う`);
          await this.runAbility(c, 'summon', pi);
          break;
        }
        case 'lastDiscardToBattle': {
          const c = (this.lastDiscarded || [])[0];
          if (c && this.zoneOf(c) === 'grave' && this.isCreature(c)) await this.enterBattle(c, pi, 'other');
          break;
        }
        case 'grantEndLast': {
          const c = this.lastEntered && this.zoneOf(this.lastEntered) === 'battle' ? this.lastEntered : null;
          if (!c) break;
          me.tempGrants = me.tempGrants || [];
          me.tempGrants.push({ names: a.names, until: this.turn, uids: [c.uid], power: 0 });
          me.endTurnActs = me.endTurnActs || [];
          me.endTurnActs.push({ uid: c.uid, to: 'destroy', turn: this.turn });
          this.log(`「${c.def.name}」に${a.names.map((x) => '「' + x + '」').join('')}を与えた（このターンの終わりに破壊）`);
          break;
        }
        case 'seq':
          for (const x of a.acts) await this.doAction(x, src, pi);
          break;
        case 'oppOwnTo': {
          const pool = op.battle.filter((c) => this.isCreature(c));
          const r = op.isAI ? pool.slice().sort((x, y) => this.power(x) - this.power(y)).slice(0, a.n) : await this.pickCards(op.idx, pool, a.n, false, `${nm}: マナゾーンに置く自分のクリーチャー`, 'discard');
          for (const c of r) if (await this.leave(c, a.to, { byOpp: true })) this.log(`${op.name}は「${c.def.name}」を${ZONE_LABEL[a.to]}に置いた`);
          break;
        }
        case 'tapSelfCancel':
          if (this.zoneOf(src) !== 'battle' || src.tapped) break;
          if (!(await this.yesNo(pi, `${nm}: タップしてその攻撃を中止しますか？`, src))) break;
          src.tapped = true;
          this._attackCancelled = true;
          this.log(`「${src.def.name}」をタップして攻撃を中止させた`);
          break;
        case 'cancelAttack':
          this._attackCancelled = true;
          this.log('攻撃は中止された');
          break;
        case 'groupGrant': {
          const grp = (this.lastPutGroup || []).filter((x) => this.zoneOf(x) === 'battle');
          me.tempGrants = me.tempGrants || [];
          for (const c of grp) me.tempGrants.push({ names: a.names, until: this.turn, uids: [c.uid], power: 0 });
          if (grp.length) this.log(`${grp.map((c) => '「' + c.def.name + '」').join('')}に${a.names.map((x) => '「' + x + '」').join('')}を与えた`);
          break;
        }
        case 'tapOppMana': {
          const pool = op.mana.filter((c) => !c.tapped);
          const r = await this.pickCards(pi, pool, a.n, false, `${nm}: タップする相手のマナ`, 'target');
          for (const c of r) c.tapped = true;
          this.lastChosen = r;
          if (r.length) this.log(`${op.name}のマナを${r.length}枚タップした`);
          break;
        }
        case 'freezeLastMana':
          for (const c of this.lastChosen || []) if (this.zoneOf(c) === 'mana') c.frozenUntil = this.nextTurnOf(pi);
          break;
        case 'handToDeckBottom': {
          const r = me.isAI ? me.hand.slice().sort((x, y) => (+y.def.cost || 0) - (+x.def.cost || 0)).slice(0, a.n) : await this.pickCards(pi, me.hand.slice(), Math.min(a.n, me.hand.length), false, `${nm}: 山札の下に置く手札（${a.n}枚）`, 'discard');
          for (const c of r) this.moveTo(c, 'deck', { top: false });
          this.log(`${me.name}は手札を${r.length}枚山札の下に置いた`);
          break;
        }
        case 'manaAllToHand': {
          const r = me.mana.filter((c) => !a.cond || this.fitLook(c, a.cond));
          for (const c of r) this.moveTo(c, 'hand');
          this.lastCount = r.length;
          this.log(`${me.name}はマナゾーンから${r.length}枚を手札に戻した`);
          break;
        }
        case 'selfFromGrave':
          if (!src || this.zoneOf(src) !== 'grave') break;
          if (a.optional && !(await this.yesNo(pi, `墓地の${nm}を出しますか？`, src))) break;
          this.log(`${me.name}は墓地から${nm}を出した`);
          await this.enterBattle(src, pi, 'other');
          if (a.tapped && this.zoneOf(src) === 'battle') src.tapped = true;
          break;
        case 'graveAnyToMana': {
          const pool = me.grave.filter((c) => this.fitLook(c, a.cond));
          const lim = a.n || pool.length;
          const r = me.isAI ? pool.slice(0, lim) : await this.pickCards(pi, pool, Math.min(lim, pool.length), a.n ? a.optional !== false : true, `${nm}: 墓地からマナゾーンに置くカード${a.n ? '（' + a.n + '枚まで）' : '（好きな数）'}`, 'recover');
          for (const c of r) this.moveTo(c, 'mana', { tapped: !!a.tapped });
          if (r.length) this.log(`${me.name}は墓地から${r.length}枚をマナゾーンに置いた`);
          break;
        }
        case 'reviveAtEnd':
          if (!src) break;
          me.endTurnActs = me.endTurnActs || [];
          me.endTurnActs.push({ uid: src.uid, to: 'reviveFromGrave', turn: this.turn });
          this.log(`このターンの終わりに${nm}を墓地から出す`);
          break;
        case 'evolveOnSelf': {
          if (!src || this.zoneOf(src) !== 'battle') break;
          const pool = me.hand.filter((c) => this.evoKind(c.def) && this.fitLook(c, a.cond) && this.evoBases(pi, c.def).includes(src));
          const r = await this.pickCards(pi, pool, 1, a.optional, `${nm}: この上に置く進化クリーチャー`, 'recover');
          if (r[0]) {
            this.log(`「${r[0].def.name}」を${nm}の上に置いた`);
            await this.enterBattle(r[0], pi, 'other', { evolveFrom: src });
          }
          break;
        }
        case 'oppPutBottom': {
          const pool = [...op.battle, ...op.hand];
          if (!pool.length) break;
          const r = op.isAI ? [pool.slice().sort((x, y) => (+x.def.cost || 0) - (+y.def.cost || 0))[0]] : await this.pickCards(op.idx, pool, a.n, false, `${nm}: 山札の下に置く自分のカード（バトルゾーンか手札）`, 'discard');
          for (const c of r) {
            if (this.zoneOf(c) === 'battle') await this.leave(c, 'deck', { byOpp: true, moveOpt: { top: false } });
            else this.moveTo(c, 'deck', { top: false });
            this.log(`${op.name}は「${c.def.name}」を山札の下に置いた`);
          }
          break;
        }
        case 'destroyEvent': {
          const ev = this._eventCard;
          if (ev && this.zoneOf(ev) === 'battle') await this.destroyMany([ev], { byOpp: ev.owner !== pi });
          break;
        }
        case 'graveBottomPick': {
          // どちらの墓地を選ぶか（AIは相手の墓地、多い方）
          let tgt = op.grave.length >= me.grave.length ? op : me;
          if (!me.isAI && me.grave.length && op.grave.length) {
            const [ch] = await this.choose(pi, { kind: 'mode', prompt: `${nm}: どちらの墓地から選びますか？`, options: [{ id: 'op', label: `${op.name}の墓地（${op.grave.length}枚）` }, { id: 'me', label: `${me.name}の墓地（${me.grave.length}枚）` }], min: 1, max: 1, aiPick: ['op'] });
            tgt = ch === 'me' ? me : op;
          }
          if (!tgt.grave.length) {
            this.pickedCount = 0;
            break;
          }
          let r;
          if (a.exact) {
            if (tgt.grave.length < a.exact) {
              const other = tgt === op ? me : op;
              if (other.grave.length >= a.exact) tgt = other;
              else {
                this.pickedCount = 0;
                break;
              }
            }
            if (a.optional && !(await this.yesNo(pi, `${nm}: ${tgt.name}の墓地からカードを${a.exact}枚選んで山札の下に置きますか？`, src))) {
              this.pickedCount = 0;
              break;
            }
            r = me.isAI ? tgt.grave.slice(0, a.exact) : await this.pickCards(pi, tgt.grave.slice(), a.exact, false, `${nm}: 山札の下に置く墓地のカード（${a.exact}枚）`, 'recover');
          } else if (me.isAI) {
            const need = Math.max(0, ...op.battle.filter((c) => this.isCreature(c)).map((c) => +c.def.cost || 0));
            r = tgt.grave.slice(0, Math.min(tgt.grave.length, need || tgt.grave.length));
          } else r = await this.pickCards(pi, tgt.grave.slice(), tgt.grave.length, true, `${nm}: 山札の下に置く墓地のカード（好きな数）`, 'recover');
          for (const c of r) this.moveTo(c, 'deck', { top: false });
          this.pickedCount = r.length;
          this.log(`${tgt.name}の墓地のカード${r.length}枚を山札の下に置いた`);
          break;
        }
        case 'ifLastDiscard': {
          const d0 = (this.lastDiscarded || [])[0];
          if (!d0 || !this.fitLook(d0, a.cond)) {
            this.log(`${nm}: 捨てたカードが${a.text}ではない`);
            break;
          }
          for (const x of a.acts) await this.doAction(x, src, pi);
          break;
        }
        case 'untapAfterAttackLast':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) {
            c.untapAfterAttackTurn = this.turn;
            this.log(`「${c.def.name}」はこのターン最初の攻撃の終わりにアンタップする`);
          }
          break;
        case 'groupGrantEnd': {
          const grp = (this.lastPutGroup || []).filter((x) => this.zoneOf(x) === 'battle');
          for (const c of grp) {
            me.tempGrants = me.tempGrants || [];
            me.tempGrants.push({ names: a.names, until: this.turn, uids: [c.uid], power: 0 });
            me.endTurnActs = me.endTurnActs || [];
            me.endTurnActs.push({ uid: c.uid, to: a.to, turn: this.turn });
          }
          if (grp.length) this.log(`${grp.map((c) => '「' + c.def.name + '」').join('')}に${a.names.map((x) => '「' + x + '」').join('')}を与えた（このターンの終わりに破壊）`);
          break;
        }
        case 'destroySum': {
          const val = (c) => (a.stat === 'power' ? this.power(c) : +c.def.cost || 0);
          const max = a.max === 'discard' ? (this.lastDiscarded || []).reduce((s2, c) => s2 + (+c.def.cost || 0), 0) : a.max;
          let left = max;
          const chosen = [];
          for (let i = 0; i < a.n; i++) {
            const ok = op.battle.filter((c) => this.isCreature(c) && !chosen.includes(c) && val(c) <= left && this.selectable(c, pi));
            if (!ok.length) break;
            const r = await this.pickCards(pi, ok, 1, true, `${nm}: 破壊する相手のクリーチャー（残り${left}）`, 'target', 'destroy');
            if (!r.length) break;
            chosen.push(r[0]);
            left -= val(r[0]);
          }
          if (chosen.length) await this.destroyMany(chosen, { byOpp: true });
          else this.log(`${nm}: 合計${max}以下で破壊できるクリーチャーがいない`);
          break;
        }
        case 'perCount': {
          const w = a.what.replace(/^自分の/, '');
          let cnt;
          if (/^マナゾーンにある/.test(w)) cnt = me.mana.filter((c) => this.fitLook(c, G.TextParse.lookCond(w.replace(/^マナゾーンにある/, '')))).length;
          else if (/^墓地にある/.test(w)) cnt = me.grave.filter((c) => this.fitLook(c, G.TextParse.lookCond(w.replace(/^墓地にある/, '')))).length;
          else if (/^シールド/.test(w)) cnt = me.shields.length;
          else cnt = this.countOwn(pi, w);
          const times = Math.floor(cnt / (a.per || 1));
          if (!times) {
            this.log(`${nm}: 数える${w}がない`);
            break;
          }
          await this.doAction({ ...a.inner, n: a.inner.n * times }, src, pi);
          break;
        }
        case 'showOwn': {
          const pool = me.hand.filter((c) => c !== src && this.fitLook(c, a.cond));
          if (pool.length < a.n) break;
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: 相手に見せる手札（${a.cond.text}）`, 'recover');
          if (r.length < a.n) break;
          this.log(`${me.name}は手札の${r.map((c) => '「' + c.def.name + '」').join('')}を見せた`);
          this.showCount = (this.showCount || 0) + 1; // 「そうしたら」判定用
          break;
        }
        case 'tapManaCost': {
          const pool = me.mana.filter((c) => !c.tapped && (!a.civ || (c.def.civs || []).includes(a.civ)));
          if (pool.length < a.n) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: マナを${a.n}枚タップしますか？`, src))) break;
          const r = me.isAI ? pool.slice(0, a.n) : await this.pickCards(pi, pool, a.n, false, `${nm}: タップするマナ`, 'discard');
          for (const c of r) c.tapped = true;
          this.log(`${me.name}はマナを${r.length}枚タップした`);
          break;
        }
        case 'underToGrave': {
          const und = (src && src.under) || [];
          if (und.length < a.n) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 下にあるカードを${a.n}枚墓地に置きますか？`, src))) break;
          const r = und.slice(-a.n);
          src.under = und.slice(0, und.length - a.n);
          for (const c of r) this.p[c.owner].grave.push(c);
          this.log(`${nm}の下のカード${r.length}枚を墓地に置いた`);
          break;
        }
        case 'destroyOwn': {
          let pool = me.battle.filter((c) => (!a.others || c !== src) && (this.isCreature(c) || /エレメント|カード|タマシード/.test(a.who || '')));
          if (a.who && !/^(クリーチャー|エレメント|カード)$/.test(a.who)) {
            const cd = G.TextParse.lookCond(a.who.replace(/(・)?(クリーチャー|エレメント|カード)$/, ''));
            pool = pool.filter((c) => this.fitLook(c, cd));
          }
          if (pool.length < a.n && !a.upTo) {
            this.log(`${nm}: 破壊できる自分の${a.who || 'クリーチャー'}が足りない`);
            break;
          }
          const r = await this.pickCards(pi, pool, a.n, a.optional || a.upTo, `${nm}: 破壊する自分の${a.who || 'クリーチャー'}（${a.n}つ）`, 'discard');
          if (r.length < a.n && !a.upTo) break;
          await this.destroyMany(r, { byOpp: false });
          break;
        }
        case 'teamBuff': {
          const until = a.until === 'next' ? this.nextTurnOf(pi) - 1 : this.turn;
          let pool = me.battle.filter((c) => this.isCreature(c) && (!a.others || c !== src));
          if (a.who) {
            const cd = G.TextParse.lookCond(a.who);
            pool = pool.filter((c) => this.fitLook(c, cd));
          }
          const tg = a.all ? pool : await this.pickCards(pi, pool, a.n, false, `${nm}: 強化する自分のクリーチャー`, 'recover');
          if (!tg.length) break;
          me.tempGrants = me.tempGrants || [];
          // all の時は後から出たクリーチャーにも効くよう uids を付けない（このターン中）
          me.tempGrants.push({ names: a.names, until, uids: a.all && !a.who && !a.others ? null : tg.map((c) => c.uid), power: a.power || 0 });
          this.log(`${a.until === 'turn' ? 'このターン' : '次のターンのはじめまで'}、${a.all ? '自分のクリーチャーすべて' : tg.map((c) => '「' + c.def.name + '」').join('')}${a.power ? 'のパワー+' + a.power : ''}${a.names.length ? '、能力' + a.names.map((x) => '「' + x.slice(0, 16) + '」').join('') : ''}`);
          break;
        }
        case 'noLose':
          me.noLoseUntil = Math.max(me.noLoseUntil || 0, a.until === 'turn' ? this.turn : this.nextTurnOf(pi) - 1);
          this.log(`${me.name}は${a.until === 'turn' ? 'このターン' : '次のターンまで'}ゲームに負けない`);
          break;
        case 'manaFaceDown': {
          const r = await this.pickCards(pi, me.mana.filter((c) => !c.faceDown), a.n, a.optional, `${nm}: 裏向きにするマナ`, 'discard');
          for (const c of r) c.faceDown = true;
          if (r.length) this.log(`${me.name}はマナを${r.length}枚裏向きにした（文明のないマナになる）`);
          break;
        }
        case 'shieldFaceDown': {
          const r = await this.pickCards(pi, me.shields.filter((c) => c.faceUp), a.n, a.optional, `${nm}: 裏向きにするシールド`, 'recover');
          for (const c of r) c.faceUp = false;
          if (r.length) this.log(`${me.name}は表向きのシールドを${r.length}枚裏向きにした`);
          break;
        }
        case 'shieldFaceUp': {
          const r = await this.pickCards(pi, me.shields.filter((c) => !c.faceUp), a.n, a.optional, `${nm}: 表向きにするシールド`, 'recover');
          for (const c of r) {
            c.faceUp = true;
            this.log(`シールドの「${c.def.name}」を表向きにした`);
          }
          break;
        }
        case 'flipSelf': {
          if (!src || this.zoneOf(src) !== 'battle' || src.frontDef) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}を裏返しますか？`, src))) break;
          const before = src.def.name;
          if (this.flipCard(src)) {
            if (a.untap) src.tapped = false;
            this.log(`${nm}を裏返した → 「${src.def.name}」${src.def.name === before ? '（裏面）' : ''}`);
          }
          break;
        }
        case 'pickTarget': {
          let pool = this.targetsFor(a, pi);
          if (a.friendly && me.isAI && pool.some((c) => c.owner === pi)) pool = pool.filter((c) => c.owner === pi);
          if (a.friendly) this._friendlyPick = true;
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: クリーチャーを${a.n}体選んでください`, a.side === 'self' || a.friendly ? 'recover' : 'target', a.friendly ? undefined : 'destroy');
          this._friendlyPick = false;
          this.chosenHist = (this.chosenHist || []).concat(r).slice(-4);
          if (!r.length) {
            this.lastChosen = [];
            this.lastChosenSeq = (this._seq = (this._seq || 0) + 1);
          }
          break;
        }
        case 'powerLast':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) {
            c.tempPower = (c.tempPower || 0) + a.n;
            if (a.names) {
              const pl = this.p[c.owner];
              (pl.tempGrants = pl.tempGrants || []).push({ names: a.names, until: this.turn, uids: [c.uid], power: 0 });
            }
            this.log(`「${c.def.name}」のパワーはこのターン${a.n > 0 ? '+' : ''}${a.n}（${this.power(c)}）`);
          }
          {
            const dead = (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle' && this.isCreature(x) && this.power(x) <= 0);
            if (dead.length) await this.destroyMany(dead);
          }
          break;
        case 'lockLast':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) {
            c.lockedUntil = this.nextTurnOf(pi) - 1;
            this.log(`「${c.def.name}」は次の${me.name}のターンのはじめまで攻撃もブロックもできない`);
          }
          break;
        case 'fightLast': {
          const t = (this.lastChosen || []).find((x) => this.zoneOf(x) === 'battle');
          if (t && src && this.zoneOf(src) === 'battle' && t !== src) await this.battle(src, t);
          break;
        }
        case 'fightLastTwo': {
          const h = (this.chosenHist || []).filter((x) => this.zoneOf(x) === 'battle');
          const x = h[h.length - 2], y = h[h.length - 1];
          if (x && y && x !== y) await this.battle(x, y);
          else if (y && src && this.zoneOf(src) === 'battle' && y !== src) await this.battle(src, y);
          break;
        }
        case 'moveLast':
          for (const c of (this.lastChosen || []).filter((x) => this.zoneOf(x) === 'battle')) {
            if (a.to === 'deckTopOrBottom') {
              const own = this.p[c.owner];
              const top = own.isAI ? false : (await this.choose(c.owner, { kind: 'mode', prompt: `「${c.def.name}」を山札の上と下のどちらに置きますか？`, options: [{ id: 'top', label: '山札の上' }, { id: 'bottom', label: '山札の下' }], min: 1, max: 1 }))[0] === 'top';
              if (await this.leave(c, 'deck', { byOpp: c.owner !== pi, moveOpt: { top } })) this.log(`「${c.def.name}」は山札の${top ? '上' : '下'}に置かれた`);
            } else if (a.to === 'deckShuffle') {
              if (await this.leave(c, 'deck', { byOpp: c.owner !== pi, shuffleAfter: true })) this.log(`「${c.def.name}」は山札に加えられた`);
            } else if (a.to === 'deckBottom') {
              if (await this.leave(c, 'deck', { byOpp: c.owner !== pi, moveOpt: { top: false } })) this.log(`「${c.def.name}」は山札の下に置かれた`);
            } else if (await this.leave(c, a.to, { byOpp: c.owner !== pi })) this.log(`「${c.def.name}」は${ZONE_LABEL[a.to]}に置かれた`);
          }
          break;
        case 'discardOwnAll': {
          if (!me.hand.length) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 手札をすべて捨てますか？`, src))) break;
          for (const c of me.hand.slice()) this.moveTo(c, 'grave');
          this.log(`${me.name}は手札をすべて捨てた`);
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
          if (!src || this.zoneOf(src) !== 'battle') break;
          if (a.optional && !(await this.yesNo(pi, `${nm}を破壊しますか？`, src))) break;
          this._selfDestroyTried = true;
          if (this.cannotLeave(src)) {
            this.log(`${nm}は破壊しようとしたが、離れない`);
            break;
          }
          await this.destroyMany([src], { byOpp: false });
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
          else if (a.where === 'pickBottom') {
            if (me.isAI) bottom = look.slice().sort((x, y) => (+y.def.cost || 0) - (+x.def.cost || 0)).slice(0, a.k);
            else bottom = await this.pickCards(pi, look, a.k, false, `${nm}: 山札の下に置くカード（${a.k}枚）`, 'discard');
          }
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
          this._selfDestroyTried = false;
          await this.doAction(a.first, src, pi);
          if (this.stateSig() === before && !(a.first.act === 'selfDestroy' && this._selfDestroyTried)) {
            this.log(`${nm}: できなかったので、その後の効果はない`);
            break;
          }
          for (const x of a.acts) await this.doAction(x, src, pi);
          break;
        }
        case 'mill':
          if (a.nFrom === 'selfCost') a = { ...a, n: +src.def.cost || 0 };
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
          if (a.cond) pool = pool.filter((c) => this.fitLook(c, a.cond));
          if (a.costLtEvent) {
            const ev = this._eventCard;
            pool = ev ? pool.filter((c) => c !== ev && (+c.def.cost || 0) < (+ev.def.cost || 0)) : [];
          }
          if (a.civ) pool = pool.filter((c) => (c.def.civs || []).includes(a.civ));
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: 墓地から出すカードを選んでください`, 'recover');
          if (!pool.length) this.log(`${nm}: 墓地に出せるカードがない`);
          this._suppressEnter = !!a.suppress;
          try {
            for (const c of r) await this.enterBattle(c, pi, 'other');
          } finally {
            this._suppressEnter = false;
          }
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
          const base = a.side === 'self' ? me.battle : a.side === 'any' ? [...op.battle, ...me.battle] : op.battle;
          const pool = base.filter((c) => (!a.others || c !== src) && (a.any || this.isCreature(c)) && (a.maxCost == null || (+c.def.cost || 0) <= a.maxCost) && (!a.notEvo || !(c.under || []).length));
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: シールド化する${a.side === 'self' ? '自分の' : a.side === 'any' ? '' : '相手の'}${a.any ? 'エレメント' : 'クリーチャー'}`, a.side === 'self' ? 'recover' : 'target', 'bounce');
          for (const c of r) {
            if (await this.leave(c, 'shields', { byOpp: c.owner !== pi })) {
              if (a.faceUp) c.faceUp = true;
              this.log(`「${c.def.name}」は持ち主のシールドになった`);
              await this.shieldAdded(c.owner);
            }
          }
          break;
        }
        case 'ownShieldToGrave': {
          if (a.optional && me.shields.length < a.n) break;
          if (a.optional && !(await this.yesNo(pi, `${nm}: 自分のシールドを${a.n}つ墓地に置きますか？`, src))) break;
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
          if ([0, 1].some((q) => this.permanents(q).some((s2) => this.kw(s2).noExtraTurns)) || this.permanents(1 - pi).some((s2) => this.kw(s2).oppNoExtraTurns)) {
            this.log('誰もターンを追加できない');
            break;
          }
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
            me.tempGrants.push({ names: a.names, until: a.until === 'turn' ? this.turn : this.nextTurnOf(pi) - 1, uids: [src.uid] });
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
          const r = await this.pickCards(pi, me.battle.filter((c) => this.isCreature(c) && c.tapped && (!a.others || c !== src) && (!a.evoOnly || (this.evoKind(c.def) && (c.under || []).length)) && (!a.cond || this.fitLook(c, a.cond))), a.n, a.optional, `${nm}: アンタップする自分のクリーチャー`, 'recover');
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
          let pool = [...me.hand, ...(a.alsoGrave ? me.grave : [])].filter((c) => c !== src && (a.act === 'castFromHand' ? c.def.type === 'spell' : (a.kinds || ['creature']).includes(this.isCreature(c) ? 'creature' : c.def.type)));
          if (a.maxCost != null) pool = pool.filter((c) => (+c.def.cost || 0) <= a.maxCost);
          if (a.notEvo) pool = pool.filter((c) => !this.evoKind(c.def));
          if (a.civ) pool = pool.filter((c) => (c.def.civs || []).includes(a.civ));
          if (a.nameHas) pool = pool.filter((c) => c.def.name.includes(a.nameHas));
          if (a.hasText) pool = pool.filter((c) => (c.def.text || '').includes(a.hasText));
          if (a.cond) pool = pool.filter((c) => this.fitLook(c, a.cond));
          if (a.costLtEvent && this._eventCard) pool = pool.filter((c) => (+c.def.cost || 0) < (+this._eventCard.def.cost || 0));
          if (a.costLESelf) pool = pool.filter((c) => (+c.def.cost || 0) <= (+src.def.cost || 0));
          if (a.act === 'castFromHand') pool = pool.filter((c) => !this.locked(pi, c.def));
          const r = await this.pickCards(pi, pool, a.n, a.optional, `${nm}: 手札から${a.act === 'castFromHand' ? '唱える呪文' : '出すクリーチャー'}`, 'recover');
          for (const c of r) {
            if (a.act === 'castFromHand') await this.putIntoPlay(pi, c, true);
            else await this.enterBattle(c, pi, 'other');
          }
          break;
        }
        case 'tapOrUntap': {
          const pool = [...(a.ownOnly ? [] : op.battle), ...me.battle].filter((c) => this.isCreature(c));
          const r = await this.pickCards(pi, pool, a.n, !!a.optional, `${nm}: タップまたはアンタップするクリーチャー`, a.ownOnly ? 'recover' : 'target', 'tap');
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
          const shPool = me.shields.filter((x) => !a.faceDownOnly || (!x.faceUp && !(x.under || []).some((u) => u.faceUp)));
          const r = await this.pickCards(pi, shPool, Math.min(a.n, shPool.length), a.optional, `${nm}: 手札に加える自分のシールド`, 'recover');
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
      const prevBatch = this._goneBatch;
      this._goneBatch = gone;
      try {
        return await this.destroyManyInner(cards, o, gone);
      } finally {
        this._goneBatch = prevBatch;
      }
    }
    async destroyManyInner(cards, o, gone) {
      for (const c of cards) {
        if (this.zoneOf(c) !== 'battle') continue;
        // パワー0以下のクリーチャーはルールで破壊される（「破壊されない」では耐えられず、「離れない」でだけ残る）
        const zero = () => this.isCreature(c) && this.power(c) <= 0 && !this.kw(c).zeroGuard;
        if (this.kw(c).zeroGuard && this.power(c) <= 0) {
          this.log(`「${c.def.name}」はパワー0以下の間、破壊されない`);
          continue;
        }
        if (!zero() && ((c.noDestroyUntil || 0) >= this.turn || this.kw(c).noDestroy)) {
          this.log(`「${c.def.name}」は破壊されない`);
          continue;
        }
        let left = false;
        for (let tries = 0; tries < 40; tries++) {
          this._leavingByDestroy = true;
          try {
            left = await this.leave(c, 'grave', { destroy: true, byOpp: o.byOpp });
          } finally {
            this._leavingByDestroy = false;
          }
          if (left || this.zoneOf(c) !== 'battle' || !zero()) break;
          if (this.cannotLeave(c)) break; // 離れない効果で残る
          this.log(`「${c.def.name}」はパワーが0以下のままなので、再び破壊される`);
        }
        if (!left) continue;
        this.log(`「${c.def.name}」は破壊された${this.zoneOf(c) === 'mana' ? '（マナゾーンへ）' : ''}`);
        gone.push(c);
        const ow = this.p[c.owner];
        ow.destroyedLog = (ow.destroyedLog || []).filter((x) => x.turn === this.turn).concat({ uid: c.uid, turn: this.turn });
      }
      this.changed();
      for (const c of gone) await this.trigger(c, 'destroyed', c.owner, c.def, null, { defer: true });
      for (const c of gone) {
        const lb = this.kwBase(c).lastBurst;
        if (!lb || !c.def.twin || c.def.twin.type !== 'spell') continue;
        await this.queueFn(c, c.owner, `「${c.def.name}」のラスト・バースト`, async () => {
          if (!['grave', 'hand', 'mana'].includes(this.zoneOf(c))) return;
          if (lb === 'normal' && this.zoneOf(c) !== 'grave') return;
          if (!(await this.yesNo(c.owner, `ラスト・バースト：「${c.def.twin.name}」をコストを支払わずに唱えますか？`, c))) return;
          await this.putIntoPlay(c.owner, c, true, c.def.twin);
        }, { defer: true });
      }
      for (const c of gone) if (c.def.type === 'creature') await this.allyEvent(c, c.owner, 'allyDestroyed');
      for (const c of gone) if (this.isCreature(c) || c.def.type === 'creature') {
        if (this.hasAbility(c, 'selfOrAllyDestroyed')) await this.trigger(c, 'selfOrAllyDestroyed', c.owner, c.def, null, { defer: true });
        for (const q of [0, 1]) for (const src of [...this.permanents(q).filter((x) => !gone.includes(x)), ...gone.filter((x) => x.owner === q)]) {
          if (!gone.includes(src) && !this.isOnField(src)) continue;
          if (this.hasAbility(src, 'anyDestroyed')) await this.trigger(src, 'anyDestroyed', q, src.def, null, { defer: true });
          if (src === c) continue;
          if (q === c.owner && this.hasAbility(src, 'selfOrAllyDestroyed')) await this.trigger(src, 'selfOrAllyDestroyed', q, src.def, null, { defer: true });
        }
      }
      for (const c of gone) if (this.isCreature(c)) for (const src of this.permanents(1 - c.owner)) if (this.isOnField(src) && this.hasAbility(src, 'oppDestroyed')) await this.trigger(src, 'oppDestroyed', src.owner, src.def, null, { defer: true });
      await this.resolvePending();
    }

    // ===== 攻撃 =====
    attackTargets(card) {
      const pi = card.owner;
      if (this.active !== pi || this.zoneOf(card) !== 'battle' || card.tapped || !this.isCreature(card)) return [];
      if (card.linkGroup && this.linkMembers(card).some((x) => x.tapped)) return [];
      if (this.kw(card).attackNeedLink && this.linkMembers(card).length < 2) return [];
      const anc = this.kw(card).attackNeedCount;
      if (anc) {
        const has = (c) => ((c.def.races || []).join('/') + c.def.name).includes(anc.race);
        if (this.p[pi].battle.filter(has).length + (anc.withMana ? this.p[pi].mana.filter(has).length : 0) < anc.n) return [];
      }
      if (this.kw(card).attackNeedNonCreature && this.p[pi].nonCreaturePlayed !== this.turn) return [];
      if (this.permanents(1 - pi).some((s2) => this.kw(s2).oppAttackOnce) && this.attackTurnMark === this.turn && (this.attacksThisTurn || [0, 0])[pi] >= 1) return [];
      if (this.kw(card).attackNeedAny && !this.p[pi].battle.some((x) => x !== card && this.fitLook(x, G.TextParse.lookCond(this.kw(card).attackNeedAny)))) return [];
      if (this.kw(card).attackNeedOppShield && !this.p[1 - pi].shields.length) return [];
      if (this.kw(card).attackNeedEvo && !(this.evoKind(card.def) && (card.under || []).length)) return [];
      if (this.kw(card).attackNeedDraws && !(this.p[pi].drawTurnMark === this.turn && this.p[pi].drawsThisTurn >= this.kw(card).attackNeedDraws)) return [];
      if (this.kw(card).attackNeedOtherAttack && !(this.attackTurnMark === this.turn && (this.attacksThisTurn || [0, 0])[pi] > 0)) return [];
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
      if (card.enteredTurn === this.turn && [0, 1].some((q) => this.permanents(q).some((s) => { const w = this.kw(s).globalSickExcept; return w && !((card.def.races || []).join('/') + card.def.name).includes(w.replace(/・?クリーチャー$/, '')); }))) return [];
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
      const sickP = card.sick && k.sickPlayerOk && !k.speedAttacker;
      if (card.sick && card.abyssTurn !== this.turn && !k.speedAttacker && !k.sickPlayerOk) {
        if (k.machFighter && card.enteredTurn === this.turn) t.push(...op.battle.filter(canHit));
        return t;
      }
      const guard = op.battle.some((s) => this.isCreature(s) && this.kw(s).playerGuardPower && this.power(card) < this.power(s)) || this.permanents(1 - pi).some((s) => this.kw(s).noPlayerAttack);
      const noPlayer = guard || needNoPlayer || k.cantAttackPlayer || lackCreatures || (k.playerAttackNeedShieldAdded && this.p[pi].shieldAddedTurn !== this.turn);
      if (!noPlayer && !(card.enteredTurn === this.turn && this.permanents(1 - pi).some((s) => this.kw(s).oppSickNoPlayer)) && !op.battle.some((s) => s.tapped && this.kw(s).noPlayerAttackIfTapped)) t.push('player');
      if (!k.cantAttackCreature && !(card.sick && card.abyssTurn === this.turn) && !sickP) t.push(...op.battle.filter((c) => canHit(c) && !(this.kw(c).flying && !k.flying) && (c.tapped || k.attackUntapped || (k.attackUntappedCiv && (c.def.civs || []).includes(k.attackUntappedCiv)))));
      if (forced.length) return t.filter((x) => x !== 'player' && forced.includes(x));
      if (t.some((x) => x !== 'player') && this.permanents(1 - pi).some((s) => this.kw(s).oppMustAttackCreature)) return t.filter((x) => x !== 'player');
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
      card._attackingPlayer = tgtCard === 'player';
      card._brokeN = 0;
      for (const x of this.linkMembers(card)) x.tapped = true;
      for (const s2 of this.permanents(pi)) if (this.isOnField(s2) && this.hasAbility(s2, 'allyTapped')) await this.trigger(s2, 'allyTapped', pi, s2.def, card, { defer: true });
      for (const s2 of this.permanents(1 - pi)) if (this.isOnField(s2) && this.hasAbility(s2, 'oppTapped')) await this.trigger(s2, 'oppTapped', 1 - pi, s2.def, card, { defer: true });
      if ((me.tempTapDrawUntil || 0) >= this.turn) await this.queueFn(card, pi, '「クリーチャーがタップした時、1枚引いてもよい」', async () => { if (await this.yesNo(pi, 'クリーチャーがタップしたので、カードを1枚引きますか？')) this.draw(pi, 1); }, { defer: true });
      if (this.hasAbility(card, 'tapped')) await this.trigger(card, 'tapped', pi, card.def, null, { defer: true });
      if (this.attackTurnMark !== this.turn) {
        this.attackTurnMark = this.turn;
        this.attacksThisTurn = [0, 0];
      }
      this.attacksThisTurn[pi]++;
      this.log(`${me.name}の「${card.def.name}」が${tgtCard === 'player' ? op.name : '「' + tgtCard.def.name + '」'}を攻撃！`);
      await this.pause();
      // 攻撃する時の誘発をすべて待機に入れ、ターンプレイヤー→相手の順に、それぞれ好きな順番で解決する
      await this.allyEvent(card, pi, 'allyAttack');
      if (this.kw(card).kizuna === 'comp') await this.queueFn(card, pi, `「${card.def.name}」のキズナコンプ`, () => this.kizunaUse(card, pi, 'any'), { defer: true });
      if (this.kw(card).kizuna === 'plus' && (card.under || []).length) await this.queueFn(card, pi, `「${card.def.name}」のキズナプラス`, async () => {
        if (!(card.under || []).length || this.zoneOf(card) !== 'battle') return;
        if (!(await this.yesNo(pi, `キズナプラス：「${card.def.name}」の下のカードを1枚墓地に置きますか？`, card))) return;
        const u = card.under.pop();
        this.p[u.owner].grave.push(u);
        this.log(`キズナプラス：下の「${u.def.name}」を墓地に置いた`);
        await this.runP(card, pi);
        await this.kizunaUse(card, pi, 'other');
      }, { defer: true });
      // アタック・チャンス：指定のクリーチャーが攻撃する時、手札の呪文をコストなしで唱える
      for (const c of me.hand.slice()) {
        const ac = parsed(c.def).kw.attackChance || (c.def.twin && parsed(c.def.twin).kw.attackChance);
        if (!ac) continue;
        const okAtk = /ハイパーモード/.test(ac) ? !!card.hyper : this.allyMatch(card, ac.replace(/(・)?クリーチャー$/, '').replace(/^クリーチャー$/, ''));
        if (!okAtk) continue;
        await this.queueFn(c, pi, `手札の「${c.def.name}」のアタック・チャンス`, async () => {
          if (this.zoneOf(c) !== 'hand' || this.locked(pi, c.def)) return;
          if (!(await this.yesNo(pi, `アタック・チャンス：「${c.def.name}」をコストを支払わずに唱えますか？`, c))) return;
          this.log(`${me.name}はアタック・チャンスで「${c.def.name}」を唱えた`);
          await this.putIntoPlay(pi, c, true);
        }, { defer: true });
      }
      // D・D・D：自分のクリーチャーが攻撃する時、手札から指定のコストで使える
      for (const c of me.hand.slice()) {
        const dd = parsed(c.def).kw.ddd || (c.def.twin && parsed(c.def.twin).kw.ddd);
        if (!dd) continue;
        await this.queueFn(c, pi, `手札の「${c.def.name}」のD・D・D`, async () => {
          if (this.zoneOf(c) !== 'hand') return;
          const mana = this.payWith(pi, { civs: dd.civs }, dd.cost);
          if (!mana) return;
          if (!(await this.yesNo(pi, `D・D・D：「${c.def.name}」をコスト${dd.cost}で使いますか？`, c))) return;
          for (const m of mana) m.tapped = true;
          c._viaDDD = this.turn;
          this.log(`${me.name}はD・D・Dで「${c.def.name}」を使った`);
          await this.putIntoPlay(pi, c, true);
        }, { defer: true });
      }
      for (const x of me.battle.filter((y) => y.attachedTo === card.uid)) if (this.hasAbility(x, 'hostAttack')) await this.trigger(x, 'hostAttack', pi, x.def, null, { defer: true });
      if (this.hasAbility(card, 'attack')) await this.trigger(card, 'attack', pi, card.def, null, { defer: true });
      if (this.kw(card).majiBomber) await this.queueFn(card, pi, `「${card.def.name}」のマジボンバー`, () => this.doAction({ act: 'majiBomber', n: this.kw(card).majiBomber }, card, pi), { defer: true });
      if (this.kw(card).jChange) await this.queueFn(card, pi, `「${card.def.name}」のJチェンジ`, () => this.doAction({ act: 'jChange', n: this.kw(card).jChange }, card, pi), { defer: true });
      // 侵略・革命チェンジも、攻撃する時に待機する処理の1つ
      const attacker0 = card;
      this._attackSwap = null;
      const swapList = () => {
        const out = [];
        for (const h of me.hand) {
          const sc = this.sc(h);
          const hk = parsed(h.def).kw;
          if ((sc && sc.revChange && sc.revChange(this, h, attacker0)) || (hk.revChange && h !== attacker0 && this.matchCond(attacker0, hk.revChange))) out.push({ id: 'rc' + h.uid, label: `革命チェンジ：「${h.def.name}」と入れ替える`, card: h, how: 'rc' });
          if (hk.invasion && this.matchCond(attacker0, hk.invasion)) out.push({ id: 'iv' + h.uid, label: `侵略：「${h.def.name}」を上に重ねる`, card: h, how: 'iv' });
        }
        // S革命チェンジ：表向きでシールドゾーンにあるものも使える
        for (const h of [...me.shields.filter((x) => x.faceUp), ...me.shields.flatMap((x) => (x.under || []).filter((u) => u.faceUp))]) {
          const hk = parsed(h.def).kw;
          if (hk.sRevChange && hk.revChange && this.matchCond(attacker0, hk.revChange)) out.push({ id: 'rc' + h.uid, label: `S革命チェンジ：シールドゾーンの「${h.def.name}」と入れ替える`, card: h, how: 'rc' });
        }
        return out;
      };
      if (swapList().length) {
        this.pending = this.pending || [];
        this.pending.push({
          card: attacker0,
          controller: pi,
          label: `【${me.name}】「${attacker0.def.name}」の攻撃時：侵略・革命チェンジ（手札から）`,
          fn: async () => {
            if (this.zoneOf(attacker0) !== 'battle' || !attacker0.attacking) {
              this.log('攻撃しているクリーチャーがいないので、侵略・革命チェンジは使えない');
              return;
            }
            const swaps = swapList();
            if (!swaps.length) return;
            const opts = [{ id: 'none', label: '使わない' }, ...swaps.map((x) => ({ id: x.id, label: x.label }))];
            const best = swaps.slice().sort((a, b) => (+b.card.def.cost || 0) - (+a.card.def.cost || 0))[0];
            const r = await this.choose(pi, { kind: 'mode', prompt: `「${attacker0.def.name}」の攻撃時に使いますか？`, options: opts, min: 1, max: 1, aiPick: [best.id] });
            const sw = swaps.find((x) => x.id === r[0]);
            if (!sw) return;
            const nc = sw.card;
            attacker0.attacking = false;
            if (sw.how === 'rc') {
              this.moveTo(attacker0, 'hand');
              this.log(`革命チェンジ！「${attacker0.def.name}」→「${nc.def.name}」`);
              await this.enterBattle(nc, pi, 'other', { via: 'change' });
            } else {
              this.log(`侵略！「${attacker0.def.name}」の上に「${nc.def.name}」`);
              await this.enterBattle(nc, pi, 'other', { evolveFrom: attacker0, via: 'change' });
            }
            if (this.zoneOf(nc) === 'battle') {
              nc.tapped = true;
              nc.attacking = true;
              this._attackSwap = nc; // 攻撃の途中で出たクリーチャーは、その攻撃を引き継ぐ（「攻撃する時」は使えない）
            }
          },
        });
      }
      await this.fireHand(1 - pi, 'oppAttack');
      this._eventCard = card;
      await this.fireAll(1 - pi, 'oppAttack');
      try {
        this._attackCancelled = false;
        await this.resolvePending();
        if (this._attackCancelled) {
          this._attackCancelled = false;
          card.attacking = false;
          this.log(`「${card.def.name}」の攻撃は中止された`);
          return true;
        }
        if (this._attackSwap && this.zoneOf(this._attackSwap) === 'battle') card = this._attackSwap;
        this._attackSwap = null;
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
        const teamSmall = this.permanents(pi).some((s) => this.kw(s).teamUnblockSmaller);
        if (!teamUnb && !this.kw(card).unblockable && !((card.unblockableTurn || 0) === this.turn) && !(this.kw(card).unblockVsCreature && tgtCard !== 'player')) {
          const ub = this.kw(card).unblockableBy;
          const ak = this.kw(card);
          const stealthOn = ak.stealth && op.mana.some((m) => (m.def.civs || []).includes(ak.stealth));
          const blockers = stealthOn ? [] : op.battle.filter((c) => !c.tapped && this.isCreature(c) && this.kw(c).blocker && c !== tgtCard && !(ak.flying && !this.kw(c).flying) && !((ak.unblockableSmaller || teamSmall) && this.power(c) < this.power(card)) && !(ak.unblockCivs && (c.def.civs || []).some((x) => ak.unblockCivs.includes(x))) && !((c.lockedUntil || 0) >= this.turn) && !(ub && ((ub.maxPower != null && this.power(c) <= ub.maxPower) || (ub.lessThanSelf && this.power(c) < this.power(card)))));
          const must = blockers.find((c) => this.kw(c).mustBlock);
          if (blockers.length) {
            const r = must ? [must.uid] : await this.choose(op.idx, {
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
              if (this.hasAbility(bl, 'tapped')) await this.trigger(bl, 'tapped', op.idx, bl.def, null, { defer: true });
              this.log(`${op.name}の「${bl.def.name}」がブロック！`);
              await this.pause();
              await this.trigger(bl, 'block', op.idx);
              if (this.hasAbility(card, 'blocked')) await this.trigger(card, 'blocked', pi);
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
          await this.allyEvent(card, pi, 'allyUnblocked');
          await this.resolvePending();
          await this.fireAll(op.idx, 'oppUnblocked');
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
      if ((card._brokeN || 0) > 0) {
        for (const c of this.p[pi].hand.slice()) {
          const kf = parsed(c.def).kw.kirifuda;
          if (!kf) continue;
          await this.queueFn(c, pi, `手札の「${c.def.name}」のキリフダッシュ`, async () => {
            if (this.zoneOf(c) !== 'hand' || this.locked(pi, c.def)) return;
            const mana = this.payWith(pi, { civs: kf.civs }, kf.cost);
            if (!mana) return;
            if (!(await this.yesNo(pi, `キリフダッシュ：「${c.def.name}」をコスト${kf.cost}で召喚しますか？`, c))) return;
            for (const m of mana) m.tapped = true;
            this.log(`${this.p[pi].name}はキリフダッシュで「${c.def.name}」を召喚した`);
            c._viaKirifuda = this.turn;
            await this.putIntoPlay(pi, c, true);
          }, { defer: true });
        }
        await this.resolvePending();
      }
      if (this.zoneOf(card) === 'battle' && this.kw(card).gBreaker && this.p[pi].shields.length) {
        this.log(`G・ブレイカー：「${card.def.name}」の攻撃の後、自分のシールドをすべてブレイクする`);
        await this.breakShields(1 - pi, this.p[pi].shields.length, card);
      }
      if (card.untapAfterAttackTurn === this.turn && this.zoneOf(card) === 'battle') {
        card.untapAfterAttackTurn = null;
        card.tapped = false;
        this.log(`「${card.def.name}」は攻撃の終わりにアンタップした`);
      }
      for (const x of this.p[pi].battle.filter((y) => y.attachedTo === card.uid)) if (this.hasAbility(x, 'hostAttackEnd')) await this.trigger(x, 'hostAttackEnd', pi);
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
      // 「自分の○○が相手のクリーチャーとバトルする時、かわりにこのクリーチャーにバトルさせてもよい」
      for (const side of ['a', 'd']) {
        const x = side === 'a' ? a : d;
        const sub = this.p[x.owner].battle.find((s) => {
          const bs = s !== x && this.isCreature(s) && this.kw(s).battleSub;
          return bs && (!bs.who || bs.who === 'クリーチャー' || this.allyMatch(x, bs.who));
        });
        if (sub && (await this.yesNo(x.owner, `「${sub.def.name}」が「${x.def.name}」のかわりにバトルしますか？`, sub))) {
          this.log(`「${sub.def.name}」が「${x.def.name}」のかわりにバトルする`);
          if (side === 'a') a = sub;
          else d = sub;
        }
      }
      a.inBattle = d;
      d.inBattle = a;
      const pa = this.power(a);
      const pd = this.power(d);
      a.inBattle = d.inBattle = null;
      for (const x of [a, d]) if (this.hasAbility(x, 'battled')) await this.trigger(x, 'battled', x.owner, x.def, null, { defer: true });
      this.log(`バトル: 「${a.def.name}」${pa} vs 「${d.def.name}」${pd}`);
      const lose = [];
      const teamWin = (c) => this.permanents(c.owner).some((s) => this.kw(s).teamWinAll) || (this.p[c.owner].teamWinTurn || 0) === this.turn;
      const zg = (x) => (this.kw(x).zeroGuard && this.power(x) <= 0) || this.p[x.owner].battle.some((s) => { const w = this.kw(s).teamWinRace; return w && ((x.def.races || []).join('/') + x.def.name).includes(w); });
      const wa = zg(a) || this.kw(a).winAllBattles || (a.winAllUntil || 0) >= this.turn || teamWin(a);
      const wd = zg(d) || this.kw(d).winAllBattles || (d.winAllUntil || 0) >= this.turn || teamWin(d);
      if ((pa >= pd || wa) && !wd) lose.push(d);
      if ((pd >= pa || wd) && !wa) lose.push(a);
      if (wa && wd) lose.push(a, d);
      if (lose.length === 1) {
        const loser = lose[0];
        const winner = loser === a ? d : a;
        if (this.kw(loser).slayer) lose.push(winner);
      }
      for (const x of lose.slice()) if (!this.kw(x).noDestroyInBattle && (this.permanents(x.owner).some((s2) => this.kw(s2).teamNoDestroyInBattle) || (x.blocking && this.permanents(x.owner).some((s2) => this.kw(s2).teamNoDestroyBlocking)))) {
        lose.splice(lose.indexOf(x), 1);
        this.log(`「${x.def.name}」はバトル中破壊されない`);
      }
      for (const x of lose.slice()) {
        const nv = this.kw(x).noDestroyVsPowerLE;
        const other = x === a ? d : a;
        if (nv != null && this.power(other) <= nv) {
          lose.splice(lose.indexOf(x), 1);
          this.log(`「${x.def.name}」はこのバトルでは破壊されない`);
        }
      }
      for (const x of lose.slice()) if (this.kw(x).noDestroyInBattle) {
        lose.splice(lose.indexOf(x), 1);
        this.log(`「${x.def.name}」はバトル中破壊されない`);
      }
      await this.destroyMany(lose);
      const after = [a, d].filter((x) => !lose.includes(x) && this.zoneOf(x) === 'battle' && this.kw(x).dieAfterBattle);
      if (after.length) await this.destroyMany(after, { byOpp: false });
      for (const w of [a, d]) if (!lose.includes(w) && this.zoneOf(w) === 'battle') {
        this.p[w.owner].battleWonTurn = this.turn;
        await this.trigger(w, 'battleWin', w.owner);
        await this.fireAll(w.owner, 'allyBattleWin');
        await this.allyEvent(w, w.owner, 'allyBattleWinR');
      }
      for (const l of lose) if (this.hasAbility(l, 'battleLose')) await this.trigger(l, 'battleLose', l.owner);
    }

    async breakShields(pi, n, src) {
      const op = this.opp(pi);
      if (src && src.owner === pi && this.zoneOf(src) === 'battle' && this.kw(src).masterG && src.enteredTurn === this.turn && !this._inDragonBreak) {
        const nb = Math.min(n, op.shields.length);
        for (let i = 0; i < nb && op.shields.length; i++) {
          const pool = op.battle.filter((c) => this.isCreature(c));
          if (pool.length) {
            const r = await this.pickCards(pi, pool, 1, false, `マスター・G・ブレイカー：ブレイクの前に破壊する相手のクリーチャー（${i + 1}回目）`, 'target', 'destroy');
            if (r.length) await this.destroyMany(r, { byOpp: true });
          }
          this._inDragonBreak = true;
          try {
            await this.breakShields(pi, 1, src);
          } finally {
            this._inDragonBreak = false;
          }
        }
        return;
      }
      if (src && src.owner === pi && this.zoneOf(src) === 'battle' && this.kw(src).dragonBreaker && !this._inDragonBreak) {
        const me = this.p[pi];
        const nb = Math.min(n, op.shields.length);
        for (let i = 0; i < nb; i++) {
          if (me.deck.length) {
            const opts = [{ id: 'new', label: '山札の上を裏向きのまま新しいシールドにする' }];
            if (me.shields.length) opts.push({ id: 'stack', label: '山札の上を表向きにして自分のシールドの上に置く' });
            const [m] = await this.chooseModes(pi, `「${src.def.name}」のドラゴン・ブレイカー（${i + 1}回目のブレイクの前）`, opts, { aiPick: [me.shields.length ? 'stack' : 'new'] });
            if (m === 'stack') await this.stackOnShield(me.deck[0], pi);
            else if (await this.addShieldFromDeck(pi, 1)) this.log(`${me.name}は山札の上を新しいシールドにした`);
          }
          if (!op.shields.length) break;
          this._inDragonBreak = true;
          try {
            await this.breakShields(pi, 1, src);
          } finally {
            this._inDragonBreak = false;
          }
        }
        return;
      }
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
      if (this.permanents(op.idx).some((s) => this.kw(s).flipInsteadOfBreak)) {
        const keep = picked.filter((s) => s.faceUp || (s.under || []).some((u) => u.faceUp));
        for (const s of keep) {
          s.faceUp = false;
          for (const u of s.under || []) u.faceUp = false;
          this.log(`表向きのカードを含むシールドは、ブレイクされるかわりに裏返った`);
        }
        picked = picked.filter((s) => !keep.includes(s));
      }
      // シールド・セイバー：シールドがブレイクされる時、かわりにこのクリーチャーを破壊してもよい
      for (const s of picked.slice()) {
        const savers = op.battle.filter((c) => this.isCreature(c) && this.kw(c).shieldSaver && this.zoneOf(c) === 'battle');
        if (!savers.length) break;
        const sv = savers[0];
        if (!(await this.yesNo(op.idx, `シールド・セイバー：シールドのかわりに「${sv.def.name}」を破壊しますか？`, sv))) break;
        picked = picked.filter((x) => x !== s);
        this.log(`シールド・セイバー：「${sv.def.name}」がシールドの身代わりになった`);
        await this.destroyMany([sv], { byOpp: false });
      }
      const toGrave = src && this.kw(src).breakToGrave;
      for (const s of picked) {
        if (toGrave && !s.faceUp) {
          this.moveTo(s, 'grave');
          this.log(`ブレイクされたシールドは、手札ではなく墓地に置かれた`);
          continue;
        }
        if (s.faceUp && s.def.type === 'castle') {
          // 城は手札ではなく墓地へ
          this.moveTo(s, 'grave');
          this.log(`城「${s.def.name}」は墓地に置かれた`);
        } else {
          const st = (s.under || []).slice();
          this.moveTo(s, 'hand');
          picked.push(...st.filter((u) => this.zoneOf(u) === 'hand'));
        }
      }
      picked = [...new Set(picked)];
      this.log(`${op.name}のシールドを${picked.length}つブレイクした（残り${op.shields.length}）`);
      if (src && src.attacking) src._brokeN = (src._brokeN || 0) + picked.length;
      for (const s2 of this.permanents(op.idx)) if (this.isOnField(s2) && this.hasAbility(s2, 'ownShieldBroken')) await this.trigger(s2, 'ownShieldBroken', op.idx, s2.def, null, { defer: true });
      await this.pause();
      // ブレイクした時の効果（ニガ=アブシュームなど）
      if (src && this.zoneOf(src) === 'battle') await this.trigger(src, 'broke', src.owner);
      if (src && this.zoneOf(src) === 'battle') await this.notifyAll('onBreak', src);
      await this.shieldsLeft(op.idx);
      await this.sabakiZ(op.idx);
      // 手札に加わったシールドの中から、使うS・トリガー／G・ストライクを先に宣言し、選んだ順に使う
      const cands = [];
      for (const sh of picked) {
        if (this.zoneOf(sh) !== 'hand') continue;
        const ssc = this.sc(sh);
        const banned = (kwName) => [0, 1].some((q) => this.permanents(q).some((s) => { const b = this.kw(s).kwBan; return b && b.kw === kwName && (b.side === 'all' || q !== sh.owner) && (!b.civ || (sh.def.civs || []).includes(b.civ)); }));
        if (banned('S・トリガー') && (this.kw(sh).shieldTrigger || (this.twin(sh) && parsed(this.twin(sh)).kw.shieldTrigger))) {
          this.log(`「${sh.def.name}」のS・トリガーは使えない`);
          continue;
        }
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

  G.homeZone = homeZone;
  G.Engine = { Game, GameOver, parsed, twinDef, CIV_LABEL, ZONE_LABEL, TYPE_LABEL, NON_CREATURE, shuffle, homeZone, attachKind };
  if (typeof module !== 'undefined') module.exports = G.Engine;
})(typeof globalThis !== 'undefined' ? globalThis : window);
