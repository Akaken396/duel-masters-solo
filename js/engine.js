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
        type: 'spell',
        power: null,
        races: [],
        text: def.twin.text || '',
        _src: JSON.stringify(def.twin),
      };
      twinCache.set(def, t);
    }
    return t;
  }

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
      return parsed(card.def).kw;
    }
    abilities(card, def = card.def) {
      if (this.isIgnored(def.name)) return [];
      return parsed(def).abilities;
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
      return (+card.def.power || 0) + card.tempPower + (card.attacking ? this.kw(card).powerAttacker : 0);
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
      if (from === 'shields' && zone !== 'shields') card.faceUp = false;
      if (from === 'battle' && zone !== 'battle') {
        // 場を離れたら、場にいた間の状態を消す
        for (const k of ['seals', 'exLife', 'forceShield', 'noLeaveUntil', 'frozenUntil', 'noAttackTurn', 'modesUsed', 'flipped', 'usedTurn', 'ignoreName']) delete card[k];
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
          if (this.winner != null || this.aborted) break;
          for (const c of this.permanents(this.active)) if (this.isOnField(c)) await this.trigger(c, 'turnEnd');
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
      for (const c of me.battle) {
        if (!this.kw(c).noUntap && !((c.frozenUntil || 0) >= this.turn)) c.tapped = false;
        c.sick = false;
      }
      const skipDraw = this.turn === 1;
      if (!skipDraw) this.draw(this.active, 1);
      for (const c of this.permanents(this.active)) {
        if (this.isOnField(c)) await this.trigger(c, 'turnStart');
      }
      this.changed();
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

    // 人間の操作をまとめて実行（同時実行を防ぐ）
    async act(fn) {
      if (this.busy || this.winner != null) return;
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
    costPlan(pi, card, def = card.def, withSasage = false) {
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
        const r = sc.costMod(this, src, pi, card, def, withSasage);
        if (r && r.n) {
          cost -= r.n;
          if (r.use) uses.push(r.use);
          if (r.sasage) break; // ササゲールは1枚だけ
        }
      }
      const base = +def.cost || 0;
      cost = Math.max(base > 0 ? 1 : 0, cost);
      if (withSasage) cost = Math.max(0, cost);
      return { cost, uses };
    }

    // 支払いに使うマナを決める。払えなければ null
    payment(pi, card, def = card.def) {
      return this.paymentPlan(pi, card, def)?.mana || null;
    }
    paymentPlan(pi, card, def = card.def) {
      for (const sas of [false, true]) {
        const plan = this.costPlan(pi, card, def, sas);
        const mana = this.payWith(pi, def, plan.cost);
        if (mana) return { mana, uses: plan.uses, cost: plan.cost };
      }
      return null;
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
      }
      return false;
    }

    canPlay(pi, card) {
      return this.active === pi && card.owner === pi && this.zoneOf(card) === 'hand' && !this.locked(pi, card.def) && !!this.payment(pi, card);
    }

    async pay(pi, card, def) {
      const plan = this.paymentPlan(pi, card, def);
      for (const m of plan.mana) m.tapped = true;
      for (const u of plan.uses) await u();
    }

    async play(pi, uid) {
      const f = this.find(uid);
      if (!f || !this.canPlay(pi, f.card)) return false;
      const card = f.card;
      await this.pay(pi, card, card.def);
      await this.putIntoPlay(pi, card, false);
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
    async putIntoPlay(pi, card, free, def = card.def) {
      const name = this.p[pi].name;
      const fr = free ? 'コストを払わずに' : '';
      if (def.type === 'spell') {
        this.log(`${name}は呪文「${def.name}」を${fr}唱えた`);
        this.spellsThisTurn[pi]++;
        // 解決中は墓地へ（DMでは唱えた後に墓地）
        this.moveTo(card, 'grave');
        this.noteManual(card, def);
        await this.trigger(card, 'cast', pi, def);
        await this.notifyAll('onAnyCast', card, def);
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
      } else {
        const verb = this.isCreature(card) ? '召喚した' : '出した';
        this.log(`${name}は${this.isCreature(card) ? '' : TYPE_LABEL[def.type]}「${def.name}」を${fr}${verb}`);
        await this.enterBattle(card, pi, 'summon');
      }
      this.changed();
    }

    // バトルゾーンに出す（召喚・踏み倒し共通）。how: 'summon' | 'other'
    async enterBattle(card, pi, how = 'other') {
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
      this.moveTo(card, 'battle');
      if (!this.isCreature(card)) card.sick = false;
      if (this.isCreature(card)) this.creaturesThisTurn[pi]++;
      if (how !== 'summon') this.log(`「${card.def.name}」がバトルゾーンに出た`);
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
          if (sc && sc[hook]) await sc[hook](this, src, card, def);
        }
      }
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
      if (o.destroy) {
        const own = this.sc(card);
        if (own && own.wouldDestroy) {
          const z = own.wouldDestroy(this, card);
          if (z) toZone = z;
        }
        for (const src of this.permanents(card.owner)) {
          const sc = this.sc(src);
          if (sc && sc.protectDestroy && (await sc.protectDestroy(this, src, card))) return false;
        }
      }
      this.moveTo(card, toZone, o.moveOpt);
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
      for (const c of this.permanents(pi)) if (this.isOnField(c)) await this.trigger(c, 'shieldAdded', pi);
    }
    isOnField(c) {
      const z = this.zoneOf(c);
      return z === 'battle' || (z === 'shields' && c.faceUp);
    }

    async trigger(card, when, controller = card.owner, def = card.def, extra) {
      const sc = this.script(def);
      if (sc && sc[when]) {
        await sc[when](this, card, controller, extra);
        this.changed();
        return;
      }
      for (const ab of this.abilities(card, def)) {
        if (ab.when !== when) continue;
        for (const a of ab.acts) {
          await this.doAction(a, card, controller);
        }
      }
    }

    targetsFor(a, pi) {
      let pool = [];
      if (a.side === 'opp' || a.side === 'any') pool.push(...this.opp(pi).battle);
      if (a.side === 'self' || a.side === 'any') pool.push(...this.p[pi].battle);
      pool = pool.filter((c) => this.isCreature(c));
      if (a.maxPower != null) pool = pool.filter((c) => this.power(c) <= a.maxPower);
      if (a.maxCost != null) pool = pool.filter((c) => (+c.def.cost || 0) <= a.maxCost);
      if (a.act === 'tap') pool = pool.filter((c) => !c.tapped);
      return pool;
    }

    async pickCards(pi, pool, n, optional, prompt, kind = 'target', act) {
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
      for (const c of gone) await this.trigger(c, 'destroyed', c.owner);
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
      if (card.sick) {
        if (k.machFighter && card.enteredTurn === this.turn) t.push(...op.battle.filter((c) => this.isCreature(c)));
        return t;
      }
      if (!k.cantAttackPlayer) t.push('player');
      t.push(...op.battle.filter((c) => c.tapped && this.isCreature(c)));
      return t;
    }

    async attack(pi, uid, target) {
      const f = this.find(uid);
      if (!f) return false;
      let card = f.card;
      const tg = this.attackTargets(card);
      const tgtCard = target === 'player' ? 'player' : tg.find((x) => x !== 'player' && x.uid === target);
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
        // 革命チェンジ
        const rc = me.hand.find((h) => {
          const sc = this.sc(h);
          return sc && sc.revChange && sc.revChange(this, h, card);
        });
        if (rc && (await this.yesNo(pi, `革命チェンジ：「${card.def.name}」を手札に戻して「${rc.def.name}」と入れ替えますか？`, rc))) {
          card.attacking = false;
          this.moveTo(card, 'hand');
          this.log(`革命チェンジ！「${card.def.name}」→「${rc.def.name}」`);
          await this.enterBattle(rc, pi, 'other');
          if (this.zoneOf(rc) !== 'battle') return true;
          card = rc;
          card.tapped = true;
          card.attacking = true;
          await this.trigger(card, 'attack', pi);
          if (this.zoneOf(card) !== 'battle') return true;
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
          await this.breakShields(pi, this.kw(card).breaker, card);
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
    }

    async breakShields(pi, n, src) {
      const op = this.opp(pi);
      n = Math.min(n, op.shields.length);
      if (!n) return;
      // ブレイク身代わり（セイント・キャッスルなど）
      const sub = op.shields.find((s) => s.faceUp && this.kw(s).breakSubstitute);
      if (sub && src && this.isCreature(src)) {
        if (await this.yesNo(op.idx, `「${sub.def.name}」でブレイクを身代わりしますか？（${n}枚分）`, sub)) {
          this.log(`${op.name}の「${sub.def.name}」がブレイクを身代わりした`);
          await this.pause();
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
      if (src && this.zoneOf(src) === 'battle') await this.notifyAll('onBreak', src);
      for (const s of picked) {
        if (this.zoneOf(s) !== 'hand') continue;
        // G・ストライク：相手クリーチャー1体はこのターン攻撃できない
        if (this.kw(s).gStrike) {
          const pool = this.p[pi].battle.filter((c) => this.isCreature(c));
          if (pool.length && (await this.yesNo(op.idx, `G・ストライク「${s.def.name}」を使いますか？`, s))) {
            const r = await this.pickCards(op.idx, pool, 1, false, 'このターン攻撃できなくするクリーチャー', 'target', 'tap');
            if (r[0]) {
              r[0].noAttackTurn = this.turn;
              this.log(`G・ストライク：「${r[0].def.name}」はこのターン攻撃できない`);
            }
          }
        }
        const t = this.twin(s);
        const sides = [];
        const ssc = this.sc(s);
        if (this.kw(s).shieldTrigger || (ssc && ssc.dynamicTrigger && ssc.dynamicTrigger(this, s))) sides.push(s.def);
        if (t && parsed(t).kw.shieldTrigger) sides.push(t);
        for (const d of sides) {
          if (this.zoneOf(s) !== 'hand') break;
          const use = await this.yesNo(op.idx, `S・トリガー「${d.name}」を使いますか？`, s);
          if (use) {
            this.log(`${op.name}: S・トリガー発動！`);
            await this.putIntoPlay(op.idx, s, true, d);
            break;
          }
        }
      }
    }

    // ===== 手動操作（ルールを無視して動かす） =====
    manualMove(uid, zone, opt = {}) {
      const f = this.find(uid);
      if (!f) return;
      const from = this.moveTo(f.card, zone, opt || {});
      if (zone === 'shields' && opt && opt.faceUp) f.card.faceUp = true;
      this.log(`[手動] 「${f.card.def.name}」を${ZONE_LABEL[from]}から${this.p[f.card.owner].name}の${ZONE_LABEL[zone]}へ`);
      this.safeChanged();
    }
    manualTap(uid) {
      const f = this.find(uid);
      if (!f) return;
      f.card.tapped = !f.card.tapped;
      this.safeChanged();
    }
    manualShuffle(pi) {
      shuffle(this.p[pi].deck, this.rng);
      this.log(`[手動] ${this.p[pi].name}は山札をシャッフルした`);
      this.safeChanged();
    }
    manualDraw(pi) {
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
