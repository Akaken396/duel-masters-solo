// カードテキスト → 自動処理できる能力 への変換
// 読み取れない文は manual として残し、対戦中に「手動で処理」と表示する。
(function (G) {
  'use strict';

  function normalize(s) {
    return String(s || '')
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[＋]/g, '+')
      .replace(/[−－]/g, '-')
      .replace(/[，]/g, '、')
      .replace(/[．]/g, '。')
      .replace(/\r/g, '')
      .replace(/\{[A-Za-z0-9]+\}\s*/g, '') // 公式ページのアイコン記号 {GS} など
      .replace(/\[[a-z]{1,3}\d{0,3}\]/g, '') // マナ記号 [ll02] など
      .replace(/^l\s+/gm, '') // 能力を与える時の記号
      .replace(/^\s*[▶►]\s*/gm, (m) => m.trim());
  }

  // （…）や(...)の注釈を消す
  function stripReminder(s) {
    let prev;
    do {
      prev = s;
      s = s.replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '');
    } while (s !== prev);
    return s.trim();
  }

  const KEYWORDS = [
    { re: /^ブロッカー$/, set: (k) => (k.blocker = true) },
    { re: /^スピードアタッカー$/, set: (k) => (k.speedAttacker = true) },
    { re: /^スレイヤー$/, set: (k) => (k.slayer = true) },
    { re: /^S・トリガー(・クリーチャー)?$/, set: (k) => (k.shieldTrigger = true) },
    { re: /^マッハファイター$/, set: (k) => (k.machFighter = true) },
    { re: /^W・ブレイカー$/, set: (k) => (k.breaker = Math.max(k.breaker, 2)) },
    { re: /^T・ブレイカー$/, set: (k) => (k.breaker = Math.max(k.breaker, 3)) },
    { re: /^Q・ブレイカー$/, set: (k) => (k.breaker = Math.max(k.breaker, 4)) },
    { re: /^ワールド・ブレイカー$/, set: (k) => (k.breaker = 99) },
    { re: /^パワーアタッカー\+(\d+)$/, set: (k, m) => (k.powerAttacker = +m[1]) },
    { re: /^このクリーチャーは相手プレイヤーを攻撃できない。?$/, set: (k) => (k.cantAttackPlayer = true) },
    { re: /^このクリーチャーは攻撃できない。?$/, set: (k) => (k.cantAttack = true) },
    { re: /^このクリーチャーはブロックされない。?$/, set: (k) => (k.unblockable = true) },
    { re: /^このクリーチャーはタップして(バトルゾーンに)?出る。?$/, set: (k) => (k.enterTapped = true) },
    { re: /^このクリーチャーは自分のターンのはじめにアンタップしない。?$/, set: (k) => (k.noUntap = true) },
    { re: /^(水晶)?チャージャー$/, set: (k) => (k.charger = true) },
    { re: /^ブレイク身代わり$/, set: (k) => (k.breakSubstitute = true) },
    { re: /^EXライフ$/, set: (k) => (k.exLife = true) },
    { re: /^シンカライズ$/, set: (k) => (k.sinkarize = true) },
    { re: /^G・ストライク$/, set: (k) => (k.gStrike = true) },
  ];

  const TRIGGERS = [
    { re: /^この(クリーチャー|タマシード|カード|城|G城)(が|を)(バトルゾーンに出た|出た|召喚した|使った)時、/, when: 'summon' },
    { re: /^このクリーチャーが攻撃する時、/, when: 'attack' },
    { re: /^このクリーチャーが召喚によって出た時、/, when: 'summonOnly' },
    { re: /^このクリーチャーが破壊された時、/, when: 'destroyed' },
    { re: /^自分のターンのはじめに、/, when: 'turnStart' },
    { re: /^自分のターンの(終わり|おわり)に、/, when: 'turnEnd' },
    { re: /^(自分のシールドゾーンにカードが|カードが自分のシールドゾーンに)置かれた時、/, when: 'shieldAdded' },
    { re: /^このクリーチャーが(相手のクリーチャーの攻撃を)?ブロックした時、/, when: 'block' },
    { re: /^このクリーチャーがバトルに勝った時、/, when: 'battleWin' },
    { re: /^相手のターンのはじめに、/, when: 'oppTurnStart' },
    { re: /^このクリーチャーが(相手の)?シールドをブレイクした時、/, when: 'broke' },
  ];

  // 対象の側：相手 / 自分 / 指定なし(どちらでも)
  function sideOf(s) {
    if (/相手の/.test(s)) return 'opp';
    if (/自分の/.test(s)) return 'self';
    return 'any';
  }

  function targetFilter(s) {
    const f = {};
    if (/タップされている|タップしている/.test(s) && !/アンタップ/.test(s)) f.tappedOnly = true;
    if (/アンタップしている|アンタップされている/.test(s)) f.untappedOnly = true;
    let m = s.match(/パワー(\d+)以下/);
    if (m) f.maxPower = +m[1];
    m = s.match(/コスト(\d+)以下/);
    if (m) f.maxCost = +m[1];
    return f;
  }

  function countOf(s) {
    const m = s.match(/(\d+)(体|枚|つ)/);
    return m ? +m[1] : 1;
  }

  // 一つの効果文（トリガー部分は除去済み）を action に変換。読めなければ null
  function parseEffect(body) {
    const s = body.replace(/。$/, '');
    const optional = /てもよい|まで/.test(s);
    let m;

    if ((m = s.match(/墓地から(.*?)(コスト(\d+)以下の)?(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?(クリーチャー|タマシード)(または|か)?(クリーチャー|タマシード)?を?(\d+)(体|つ)?(まで)?(選び、)?(バトルゾーンに)?出/))) {
      const kinds = [m[7], m[9]].filter(Boolean).map((k) => (k === 'クリーチャー' ? 'creature' : 'tamaseed'));
      const civ = m[4] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[4]] : null;
      return { act: 'reanimate', kinds, civ, maxCost: m[3] ? +m[3] : m[6] ? +m[6] : null, n: +(m[10] || 1), optional };
    }
    if ((m = s.match(/^(コスト(\d+)以下の)?(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?(クリーチャー|タマシード)(または|か)?(クリーチャー|タマシード)?を(\d+)(体|つ|枚)(まで)?、?(自分の)?墓地から(バトルゾーンに)?出/))) {
      const kinds = [m[6], m[8]].filter(Boolean).map((k) => (k === 'クリーチャー' ? 'creature' : 'tamaseed'));
      const civ = m[3] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[3]] : null;
      return { act: 'reanimate', kinds, civ, maxCost: m[2] ? +m[2] : m[5] ? +m[5] : null, n: +m[9], optional };
    }
    if ((m = s.match(/^(自分は)?(、)?(([^、。]*?)・)?(超)?メクレイド\s*(\d+)(する|を行う)?$/))) {
      return { act: 'mekuraid', n: +m[6], race: m[4] || null, look: 3 };
    }
    if ((m = s.match(/^カードを(最大)?(\d+)枚(まで)?引/))) {
      return { act: 'draw', n: +m[2], optional };
    }
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?(まで)?を?(タップして)?(自分の)?マナゾーンに(タップして)?置/))) {
      return { act: 'manaBoost', n: +m[1], optional };
    }
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?(まで)?をシールド化する|^自分の山札の上から(\d+)枚(目)?を(自分の)?シールドゾーンに(裏向きのまま)?(加える|置く)/))) {
      return { act: 'shieldAdd', n: +(m[1] || m[4]), optional };
    }
    if (/クリーチャー/.test(s) && /破壊する$|破壊してもよい$/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'destroy', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, ...targetFilter(s) };
    }
    if (/クリーチャー/.test(s) && /(持ち主の)?山札の下に置く$|山札の下に置いてもよい$/.test(s) && !/墓地から|マナゾーンから/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'deckBottom', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, ...targetFilter(s) };
    }
    if (/クリーチャー/.test(s) && /(持ち主の)?マナゾーンに置く$|マナゾーンに置いてもよい$/.test(s) && !/山札の上|墓地から|手札から/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'toMana', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, ...targetFilter(s) };
    }
    if ((m = s.match(/^自分のシールドを(\d+)つ(まで)?、?(選び、)?手札に加え(る|てもよい)(。ただし、その「S・トリガー」は使えない)?$/))) {
      return { act: 'shieldToHand', n: +m[1], optional: !!m[2] || /てもよい/.test(s), noTrigger: true };
    }
    if (/^自分は(、)?ゲームに負ける$/.test(s)) return { act: 'loseGame' };
    if (/^相手は(、)?ゲームに負ける$/.test(s)) return { act: 'winGame' };
    if ((m = s.match(/^相手のシールドを(\d+)つ選び、持ち主の墓地に置く$/))) {
      return { act: 'shieldBurn', n: +m[1] };
    }
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選ぶ。(この|その)ターン、そのクリーチャーのパワーを-(\d+)する$/))) {
      return { act: 'powerDown', side: 'opp', n: +m[1], amount: +m[3] };
    }
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選ぶ。このターン、そのクリーチャーのパワーを-(\d+)する$/))) {
      return { act: 'powerDown', side: 'opp', n: +m[1], amount: +m[2] };
    }
    if (/クリーチャー/.test(s) && /手札に戻す$|手札に戻してもよい$/.test(s) && !/墓地/.test(s) && !/マナ/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'bounce', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, ...targetFilter(s) };
    }
    if (/クリーチャー/.test(s) && /(?<!アン)タップする$|(?<!アン)タップしてもよい$/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'tap', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, ...targetFilter(s) };
    }
    if ((m = s.match(/^相手の手札を(\d+)枚見ないで選び、捨てさせる$/))) {
      return { act: 'discard', n: +m[1], random: true };
    }
    if ((m = s.match(/^相手の手札を見ないで(\d+)枚選び、捨てさせる$/))) {
      return { act: 'discard', n: +m[1], random: true };
    }
    if ((m = s.match(/^相手は(自身|自分)の手札を(\d+)枚選(び、|んで)捨てる$/))) {
      return { act: 'discard', n: +m[2], random: false };
    }
    if (/^自分の墓地から/.test(s) && /手札に(戻す|加える)/.test(s)) {
      return { act: 'graveToHand', n: countOf(s), creatureOnly: /クリーチャー/.test(s), optional };
    }
    if (/^自分のマナゾーンから/.test(s) && /手札に(戻す|加える)/.test(s)) {
      return { act: 'manaToHand', n: countOf(s), optional };
    }
    if ((m = s.match(/^(自分の)?手札を(\d+)枚(選び、)?捨てる$/))) {
      return { act: 'selfDiscard', n: +m[2] };
    }
    if ((m = s.match(/^自分の山札の上から(\d+)枚(まで)?を(自分の)?墓地に置(く|いてもよい)$/))) {
      return { act: 'mill', n: +m[1], optional: /てもよい/.test(s) };
    }
    // 直前に選んだクリーチャーを、次のターンのはじめにアンタップさせない
    if (/^(次の(自分|相手)のターンのはじめ(に|まで)、)?(それ|そのクリーチャー|そのカード)(は|を)(、)?(次の(自分|相手)のターンのはじめ(に|まで)、?)?アンタップしない$/.test(s)) {
      return { act: 'freezeLast' };
    }
    if (/^このクリーチャーをアンタップする$/.test(s)) {
      return { act: 'untapSelf' };
    }
    if ((m = s.match(/^相手のシールドを(\d+)つ(選び、)?ブレイクする$/))) {
      return { act: 'breakShield', n: +m[1] };
    }
    if ((m = s.match(/^(このターン、)?このクリーチャーのパワーを\+(\d+)する$/))) {
      return { act: 'powerUp', n: +m[2] };
    }
    return null;
  }

  // 「その後、」や「。」で区切った複数効果を読む。全部読めた時だけ配列を返す
  function parseEffects(body) {
    const parts = body
      .replace(/(引き|引いて)、(その後、)?(自分の)?(手札を)?(\d+枚)(選び、)?捨てる/g, '引く。自分の手札を$5捨てる')
      .split(/。その後、|、その後、|。/)
      .map((x) => x.trim())
      .filter(Boolean);
    const acts = [];
    let ok = 0;
    for (const p of parts) {
      const a = parseEffect(p);
      if (a) {
        acts.push(a);
        ok++;
      } else acts.push({ act: 'manualNote', text: p });
    }
    // 最初の文が読めない時（条件や選び方が分からない時）は、全体を手動にする
    if (!ok || acts[0].act === 'manualNote') return null;
    return acts;
  }

  const KWD = () => G.Keywords || (typeof require !== 'undefined' ? require('./keywords.js') : null);
  const CIVJ = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' };

  // def: {type, text}
  function parseCard(def) {
    const kw = { breaker: 1, powerAttacker: 0 };
    const abilities = []; // {when, acts, cond}
    const manual = []; // 自動化できない文
    const known = []; // 認識したが手動のキーワード {name, desc}
    const hyper = { kw: { breaker: 1, powerAttacker: 0 }, abilities: [] }; // ハイパーモード中だけ有効
    let hyperUsed = false;
    let inHyper = false;
    const A_PUSH = (w, ab) => (inHyper ? hyper.abilities : abilities).push(ab);
    const rawLines = normalize(def.text).split('\n').map((l) => l.trim()).filter(Boolean);
    // 「▶」「►」で始まる行は、直前の「選ぶ」行の選択肢としてまとめる
    const lines = [];
    for (const l of rawLines) {
      if (/^[▶►]/.test(l) && lines.length) {
        const prev = lines[lines.length - 1];
        (prev.opts = prev.opts || []).push(l.replace(/^[▶►]\s*/, ''));
      } else lines.push(Object.assign(new String(l.replace(/^[■▪・●◆]\s*/, '')), {}));
    }
    const Kd = KWD();

    for (const rawObj of lines) {
      const raw = String(rawObj);
      let line = stripReminder(raw);
      if (!line) continue;
      // 選択肢つきの能力（「次の中から1つ選ぶ」＋ ▶ の行）
      const inline = !rawObj.opts && line.match(/^(.*?)(次の(中|うち)から|以下から)?(\d+|いずれか1|好きな数|いくつでも)(回|つ)?選ぶ[。：:]\s*(.+)$/);
      if (rawObj.opts || (inline && /[／/]/.test(inline[6]))) {
        const head = rawObj.opts ? line : inline[1] + '選ぶ';
        const optTexts = rawObj.opts || inline[6].split(/[／/]/);
        let whens = [];
        for (const t of TRIGGERS) if (t.re.test(head)) whens = [t.when];
        if (!whens.length && def.type === 'spell') whens = ['cast'];
        if (!whens.length) {
          // いつ使うか分からない選択肢は手動扱い
          manual.push(raw);
          continue;
        }
        const cm = (rawObj.opts ? head : line).match(/(\d+)(回|つ)選ぶ/);
        const count = /好きな数|いくつでも/.test(line) ? 'any' : cm ? +cm[1] : 1;
        const repeat = /同じものを(選んでも|何度)|同じ(もの|選択肢)を2回/.test(raw + (rawObj.opts || []).join(''));
        const bothLine = [raw, ...(rawObj.opts || [])].find((x) => /両方|すべて選んでもよい|全部選/.test(x)) || '';
        const bc = bothLine.match(/(光|水|闇|火|自然)(と|、)(光|水|闇|火|自然)/);
        const bothCond = bothLine ? { civs: bc ? [CIVJ[bc[1]], CIVJ[bc[3]]] : [], text: bothLine } : null;
        const options = optTexts.map((t) => ({ text: t.trim(), acts: parseEffects(stripReminder(t.trim()).replace(/。$/, '')) }));
        for (const w of whens) A_PUSH(w, { when: w, acts: [], modal: { count, repeat, bothCond, options }, text: raw });
        continue;
      }
      // ハイパーモードの区切り
      const hm = line.match(/^ハイパーモード\s*(\d+)?/);
      if (hm) {
        inHyper = true;
        hyperUsed = true;
        if (hm[1]) kw.hyperPower = +hm[1];
        continue;
      }
      const K = inHyper ? hyper.kw : kw;
      const A = inHyper ? hyper.abilities : abilities;
      // キーワード辞書
      const hit = Kd && Kd.match(line, raw);
      if (hit) {
        if (hit.e.set) hit.e.set(K, hit.m, raw);
        if (!hit.e.auto) known.push({ name: hit.e.name, desc: hit.e.desc, text: raw });
        continue;
      }
      // 旧来の書式（後方互換）
      const kwHit = KEYWORDS.find((k) => k.re.test(line));
      if (kwHit) {
        kwHit.set(K, line.match(kwHit.re));
        continue;
      }
      // マナ武装N：… → 条件付きの能力
      let cond = null;
      const ma = line.match(/^マナ武装\s*(\d+)[：:]\s*(.*)$/);
      if (ma) {
        line = ma[2];
        cond = { manaCiv: null, n: +ma[1] };
      }
      const mc = line.match(/自分のマナゾーンに(光|水|闇|火|自然)のカードが(\d+)枚以上あれば、/);
      if (mc) {
        cond = { manaCiv: CIVJ[mc[1]], n: +mc[2] };
        line = line.replace(mc[0], '');
      }
      // マナ武装の召喚コスト軽減
      const mcost = line.match(/^このクリーチャーの召喚コストを(\d+)少なくする。?$/);
      if (mcost && cond) {
        K.manaArmedCost = { ...cond, n2: +mcost[1] };
        continue;
      }
      // 単独の「メクレイドN」は、出た時に行う
      const mk = line.match(/^(([^、。]*?)・)?(超)?メクレイド\s*(\d+)$/);
      if (mk) {
        A.push({ when: 'summon', acts: [{ act: 'mekuraid', n: +mk[4], race: mk[2] || null, look: 3 }], text: raw });
        continue;
      }
      // 封印
      const seal = line.match(/封印を(\d+)つ付ける/);
      let whens = [];
      let body = line;
      // 「出た時または攻撃する時」
      const both = line.match(/^このクリーチャーが(バトルゾーンに)?出た時(、)?(または|か|、)攻撃する時、/);
      const atkBlk = line.match(/^このクリーチャーが攻撃(する時)?(または|か|、)ブロックした時、/);
      if (both) {
        whens = ['summon', 'attack'];
        body = line.replace(both[0], '');
      } else if (atkBlk) {
        whens = ['attack', 'block'];
        body = line.replace(atkBlk[0], '');
      } else {
        for (const t of TRIGGERS) {
          if (t.re.test(line)) {
            whens = [t.when];
            body = line.replace(t.re, '');
            break;
          }
        }
      }
      if (seal && !whens.length) whens = ['summon'];
      if (!whens.length) {
        if (def.type === 'spell') whens = ['cast'];
        else {
          manual.push(raw);
          if (Kd) for (const e of Kd.mentions(line)) known.push({ name: e.name, desc: e.desc, text: raw });
          continue;
        }
      }
      const acts = seal ? [{ act: 'seal', n: +seal[1] }] : parseEffects(body);
      if (acts) for (const w of whens) A.push({ when: w, acts, cond, text: raw });
      else {
        manual.push(raw);
        if (Kd) for (const e of Kd.mentions(line)) known.push({ name: e.name, desc: e.desc, text: raw });
      }
    }
    // パワーアタッカー・ブレイカーなどの初期値
    return { kw, abilities, manual, known, hyper: hyperUsed ? hyper : null };
  }

  const ACT_LABEL = {
    draw: (a) => `${a.n}枚ドロー`,
    manaBoost: (a) => `山札から${a.n}枚マナ`,
    shieldAdd: (a) => `山札から${a.n}枚シールド化`,
    destroy: (a) => `${sideJ(a.side)}${filt(a)}${a.all ? 'すべて' : a.n + '体'}破壊`,
    bounce: (a) => `${sideJ(a.side)}${filt(a)}${a.all ? 'すべて' : a.n + '体'}手札に戻す`,
    tap: (a) => `${sideJ(a.side)}${filt(a)}${a.all ? 'すべて' : a.n + '体'}タップ`,
    discard: (a) => `相手の手札${a.n}枚捨て${a.random ? '(ランダム)' : ''}`,
    graveToHand: (a) => `墓地から${a.n}枚回収`,
    manaToHand: (a) => `マナから${a.n}枚回収`,
    breakShield: (a) => `シールド${a.n}つブレイク`,
    powerUp: (a) => `パワー+${a.n}`,
    selfDiscard: (a) => `自分の手札${a.n}枚捨て`,
    mill: (a) => `山札から${a.n}枚墓地へ`,
    untapSelf: () => `自身をアンタップ`,
    mekuraid: (a) => `${a.race ? a.race + '・' : ''}メクレイド${a.n}`,
    manualNote: (a) => `［手動: ${String(a.text).slice(0, 16)}…］`,
    seal: (a) => `封印を${a.n}つ付ける`,
    freezeLast: () => 'それはアンタップしない',
    shieldToHand: (a) => `自分のシールド${a.n}つを手札へ`,
    loseGame: () => '自分は負ける',
    winGame: () => '自分の勝ち',
    deckBottom: (a) => `${sideJ(a.side)}${filt(a)}${a.all ? 'すべて' : a.n + '体'}山札の下へ`,
    toMana: (a) => `${sideJ(a.side)}${filt(a)}${a.all ? 'すべて' : a.n + '体'}マナへ`,
    shieldBurn: (a) => `相手のシールド${a.n}つを墓地へ`,
    powerDown: (a) => `相手の${a.n}体パワー-${a.amount}`,
    reanimate: (a) => `墓地から${a.maxCost ? 'コスト' + a.maxCost + '以下の' : ''}${a.kinds.map((k) => (k === 'creature' ? 'クリーチャー' : 'タマシード')).join('か')}を${a.n}つ出す`,
  };
  function sideJ(s) {
    return s === 'opp' ? '相手の' : s === 'self' ? '自分の' : '';
  }
  function filt(a) {
    return (a.tappedOnly ? 'タップ中の' : '') + (a.untappedOnly ? 'アンタップ中の' : '') + (a.maxPower ? `パワー${a.maxPower}以下` : '') + (a.maxCost ? `コスト${a.maxCost}以下` : '');
  }
  const WHEN_LABEL = { summonOnly: '召喚で出た時', summon: '出た時', attack: '攻撃時', destroyed: '破壊時', turnStart: 'ターン開始時', turnEnd: 'ターン終了時', shieldAdded: 'シールド追加時', cast: '呪文', block: 'ブロック時', battleWin: 'バトルに勝った時', oppTurnStart: '相手のターン開始時', broke: 'ブレイクした時' };

  function civJ(c) {
    return { light: '光', water: '水', darkness: '闇', fire: '火', nature: '自然' }[c] || '';
  }
  function describe(parsed) {
    const out = [];
    const k = parsed.kw;
    if (k.blocker) out.push('ブロッカー');
    if (k.speedAttacker) out.push('スピードアタッカー');
    if (k.slayer) out.push('スレイヤー');
    if (k.shieldTrigger) out.push('S・トリガー');
    if (k.machFighter) out.push('マッハファイター');
    if (k.breaker > 1) out.push(k.breaker >= 99 ? 'ワールド・ブレイカー' : `${k.breaker}枚ブレイク`);
    if (k.powerAttacker) out.push(`パワーアタッカー+${k.powerAttacker}`);
    if (k.cantAttackPlayer) out.push('プレイヤー攻撃不可');
    if (k.cantAttack) out.push('攻撃不可');
    if (k.unblockable) out.push('ブロックされない');
    if (k.enterTapped) out.push('タップして出る');
    if (k.noUntap) out.push('ターン開始時にアンタップしない');
    if (k.charger) out.push('チャージャー');
    if (k.breakSubstitute) out.push('ブレイク身代わり');
    if (k.exLife) out.push('EXライフ');
    if (k.gStrike) out.push('G・ストライク');
    if (k.yobinion) out.push('ヨビニオン');
    const flags = {
      justDiver: 'ジャストダイバー', shieldGo: 'シールド・ゴー', escape: 'エスケープ', guardman: 'ガードマン', poweredBreaker: 'パワード・ブレイカー',
      attackUntapped: 'アンタップ攻撃可', untargetable: '相手に選ばれない', sinkarize: 'シンカライズ', zRush: 'Zラッシュ',
    };
    for (const [f, label] of Object.entries(flags)) if (k[f]) out.push(label);
    if (k.ninjaStrike) out.push(`ニンジャ・ストライク${k.ninjaStrike}`);
    if (k.bad) out.push(`B・A・D${k.bad}`);
    if (k.sasage) out.push(`ササゲール${k.sasage}${k.sasageFor ? '（' + k.sasageFor + '）' : ''}`);
    if (k.sympathy) out.push(`シンパシー（${k.sympathy}）`);
    if (k.revChange) out.push(`革命チェンジ（${k.revChange.text}）`);
    if (k.invasion) out.push(`侵略（${k.invasion.text}）`);
    if (k.evolution) out.push(k.evolution === 'neo' ? 'NEO進化' : '進化');
    if (k.gZero) out.push(`G・ゼロ（${k.gZero}）`);
    if (k.spellLockMax != null) out.push(`相手のコスト${k.spellLockMax}以下の呪文を封じる`);
    if (k.manaArmedCost) out.push(`マナ武装${k.manaArmedCost.n}: コスト-${k.manaArmedCost.n2}`);
    const ab = (x) =>
      x.modal
        ? `${WHEN_LABEL[x.when]}: 選択（${x.modal.count === 'any' ? '好きな数' : x.modal.count + (x.modal.repeat ? '回・重複可' : 'つ')}${x.modal.bothCond ? '・条件で全部' : ''}）` +
          x.modal.options.map((o) => '［' + (o.acts ? o.acts.map((a) => ACT_LABEL[a.act](a)).join('→') : '手動') + '］').join('')
        : `${WHEN_LABEL[x.when]}: ` + (x.cond ? `[マナに${x.cond.manaCiv ? civJ(x.cond.manaCiv) : ''}${x.cond.n}枚以上なら] ` : '') + x.acts.map((a) => ACT_LABEL[a.act](a) + (a.optional ? '(任意)' : '')).join(' → ');
    for (const x of parsed.abilities) out.push(ab(x));
    if (parsed.hyper) {
      const hk = describe({ kw: parsed.hyper.kw, abilities: parsed.hyper.abilities });
      out.push(`ハイパーモード${k.hyperPower ? '(' + k.hyperPower + ')' : ''}: ${hk.join('・') || '—'}`);
    }
    return out;
  }

  G.TextParse = { parseCard, describe, normalize };
  if (typeof module !== 'undefined') module.exports = G.TextParse;
})(typeof globalThis !== 'undefined' ? globalThis : window);
