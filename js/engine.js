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

  const WHEN_J = { battleWin: 'バトルに勝った時の能力', oppTurnStart: '相手のターンのはじめの能力', broke: 'ブレイクした時の能力', summon: '出た時の能力', attack: '攻撃する時の能力', destroyed: '破壊された時の能力', turnStart: 'ターンのはじめの能力', turnEnd: 'ターンの終わりの能力', shieldAdded: 'シールドが置かれた時の能力', exLifeLost: 'EXライフが離れた時の能力', block: 'ブロックした時の能力', sealsGone: '封印が外れた時の能力' };

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
      const k = this.kw(card);
      if (k.poweredBreaker) return Math.max(1, Math.floor(this.power(card) / 6000), k.breaker);
      return k.breaker;
    }
    // 相手に選ばれるか（ジャストダイバー・選べない）
    selectable(card, chooserPi) {
      if (card.owner === chooserPi || this.zoneOf(card) !== 'battle') return true;
      const k = this.kw(card);
      if (k.untargetable) return false;
      if ((card.jdUntil || 0) >= this.turn) return false;
      const sc = this.sc(card);
      if (sc && sc.untargetable && sc.untargetable(this, card)) return false;
      // アアルカイトの電影：呪文で選ばれない
      if ((card.spellShieldUntil || 0) >= this.turn && this.currentSource && this.currentSource.type === 'spell') return false;
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
      return (hp || +card.def.power || 0) + card.tempPower + (card.attacking ? this.kw(card).powerAttacker : 0);
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
        for (const k of ['seals', 'exLife', 'forceShield', 'noLeaveUntil', 'frozenUntil', 'noAttackTurn', 'modesUsed', 'flipped', 'usedTurn', 'ignoreName', 'hyper', 'hyperUntil', 'jdUntil', 'returnAtEnd', 'badEnd', 'spellShieldUntil']) delete card[k];
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
          this.active = 1 - this.active;
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
      for (const c of me.battle) {
        if (!this.kw(c).noUntap && !((c.frozenUntil || 0) >= this.turn)) c.tapped = false;
        c.sick = false;
      }
      for (const c of this.permanents(this.active)) {
        if (this.isOnField(c)) await this.trigger(c, 'turnStart', c.owner, c.def, null, { defer: true });
      }
      for (const c of this.permanents(1 - this.active)) {
        if (this.isOnField(c)) await this.trigger(c, 'oppTurnStart', c.owner, c.def, null, { defer: true });
      }
      await this.resolvePending();
      // ドロー（先攻1ターン目は引かない）
      const skipDraw = this.turn === 1;
      if (!skipDraw) this.draw(this.active, 1);
      this.changed();
    }

    async endTurnEffects() {
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
      const withSas = plans.filter((x) => x.sas || x.bad);
      if (withSas.length && !this.p[pi].isAI) {
        const opts = plans.map((x, i) => ({
          id: String(i),
          label: x.sas
            ? `ササゲール：「${x.sas.def.name}」を破壊してコスト${x.cost}で出す`
            : x.bad
              ? `B・A・D：コスト${x.cost}で出す（ターンの終わりに破壊）`
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
      await this.pay(pi, card, card.def);
      await this.putIntoPlay(pi, card, false, card.def, { evolveFrom });
      return true;
    }

    // 墓地から使えるか（ア・ストラ・ゼーレ、アビス記号など）
    graveUse(pi, card) {
      if (this.active !== pi || card.owner !== pi || this.zoneOf(card) !== 'grave') return null;
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
      src.usedTurn = this.turn;
      this.log(`${this.p[pi].name}は「${src.def.name}」の効果で墓地から使う`);
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
        await this.resolvePending();
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
        if (sc && sc.replaceEnter && this.isCreature(card) && sc.replaceEnter(this, src, card, how)) {
          this.moveTo(card, 'mana', { tapped: true });
          this.log(`「${src.def.name}」の効果で「${card.def.name}」はかわりにマナゾーンに置かれた`);
          await this.pause();
          return false;
        }
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
      } else {
        this.moveTo(card, 'battle');
      }
      if (!this.isCreature(card)) card.sick = false;
      if (o.flipped) card.flipped = true;
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
      if (this.zoneOf(card) === 'battle') await this.notifyAll('onAnyEnter', card);
      if (this.kw(card).exLife && card.exLife) await this.shieldAdded(pi);
      return true;
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
        for (const src of this.permanents(card.owner)) {
          const sc = this.sc(src);
          if (sc && sc.protectDestroy && (await sc.protectDestroy(this, src, card))) return false;
        }
      }
      // 進化元も一緒に移す（シールドへ行く場合、進化元は墓地へ）
      const under = card.under || [];
      card.under = null;
      this.moveTo(card, toZone, o.moveOpt);
      if (faceUp) {
        card.faceUp = true;
        this.log(`「${card.def.name}」はシールド・ゴーで表向きのシールドになった`);
      }
      for (const u of under) this.moveTo(u, toZone === 'shields' ? 'grave' : toZone, o.moveOpt);
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
      for (const c of this.permanents(pi)) if (this.isOnField(c)) await this.trigger(c, 'shieldAdded', pi, c.def, null, { defer: true });
      await this.resolvePending();
    }
    // 自分のシールドが離れた時（獄鬼夜城など）
    async shieldsLeft(pi) {
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
        if (ab.cond) {
          const have = this.p[controller].mana.filter((m) => !ab.cond.manaCiv || (m.def.civs || []).includes(ab.cond.manaCiv)).length;
          if (have < ab.cond.n) {
            this.log(`「${def.name}」: マナ武装の条件を満たしていない`);
            continue;
          }
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
      pool = pool.filter((c) => this.isCreature(c));
      if (a.maxPower != null) pool = pool.filter((c) => this.power(c) <= a.maxPower);
      if (a.maxCost != null) pool = pool.filter((c) => (+c.def.cost || 0) <= a.maxCost);
      if (a.act === 'tap') pool = pool.filter((c) => !c.tapped);
      if (a.tappedOnly) pool = pool.filter((c) => c.tapped);
      if (a.untappedOnly) pool = pool.filter((c) => !c.tapped);
      return pool;
    }

    async pickCards(pi, pool, n, optional, prompt, kind = 'target', act) {
      pool = pool.filter((c) => this.selectable(c, pi));
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
      return ids.map((id) => pool.find((c) => c.uid === id)).filter(Boolean);
    }

    async doAction(a, src, pi) {
      this.currentSource = src && src.def;
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
            this.moveTo(c, 'mana', { tapped: (c.def.civs || []).length > 1 });
            this.log(`${me.name}は山札の上の「${c.def.name}」をマナに置いた`);
          }
          break;
        }
        case 'shieldAdd': {
          if (a.optional && !(await this.yesNo(pi, `${nm}: 山札の上から${a.n}枚をシールド化しますか？`, src))) return;
          for (let i = 0; i < a.n && me.deck.length; i++) this.moveTo(me.deck[0], 'shields');
          this.log(`${me.name}はシールドを${a.n}つ追加した`);
          await this.shieldAdded(pi);
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
            c.tempPower -= a.amount;
            this.log(`「${c.def.name}」のパワーが-${a.amount}された`);
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
            else {
              const r = await this.pickCards(op.idx, op.hand, 1, false, `${nm}: 捨てる手札を選んでください`, 'discard');
              c = r[0];
            }
            this.moveTo(c, 'grave');
            this.log(`${op.name}は手札の「${c.def.name}」を捨てた`);
          }
          break;
        }
        case 'graveToHand':
        case 'manaToHand': {
          const zone = a.act === 'graveToHand' ? 'grave' : 'mana';
          let pool = me[zone].slice();
          if (a.creatureOnly) pool = pool.filter((c) => !NON_CREATURE.includes(c.def.type));
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
        case 'mill':
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
          if (this.zoneOf(src) === 'battle' && src.tapped) {
            src.tapped = false;
            this.log(`「${src.def.name}」はアンタップした`);
          }
          break;
        case 'breakShield':
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
        if (!(await this.leave(c, 'grave', { destroy: true, byOpp: o.byOpp }))) continue;
        this.log(`「${c.def.name}」は破壊された${this.zoneOf(c) === 'mana' ? '（マナゾーンへ）' : ''}`);
        gone.push(c);
      }
      this.changed();
      for (const c of gone) await this.trigger(c, 'destroyed', c.owner, c.def, null, { defer: true });
      await this.resolvePending();
    }

    // ===== 攻撃 =====
    attackTargets(card) {
      const pi = card.owner;
      if (this.active !== pi || this.zoneOf(card) !== 'battle' || card.tapped || !this.isCreature(card)) return [];
      const k = this.kw(card);
      if (k.cantAttack) return [];
      if (card.noAttackTurn === this.turn) return [];
      for (const src of this.permanents(1 - pi)) {
        const sc = this.sc(src);
        if (sc && sc.forbidAttack && sc.forbidAttack(this, src, card)) return [];
      }
      const op = this.opp(pi);
      const t = [];
      const canHit = (c) => this.isCreature(c) && !((c.jdUntil || 0) >= this.turn);
      if (card.sick) {
        if (k.machFighter && card.enteredTurn === this.turn) t.push(...op.battle.filter(canHit));
        return t;
      }
      if (!k.cantAttackPlayer) t.push('player');
      t.push(...op.battle.filter((c) => canHit(c) && (c.tapped || k.attackUntapped)));
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
      this.log(`${me.name}の「${card.def.name}」が${tgtCard === 'player' ? op.name : '「' + tgtCard.def.name + '」'}を攻撃！`);
      await this.pause();
      try {
        await this.trigger(card, 'attack', pi);
        if (this.zoneOf(card) !== 'battle') return true;
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
        // ガードマン：自分の他のクリーチャーへの攻撃を引き受ける
        if (tgtCard !== 'player') {
          const guards = op.battle.filter((c) => c !== tgtCard && !c.tapped && this.isCreature(c) && this.kw(c).guardman);
          if (guards.length) {
            const r = await this.pickCards(op.idx, guards, 1, true, `ガードマン：「${tgtCard.def.name}」への攻撃を引き受けるクリーチャー（任意）`, 'recover');
            if (r[0]) {
              r[0].tapped = true;
              tgtCard = r[0];
              this.log(`ガードマン：攻撃先が「${tgtCard.def.name}」に変わった`);
            }
          }
        }
        // ブロック
        if (!this.kw(card).unblockable) {
          const blockers = op.battle.filter((c) => !c.tapped && this.isCreature(c) && this.kw(c).blocker && c !== tgtCard);
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
              await this.battle(card, bl);
              return true;
            }
          }
        }
        if (tgtCard === 'player') {
          if (op.shields.length === 0) {
            this.log(`「${card.def.name}」のダイレクトアタック！`);
            this.win(pi, 'ダイレクトアタック');
          }
          await this.breakShields(pi, this.breakCount(card), card);
        } else if (this.zoneOf(tgtCard) === 'battle') {
          await this.battle(card, tgtCard);
        }
      } finally {
        card.attacking = false;
        this.changed();
      }
      return true;
    }

    async battle(a, d) {
      const pa = this.power(a);
      const pd = this.power(d);
      this.log(`バトル: 「${a.def.name}」${pa} vs 「${d.def.name}」${pd}`);
      const lose = [];
      if (pa >= pd) lose.push(d);
      if (pd >= pa) lose.push(a);
      if (lose.length === 1) {
        const loser = lose[0];
        const winner = loser === a ? d : a;
        if (this.kw(loser).slayer) lose.push(winner);
      }
      await this.destroyMany(lose);
      for (const w of [a, d]) if (!lose.includes(w) && this.zoneOf(w) === 'battle') await this.trigger(w, 'battleWin', w.owner);
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
      // ブレイクするシールドは攻撃側が選ぶ
      let picked;
      if (n >= op.shields.length) picked = op.shields.slice();
      else {
        picked = await this.pickCards(pi, op.shields, n, false, `ブレイクするシールドを${n}つ選んでください`, 'shield');
      }
      for (const s of picked) {
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
