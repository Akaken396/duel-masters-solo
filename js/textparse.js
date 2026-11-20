// カードテキスト → 自動処理できる能力 への変換
// 読み取れない文は manual として残し、対戦中に「手動で処理」と表示する。
(function (G) {
  'use strict';

  function normalize(s) {
    return String(s || '')
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/ひとつ/g, '1つ')
      .replace(/ふたつ/g, '2つ')
      .replace(/みっつ/g, '3つ')
      .replace(/[＋]/g, '+')
      .replace(/｢/g, '「')
      .replace(/｣/g, '」')
      .replace(/[−－]/g, '-')
      .replace(/[，]/g, '、')
      .replace(/[．]/g, '。')
      .replace(/\r/g, '')
      .replace(/^(\{O[A-Z]?\}|\[O[A-Z]?\])\s*/gm, '〔バズ〕') // バズレンダで使う能力の印
      .replace(/\{[^}]{1,6}\}\s*/g, '') // 公式ページのアイコン記号 {GS} {x+} など
      .replace(/^[a-z]{1,2}[A-Z]?(?=この|自分|相手|各ターン)/gm, '') // 行頭に残ったアイコンの文字
      .replace(/\s*\[([lwdfn]{1,5})(\d{2})\]\s*支払って/g, '〔代替$1$2〕支払って') // 代わりに払うコスト
      .replace(/\[[a-z]{1,5}\d{0,3}\]/g, '') // マナ記号 [ll02] など
      .replace(/^l\s+/gm, '') // 能力を与える時の記号
      .replace(/\?\?|\uFFFD{1,2}/g, '\n▶')
      .replace(/。\s*▼\s*/g, '。\n▶')
      // エンジンが常に守る注意書きは読み飛ばす
      .replace(/(。|、)\s*ただし(、)?(その)?(召喚)?コストは\s*[01０１]\s*(以下に(は)?ならない|より少なくならない|以下にはならない)(。)?/g, '。')
      .replace(/(。|、)\s*ただし(、)?その「S・トリガー」は使えない(。)?/g, '。')
      .replace(/(。|、)\s*その「S・トリガー」は使えない(。)?/g, '。')
      .replace(/(。|、)\s*ただし(、)?(その|それらの)「S・トリガー」(能力)?は使えない(。)?/g, '。')
      .replace(/。。/g, '。')
      .replace(/代わりに/g, 'かわりに')
      .replace(/^自分の(他の)?([^、。]{1,24}?)をバトルゾーンに出した(時|とき)、/gm, '自分の$1$2が出た時、')
      .replace(/^(覚醒|龍解|ループ覚醒|覚醒リンク|龍解リンク|超覚醒)\s*[-－：:―—‐]\s*/gm, '')
      .replace(/唱えること(が|は)できない/g, '唱えられない')
      .replace(/パワー(を|は)\s*[_?−‐]\s*(\d)/g, 'パワー$1-$2')
      .replace(/パワー(を|は)(-|\+)(\d+)\s+(する|され)/g, 'パワー$1$2$3$4')
      .replace(/パワーアタッカー\s+\+/g, 'パワーアタッカー+')
      .replace(/(\d+)(体|枚|つ)につき(\d+)枚、カードを引/g, '$1$2につき、カードを$3枚引')
      .replace(/カードをもう(\d+)枚/g, 'カードを$1枚')
      .replace(/山札の上からもう(\d+)枚/g, '山札の上から$1枚')
      .replace(/(?<!も)てよい/g, 'てもよい')
      .replace(/山札の上から(\d+)枚(目)?を、(?=(タップして)?マナゾーン)/g, '山札の上から$1枚$2を')
      .replace(/裏向きのまま、それぞれ新しいシールドとして/g, '裏向きのまま、新しいシールドとして')
      .replace(/をすべてのプレイヤーに見せ(る|てもよい)/g, 'を表向きにする')
      .replace(/このターンが終わるまで、|このターンの終わりまで、/g, 'このターン、')
      .replace(/(攻撃|ブロック)すること(が|は)できない/g, '$1できない')
      .replace(/^\s*▼\s*/gm, '▶')
      .replace(/^\s*→\s*/gm, '▶')
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
    { re: /^この(クリーチャー|タマシード|カード|城|G城)(が|を)(、)?(バトルゾーンに出た|バトルゾーンに出した|出た|召喚した|使った|進化して出た)(時|とき)、/, when: 'summon' },
    { re: /^このクリーチャーまたは自分の[^、]{1,20}が(バトルゾーンに)?出た(時|とき)、/, when: 'summon' },
    { re: /^このカードが表向きで自分のシールドゾーンに置かれた時(またはこのクリーチャーが出た時)?、/, when: 'summon' },
    { re: /^カードが表向きで自分のシールドゾーンに置かれた時、/, when: 'shieldAdded' },
    { re: /^このクリーチャーが攻撃する(時|とき)、/, when: 'attack' },
    { re: /^このクリーチャーの攻撃の終わりに、/, when: 'attackEnd' },
    { re: /^(各ターンに1度、)?カードが自分のシールドゾーンを離れた(時|とき)、/, when: 'ownShieldLeft' },
    { re: /^このクリーチャーの各ブレイクの前に、/, when: 'beforeBreak' },
    { re: /^このクリーチャーが相手プレイヤーを攻撃してブロックされなかった(時|とき)、/, when: 'unblocked' },
    { re: /^ラビリンス[：:]このクリーチャーが(バトルゾーンに)?出た(時|とき)、/, when: 'summon' },
    { re: /^このクリーチャーが召喚によって出た時、/, when: 'summonOnly' },
    { re: /^このクリーチャーが破壊された時、/, when: 'destroyed' },
    { re: /^自分のターンのはじめに、/, when: 'turnStart' },
    { re: /^自分のターンの(終わり|おわり)に、/, when: 'turnEnd' },
    { re: /^(自分のシールドゾーンにカードが|カードが自分のシールドゾーンに)置かれた時、/, when: 'shieldAdded' },
    { re: /^このクリーチャーが(相手のクリーチャーの攻撃を)?ブロック(した|する)(時|とき)、/, when: 'block' },
    { re: /^このクリーチャーが(バトルゾーンを)?離れた(時|とき)、/, when: 'left' },
    { re: /^このクリーチャーがバトルに負けた(時|とき)、/, when: 'battleLose' },
    { re: /^このクリーチャーがタップした(時|とき)、/, when: 'tapped' },
    { re: /^このクリーチャーが(自分のターンのはじめに)?アンタップした(時|とき)、/, when: 'untapped' },
    { re: /^シンカパワー[：:]この(クリーチャー|タマシード)が(進化する|進化元になる)(時|とき)、/, when: 'evolveSource' },
    { re: /^このクリーチャーが攻撃された(時|とき)(または相手に選ばれた(時|とき))?、/, when: 'attacked' },
    { re: /^このクリーチャーがバトルに勝った時、/, when: 'battleWin' },
    { re: /^相手のターンのはじめに、/, when: 'oppTurnStart' },
    { re: /^このクリーチャーが(相手の)?シールドをブレイクした時、/, when: 'broke' },
  ];

  // 発動タイミングの部品。「AまたはB、」のような組み合わせも読む
  const TRIGGER_ATOMS = [
    [/^(このクリーチャー|このカード|このタマシード|このフィールド|このDGフィールド|このDNフィールド|このD2フィールド|このクロスギア|このオーラ|このドラグハート|このG城)(が|を)?(、)?(バトルゾーンに)?(出た|出した)(時|とき)/, 'summon'],
    [/^(このクリーチャーの)?(最初の)?攻撃の終わりに/, 'attackEnd'],
    [/^(このクリーチャーが)?(はじめて)?バトルに勝った(時|とき)/, 'battleWin'],
    [/^このクリーチャーが(、)?[^、。]*?バトルに負けた(時|とき)/, 'battleLose'],
    [/^(このクリーチャーが)?バトルする(時|とき)/, 'battled'],
    [/^(このクリーチャー|このカード)が(どこからでも|バトルゾーンから)?(自分の)?墓地に置かれた(時|とき)/, 'toGrave'],
    [/^このクリーチャーがタップされた(時|とき)/, 'tapped'],
    [/^自分の(他の)?(光|水|闇|火|自然)?(の)?クリーチャーがバトルに勝った(時|とき)/, 'allyBattleWin'],
    [/^これを(付けた|装備した|クロスした)クリーチャーが破壊された(時|とき)/, 'hostDestroyed'],
    [/^(このクリーチャーが)?召喚によって出た(時|とき)/, 'summonOnly'],
    [/^(このクリーチャーが)?(、)?進化して出た(時|とき)/, 'summon'],
    [/^(このクリーチャーが)?攻撃する(時|とき)/, 'attack'],
    [/^(このクリーチャーが|このクリーチャーを)?タップした(時|とき)/, 'tapped'],
    [/^(このクリーチャーが)?(バトルゾーンを)?離れた(時|とき)/, 'left'],
    [/^(このクリーチャーが)?破壊された(時|とき)/, 'destroyed'],
    [/^(このクリーチャーが)?相手に選ばれた(時|とき)/, 'targeted'],
    [/^相手がこのクリーチャーを選んだ(時|とき)/, 'targeted'],
    [/^(このクリーチャーが)?ブロックした(時|とき)/, 'block'],
    [/^(このクリーチャーの)?「EXライフ」シールドが(自分のシールドゾーンを)?離れた(時|とき)/, 'exLifeLost'],
    [/^自分のターンのはじめに/, 'turnStart'],
    [/^自分のターンの(終わり|おわり)に/, 'turnEnd'],
    [/^相手のターンのはじめに/, 'oppTurnStart'],
    [/^相手のクリーチャーが攻撃する(時|とき)/, 'oppAttack'],
    [/^自分が呪文を唱えた(時|とき)/, 'allyCast'],
    [/^相手が呪文を唱えた(時|とき)/, 'oppCast'],
    [/^自分のクリーチャーがバトルに勝った(時|とき)/, 'allyBattleWin'],
    [/^相手のクリーチャーが破壊された(時|とき)/, 'oppDestroyed'],
    [/^カードが自分のシールドゾーン(から|を)離れた(時|とき)/, 'ownShieldLeft'],
    [/^カードが自分のシールドゾーンから墓地に置かれた(時|とき)/, 'ownShieldLeft'],
    [/^カードが自分のシールドゾーンに置かれた(時|とき)/, 'shieldAdded'],
    [/^(各ターンの終わりに|ターンの終わりに)/, 'eachTurnEnd'],
    [/^自分が(手札を(\d+)枚|カードを)捨てた(時|とき)/, 'selfDiscarded'],
    [/^自分がカードを引いた(時|とき)/, 'selfDraw'],
    [/^相手が(カードを実行|呪文を唱えるかクリーチャーを召喚|カードを使っ)した?(時|とき)/, 'oppPlay'],
    [/^相手のクリーチャーがコストを支払わずに(バトルゾーンに)?出た(時|とき)/, 'oppEnterFree'],
    [/^相手のクリーチャーが相手のマナゾーンのカードをタップせずに(バトルゾーンに)?出た(時|とき)/, 'oppEnterFree'],
    [/^自分の手札を(\d+枚)?捨てた(時|とき)/, 'selfDiscarded'],
    [/^カードが相手のシールドゾーンに置かれた(時|とき)/, 'oppShieldAdded'],
    [/^相手のマナゾーン(にある|の)カードの枚数よりコストが大きい相手のクリーチャーが(バトルゾーンに)?出た(時|とき)/, 'oppEnterBig'],
    [/^このカードを(自分の)?手札からマナゾーンに置いた(時|とき)/, 'charged'],
    [/^(相手の)?クリーチャーが(自分を)?攻撃する(時|とき)/, 'oppAttack'],
    [/^これを(装備|クロス|付け)(した|た)クリーチャーが攻撃する(時|とき)/, 'hostAttack'],
    [/^これを(装備|クロス|付け)(した|た)クリーチャーの攻撃の終わりに/, 'hostAttackEnd'],
    [/^これを(クリーチャーに)?(付けた|クロスした|装備した)(時|とき)/, 'summon'],
    [/^相手のターンの終わりに/, 'oppTurnEnd'],
    [/^相手のクリーチャーが(バトルゾーンに)?出た(時|とき)/, 'oppEnter'],
    [/^他のクリーチャーが(バトルゾーンに)?出た(時|とき)/, 'anyEnter'],
    [/^(他の)?クリーチャーが破壊された(時|とき)/, 'anyDestroyed'],
    [/^このクリーチャーまたは自分の他のクリーチャーが破壊された(時|とき)/, 'selfOrAllyDestroyed'],
    [/^このクリーチャーがブロックされた(時|とき)/, 'blocked'],
    [/^相手のクリーチャーが自分を攻撃してブロックされなかった(時|とき)/, 'oppUnblocked'],
    [/^相手のクリーチャーが自分を攻撃する(時|とき)/, 'oppAttack'],
    [/^(このクリーチャーが)?バトルした(時|とき)/, 'battled'],
    [/^このクリーチャーを召喚してバトルゾーンに出した(時|とき)/, 'summonOnly'],
    [/^このクリーチャーが召喚によってバトルゾーンに出た(時|とき)/, 'summonOnly'],
    [/^このクリーチャーが(他の)?ゴッドとリンクした(時|とき)/, 'linked'],
    [/^相手のクリーチャーが召喚以外の方法で(バトルゾーンに)?出た(時|とき)/, 'oppEnterNonSummon'],
    [/^相手が召喚以外の方法でクリーチャーを(バトルゾーンに)?出した(時|とき)/, 'oppEnterNonSummon'],
    [/^このクリーチャーが「(革命チェンジ|侵略|侵略ZERO|S級侵略[^」]*)」(能力)?によって(バトルゾーンに)?出た(時|とき)/, 'enteredByChange'],
    [/^自分の進化クリーチャーを(他の)?クリーチャーの上に置いた(時|とき)/, 'allyEvolved'],
    [/^相手のクリーチャーが攻撃またはブロックした(時|とき)/, 'oppAttack'],
    [/^相手が(自身の)?手札を(\d+枚)?捨てた(時|とき)/, 'oppDiscarded'],
    [/^自分のターンが終わる(時|とき)/, 'turnEnd'],
    [/^カードが自分の墓地から離れた(時|とき)/, 'graveLeft'],
    [/^自分のシールドがブレイクされた(時|とき)/, 'ownShieldBroken'],
    [/^自分の裁きの紋章を持つ呪文を唱えた(時|とき)/, 'allyCastCrest'],
    [/^自分のシールドゾーンにカードが置かれた(時|とき)/, 'shieldAdded'],
    [/^他のクリーチャーが(バトルゾーンを)?離れた(時|とき)/, 'anyLeft'],
    [/^自分のクリーチャーが(バトルゾーンに)?出た(時|とき)/, 'allyEnterAny'],
  ];
  // 行頭の発動タイミングを読む。読めたら {whens, rest, cond}
  function parseTriggerHead(line) {
    let rest = line;
    const cond = {};
    // 「相手のターン中に、」「相手のターンに」は条件
    let mm;
    if ((mm = rest.match(/^相手のターン(中)?に、?/))) {
      cond.oppTurn = true;
      rest = rest.slice(mm[0].length);
    }
    if ((mm = rest.match(/^自分のターン(中)?に、?(?=この)/))) {
      cond.myTurn = true;
      rest = rest.slice(mm[0].length);
    }
    if ((mm = rest.match(/^各ターン、(このクリーチャーの)?(?=最初の攻撃の終わりに)/))) {
      cond.firstPerTurn = true;
      rest = rest.slice(mm[0].length);
    }
    if ((mm = rest.match(/^各ターン、(このクリーチャーが|自分が)?はじめて/))) {
      if (mm[1] === '自分が') rest = '自分が' + rest.slice(mm[0].length), (cond.firstPerTurn = true);
    }
    if (!cond.firstPerTurn && (mm = rest.match(/^各ターン、(このクリーチャーが)?はじめて/))) {
      cond.firstPerTurn = true;
      rest = rest.slice(mm[0].length);
    }
    if ((mm = rest.match(/^(各ターンに(1|一)度、|各ターン1回、)/))) {
      cond.oncePerTurn = true;
      rest = rest.slice(mm[0].length);
    }
    if ((mm = rest.match(/^このクリーチャーが出たターンに/))) {
      cond.enteredThisTurn = true;
      rest = rest.slice(mm[0].length);
    }
    if ((mm = rest.match(/^バラバラエティ\d+[：:]/))) rest = rest.slice(mm[0].length);
    if ((mm = rest.match(/^(ウルトラ・)?ドロン・ゴー[：:]/))) rest = rest.slice(mm[0].length);
    if ((mm = rest.match(/^各ターン、自分の(\d+)体目のクリーチャーが(バトルゾーンに)?出た(時|とき)、/))) return { whens: ['allyEnterAny'], rest: rest.slice(mm[0].length), cond: { ...cond, nthCreature: +mm[1] } };
    if ((mm = rest.match(/^(自分のターン中に、)?コスト(\d+)以上のクリーチャーを召喚した(時|とき)またはコスト(\d+)以上の呪文を唱えた(時|とき)、/))) return { whens: ['selfPlay'], rest: rest.slice(mm[0].length), cond: { ...cond, evMinCost: +mm[2], ...(mm[1] ? { myTurnOnly: true } : {}) } };
    const whens = [];
    for (let guard = 0; guard < 4; guard++) {
      const atom = TRIGGER_ATOMS.find(([re]) => re.test(rest));
      if (!atom) break;
      const m0 = rest.match(atom[0]);
      whens.push(atom[1]);
      rest = rest.slice(m0[0].length);
      const sep = rest.match(/^(、)?(または|か)(、)?/);
      if (sep) {
        rest = rest.slice(sep[0].length);
        // 主語を省いた2つ目（「このクリーチャーが出た時または離れた時」）
        continue;
      }
      break;
    }
    if (!whens.length || !/^、/.test(rest)) return null;
    return { whens: [...new Set(whens)], rest: rest.slice(1), cond };
  }

  // 対象の側：相手 / 自分 / 指定なし(どちらでも)
  function sideOf(s) {
    if (/相手の/.test(s)) return 'opp';
    if (/自分の/.test(s)) return 'self';
    return 'any';
  }

  function targetFilter(s) {
    const f = {};
    const cv = s.match(/(光|水|闇|火|自然)((または|か)(光|水|闇|火|自然))?の(クリーチャー|エレメント)/);
    if (cv) f.civs = [cv[1], cv[4]].filter(Boolean).map((x) => ({ 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[x]));
    if (/タップされている|タップしている/.test(s) && !/アンタップ/.test(s)) f.tappedOnly = true;
    if (/アンタップしている|アンタップされている/.test(s)) f.untappedOnly = true;
    let m = s.match(/パワー(\d+)以下/);
    if (m) f.maxPower = +m[1];
    if (/自分の他の/.test(s)) f.others = true;
    let dm;
    if ((dm = s.match(/自分の(墓地|マナゾーン|手札|シールドゾーン)(にある(カード)?)?の(カードの)?枚数以下のコスト/))) f.maxCostDyn = { 墓地: 'grave', マナゾーン: 'mana', 手札: 'hand', シールドゾーン: 'shields' }[dm[1]];
    if ((dm = s.match(/相手のマナゾーン(にある|の)カードの枚数よりコストが大きい/))) f.minCostDyn = 'oppManaPlus1';
    if (/このクリーチャーよりパワーが小さい/.test(s)) f.powerLtSelf = true;
    if (/このクリーチャーよりコストが小さい/.test(s)) f.costLtSelf = true;
    if (/進化ではない/.test(s)) f.notEvo = true;
    if (/多色ではない/.test(s)) f.notMulti = true;
    const ec = s.match(/(光|水|闇|火|自然)以外の/);
    if (ec) f.exceptCiv = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[ec[1]];
    const rm = s.match(/自分の(他の)?(、)?([^、。のをが「」《》\d]{2,12}?)((または|か)([^、。のをが「」《》\d]{2,12}?))?の?クリーチャーを/);
    if (rm && !/^(光|水|闇|火|自然|進化|タップ|アンタップ|コスト|パワー)/.test(rm[3])) f.races = [rm[3], rm[6]].filter(Boolean).map((x) => x.replace(/・$/, ''));
    m = s.match(/コスト(\d+)以下/);
    if (m) f.maxCost = +m[1];
    return f;
  }

  // 超次元ゾーンから出すカードの条件（コスト・文明・種族）
  function hyperCond(t) {
    const o = {};
    t = String(t || '');
    let m;
    if ((m = t.match(/コスト(\d+)以下/))) o.maxCost = +m[1];
    const cv = t.match(/(光|水|闇|火|自然)((または|か|、)(光|水|闇|火|自然))?の/);
    if (cv && !/マナゾーンにあるカードと同じ文明/.test(t)) o.civs = [cv[1], cv[4]].filter(Boolean).map((x) => ({ 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[x]));
    const r = t.replace(/コスト(\d+)以下の(、)?/, '').replace(/(光|水|闇|火|自然)((または|か|、)(光|水|闇|火|自然))?の/, '').replace(/自分のマナゾーンにあるカードと同じ文明を持つ(、)?/, '').replace(/[、・]$/, '').trim();
    if (r) o.race = r;
    return o;
  }
  function countOf(s) {
    const m = s.match(/(\d+)(体|枚|つ)/);
    return m ? +m[1] : 1;
  }

  // 一つの効果文（トリガー部分は除去済み）を action に変換。読めなければ null
  function parseEffect(body) {
    const s = body.replace(/。$/, '').replace(/^自分は(、)?(?=カードを)/, '').replace(/\s+/g, '');
    const optional = /てもよい|まで/.test(s);
    let m;
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?を(、)?シールド化(する|してもよい)$/))) return { act: 'shieldAdd', n: +m[1], optional: m[4] !== 'する' };
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?を(、)?表向き(で|にして)シールド化(する|してもよい)$/))) return { act: 'shieldAdd', n: +m[1], optional: m[5] !== 'する', faceUp: true };
    if ((m = s.match(/^自分と相手のクリーチャーを1体ずつ選(ぶ|んでもよい)。その2体をバトルさせる$/))) return { act: 'pairFight', optional: m[1] !== 'ぶ' };
    if ((m = s.match(/^(バトルゾーンにある)?相手の(タップされている|タップしている)?クリーチャーはすべて、次の相手のターンのはじめにアンタップ(されない|しない)$/))) return { act: 'freezeAll', tappedOnly: !!m[2] };
    if ((m = s.match(/^(バトルゾーンにある)?相手の(コスト(\d+)以下の)?クリーチャーを(\d+)体選び、(表向きに|裏向きにして)?(、)?シールド化する$/))) return { act: 'toShield', side: 'opp', n: +m[4], optional: false, maxCost: m[3] ? +m[3] : null };
    // 「自分の○○をN体（つ）タップしてもよい」：コストとして自分のクリーチャーをタップ
    if ((m = s.match(/^(自分の|バトルゾーンの)(他の)?(、)?([^、。]*?)を(\d+)(体|つ)(、)?タップ(する|してもよい)$/)) && !/相手/.test(s))
      return { act: 'tapOwnCost', who: m[4].replace(/(・)?クリーチャー$/, ''), others: !!m[2], n: +m[5], optional: m[8] !== 'する' };
    // 覚醒・龍解（裏返す）
    if ((m = s.replace(/コスト(の|が)大きいほうに|《[^》]+》(の)?(ほう|側)に/, '').match(/^(この(クリーチャー|ドラグハート|カード)を)(、)?(コスト(の|が)大きいほうに|クリーチャー側に|ドラグハート・クリーチャー側に|フォートレス側に|ウエポン側に|《[^》]+》(の)?(ほう|側)に)?裏返(す|してもよい|し、アンタップする|し、アンタップしてもよい)$/))) return { act: 'flipSelf', optional: /もよい/.test(m[m.length - 1]), untap: /アンタップ/.test(m[m.length - 1]) };
    // このターン（次のターンまで）、自分のクリーチャーN体／すべてのパワー・能力
    if ((m = s.replace(/^((?:このターン|そのターン|次の自分のターンのはじめまで)、自分の(?:他の)?)([^、。「」]+?)(?<!クリーチャー)すべてに「/, '$1$2クリーチャーすべてに「').match(/^(このターン|そのターン|次の自分のターンのはじめまで)、(バトルゾーンにある)?自分の(他の)?(、)?((?:[^、。]|、(?=コスト|進化))*?)クリーチャー((\d+)体|すべて|はすべて)(のパワー(は|を)\+(\d+)(される|する|され、|し、))?(は|に)?(、)?(「(.+?)」(と「(.+?)」)?を(得る|与える))?$/)) && (m[10] || m[15]))
      return { act: 'teamBuff', until: /次の自分/.test(m[1]) ? 'next' : 'turn', all: !m[7], n: m[7] ? +m[7] : 0, others: !!m[3], who: m[5] || null, power: m[10] ? +m[10] : 0, names: [m[15], m[17]].filter(Boolean) };
    // 攻撃の制限を外す
    if ((m = s.match(/^((この|その)ターン、)?(このクリーチャー|自分のクリーチャー(はすべて)?|バトルゾーンにある自分のクリーチャー(\d+)体)は(、)?(タップされていない|アンタップしている)クリーチャーを攻撃できる$/)))
      return /^このクリーチャー/.test(m[3]) ? { act: 'selfTempGrant', until: m[1] ? 'turn' : 'next', names: ['このクリーチャーはアンタップしているクリーチャーを攻撃できる'] } : { act: 'teamBuff', until: 'turn', all: !m[5], n: m[5] ? +m[5] : 0, power: 0, names: ['このクリーチャーはアンタップしているクリーチャーを攻撃できる'] };
    // GR召喚・超次元ゾーン
    if ((m = s.match(/^(自分は)?GR召喚(を(\d+)回)?する$/))) return { act: 'grSummon', n: m[3] ? +m[3] : 1 };
    if ((m = s.match(/^自分の超次元ゾーンから好きな数の(.*?)(サイキック・クリーチャー|ドラグハート)をコストの合計が(\d+)以下になるように選び、(バトルゾーンに)?出す$/)))
      return { act: 'hyperPut', kind: m[2] === 'ドラグハート' ? 'dragheart' : 'psychic', sumCost: +m[3], ...hyperCond(m[1]) };
    if ((m = s.match(/^(.*?)(サイキック・クリーチャー|ドラグハート・ウエポン|ドラグハート・フォートレス|ドラグハート|エレメント|カード)を(\d+)(体|枚|つ)(まで)?、?(自分の)?超次元ゾーンから(バトルゾーンに)?出(す|してもよい|し、このクリーチャーに装備する)$/)) && !/手札|山札/.test(m[1]))
      return { act: 'hyperPut', kind: /サイキック/.test(m[2]) ? 'psychic' : /ドラグハート/.test(m[2]) ? 'dragheart' : 'any', n: +m[3], optional: !!m[5] || m[8] === 'してもよい', ...hyperCond(m[1]) };
    // 選んで別のゾーンへ（破壊ではない）
    if (!/各プレイヤー|でもない|につき|自身の|^相手は|(?<!進化|多色)ではない|でない/.test(s) && (m = s.match(/^(バトルゾーンにある)?(相手の|自分の)?(、)?((?:[^。、]|、(?=コスト|進化|パワー|多色|タップ|アンタップ))*?)(カード|クリーチャー|エレメント)を(すべて|(\d+)(枚|体|つ)(まで)?選び)、(裏向きにして、?|表向きにして、?)?(新しいシールドとして)?(、)?(持ち主の)?(墓地|マナゾーン|山札の下|シールドゾーン|シールド)に(裏向きにして|表向きにして)?(置く|加える|置いてもよい)$/)) && !/手札|山札の上|マナゾーンにある|墓地にある/.test(m[4]))
      return { act: 'moveTarget', side: m[2] === '相手の' ? 'opp' : m[2] === '自分の' ? 'self' : 'any', all: m[6] === 'すべて', n: m[7] ? +m[7] : 0, optional: !!m[9] || /てもよい/.test(s), any: m[5] !== 'クリーチャー', to: /シールド/.test(m[14]) ? 'shields' : { 墓地: 'grave', マナゾーン: 'mana', 山札の下: 'deckBottom' }[m[14]], ...targetFilter(s) };
    // 手札にある時の能力：「このクリーチャーを自分の手札から出してもよい」
    if ((m = s.match(/^このクリーチャーを(、)?(自分の)?手札から(バトルゾーンに)?(コストを支払わずに)?(出|召喚)(す|してもよい)$/))) return { act: 'selfFromHand', optional: m[6] !== 'す', summon: m[5] === '召喚' };
    if ((m = s.match(/^(この(カード|クリーチャー|呪文)を(自分の)?手札から|(自分の)?手札にあるこの(カード|クリーチャー)を)捨て(る|てもよい)$/))) return { act: 'selfDiscardFromHand', optional: m[6] !== 'る' };
    // 自分のカードを破壊する（コストとして使うことが多い）
    if ((m = s.match(/^(バトルゾーンにある)?自分の(他の)?(、)?([^、。]*?)を(\d+)(つ|体|枚)(まで)?(、)?(選んで|選び、)?破壊(する|してもよい)$/)) && !/相手/.test(s))
      return { act: 'destroyOwn', who: m[4] || null, others: !!m[2], n: +m[5], upTo: !!m[7], optional: m[10] !== 'する' };
    // 種族・名前などを指定して手札から出す
    if ((m = s.match(/^([^、。]+?)を(\d+)(体|枚|つ)(まで)?、?自分の手札(または墓地)?から(バトルゾーンに)?(コストを支払わずに)?出(す|してもよい)$/)) && !/^(コスト|光|水|闇|火|自然)?.*?(呪文)/.test(m[1]))
      if (!lookCond(m[1]).unknown) return { act: 'putFromHand', cond: lookCond(m[1]), kinds: ['creature', 'tamaseed', 'field'], n: +m[2], optional: !!m[4] || m[8] !== 'す', alsoGrave: !!m[5] };
    if ((m = s.match(/^(この|その)ターンの終わりに(、)?(それ|そのクリーチャー|それら(のクリーチャー)?)を(破壊する|(持ち主の)?手札に戻す|(持ち主の)?山札の下に置く)$/))) return { act: 'lastAtEnd', to: /破壊/.test(m[5]) ? 'destroy' : /手札/.test(m[5]) ? 'hand' : 'deckBottom' };
    if ((m = s.match(/^〔代替([lwdfn]+)(\d+)〕支払って、(.+)てもよい$/))) {
      const inner = parseEffects(m[3] + 'てもよい');
      const CV = { l: 'light', w: 'water', d: 'darkness', f: 'fire', n: 'nature' };
      if (inner && !inner.some((x) => x.act === 'manualNote')) return { act: 'payThen', cost: +m[2], civs: [...new Set(m[1].split(''))].map((x) => CV[x]), acts: inner };
    }
    if ((m = s.match(/^それを(持ち主の)?(マナゾーンに置|シールド化|手札に戻|山札の下に置)(く|する|す|いてもよい|してもよい)$/))) return { act: 'moveEvent', to: { マナゾーンに置: 'mana', シールド化: 'shields', 手札に戻: 'hand', 山札の下に置: 'deckBottom' }[m[2]], optional: /もよい/.test(m[3]) };
    if ((m = s.match(/^コストの合計が(\d+)以下になるように(、)?([^、。]*?)クリーチャーを好きな数(、)?自分の(墓地|手札)から(バトルゾーンに)?出す$/))) return { act: 'putSumCost', max: +m[1], from: m[5] === '墓地' ? 'grave' : 'hand', cond: m[3] ? lookCond(m[3].replace(/の$/, '')) : null };
    if (/^次の自分のターンのはじめまで、自分のクリーチャーがタップした(時|とき)、カードを1枚引いてもよい$/.test(s)) return { act: 'tempTapDraw' };
    if (/^次の自分のターンのはじめまで、相手は(、)?自身のマナゾーンにあるカードの枚数よりコストが大きいクリーチャーを(バトルゾーンに)?出した(時|とき)、そのクリーチャーを自身の山札の一番下に置く$/.test(s)) return { act: 'tempBigBottom' };
    if ((m = s.match(/^(この|その)ターン、次に使う(光|水|闇|火|自然)?(の)?カードのコストを(、)?(最大)?(\d+)少なくしてもよい$/))) return { act: 'nextCostDiscount', civ: m[2] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[2]] : null, n: +m[6] };
    if ((m = s.match(/^そうしなければ、(.+)$/))) {
      const inner = parseEffects(m[1]);
      if (inner && !inner.some((x) => x.act === 'manualNote')) return { act: 'ifNotDidPrev', acts: inner };
    }
    if ((m = s.match(/^相手のパワー(\d+)以下のクリーチャーをすべて(表向きに)?シールド化する。こうしてシールド化したカード1枚につき、自分はカードを1枚引く$/))) return { act: 'toShieldAllDraw', maxPower: +m[1], faceUp: !!m[2] };
    if (/^自分と相手のシールドを1つずつ選ぶ。このクリーチャーは選ばれたそれらのシールドをブレイクする$/.test(s)) return { act: 'breakBothOne' };
    if ((m = s.match(/^次の自分のターンのはじめに、(.+)$/))) {
      const inner = parseEffects(m[1].replace(/。$/, ''));
      if (inner && !inner.some((x) => x.act === 'manualNote')) return { act: 'atNextTurnStart', acts: inner };
    }
    if ((m = s.match(/^カードを(\d+)枚、自分のシールドゾーンから手札に加え(る|てもよい)$/))) return { act: 'shieldToHand', n: +m[1], optional: m[2] !== 'る' };
    if (/^(この(クリーチャー|カード)を、?)?自分のシールド(1つ)?の上に表向きにして置く$/.test(s)) return { act: 'stackSelfOnShield' };
    if ((m = s.match(/^相手の(コスト(\d+)以下の)?(、)?(進化ではない)?クリーチャーを(\d+)体選び、持ち主のシールド(1つ)?の上に表向きにして置く$/))) return { act: 'stackOppOnShield', n: +m[5], maxCost: m[2] ? +m[2] : null, notEvo: !!m[4] };
    if ((m = s.match(/^自分の手札から([^、。]+?)を(\d+)枚、コストを支払わずに唱え(る|てもよい)$/))) return { act: 'castFromHand', n: +m[2], cond: lookCond(m[1]), optional: m[3] !== 'る' };
    if ((m = s.match(/^自分の手札を(\d+)枚まで捨て、その枚数より(\d+)枚多くカードを引く$/))) return { act: 'discardDrawPlus', n: +m[1], plus: +m[2] };
    if ((m = s.match(/^各プレイヤーは(、)?自身の手札を(\d+)枚選んで捨てる$/))) return { act: 'seq', acts: [{ act: 'selfDiscard', n: +m[2] }, { act: 'asOpp', acts: [{ act: 'selfDiscard', n: +m[2] }] }] };
    if ((m = s.match(/^自分のマナゾーンのカードを(\d+)枚(まで)?アンタップする$/))) return { act: 'untapManaN', n: +m[1] };
    if ((m = s.match(/^自分の手札を(\d+)枚まで捨てる$/))) return { act: 'selfDiscard', n: +m[1], optional: true };
    if ((m = s.match(/^他のクリーチャーを(\d+)体、自分の墓地から手札に戻(す|してもよい)$/))) return { act: 'graveToHand', n: +m[1], creatureOnly: true, notSelf: true, optional: m[2] !== 'す' };
    if (/^自分のシールドをすべて墓地に置く$/.test(s)) return { act: 'ownShieldToGrave', n: 99 };
    if ((m = s.match(/^このクリーチャーは(、)?自分のシールドを(\d+)(つ|枚)ブレイクする$/))) return { act: 'breakOwn', n: +m[2] };
    if ((m = s.match(/^(バトルゾーンにある)?相手のクリーチャーを(\d+)体選び、このクリーチャーとバトルさせ(る|てもよい)$/))) return { act: 'seq', acts: [{ act: 'pickTarget', side: 'opp', n: 1, optional: m[3] !== 'る' }, { act: 'fightLast' }] };
    if ((m = s.match(/^(バトルゾーンにある)?(相手の)?クロスギアを(\d+)枚選び、持ち主の墓地に置く$/))) return { act: 'gearToGrave', n: +m[3], side: m[2] ? 'opp' : 'any' };
    if ((m = s.match(/^クリーチャーを(\d+)体、自分の墓地からマナゾーンに置(く|いてもよい)$/))) return { act: 'graveAnyToMana', cond: lookCond('クリーチャー'), n: +m[1], optional: m[2] !== 'く' };
    if ((m = s.match(/^カードを(\d+)枚相手のマナゾーンから選び、持ち主の墓地に置く$/))) return { act: 'oppManaToGrave', n: +m[1] };
    if ((m = s.match(/^自分の山札の上から(\d+)枚を裏向きのまま(自分の)?マナゾーンに置く$/))) return { act: 'manaBoost', n: +m[1], optional: false, faceDown: true };
    if ((m = s.match(/^(その|この)ターン(の終わりまで)?、このクリーチャーは(、)?パワーを\+(\d+)され、シールドをさらに(\d+)(つ|枚)ブレイクする$/))) return { act: 'seq', acts: [{ act: 'powerUp', n: +m[4] }, { act: 'tempBreakExtra', n: +m[5] }] };
    if ((m = s.match(/^(その|この)ターン、(バトルゾーンにある)?自分のクリーチャー(\d+)体のパワーは\+(\d+)され、シールドをさらに(\d+)(つ|枚)ブレイクする$/))) return { act: 'seq', acts: [{ act: 'pickTarget', side: 'self', n: +m[3], optional: false }, { act: 'powerLast', n: +m[4] }, { act: 'tempBreakExtraLast', n: +m[5] }] };
    if ((m = s.match(/^相手の手札から(\d+)枚見ないで選び、相手はそれを(持ち主の)?墓地に置く$/))) return { act: 'discard', n: +m[1], random: true };
    if (/^このクリーチャーを(、)?自分の手札または墓地から(バトルゾーンに)?タップして出(す|してもよい)$/.test(s)) return { act: 'selfFromHandOrGrave', tapped: true, optional: /もよい/.test(s) };
    if ((m = s.match(/^相手のシールドを(\d+)(つ|枚)選び、持ち主の(墓地|マナゾーン)に置く$/))) return { act: 'oppShieldTo', n: +m[1], to: m[3] === '墓地' ? 'grave' : 'mana' };
    if (/^このクリーチャーは(、)?ブロックされない$/.test(s)) return { act: 'selfTempGrant', until: 'turn', names: ['このクリーチャーはブロックされない'] };
    if ((m = s.match(/^(その|この)ターン、このクリーチャーは「(.+?)」(と「(.+?)」)?を得る$/))) return { act: 'selfTempGrant', until: 'turn', names: [m[2], m[4]].filter(Boolean) };
    if ((m = s.match(/^(その|この)ターンの終わりまで、このクリーチャーのパワーは\+(\d+)される$/))) return { act: 'powerUp', n: +m[2] };
    if ((m = s.match(/^このクリーチャーは(、)?相手のシールドを(\d+)(つ|枚)ブレイクする$/))) return { act: 'breakShield', n: +m[2] };
    if (/^自分の他のクリーチャーは(、)?(この|その)ターン(中)?、攻撃できない$/.test(s)) return { act: 'teamNoAttackOthers' };
    if ((m = s.match(/^カードを(\d+)枚、自分のマナゾーンから(自分の)?墓地に置く$/))) return { act: 'manaToGrave', n: +m[1], optional: false };
    if ((m = s.match(/^相手は(、)?(バトルゾーンにある)?自身のクリーチャーを(\d+)体選び、(持ち主の)?(墓地|手札|マナゾーン)に(置く|戻す)$/))) return { act: 'oppOwnTo', n: +m[3], to: { 墓地: 'grave', 手札: 'hand', マナゾーン: 'mana' }[m[5]] };
    if ((m = s.match(/^相手のシールドが(\d+)枚でもあれば、そのうちの(\d+)枚をブレイクする$/))) return { act: 'breakShield', n: +m[2] };
    if ((m = s.match(/^自分のシールドが(\d+)枚でもあれば、(裏向きのまま)?(\d+)枚選び、自分の墓地に置く$/))) return { act: 'ownShieldToGrave', n: +m[3] };
    if (/^このクリーチャーとそのクリーチャーをバトルさせ(る|てもよい)$/.test(s)) return { act: 'fightEvent', optional: /もよい/.test(s) };
    if ((m = s.match(/^自分のマナゾーンからカードを(\d+)枚選び、(持ち主の|自分の)?墓地に置く$/))) return { act: 'manaToGrave', n: +m[1], optional: false };
    if ((m = s.match(/^自分のシールドを(\d+)(つ|枚)(選び、)?ブレイク(する|してもよい)$/))) return { act: 'breakOwn', n: +m[1], optional: m[4] !== 'する' };
    if ((m = s.match(/^自分と相手のクリーチャーを(\d+)体ずつ選(び|んでもよい)[、。]その(\d+)体をバトルさせる$/))) return { act: 'pairFight', optional: m[2] !== 'び' };
    if ((m = s.match(/^自分の他のクリーチャーを(\d+)体(まで)?アンタップ(する|してもよい)$/))) return { act: 'untapOwn', n: +m[1], optional: !!m[2] || m[3] !== 'する', others: true };
    if ((m = s.match(/^(自分の)?クリーチャーを(\d+)体(まで)?選び、アンタップ(する|してもよい)$/))) return { act: 'untapOwn', n: +m[2], optional: !!m[3] || m[4] !== 'する' };
    if ((m = s.match(/^(その|この)ターン、このクリーチャーのパワーを\+(\d+)し、「(.+?)」(と「(.+?)」)?を与える$/))) return { act: 'seq', acts: [{ act: 'powerUp', n: +m[2] }, { act: 'selfTempGrant', until: 'turn', names: [m[3], m[5]].filter(Boolean) }] };
    if (/^各プレイヤーは(、)?自身の手札をすべて捨てる$/.test(s)) return { act: 'discardAllBoth' };
    if (/^このターンの後に(もう一度|もう1度)自分のターンを行う$/.test(s)) return { act: 'extraTurn', notInExtra: false };
    if (/^その攻撃の後、このクリーチャーをアンタップする$/.test(s)) return { act: 'untapAfterAttackSelf' };
    if ((m = s.match(/^(自分の)?山札の上から(\d+)枚(目)?を(、)?(自分の)?マナゾーンに置く$/))) return { act: 'manaBoost', n: +m[2], optional: false };
    if ((m = s.match(/^自分のマナゾーンにある(光|水|闇|火|自然)?(の)?カードを(\d+)枚タップ(する|してもよい)$/))) return { act: 'tapManaCost', n: +m[3], civ: m[1] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[1]] : null, optional: m[4] !== 'する' };
    if ((m = s.match(/^(バトルゾーンにある)?自分のクリーチャー(\d+)体は(、)?(このターンの終わりまで|このターン)、?「(.+?)」を得る$/))) return { act: 'teamBuff', until: 'turn', all: false, n: +m[2], others: false, who: null, power: 0, names: [m[5]] };
    if (/^そのクリーチャーとこのクリーチャーを破壊する$/.test(s)) return { act: 'seq', acts: [{ act: 'destroyEvent' }, { act: 'selfDestroy', optional: false }] };
    if (/^自分の墓地にあるカードをすべて(自分の)?山札に加え(、|て)シャッフルする$/.test(s)) return { act: 'graveAllToDeck' };
    if (/^自分の山札の(一番)?上のカードを表にして(自分の)?マナゾーンに置く$/.test(s)) return { act: 'manaBoost', n: 1, optional: false };
    if ((m = s.match(/^各プレイヤーは(、)?自身の手札と墓地にあるカードをすべて山札に加えてシャッフルし、カードを(\d+)枚引く$/))) return { act: 'resetHands', n: +m[2] };
    if ((m = s.match(/^カードを(\d+)枚(まで)?、自分の墓地からマナゾーンに置(く|いてもよい)$/))) return { act: 'graveAnyToMana', cond: lookCond('カード'), n: +m[1], optional: !!m[2] || m[3] !== 'く' };
    if ((m = s.match(/^カードを(\d+)枚、自分のマナゾーンまたは墓地から手札に戻(す|してもよい)$/))) return { act: 'manaToHand', n: +m[1], alsoGrave: true, optional: m[2] !== 'す' };
    if ((m = s.match(/^相手は(、)?自身の(アンタップしている|タップされていない)クリーチャーを(\d+)体選び、タップする$/))) return { act: 'asOpp', acts: [{ act: 'tap', side: 'self', all: false, n: +m[3], optional: false, untappedOnly: true }] };
    if ((m = s.match(/^跳次元召喚(\d+)$/))) return { act: 'hyperSummonN', n: +m[1] };
    if ((m = s.match(/^自分の山札の上から(\d+)枚を表向きにする。その中の([^、。]+?)をすべて、(タップして)?(マナゾーンに置き|手札に加え)、それ以外のカードを(墓地に置く|山札の下に置く)$/))) return { act: 'revealSort', n: +m[1], cond: lookCond(m[2]), to: /マナ/.test(m[4]) ? 'mana' : 'hand', tapped: !!m[3], rest: /墓地/.test(m[5]) ? 'grave' : 'deckBottom' };
    if (/^それらの出た時の効果は起こらない$/.test(s)) return { act: 'noop', suppressPrev: true };
    if ((m = s.match(/^相手はクリーチャーを好きな数(、)?自身の墓地から(バトルゾーンに)?出す$/))) return { act: 'oppReanimateAny' };
    if ((m = s.match(/^相手は(、)?マナゾーンまたはシールドゾーンにある自身のカードを合計(\d+)枚選び、(持ち主の)?墓地に置く$/))) return { act: 'oppManaShieldToGrave', n: +m[2] };
    if ((m = s.match(/^相手は(、)?(バトルゾーン|マナゾーン|シールドゾーン)または(バトルゾーン|マナゾーン|シールドゾーン)にある自身の(表向きの)?カードを合計(\d+)枚選び、(持ち主の)?墓地に置く$/))) {
      const Z = { バトルゾーン: 'battle', マナゾーン: 'mana', シールドゾーン: 'shields' };
      return { act: 'oppManaShieldToGrave', n: +m[5], zones: [Z[m[2]], Z[m[3]]], faceUp: !!m[4] };
    }
    if (/^相手はそれを(自身の)?山札の上か下に置く$/.test(s)) return { act: 'moveLast', to: 'deckTopOrBottom' };
    if ((m = s.match(/^自分のマナゾーンにあるカードの枚数以下のコストの([^、。]*?)クリーチャーを(\d+)体、自分のマナゾーンから(バトルゾーンに)?出(す|してもよい)$/))) return { act: 'putFromMana', cond: lookCond((m[1] || '').replace(/の$/, '') + 'クリーチャー'), n: +m[2], optional: m[4] !== 'す', maxCostMana: true };
    if (/^各プレイヤー1人につき、そのプレイヤーのエレメントを1つまで選び、持ち主のマナゾーンに置く$/.test(s)) return { act: 'eachPlayerToMana' };
    if ((m = s.match(/^([^、。]+?)を(\d+)(体|つ)(まで)?、自分の墓地から(バトルゾーンに)?出(す|してもよい)$/)) && (m = [m[0], m[1], m[2], m[4], m[5], m[6]]) && !lookCond(m[1]).unknown && !/呪文|カード/.test(m[1])) return { act: 'reanimate', kinds: ['creature'], cond: lookCond(m[1]), n: +m[2], optional: !!m[3] || m[5] !== 'す' };
    if (/^ターンの残りをとばしてもよい$/.test(s)) return { act: 'skipRestOfTurn', optional: true };
    // dm26ex4 など
    if (/^無色ではないクリーチャーをすべてシールド化する$/.test(s)) return { act: 'moveTarget', side: 'any', all: true, n: 0, to: 'shields', notColorless: true };
    if ((m = s.match(/^相手は(、)?自身の手札を(\d+)枚選び、シールド化する$/))) return { act: 'oppHandToShield', n: +m[2] };
    if (/^こうして捨てたカード以下のコストの相手のクリーチャーを(\d+)体選び、破壊する$/.test(s)) return { act: 'destroy', side: 'opp', n: 1, optional: false, all: false, maxCostDiscardN: true };
    if (/^そのカードの「このクリーチャーが(バトルゾーンに)?出た時」で始まる能力を1つ使ってもよい$/.test(s)) return { act: 'useEtbOfLast' };
    if (/^(それ|そのカード)を?、?自分の墓地から(バトルゾーンに)?出す$|^自分の墓地から出す$/.test(s)) return { act: 'lastDiscardToBattle' };
    if ((m = s.replace(/^(この|その)ターン、/, '').match(/^そのクリーチャーに「(.+?)」(と「(.+?)」)?を与え、(この|その)ターンの終わりに破壊する$/))) return { act: 'grantEndLast', names: [m[1], m[3]].filter(Boolean) };
    if ((m = s.match(/^相手は自身のクリーチャーを(\d+)体マナゾーンに置き、自分はクリーチャーを(\d+)体まで自分のマナゾーンから出す$/))) return { act: 'seq', acts: [{ act: 'oppOwnTo', n: +m[1], to: 'mana' }, { act: 'putFromMana', cond: lookCond('クリーチャー'), n: +m[2], optional: true }] };
    if (/^攻撃を中止する$/.test(s)) return { act: 'cancelAttack' };
    if (/^それがウエポンなら、自分のクリーチャーに装備する$/.test(s)) return { act: 'noop' };
    if ((m = s.match(/^自分と相手のクリーチャーを1体ずつ選(ぶ|んでもよい)$/))) return { act: 'pairPick', optional: m[1] !== 'ぶ' };
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選び、持ち主の超次元ゾーンに置く$/))) return { act: 'moveTarget', side: 'opp', all: false, n: +m[1], to: 'hyper', optional: false };
    if ((m = s.match(/^(この|その)ターン、それらの(GRクリーチャー|クリーチャー)に「(.+?)」(と「(.+?)」)?(と「(.+?)」)?を与える$/))) return { act: 'groupGrant', names: [m[3], m[5], m[7]].filter(Boolean) };
    if (/^相手のマナゾーンにあるカードを1枚選び、タップする$/.test(s)) return { act: 'tapOppMana', n: 1 };
    if (/^次の自分のターンのはじめまで、それはアンタップしない$/.test(s)) return { act: 'freezeLastMana' };
    if ((m = s.match(/^(自分は)?カードを(\d+)枚引いてもよい$/))) return { act: 'draw', n: +m[2], optional: true };
    // dm26 などの新しい書き方
    if ((m = s.match(/^自分の手札を(\d+)枚(、)?(好きな順序で)?(自分の)?山札の(一番)?下に置く$/))) return { act: 'handToDeckBottom', n: +m[1] };
    if ((m = s.match(/^自分のマナゾーンにある([^、。]*?)(・カード|カード)をすべて手札に戻す$/))) return { act: 'manaAllToHand', cond: m[1] ? lookCond(m[1]) : null };
    if ((m = s.match(/^こうして戻したのと同じ枚数のカードを(、)?自分の山札の上から(タップして)?マナゾーンに置く$/))) return { act: 'manaBoost', n: 'lastCount', tapped: !!m[2] };
    if (/^このクリーチャーを(、)?自分の墓地から(バトルゾーンに)?(タップして)?出(す|してもよい)$/.test(s)) return { act: 'selfFromGrave', optional: /もよい/.test(s), tapped: /タップして/.test(s) };
    if ((m = s.match(/^各プレイヤーは(、)?自身の手札を(\d+)枚選び、捨てる$/))) return { act: 'seq', acts: [{ act: 'selfDiscard', n: +m[2] }, { act: 'asOpp', acts: [{ act: 'selfDiscard', n: +m[2] }] }] };
    if ((m = s.match(/^好きな枚数の([^、。]+?)(・)?カードを(、)?自分の墓地からマナゾーンに置く$/))) return { act: 'graveAnyToMana', cond: lookCond(m[1]) };
    if ((m = s.match(/^(相手の|自分の)(、)?([^、。]*?)エレメントを(\d+)つ(まで)?選(ぶ|んでもよい)$/)) && !/墓地|手札|マナ|シールド|山札/.test(s)) return { act: 'pickTarget', side: m[1] === '相手の' ? 'opp' : 'self', n: +m[4], optional: !!m[5] || m[6] !== 'ぶ', any: true, ...targetFilter(s) };
    if (/^(その|この)ターンの終わりに(、)?(このクリーチャーを)?(自分の)?墓地から(バトルゾーンに)?出す$/.test(s)) return { act: 'reviveAtEnd' };
    if ((m = s.match(/^このクリーチャーから進化できる(、)?([^、。]*?)を(\d+)体、自分の手札からこの(クリーチャーの)?上に置(く|いてもよい)$/))) return { act: 'evolveOnSelf', cond: lookCond(m[2]), optional: m[5] !== 'く' };
    if ((m = s.match(/^プレイヤー1人の墓地からカードを(\d+)枚選(ぶ|んでもよい)$/))) return { act: 'graveBottomPick', exact: +m[1], optional: m[2] !== 'ぶ' };
    if (/^その持ち主は(、)?それを好きな順序で山札の下に置く$/.test(s)) return { act: 'noop' };
    if ((m = s.match(/^相手は(、)?バトルゾーンまたは手札にある自身のカードを(\d+)枚選び、山札の下に置く$/))) return { act: 'oppPutBottom', n: +m[2] };
    // 出来事のクリーチャー（「そのクリーチャー」「それ」）への効果
    if (/^(その|この)クリーチャーを破壊する$|^それを破壊する$/.test(s) && !/この/.test(s)) return { act: 'destroyEvent' };
    if ((m = s.match(/^それよりコストが小さい([^、。]+?)を(\d+)体、自分の墓地から(バトルゾーンに)?出(す|してもよい)$/))) return { act: 'reanimate', kinds: ['creature'], cond: lookCond(m[1]), n: +m[2], optional: m[4] !== 'す', costLtEvent: true };
    // 墓地のカードを山札の下に置き、その枚数以下のコストの相手を破壊（コッコ・武・ルピアなど）
    if (/^プレイヤー1人の墓地にあるカードを好きな数選ぶ$/.test(s)) return { act: 'graveBottomPick' };
    if (/^その持ち主は選ばれたカードを好きな順序で山札の下に置く$/.test(s)) return { act: 'noop' };
    if ((m = s.match(/^選ばれたカードの枚数以下のコストの(、)?相手のクリーチャーを(\d+)体破壊(する|してもよい)$/))) return { act: 'destroy', side: 'opp', n: +m[2], optional: m[3] !== 'する', all: false, maxCostPicked: true };
    // 捨てた手札による分岐
    if ((m = s.match(/^その捨てた(手札|カード)と同じコストを持つ相手のクリーチャーを(\d+)体選び、破壊する$/))) return { act: 'destroy', side: 'opp', n: +m[2], optional: false, all: false, costEqDiscard: true };
    if ((m = s.match(/^(この|その)ターン、そのクリーチャーの最初の攻撃の終わりに、そのクリーチャーをアンタップする$/))) return { act: 'untapAfterAttackLast' };
    if ((m = s.match(/^それらの(クリーチャー)?に「(.+?)」(と「(.+?)」)?を与え、(この|その)ターンの終わりに(、)?(それらを)?破壊する$/))) return { act: 'groupGrantEnd', names: [m[2], m[4]].filter(Boolean), to: 'destroy' };
    // 合計で選ぶ：「相手のクリーチャーを、パワーの合計が6000以下になるように好きな数選び、破壊する」
    if ((m = s.match(/^(バトルゾーンにある)?相手のクリーチャーを(、)?(パワー|コスト)の合計が(\d+)以下になるよう(に)?好きな数選び、破壊する$/))) return { act: 'destroySum', stat: m[3] === 'パワー' ? 'power' : 'cost', max: +m[4], n: 99 };
    if ((m = s.match(/^コストの合計が(その)?捨てた(手札|カード)のコスト以下になるように相手のクリーチャーを(\d+)体(まで)?選び、破壊する$/))) return { act: 'destroySum', stat: 'cost', max: 'discard', n: +m[3] };
    // 「○○1体につき、△△をN体選び、タップする」など、数に応じた回数
    if ((m = s.replace(/^(バトルゾーンにある)?自分の、/, '$1自分の').match(/^(バトルゾーンにある)?(自分の[^、。]+?)(\d+)(体|枚|つ)につき(、)?(.+)$/)) && !/パワー|コスト/.test(m[6].slice(0, 6))) {
      const inner = parseEffect(m[6]);
      if (inner && inner.n && ['oppHandToShield', 'pickTarget', 'tap', 'destroy', 'bounce', 'draw', 'manaBoost', 'shieldAdd', 'mill', 'discard', 'toMana', 'deckBottom', 'untapOwn'].includes(inner.act)) return { act: 'perCount', what: m[2], per: +m[3], inner };
    }
    // 対象を選ぶだけの文（後の文で「そのクリーチャー」を使う）
    if ((m = s.match(/^(バトルゾーンにある)?(相手の|自分の)?(、)?([^、。]*?)(クリーチャー|カード)を(\d+)体(まで)?選(ぶ|んでもよい)$/)) && !/墓地|手札|マナ|シールド|山札|自身の|^相手は|(?<!進化|多色)ではない|でない|でもない/.test(s))
      return { act: 'pickTarget', side: m[2] === '相手の' ? 'opp' : m[2] === '自分の' ? 'self' : 'any', n: +m[6], optional: !!m[7] || m[8] !== 'ぶ', ...targetFilter(s) };
    if ((m = s.match(/^(そのターン|このターン)、(そのクリーチャー|それ|選んだクリーチャー)のパワー(は|を)(-|\+)(\d+)(される|する)$/))) return { act: 'powerLast', n: (m[4] === '-' ? -1 : 1) * +m[5] };
    if ((m = s.match(/^(そのターン|このターン)、(そのクリーチャー|それ)のパワーを(\+)(\d+)し、「(.+?)」を与える$/))) return { act: 'powerLast', n: +m[4], names: [m[5]] };
    if (/^((次の自分のターンのはじめまで、)?(そのクリーチャー|それら(のクリーチャー)?|選んだクリーチャー|その選んだクリーチャー)は(、)?(次の自分のターンのはじめまで(、)?)?攻撃もブロックもできない)$/.test(s) && /次の自分のターンのはじめまで/.test(s)) return { act: 'lockLast' };
    if (/^(この|その)?(選んだ)?クリーチャーと(その)?(選んだ)?クリーチャーをバトルさせる$|^(その(選んだ)?クリーチャー|選んだクリーチャー)とこのクリーチャーをバトルさせる$|^このクリーチャーと(その)?(選んだ)?クリーチャーをバトルさせる$/.test(s)) return { act: 'fightLast' };
    if (/^(その2体|その二体)を?バトルさせる$|^そうした場合、その2体はバトルする$/.test(s)) return { act: 'fightLastTwo' };
    if ((m = s.match(/^相手は(それ|そのクリーチャー)を(持ち主の|自身の)?(墓地に置く|手札に戻す|マナゾーンに置く|山札に加えてシャッフルする|山札の下に置く)$/))) return { act: 'moveLast', to: { 墓地に置く: 'grave', 手札に戻す: 'hand', マナゾーンに置く: 'mana', 山札に加えてシャッフルする: 'deckShuffle', 山札の下に置く: 'deckBottom' }[m[3]] };
    if (/^自分の手札をすべて捨て(る|てもよい)$/.test(s)) return { act: 'discardOwnAll', optional: /もよい/.test(s) };
    if ((m = s.match(/^相手のシールドを(\d+)(枚|つ)(選び、)?ブレイク(する|してもよい)$/))) return { act: 'breakShield', n: +m[1], optional: m[4] !== 'する' };
    if ((m = s.match(/^(その|この)ターン、このクリーチャーのパワー(は|を)\+(\d+)(される|する)$/))) return { act: 'powerUp', n: +m[3] };
    if ((m = s.match(/^(自分の)?手札を(\d+)枚(、)?(自分の)?マナゾーンに置(く|いてもよい)$/))) return { act: 'handToMana', n: +m[2], optional: m[5] !== 'く' };
    if ((m = s.match(/^(このターン|そのターン)、相手のクリーチャーすべてのパワーを-(\d+)する$/))) return { act: 'oppTeamPower', n: -m[2] };
    if ((m = s.match(/^(クリーチャー|呪文|カード)を(\d+)(体|枚)(まで)?、自分のマナゾーンから手札に戻(す|してもよい)$/))) return { act: 'manaToHand', n: +m[2], creatureOnly: m[1] === 'クリーチャー', spellOnly: m[1] === '呪文', optional: !!m[4] || m[5] !== 'す' };
    // 細かい言い回し
    if ((m = s.match(/^相手は(、)?自身の山札の上から(\d+)枚(目)?(まで)?を墓地に置く$/))) return { act: 'oppMill', n: +m[2] };
    if ((m = s.match(/^相手の手札を見て(\d+)枚(まで)?選び、捨てさせる$/))) return { act: 'discard', n: +m[1], random: false, byMe: true, optional: !!m[2] };
    if ((m = s.match(/^(コスト(\d+)以上の)?(コスト(\d+)以下の)?(クリーチャー|呪文|カード)を(\d+)(体|枚)(まで)?、自分の墓地から手札に(戻|加え)(す|る|してもよい|てもよい)$/)))
      return { act: 'graveToHand', n: +m[6], creatureOnly: m[5] === 'クリーチャー', spellOnly: m[5] === '呪文', minCost: m[2] ? +m[2] : null, maxCost: m[4] ? +m[4] : null, optional: !!m[8] || /もよい/.test(m[10]) };
    if (/^このクリーチャーを(自分の)?墓地から手札に戻(す|してもよい)$/.test(s)) return { act: 'selfToHand', optional: /もよい/.test(s) };
    if (/^自分の墓地(のカードをすべて|を)山札に加えてシャッフルする$/.test(s)) return { act: 'graveToDeck' };
    if ((m = s.match(/^(バトルゾーンにある)?相手の(コスト(\d+)以下の)?(カード|エレメント)を(\d+)(枚|つ)選び、破壊する$/))) return { act: 'destroy', side: 'opp', n: +m[5], any: true, maxCost: m[3] ? +m[3] : null, optional: false, all: false };
    if ((m = s.match(/^(相手の)?エレメントを(\d+)つ(まで)?選び、シールド化する$/))) return { act: 'toShield', side: 'opp', n: +m[2], any: true, optional: !!m[3] };
    if (/^(このクリーチャーの)?下にあったカードをすべて手札に加える$/.test(s)) return { act: 'underToHand' };
    // 直前に出した・選んだカード（そのクリーチャー）への効果
    if ((m = s.match(/^((次の自分のターンのはじめまで|このターン|そのターン)、)?(そのクリーチャー|それ|そのドラゴン|それら)(は|に)(、)?「(.+?)」(と「(.+?)」)?を(得る|与える)$/)))
      return { act: 'grantLast', names: [m[6], m[8]].filter(Boolean), until: !m[2] ? 'perm' : /次の自分/.test(m[2]) ? 'next' : 'turn' };
    if ((m = s.match(/^(次の自分のターンのはじめまで|このターン)、(そのクリーチャー|それ|それら)は(バトルゾーンを)?(離れない|破壊されない)$/)))
      return { act: 'guardLast', kind: m[4] === '離れない' ? 'noLeave' : 'noDestroy', until: /次の自分/.test(m[1]) ? 'next' : 'turn' };
    if (/^(そのクリーチャー|それ)をアンタップする$/.test(s)) return { act: 'untapLast' };
    if ((m = s.match(/^(この|その)ターンの終わりに、(そのクリーチャー|そのドラゴン|それ)を(破壊する|手札に戻す|山札の下に置く|マナゾーンに置く)$/)))
      return { act: 'endTurnLast', to: { 破壊する: 'destroy', 手札に戻す: 'hand', 山札の下に置く: 'deckBottom', マナゾーンに置く: 'mana' }[m[3]] };
    if (/^この(クリーチャー|タマシード|カード|フィールド|クロスギア)を破壊(する|してもよい)$/.test(s)) return { act: 'selfDestroy', optional: /もよい/.test(s) };
    // すべてアンタップ
    if ((m = s.match(/^自分の([^、。]+?)をすべてアンタップ(する|してもよい)$/)) && !/クリーチャー|マナ|カード/.test(m[1])) return { act: 'untapAll', others: false, nameHas: null, evoOnly: false, race: m[1], optional: m[2] !== 'する' };
    if ((m = s.match(/^(バトルゾーンにある)?自分の(他の)?(、)?(名前に《(.+?)》とある)?(進化)?((.+?)・)?クリーチャー(をすべて|すべてを)アンタップする$/)))
      return { act: 'untapAll', others: !!m[2], nameHas: m[5] || null, evoOnly: !!m[6], race: m[8] || null };
    if (/^(この(クリーチャー|カード)を)?アンタップする$/.test(s)) return { act: 'untapSelf', optional: false };
    if ((m = s.match(/^自分のマナゾーンにある(カード|[^、。]*?カード)を(\d+)枚(まで)?アンタップする$/))) return { act: 'untapManaN', n: +m[2] };
    if ((m = s.match(/^(コスト(\d+)以下の)?((光|水|闇|火|自然)の)?呪文を(\d+)枚、自分の墓地からコストを支払わずに唱え(る|てもよい)$/))) return { act: 'castFromGrave', maxCost: m[2] ? +m[2] : null, civ: m[4] ? CIVJ[m[4]] : null, n: +m[5], optional: m[6] !== 'る' };
    if ((m = s.match(/^([^、。]*?)を(\d+)(体|枚)、自分のマナゾーンから(バトルゾーンに)?出(す|してもよい)$/)) && !lookCond(m[1]).unknown) return { act: 'putFromMana', cond: lookCond(m[1]), n: +m[2], optional: m[5] !== 'す' };
    if ((m = s.match(/^クリーチャーを(\d+)体選び、タップまたはアンタップしてもよい$/))) return { act: 'tapOrUntap', n: +m[1], optional: true };
    if ((m = s.match(/^(自分の手札を|カードを)(\d+)枚(、自分の手札から)?捨ててもよい$/))) return { act: 'selfDiscard', n: +m[2], optional: true };
    if ((m = s.match(/^カードを(\d+)枚、自分のマナゾーンから墓地に置(く|いてもよい)$/))) return { act: 'manaToGrave', n: +m[1], optional: m[2] !== 'く' };
    if ((m = s.match(/^カードを(\d+)枚、自分のマナゾーンから手札に戻(す|してもよい)$/))) return { act: 'manaToHand', n: +m[1], optional: m[2] !== 'す' };
    if (/^このカードを(自分の)?墓地に置く$/.test(s)) return { act: 'selfToGrave' };
    if (/^(自分の)?山札をシャッフルする$/.test(s)) return { act: 'shuffleDeck' };
    if ((m = s.match(/^(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?呪文を(\d+)枚まで、自分の墓地から手札に戻(す|してもよい)$/)))
      return { act: 'graveToHand', n: +m[4], civ: m[1] ? CIVJ[m[1]] : null, spellOnly: true, maxCost: m[3] ? +m[3] : null, optional: true };
    // 条件つきの呪文・クリーチャーを手札（または墓地）から
    if ((m = s.match(/^(名前に《(.+?)》とある|「(.+?)」を持つ)?(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?呪文を(\d+)枚、(自分の手札(または墓地)?から)?コストを支払わずに(自分の手札(または墓地)?から)?唱え(る|てもよい)$/)))
      return { act: 'castFromHand', nameHas: m[2] || null, hasText: m[3] || null, civ: m[4] ? CIVJ[m[4]] : null, maxCost: m[6] ? +m[6] : null, n: +m[7], alsoGrave: !!(m[9] || m[11]), optional: m[12] !== 'る' };
    if ((m = s.match(/^(名前に《(.+?)》とある|「(.+?)」を持つ)(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?(進化ではない)?(、)?クリーチャーを(\d+)体、自分の手札(または墓地)?から(バトルゾーンに)?出(す|してもよい)$/)))
      return { act: 'putFromHand', nameHas: m[2] || null, hasText: m[3] || null, civ: m[4] ? CIVJ[m[4]] : null, maxCost: m[6] ? +m[6] : null, notEvo: !!m[7], kinds: ['creature'], n: +m[9], alsoGrave: !!m[10], optional: m[13] !== 'す' };

    if ((m = s.match(/墓地から(.*?)(コスト(\d+)以下の)?(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?(クリーチャー|タマシード)(または|か)?(クリーチャー|タマシード)?を?(\d+)(体|つ)?(まで)?(選び、)?(バトルゾーンに)?出/))) {
      const kinds = [m[7], m[9]].filter(Boolean).map((k) => (k === 'クリーチャー' ? 'creature' : 'tamaseed'));
      const civ = m[4] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[4]] : null;
      return { act: 'reanimate', kinds, civ, maxCost: m[3] ? +m[3] : m[6] ? +m[6] : null, n: +(m[10] || 1), optional };
    }
    if ((m = s.replace(/、?進化ではない、?/, '').match(/^(コスト(\d+)以下の)?(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?(クリーチャー|タマシード)(または|か)?(クリーチャー|タマシード)?を(\d+)(体|つ|枚)(まで)?、?(自分の)?墓地から(バトルゾーンに)?出/))) {
      const kinds = [m[6], m[8]].filter(Boolean).map((k) => (k === 'クリーチャー' ? 'creature' : 'tamaseed'));
      const civ = m[3] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[3]] : null;
      return { act: 'reanimate', kinds, civ, maxCost: m[2] ? +m[2] : m[5] ? +m[5] : null, n: +m[9], optional };
    }
    if ((m = s.match(/^(自分は)?(、)?(([^、。]*?)・)?(超)?メクレイド\s*(\d+)(する|を行う)?$/))) {
      return { act: 'mekuraid', n: +m[6], race: m[4] || null, look: 3 };
    }
    if ((m = s.match(/^(自分の)?手札を(\d+)枚(、)?相手に見ないで選ばせ(、)?捨てる$/))) return { act: 'selfDiscard', n: +m[2], random: true };
    if ((m = s.match(/^カードを(最大)?(\d+)枚(まで)?引(く|いてもよい|ける)?$/))) {
      return { act: 'draw', n: +m[2], optional };
    }
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?(まで)?を?(タップして)?(自分の)?マナゾーンに(タップして)?置/))) {
      return { act: 'manaBoost', n: +m[1], optional, tapped: /タップして/.test(s) };
    }
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?(まで)?をシールド化(する|してもよい)|^自分の山札の上から(\d+)枚(目)?を(自分の)?シールドゾーンに(裏向きのまま)?(加える|置く)/))) {
      if (m[5]) m[4] = m[5];
      return { act: 'shieldAdd', n: +(m[1] || m[4]), optional };
    }
    if (!/それら|その(捨て|選んだ|クリーチャー[^をの]|中|カード)|こうして|合計|同じ|それより|以下のコストの|数だけ|与え|につき|ターンの終わりに|攻撃の終わりに|かわりに/.test(s) && !(/より(コスト|パワー)|枚数/.test(s) && !/(このクリーチャーより(パワー|コスト)が小さい|自分の(墓地|マナゾーン|手札|シールドゾーン)(にある(カード)?)?の(カードの)?枚数以下のコスト|相手のマナゾーン(にある|の)カードの枚数よりコストが大きい)/.test(s)) && /クリーチャー|エレメント/.test(s) && /破壊する$|破壊してもよい$/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'destroy', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, any: /エレメント/.test(s), ...targetFilter(s) };
    }
    if (!/それら|その(捨て|選んだ|クリーチャー[^をの]|中|カード)|こうして|合計|同じ|それより|以下のコストの|数だけ|与え|につき|ターンの終わりに|攻撃の終わりに|かわりに/.test(s) && !(/より(コスト|パワー)|枚数/.test(s) && !/(このクリーチャーより(パワー|コスト)が小さい|自分の(墓地|マナゾーン|手札|シールドゾーン)(にある(カード)?)?の(カードの)?枚数以下のコスト|相手のマナゾーン(にある|の)カードの枚数よりコストが大きい)/.test(s)) && /クリーチャー|エレメント/.test(s) && /(持ち主の)?山札の下に置く$|山札の下に置いてもよい$/.test(s) && !/墓地から|マナゾーンから/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'deckBottom', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, any: /エレメント/.test(s), ...targetFilter(s) };
    }
    if (!/それら|その(捨て|選んだ|クリーチャー[^をの]|中|カード)|こうして|合計|同じ|それより|以下のコストの|数だけ|与え|につき|ターンの終わりに|攻撃の終わりに|かわりに/.test(s) && !(/より(コスト|パワー)|枚数/.test(s) && !/(このクリーチャーより(パワー|コスト)が小さい|自分の(墓地|マナゾーン|手札|シールドゾーン)(にある(カード)?)?の(カードの)?枚数以下のコスト|相手のマナゾーン(にある|の)カードの枚数よりコストが大きい)/.test(s)) && /クリーチャー|エレメント/.test(s) && /(持ち主の)?マナゾーンに置く$|マナゾーンに置いてもよい$/.test(s) && !/山札の上|墓地から|手札から/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'toMana', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, any: /エレメント/.test(s), ...targetFilter(s) };
    }
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?を裏向きのまま、新しいシールドとして(自分の)?シールドゾーンに(加え|置)(る|く|てもよい)$/))) {
      return { act: 'shieldAdd', n: +m[1], optional: /てもよい/.test(s) };
    }
    if ((m = s.match(/^自分の手札を(\d+)枚(、)?(裏向きのまま|裏向きにして)(、)?新しいシールドとして(自分の)?シールドゾーンに(加え|置)(る|く|てもよい)$/))) {
      return { act: 'handToShield', n: +m[1], optional: /てもよい/.test(s) };
    }
    if ((m = s.match(/^次の自分のターンのはじめまで、このクリーチャーは(相手に選ばれない|離れない)$/))) {
      return { act: 'selfGuard', kind: m[1] === '離れない' ? 'noLeave' : 'untargetable' };
    }
    if ((m = s.match(/^(バトルゾーンにある)?相手の(コスト(\d+)以下の)?(進化ではない)?(クリーチャー|エレメント)を(\d+)(体|つ)(まで)?選び、(持ち主の)?シールド化(する|してもよい)$/))) {
      return { act: 'toShield', side: 'opp', n: +m[6], optional: /てもよい/.test(s) || !!m[8], any: m[5] === 'エレメント', maxCost: m[3] ? +m[3] : null, notEvo: !!m[4] };
    }
    if ((m = s.match(/^自分のシールドを(\d+)(つ|枚)(まで)?、?(選び、)?手札に(加え|戻)(る|す|てもよい|してもよい)(。ただし、その「S・トリガー」は使えない)?$/))) m = [m[0], m[1], m[3], m[4], m[5], m[6], m[7]];
    if (m && /^自分のシールドを/.test(s) && /手札に/.test(s) && m[1]) {
      return { act: 'shieldToHand', n: +m[1], optional: !!m[2] || /てもよい/.test(s), noTrigger: true };
    }
    if (/^自分は(、)?ゲームに負ける$/.test(s)) return { act: 'loseGame' };
    if (/^(自分は(、)?)?ゲームに勝(つ|利する)$/.test(s)) return { act: 'winGame' };
    if ((m = s.match(/^((このターン|次の(自分の|相手の)ターンの(はじめ|終わり)まで)、)?自分は(、)?ゲームに負け(ない|ず、相手は(、)?(ゲームに)?勝てない)$/))) return { act: 'noLose', until: !m[2] || m[2] === 'このターン' ? 'turn' : 'next' };
    if (/^相手の手札を見る$/.test(s)) return { act: 'revealHand' };
    if ((m = s.match(/^相手の手札を見て(、)?(その中から)?(([^、。]*?)を)?(\d+)(枚|体)(まで)?選び、捨てさせる$/))) return { act: 'discard', n: +m[5], random: false, byMe: true, optional: !!m[7], cond: m[4] ? lookCond(m[4]) : null };
    if ((m = s.match(/^自分のマナゾーンのカードを(\d+)枚(、)?裏向きに(する|してもよい)$/))) return { act: 'manaFaceDown', n: +m[1], optional: m[3] !== 'する' };
    if ((m = s.match(/^自分のシールドゾーンにある表向きのカードを(\d+)枚(、)?裏向きに(する|してもよい)$/))) return { act: 'shieldFaceDown', n: +m[1], optional: m[3] !== 'する' };
    if ((m = s.replace(/^自分のシールドゾーンにあるカードを/, '自分のシールドを').match(/^自分のシールドを(\d+)(つ|枚)(選び、)?表向きに(する|してもよい)$/))) return { act: 'shieldFaceUp', n: +m[1], optional: m[4] !== 'する' };
    if (/^相手は(、)?ゲームに負ける$/.test(s)) return { act: 'winGame' };
    if ((m = s.match(/^相手のシールドを(\d+)つ選び、持ち主の墓地に置く$/))) {
      return { act: 'shieldBurn', n: +m[1] };
    }
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選び、墓地の数だけパワーを-(\d+)する$/))) {
      return { act: 'powerDown', side: 'opp', n: +m[1], amount: 'grave', per: +m[2] };
    }
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選んで次のターンまで攻撃もブロックもできなくする$/))) return { act: 'lockCreature', n: +m[1] };
    if ((m = s.match(/^自分のクリーチャーを(\d+)体(まで)?選んでこのターンブロックされなくする$/))) return { act: 'tempUnblockable', n: +m[1], optional: !!m[2] };
    if ((m = s.match(/^(次の自分のターンのはじめまで|このターン)、相手は(コスト(\d+)以下の)?(呪文を唱えられない|クリーチャーを(召喚できない|出せない))$/))) {
      return { act: 'oppLock', spell: /呪文/.test(m[4]), maxCost: m[3] ? +m[3] : null, until: m[1] === 'このターン' ? 'turn' : 'next' };
    }
    if (/^相手は(、)?自身の手札をすべて捨てる$/.test(s)) return { act: 'discardAll' };
    // シールドを増やす（いろいろな書き方）
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?を(、)?(裏向きのまま|裏向きにして|表向きにし|表向きにして)?(、)?(新しいシールドとして)?(、)?(自分の)?(シールド(ゾーン)?|シールド(\d+)つの上)に(表向きにして)?(裏向きにして)?(加え|置い?)(る|く|てもよい)$/))) return { act: 'shieldAdd', n: +m[1], optional: /てもよい/.test(s) };
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?を表向きにして、?自分のシールド(\d+)つの上に置く$/))) return { act: 'shieldAdd', n: +m[1] };
    if (/^自分のシールドをすべて手札に加える(。ただし、その「S・トリガー」は使えない)?$/.test(s)) return { act: 'shieldToHand', n: 99, noTrigger: true };
    if ((m = s.match(/^自分のシールドを(\d+)(つ|枚)(選び)?、?(自分の)?墓地に置(く|いてもよい)$/))) return { act: 'ownShieldToGrave', n: +m[1], optional: m[5] !== 'く' };
    if ((m = s.match(/^自分のクリーチャーを(\d+)体(、)?(持ち主の)?手札に戻(す|してもよい)$/))) return { act: 'bounce', side: 'self', n: +m[1], optional: m[4] !== 'す', all: false };
    if ((m = s.match(/^([^、。]*?)を(\d+)(体|枚)、自分の手札から捨て(る|てもよい)$/))) return { act: 'selfDiscard', n: +m[2], optional: m[4] !== 'る', cond: lookCond(m[1]) };
    if ((m = s.match(/^自分の手札(にある|から)([^、。]*?)を(\d+)(体|枚)(、)?相手に見せ(る|てもよい)$/))) return { act: 'showOwn', n: +m[3], cond: lookCond(m[2]), optional: m[6] !== 'る' };
    if ((m = s.match(/^自分のマナゾーンの(カード|[^、。]*?カード)を(\d+)枚タップ(する|してもよい)$/))) return { act: 'tapManaCost', n: +m[2], optional: m[3] !== 'する' };
    if ((m = s.match(/^このクリーチャーの下にあるカードを(\d+)枚(、)?(自分の)?墓地に置(く|いてもよい)$/))) return { act: 'underToGrave', n: +m[1], optional: m[4] !== 'く' };
    if (/^自分の手札をすべて(、)?マナゾーンに置(く|いてもよい)$/.test(s)) return { act: 'handToMana', n: 99, all: true, optional: /もよい/.test(s) };
    if ((m = s.match(/^自分のシールドを(\d+)枚山札の下に置いて(\d+)枚引く$/))) return { act: 'shieldToDeckDraw', n: +m[1], draw: +m[2], optional: true };
    // 呪文をマナ（または墓地）から手札へ
    if ((m = s.match(/^(自分のマナゾーンから)?呪文を(\d+)枚(選び、)?(、)?(自分の)?(マナゾーン(または墓地)?から)?(自分の)?手札に戻(す|してもよい|してよい)$/))) return { act: 'manaToHand', n: +m[2], spellOnly: true, alsoGrave: !!m[7], optional: /もよい|てよい/.test(s) };
    // 次のターンまで：破壊されない・全体のパワー
    if (/^次の自分のターンのはじめまで、このクリーチャーは破壊されない$/.test(s)) return { act: 'selfGuard', kind: 'noDestroy' };
    if ((m = s.match(/^自分のクリーチャーを(\d+)体選んで次のターンまで破壊されなくする$/))) return { act: 'protectDestroy', n: +m[1] };
    if ((m = s.match(/^次の自分のターンのはじめまで、自分の(他の)?クリーチャーすべてのパワーを\+(\d+)する$/))) return { act: 'teamTempPower', n: +m[2], others: !!m[1] };
    if ((m = s.match(/^次の自分のターンのはじめまで、自分のクリーチャー(\d+)体のパワーを\+(\d+)し、「(.+?)」(と「(.+?)」)?を与える$/))) return { act: 'tempGrant', n: +m[1], power: +m[2], names: [m[3], m[5]].filter(Boolean) };
    // このターンの終わりに、自分のクリーチャーをアンタップ
    if ((m = s.match(/^このターンの終わりに、(バトルゾーンにある)?自分のクリーチャーを(\d+)体(、)?(まで選んで)?アンタップする$/))) return { act: 'untapAtEnd', n: +m[2] };
    if ((m = s.match(/^自分のシールドを(\d+)枚山札の下に置いて(\d+)枚引く$/))) return { act: 'shieldToDeckDraw', n: +m[1], draw: +m[2], optional: true };
    if ((m = s.match(/^(自分の)?(.+?)(\d+)(体|枚|つ)につき、カードを(\d+)枚引(く|いてもよい)$/))) return { act: 'drawPer', what: m[2], per: +m[3], n: +m[5], optional: /てもよい/.test(s) };
    if ((m = s.match(/^自分の山札の上から1枚(目)?を表向きにする。それが(.+?)(なら|であれば)(、)?(バトルゾーンに)?出(す|してもよい)。(それ以外なら|こうして出さなければ)(、)?(自分の)?(山札の下|マナゾーン|墓地|手札)に(置く|加える)$/))) {
      return { act: 'revealTop', cond: lookCond(m[2]), optional: /てもよい/.test(m[6]), rest: { 山札の下: 'deckBottom', マナゾーン: 'mana', 墓地: 'grave', 手札: 'hand' }[m[10]] };
    }
    if ((m = s.match(/^(コスト(\d+)以下の)?(進化ではない)?(、)?クリーチャーを好きな数、自分の墓地から出す$/))) return { act: 'reanimate', kinds: ['creature'], maxCost: m[2] ? +m[2] : null, n: 99, optional: true };
    if (/^相手は(、)?自身の手札をすべて見せる$/.test(s)) return { act: 'revealHand' };
    if (/^自分のマナゾーンにあるカードをすべてアンタップする$/.test(s)) return { act: 'untapMana' };
    if (/^このターン、自分のクリーチャーはすべてのバトルに勝つ$/.test(s)) return { act: 'teamWinTurn' };
    if ((m = s.match(/^このターン、自分のクリーチャー(\d+)体に「(.+?)」(と「(.+?)」)?を与える$/))) return { act: 'turnGrant', n: +m[1], names: [m[2], m[4]].filter(Boolean) };
    if (/^(追加ターン中でなければ、)?このターンの後に自分のターンを追加する$/.test(s)) return { act: 'extraTurn', notInExtra: /追加ターン中でなければ/.test(s) };
    if ((m = s.match(/^自分のクリーチャーを(\d+)体選んで次のターンまで選ばれなくする$/))) {
      return { act: 'protectOwn', n: +m[1] };
    }
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選び、同じ名前のクリーチャーをすべてタップする$/))) {
      return { act: 'tapSameName', n: +m[1] };
    }
    if ((m = s.match(/^(バトルゾーンにある)?自分のクリーチャーを(\d+)体(まで)?、?アンタップする$/))) {
      return { act: 'untapOwn', n: +m[2], optional: !!m[3] };
    }
    if ((m = s.match(/^次の自分のターンのはじめまで、相手はコスト(\d+)以下のクリーチャーを召喚できない$/))) {
      return { act: 'summonLock', maxCost: +m[1] };
    }
    if (/^このクリーチャーが表向きで自分のシールドゾーンにあれば、コストを支払ったものとして召喚する$/.test(s)) {
      return { act: 'summonFromShield' };
    }
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選び、パワーを(-(\d+)する|0にする)$/))) {
      return { act: 'powerDown', side: 'opp', n: +m[1], amount: m[3] ? +m[3] : 'all' };
    }
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選んでバトルさせる$/))) {
      return { act: 'fight', n: +m[1], optional: true };
    }
    if ((m = s.match(/^(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?(呪文|クリーチャー|カード|タマシード)を(\d+)(枚|体|つ)、?自分の墓地から(自分の)?手札に(戻|加え)/))) {
      const civ = m[1] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[1]] : null;
      return { act: 'graveToHand', n: +m[5], civ, creatureOnly: m[4] === 'クリーチャー', spellOnly: m[4] === '呪文', maxCost: m[3] ? +m[3] : null, optional: /てもよい/.test(s) };
    }
    if ((m = s.match(/^(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?(、)?(進化ではない)?(、)?(クリーチャー|タマシード)を(\d+)(体|つ|枚)、?自分の手札(または墓地)?から(バトルゾーンに)?出/))) {
      const civ = m[1] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[1]] : null;
      return { act: 'putFromHand', civ, maxCost: m[3] ? +m[3] : null, notEvo: !!m[5], kinds: [m[7] === 'クリーチャー' ? 'creature' : 'tamaseed'], n: +m[8], optional: /てもよい/.test(s), alsoGrave: !!m[10] };
    }
    if ((m = s.match(/^(コスト(\d+)以下の)?呪文を(\d+)枚、?自分の手札からコストを支払わずに唱え/))) {
      return { act: 'castFromHand', maxCost: m[2] ? +m[2] : null, n: +m[3], optional: /てもよい/.test(s) };
    }
    if ((m = s.match(/^クリーチャーを(\d+)体選び、タップまたはアンタップする$/))) {
      return { act: 'tapOrUntap', n: +m[1] };
    }
    if (/^このクリーチャーをアンタップしてもよい$/.test(s)) return { act: 'untapSelf', optional: true };
    if ((m = s.match(/^バトルの後、このクリーチャーをアンタップ(する|してもよい)$/))) return { act: 'untapSelf', optional: m[1] !== 'する' };
    if (/^(この|その)ターン、この(進化した)?クリーチャーはすべてのバトルに勝つ$/.test(s)) return { act: 'tempWinAll', until: 'turn' };
    if (/^次の自分のターンのはじめまで、この(進化した)?クリーチャーはすべてのバトルに勝つ$/.test(s)) return { act: 'tempWinAll', until: 'next' };
    if ((m = s.match(/^次の自分のターンのはじめまで、この(進化した)?クリーチャーは「(.+?)」(と「(.+?)」)?を得(る)?$/))) return { act: 'selfTempGrant', names: [m[2], m[4]].filter(Boolean) };
    if ((m = s.match(/^このクリーチャーは(、)?(相手の)?シールドを(\d+)つブレイク(する|してもよい)$/))) return { act: 'breakShield', n: +m[3], optional: m[4] !== 'する' };
    if ((m = s.match(/^相手の(コスト(\d+)以下の)?クリーチャーを(\d+)体選んでもよい[。、]相手はそれをシールド化する$/))) return { act: 'toShield', side: 'opp', n: +m[3], optional: true, maxCost: m[2] ? +m[2] : null };
    if ((m = s.match(/^次の自分のターンのはじめまで、自分のクリーチャー(すべて|(\d+)体)に「(.+?)」(と「(.+?)」)?を与える$/))) {
      return { act: 'tempGrant', all: m[1] === 'すべて', n: m[2] ? +m[2] : 0, names: [m[3], m[5]].filter(Boolean) };
    }
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選ぶ。このターン、そのクリーチャーのパワーを-(\d+)する$/))) {
      return { act: 'powerDown', side: 'opp', n: +m[1], amount: +m[3] };
    }
    if ((m = s.match(/^相手のクリーチャーを(\d+)体選ぶ。このターン、そのクリーチャーのパワーを-(\d+)する$/))) {
      return { act: 'powerDown', side: 'opp', n: +m[1], amount: +m[2] };
    }
    if (!/それら|その(捨て|選んだ|クリーチャー[^をの]|中|カード)|こうして|合計|同じ|それより|以下のコストの|数だけ|与え|につき|ターンの終わりに|攻撃の終わりに|かわりに/.test(s) && !(/より(コスト|パワー)|枚数/.test(s) && !/(このクリーチャーより(パワー|コスト)が小さい|自分の(墓地|マナゾーン|手札|シールドゾーン)(にある(カード)?)?の(カードの)?枚数以下のコスト|相手のマナゾーン(にある|の)カードの枚数よりコストが大きい)/.test(s)) && /クリーチャー|エレメント/.test(s) && /手札に戻す$|手札に戻してもよい$/.test(s) && !/墓地/.test(s) && !/マナ/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'bounce', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, any: /エレメント/.test(s), ...targetFilter(s) };
    }
    if (!/それら|その(捨て|選んだ|クリーチャー[^をの]|中|カード)|こうして|合計|同じ|それより|以下のコストの|数だけ|与え|につき|ターンの終わりに|攻撃の終わりに|かわりに/.test(s) && !(/より(コスト|パワー)|枚数/.test(s) && !/(このクリーチャーより(パワー|コスト)が小さい|自分の(墓地|マナゾーン|手札|シールドゾーン)(にある(カード)?)?の(カードの)?枚数以下のコスト|相手のマナゾーン(にある|の)カードの枚数よりコストが大きい)/.test(s)) && /クリーチャー/.test(s) && /(?<!アン)タップする$|(?<!アン)タップしてもよい$/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'tap', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, ...targetFilter(s) };
    }
    if ((m = s.match(/^相手の手札を(\d+)枚見ないで選び、捨てさせる$/))) {
      return { act: 'discard', n: +m[1], random: true };
    }
    if ((m = s.match(/^相手の手札を見ないで(\d+)枚選び、捨てさせる$/))) {
      return { act: 'discard', n: +m[1], random: true };
    }
    if ((m = s.match(/^相手は(自身|自分自身|自分)の手札を(\d+)枚選(び、|んで)捨てる$/))) {
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
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?(まで)?を?(自分の)?墓地に置(く|いてもよい)$/))) {
      return { act: 'mill', n: +m[1], optional: /てもよい/.test(s) };
    }
    // 直前に選んだクリーチャーを、次のターンのはじめにアンタップさせない
    if (/^(次の(自分|相手)のターンのはじめ(に|まで)、)?(それ|そのクリーチャー|そのカード|それら|選んだクリーチャーはすべて)(は|を)?(、)?(次の(自分|相手)のターンのはじめ(に|まで)、?)?アンタップ(しない|されない)$/.test(s)) {
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

  // 「山札の上からN枚を見る／表向きにする。その中から○○を△に、残りを□に」
  const LOOK_RE = /^(自分の)?山札の上から(?<n>\d+)枚を(?<how>見る|表向きにする)。(その後、)?その中から(、)?((?<cond>[^。]+?)を)?(?<take>すべて|好きな数|それぞれ(?<each>\d+)(枚|体|つ)(?<eupto>まで)?|(?<cnt>\d+)(枚|体|つ)(?<upto>まで)?)(を)?(、)?(選び、)?(、)?(表向きにし(てから)?、?)?(自分の)?(タップして)?(?<dest>手札に加え|バトルゾーンに出し|出し|マナゾーンに置き|墓地に置き|シールド化し)(?<may>てもよい)?(。その後、|、|。)?(残り(のカード)?を(すべて)?(好きな順序で|ランダムな順序で)?(自分の)?(?<rtap>タップして)?(?<rest>山札の下|墓地|マナゾーン|手札|山札の上)に(置く|戻す|加える)。?)?/;
  function lookCond(t) {
    t = String(t || '').replace(/^[→a-zA-Z\s]+(?=[ぁ-んァ-ヶ一-龠《「])/, '');
    const c = {};
    let m;
    if ((m = t.match(/^《(.+?)》$/))) return { nameIs: m[1], text: t };
    let nameNot = null;
    if ((m = t.match(/名前が《(.+?)》ではない(、)?/))) {
      nameNot = m[1];
      t = t.replace(m[0], '');
      const r0 = lookCond(t);
      r0.nameNot = nameNot;
      r0.text = '名前が《' + nameNot + '》ではない' + t;
      return r0;
    }
    // 「コスト3以下のクリーチャー1体またはコスト3以下のタマシード」
    if ((m = t.match(/^(.+?(クリーチャー|タマシード|呪文|カード))((\d+)(体|枚|つ))?(を)?または(.+?(クリーチャー|タマシード|呪文|カード))$/))) {
      return { any: [lookCond(m[1]), lookCond(m[7])], text: t };
    }
    if (/以下のコスト|以上のコスト|より(コスト|パワー)|それ以下|それ以上|このクリーチャー|攻撃している|枚数|数より|と同じ/.test(t)) {
      c.unknown = true;
      c.text = t;
      return c;
    }
    if (/^(進化)(クリーチャー)?$|の進化クリーチャー$|^コスト\d+以下の進化クリーチャー$/.test(t)) c.evoOnly = true;
    if (/ツインパクト/.test(t)) {
      c.twinpact = true;
      t = t.replace(/ツインパクト/, '');
    }
    if (/D2フィールド|フィールド$/.test(t)) {
      c.types = ['field'];
      t = t.replace(/(D2)?フィールド$/, '');
    }
    t = t.replace(/(・)?エレメント$/, '');
    if ((m = t.match(/^(.+?)か、(.+)$/)) && !/または/.test(t)) {
      c.any = [lookCond(m[1]), lookCond(m[2])];
      c.text = t;
      return c;
    }
    if (/^無色/.test(t)) {
      c.colorless = true;
      t = t.replace(/^無色(の)?/, '');
    }
    if ((m = t.match(/「(.+?)」を持つ、?/))) {
      c.hasText = m[1];
      t = t.replace(m[0], '');
    }
    if ((m = t.match(/名前に《(.+?)》とある、?/))) {
      c.nameHas = m[1];
      t = t.replace(m[0], '');
    }
    if ((m = t.match(/コスト(\d+)以下/))) c.maxCost = +m[1];
    if ((m = t.match(/コスト(\d+)の/))) {
      c.maxCost = c.minCost = +m[1];
      t = t.replace(m[0], '');
    }
    if ((m = t.match(/コスト(\d+)以上/))) c.minCost = +m[1];
    if (/進化ではない/.test(t)) c.notEvo = true;
    const civ = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' };
    c.civs = Object.keys(civ).filter((j) => new RegExp(j + '(の|または|か|・)').test(t)).map((j) => civ[j]);
    if (/呪文/.test(t) && !/クリーチャー/.test(t)) c.types = ['spell'];
    else if (/タマシード/.test(t) && !/クリーチャー/.test(t)) c.types = ['tamaseed'];
    else if (!c.types && /クリーチャー/.test(t) && !/呪文|カード/.test(t.replace(/クリーチャー・カード/, 'クリーチャー'))) c.types = ['creature'];
    // 種族（「ドラゴン・クリーチャー」「ドラゴン・カード」「ジョーカーズ」など）
    const r = t
      .replace(/コスト\d+(以下|以上)の、?/g, '')
      .replace(/進化ではない、?/g, '')
      .replace(/^進化$|の進化$|進化(?=$)/, '')
      .replace(/^(光|水|闇|火|自然)((または|か|・|、)(光|水|闇|火|自然))*の、?/, '')
      .replace(/(・)?(クリーチャー|カード|呪文|タマシード)(・カード)?$/, '')
      .replace(/^(クリーチャー|カード|呪文|タマシード)$/, '')
      .trim();
    if (r) {
      const alts = r
        .split(/と|または|か、/)
        .map((x) => x.replace(/(・)?(クリーチャー|カード)$/, '').trim())
        .filter(Boolean);
      if (alts.length > 1) c.races = alts;
      else c.race = alts[0] || r;
    }
    if (c.evoOnly && c.race === '進化') delete c.race;
    c.text = t;
    return c;
  }
  function parseLook(body) {
    const m = body.match(LOOK_RE);
    if (!m) return null;
    const g = m.groups;
    const dest = { 手札に加え: 'hand', バトルゾーンに出し: 'battle', 出し: 'battle', マナゾーンに置き: 'mana', 墓地に置き: 'grave', シールド化し: 'shields' }[g.dest];
    const rest = g.rest ? { 山札の下: 'deckBottom', 墓地: 'grave', マナゾーン: 'mana', 手札: 'hand', 山札の上: 'deckTop' }[g.rest] : 'deckBottom';
    return {
      act: {
        act: 'lookTop',
        n: +g.n,
        reveal: g.how === '表向きにする',
        cond: lookCond(g.cond || ''),
        take: g.take === 'すべて' ? 'all' : g.take === '好きな数' ? 'any' : g.each ? 'each' : +g.cnt,
        each: g.each ? +g.each : 0,
        upTo: !!g.upto || !!g.eupto || !!g.may || g.take === '好きな数',
        dest,
        rest,
        restTapped: !!g.rtap,
      },
      remain: body.slice(m[0].length).replace(/^[。、]/, '').replace(/^その後、/, ''),
    };
  }

  // 「その後、」や「。」で区切った複数効果を読む。全部読めた時だけ配列を返す
  // 「山札の上から1枚を表向きにする。それが○○なら出す。それ以外なら△に置く」をひとまとめに
  const REVEAL_RE = /^自分の山札の上から1枚(目)?を表向きにする。それが(.+?)(なら|であれば)(、)?(バトルゾーンに)?出(す|してもよい)。(それ以外なら|こうして出さなければ)(、)?(自分の)?(山札の下|マナゾーン|墓地|手札)に(置く|加える)。?/;
  // 山札全体から探す：「自分の山札を見る。その中から○○を1枚手札に加えてもよい。その後、山札をシャッフルする」
  const SEARCH_CAST_RE = /^自分の山札を見る。その中から(?<cond>[^。]+?)を1枚(選び、)?(、)?(自分の)?山札をシャッフルした後、その呪文をコストを支払わずに唱え(てもよい|る)。?/;
  const SEARCH_RE = /^(自分の山札を見る。その中から|自分の山札から)(、)?(?<cond>[^。]+?)を(?<n>\d+)(枚|体|つ)(?<upto>まで)?(、)?(選び、|さがして(相手に見せ、)?|表向きにし(て)?、|相手に見せ(て|、))?(自分の)?(タップして)?(?<dest>手札に加え|バトルゾーンに出し|出し|マナゾーンに置き|墓地に置き|マナゾーンに置|墓地に置|シールド化し)(?<may>いてもよい|てもよい|る|す|く)?。?((その後、)?(自分の)?山札をシャッフルする。?)?/;
  // 山札の上を並べ替える
  const ARRANGE_RE = /^(自分の)?山札の上から(?<n>\d+)枚を見る。(その後、)?(それら|そのカード|見たカード)を(好きな順序で)?(自分の)?山札の(?<where>上または下|上か下|上|下|一番下|一番上)に(好きな順序で)?(置く|戻す)。?/;
  // 山札の上1枚をチェック：「それが○○なら手札に加える。それ以外なら山札の下に置く」など
  const TOPCHECK_RE = /^(自分の)?山札の上から1枚(目)?を(?<how>見る|表向きにする|見てもよい|表向きにしてもよい)(?<may0>てもよい)?。(それ|そのカード)が(?<cond>[^。]+?)(なら|であれば)(、)?(表向きにして|相手に見せて|相手に見せ、)?(自分の)?(タップして)?(?<then>手札に加え|バトルゾーンに出|出|マナゾーンに置|墓地に置|コストを支払わずに唱え|コストを支払わずに使っ|シールド化し)(?<may>てもよい|る|す|く|してもよい|いてもよい|き)?。?((?<elseh>それ以外なら|それ以外のカードであれば|そうでなければ|そうでない場合|こうして出さなければ|こうして加えなければ|こうして唱えなければ|[^、。]{1,20}でなければ)(、)?(自分の)?(?<else>山札の(一番)?下|山札の(一番)?上|墓地|マナゾーン|手札)に(置く|加える|戻す|置いてもよい|戻してもよい)。?)?/;
  const ZONE_OF = (t) => (/下/.test(t) ? 'deckBottom' : /上/.test(t) ? 'deckTop' : t === '墓地' ? 'grave' : t === 'マナゾーン' ? 'mana' : 'hand');
  const DEST_OF = (t) => ({ 手札に加え: 'hand', バトルゾーンに出し: 'battle', バトルゾーンに出: 'battle', 出し: 'battle', 出: 'battle', マナゾーンに置き: 'mana', マナゾーンに置: 'mana', 墓地に置き: 'grave', 墓地に置: 'grave', シールド化し: 'shields', コストを支払わずに唱え: 'cast', コストを支払わずに使っ: 'use' }[t]);
  function afterActs(remain) {
    remain = remain.replace(/^その後、/, '').trim();
    if (!remain) return [];
    const whole = parseEffects(remain);
    if (whole) return whole;
    // 文ごとに読み、読めない文だけ手動にする
    const out = [];
    for (const sen of remain.split(/。/).map((x) => x.trim()).filter(Boolean)) {
      const r = parseEffects(sen);
      if (r) out.push(...r);
      else out.push({ act: 'manualNote', text: sen });
    }
    return out;
  }
  // 「〜なら」「〜あれば」「〜場合」の条件文を読む。読めなければ null
  let mm0;
  function parseCondText(ct) {
    ct = String(ct || '').replace(/^(G・G・G|マナ武装\s*\d+|ラビリンス|シビルカウント\s*\d+)\s*[：:\-－―]\s*/, '').replace(/^バトルゾーンにある間$/, 'バトルゾーンに');
    // 「〜がなければ」は肯定の条件を読んで反転する
    let neg = ct.match(/^(.+?)(が)(\d+(体|枚|つ)以上)?(なければ)$/);
    if (neg && !/もなければ$/.test(ct)) {
      const pos = parseCondText(neg[1] + neg[2] + (neg[3] || '') + 'あれば');
      if (pos) return { not: pos };
    }
    // 「〜があり、〜があれば」は両方の条件
    const andm = ct.match(/^(.+?)(があり|であり|あり)、(.+)$/);
    if (andm) {
      const a1 = parseCondText(andm[1] + (andm[2] === 'であり' ? 'であれば' : 'があれば'));
      const a2 = parseCondText(andm[3]);
      if (a1 && a2) return { and: [a1, a2] };
    }
    if ((mm0 = ct.match(/^自分のクリーチャーの中に((光|水|闇|火|自然)(と|、)?)+が(あれば)?$/))) return { battleCivAll: (ct.match(/光|水|闇|火|自然/g) || []).map((x) => ({ 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[x])) };
    const c = {};
    let mm;
    ct = ct.replace(/(である間|ある間|の間|いる間)$/, '');
    if ((mm = ct.match(/^それが(その|この)ターン(はじめて|最初)の攻撃(であれば|なら)$/))) return { firstAttack: true };
    if ((mm = ct.match(/^このクリーチャーが(カード(\d+)枚で)?リンクして(いれば|いる|いる時|い)?$/))) return { linked: mm[2] ? +mm[2] : 2 };
    if (/^自分のシールドの数が相手のより多ければ$/.test(ct)) return { shieldsMore: true };
    if (/^このカードが(自分の)?シールドゾーン(に|で)表向き(なら|であれば)$/.test(ct)) return { selfFaceUpShield: true };
    if (/^(この|その)ターン、クリーチャーが攻撃していなければ$/.test(ct)) return { noAttackThisTurn: true };
    if ((mm = ct.match(/^すべてのシールドゾーンにある表向きのカードの(合計|数)が(\d+)枚以上(なら|あれば)$/))) return { faceUpAllShieldsGE: +mm[2] };
    if ((mm = ct.match(/^コストが異なる自分のエレメントが(\d+)(つ|枚|体)以上あれば$/))) return { distinctCosts: +mm[1] };
    if ((mm = ct.match(/^(バトルゾーンに)?自分の(、)?名前に[《「](.+?)[》」]を?(持つ|とある)クリーチャーが(\d+)体以上(バトルゾーンに)?あれば$/))) return { count: { what: mm[3], n: +mm[5] } };
    if ((mm = ct.match(/^それが(その|この)ターン(はじめて|最初)の攻撃でなければ$/))) return { notFirstAttack: true };
    if ((mm = ct.match(/^(カードがこれの下に|このクリーチャーの下に(\d+)枚以上カードが|このクリーチャーにカードが(\d+)枚以上含まれて)(あれば|いれば)$/))) return { underGE: mm[2] ? +mm[2] : mm[3] ? +mm[3] - 1 : 1 };
    if ((mm = ct.match(/^相手の手札が(\d+)枚もなければ$/))) return { oppHandLE: +mm[1] - 1 };
    if ((mm = ct.match(/^このクリーチャーのパワーが(\d+)以上(なら|であれば)$/))) return { selfPowerGE: +mm[1] };
    if (/^相手のマナゾーンに多色カードがあれば$/.test(ct)) return { oppManaMulti: 1 };
    if (/^(自分の)?(DN|D2|DG)フィールドがバトルゾーンにあれば$|^バトルゾーンに自分の(DN|D2|DG)フィールドがあれば$/.test(ct)) return { hasField: true };
    if (/^相手のターンにこのクリーチャーがタップ(されて|して)いれば$/.test(ct)) return { oppTurn: true, selfTapped: true };
    if (/^(その|この)ターン(、|中に)?自分のクリーチャーがバトルに勝って(いれば|いたら)$/.test(ct)) return { wonBattleThisTurn: true };
    if ((mm = ct.match(/^(このカード|この呪文|このクリーチャー)が(バトルゾーンまたは)?(表向きで)?自分のシールドゾーンに(表向きで)?(あれば|であれば)$/))) return { selfFaceUpShield: true, orBattle: !!mm[2] };
    ct = ct.replace(/^マナ武装\s*\d+\s*[：:\-－―]\s*/, '').replace(/(であれば|ならば|なら|あれば|場合|の場合|いれば)$/, '').replace(/ければ$/, 'い').replace(/^バトルゾーンにある、?/, 'バトルゾーンに');
    if (/^これを装備したクリーチャーがタップ(されて|して)(い)?(れば)?$/.test(ct)) return { equippedTapped: true };
    const CV = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' };
    const civList = (t) => (t.match(/光|水|闇|火|自然/g) || []).map((x) => CV[x]);
    // マナ武装・マナの条件
    if ((mm = ct.match(/^自分のマナゾーンに((光|水|闇|火|自然)(、|または|か)?)+の?カードが(\d+)枚以上$/))) return { manaCivGE: { civs: civList(ct), n: +mm[4] } };
    if ((mm = ct.match(/^自分のマナゾーンに((光|水|闇|火|自然)(、|または|か)?)+(の)?(カード|文明)が$/))) return { manaCivGE: { civs: civList(ct), n: 1 } };
    if ((mm = ct.match(/^自分のマナゾーンに((光|水|闇|火|自然)(と|、)?)+(の)?(カード|文明)が(すべて|両方)?$/))) return { manaCivAll: civList(ct) };
    if ((mm = ct.match(/^自分のマナゾーンに多色カードが(\d+)枚以上$/))) return { manaMultiGE: +mm[1] };
    if ((mm = ct.match(/^自分のマナゾーン(にある|の)カードがすべて((光|水|闇|火|自然|無色)(または|か|、)?)+((の)?カード)?(で(ある|あれ)?)?$/))) return { manaOnlyCivs: civList(ct).concat(/無色/.test(ct) ? ['zero'] : []) };
    if ((mm = ct.match(/^自分のマナゾーンに([^、。]+?)(・カード)?が(\d+)枚以上$/)) && !/カード$/.test(mm[1])) return { manaRaceGE: { what: mm[1], n: +mm[3] } };
    // シールド・手札・墓地
    if ((mm = ct.match(/^相手のシールドが(\d+)(つ|枚)以下(で)?$/))) return { oppShieldsLE: +mm[1] };
    if ((mm = ct.match(/^相手のシールドが(\d+)(つ|枚)以上$/))) return { oppShieldsGE: +mm[1] };
    if ((mm = ct.match(/^相手のシールドが(\d+)(つ|枚)でも$/))) return { oppShieldsGE: +mm[1] };
    if ((mm = ct.match(/^自分のシールドが(\d+)(つ|枚)でも$/))) return { shieldsGE: +mm[1] };
    if (/^相手のシールドが1(つ|枚)もない$|^相手のシールドがない$/.test(ct)) return { oppShieldsLE: 0 };
    if ((mm = ct.match(/^自分の手札が(\d+)枚以上$/))) return { handGE: +mm[1] };
    if (/^自分の手札が1枚もない$|^自分の手札がない$/.test(ct)) return { handLE: 0 };
    if ((mm = ct.match(/^自分の墓地に(クリーチャー|呪文)が(\d+)(体|枚)以上$/))) return { graveTypeGE: { type: mm[1] === '呪文' ? 'spell' : 'creature', n: +mm[2] } };
    if ((mm = ct.match(/^自分の墓地に([^、。]+?)が(\d+)(体|枚|つ)(以上|でも)$/))) return { graveWhatGE: { what: mm[1], n: +mm[2] } };
    if (/^(自分の)?シールドゾーンに表向きのカードが$/.test(ct)) return { faceUpShieldsGE: 1 };
    if ((mm = ct.match(/^「(.+?)」を持つカードが自分のシールドゾーンに表向き(で)?$/))) return { faceUpShieldHas: mm[1] };
    if (/^このカードが(自分の)?シールドゾーン(に|で)表向き(で)?$/.test(ct)) return { selfFaceUpShield: true };
    if (/^(この|その)ターン、クリーチャーが攻撃していな(い|ければ)$/.test(ct)) return { noAttackThisTurn: true };
    // 場の状態
    if ((mm = ct.match(/^(バトルゾーンに)?自分の((《[^》]+》)(と|、)?)+が$/))) return { namesPresent: [...ct.matchAll(/《([^》]+)》/g)].map((x) => x[1]) };
    if ((mm = ct.match(/^(バトルゾーンに)?自分の《([^》]+)》がない$/))) return { nameAbsent: mm[2] };
    if ((mm = ct.match(/^(バトルゾーンに)?相手の([^、。]+?)が$/)) && !/シールド|マナ|手札|墓地/.test(mm[2])) return { oppCount: { what: mm[2], n: 1 } };
    if (/^このクリーチャーがタップ(して|されて)(い)?$/.test(ct)) return { selfTapped: true };
    if (/^このクリーチャーがアンタップして(い)?$/.test(ct)) return { selfUntapped: true };
    if (/^これが(NEO)?進化クリーチャー$/.test(ct)) return { selfEvo: true };
    if (/^このクリーチャーが自分の墓地に$/.test(ct)) return { selfInGrave: true };
    if (/^(バトルゾーンにある)?自分のクリーチャーがこのクリーチャーだけ(で)?$|^バトルゾーンに自分のクリーチャーがこのクリーチャーだけ(で)?$|^(バトルゾーンに)?自分の他のクリーチャーが(1体も)?ない$/.test(ct)) return { alone: true };
    if (/^自分のクリーチャーの数が自分のシールドの数以上$/.test(ct)) return { creaturesGEShields: true };
    if ((mm = ct.match(/^(バトルゾーンまたはマナゾーンに)?自分の(、)?([^、。]+?)(と|、)?(マナゾーンにある[^、。]+?)?が(合計)?(\d+)(枚|つ|体)以上$/)) && (mm[1] || mm[5] || mm[6])) return { battleManaGE: { what: mm[3].replace(/(・カード|・クリーチャー)$/, ''), n: +mm[7] } };
    if (/^相手のターン中$/.test(ct)) return { oppTurn: true };
    if (/^自分のターン中$/.test(ct)) return { myTurn: true };
    if (/^(このクリーチャーが)?(バトルゾーンにある間|バトルゾーンに)$/.test(ct)) return {};
    if (/^(このクリーチャーの)?攻撃中$/.test(ct)) return { selfAttacking: true };
    if (/^(このクリーチャーが)?ブロック中$/.test(ct)) return { selfBlocking: true };
    if (/^(このクリーチャーが)?バトル中$/.test(ct)) return { inBattle: true };
    if ((mm = ct.match(/^自分のシールドが(\d+)(つ|枚)以下(で)?$/))) c.shieldsLE = +mm[1];
    else if ((mm = ct.match(/^自分のシールドが(\d+)(つ|枚)?以上$/))) c.shieldsGE = +mm[1];
    else if ((mm = ct.match(/^自分のシールドゾーンに表向きのカードが(\d+)枚以上$/))) c.faceUpShieldsGE = +mm[1];
    else if ((mm = ct.match(/^(バトルゾーンに)?(ある)?自分の(他の)?([^、。]+?)が(\d+)(体|つ|枚)以下$/)) && !/シールド|マナ|手札|墓地/.test(mm[4])) c.countLE = { what: mm[4], n: +mm[5], others: !!mm[3] };
    else if (/^自分のシールドが1(つ|枚)もない$|^自分のシールドがない$/.test(ct)) c.shieldsLE = 0;
    else if (/^(自分の手札が相手より少ない|相手の手札が自分(のもの|の)?より多い|相手の手札の枚数が自分より多い)(い)?$/.test(ct)) c.handLess = true;
    else if (/^(自分のマナゾーンのカードが相手より少ない|相手のマナゾーンのカードが自分(のマナゾーンのカード|の)?より多い)$/.test(ct)) c.oppManaMore = true;
    else if (/^(自分のシールドが相手より少ない|相手のシールドが自分(のもの|の)?より多い)$/.test(ct)) c.shieldsLess = true;
    else if (/^自分のシールドの数が相手より多い$/.test(ct)) c.shieldsMore = true;
    else if (/^(バトルゾーンにある)?自分のクリーチャーの数が相手より多い$/.test(ct)) c.creaturesMore = true;
    else if ((mm = ct.match(/^自分のマナゾーンにカードが(\d+)枚以上$/))) c.manaGE = +mm[1];
    else if ((mm = ct.match(/^自分の手札が(\d+)枚以下$/))) c.handLE = +mm[1];
    else if ((mm = ct.match(/^自分の墓地にカードが(\d+)枚以上$/))) c.graveGE = +mm[1];
    else if ((mm = ct.match(/^(バトルゾーンに)?自分の(他の)?([^、。]+?)が(\d+)(体|つ|枚)以上$/)) && !/シールド|マナ|手札|墓地/.test(mm[3])) c.count = { what: mm[3], n: +mm[4], others: !!mm[2] };
    else if ((mm = ct.match(/^(バトルゾーンに)?自分の(他の)?([^、。]+?)が$/)) && !/シールド|マナ|手札|墓地/.test(mm[3])) c.count = { what: mm[3], n: 1, others: !!mm[2] };
    else if (/^自分のターン中/.test(ct) && /^自分のターン中(に)?(この呪文を唱えた)?$/.test(ct)) c.myTurn = true;
    else return null;
    return c;
  }

  // 山札を見る効果の言い回しをそろえる
  function lookNorm(b) {
    if (!/山札/.test(b)) return b;
    return b
      .replace(/(、)?(選んで|選び、)?(相手に|すべてのプレイヤーに)?見せ(てから|て|、)(、)?/g, '、')
      .replace(/、、+/g, '、')
      .replace(/(その中から|そのうち(の)?)、/g, '$1')
      .replace(/(\d+)(枚|体)、(手札|自分の手札|マナゾーン|墓地|バトルゾーン|出)/g, '$1$2$3')
      .replace(/(\d+)(枚|体)選んで(?=(自分の)?(手札|マナ|墓地|バトル|出))/g, '$1$2')
      .replace(/山札の一番(下|上)/g, '山札の$1')
      .replace(/好きな枚数/g, '好きな数')
      .replace(/その中から好きな数の([^。、]+?)を/g, 'その中から$1を好きな数')
      .replace(/その中(にある|の)すべての([^。、]+?)を/g, 'その中から$2をすべて')
      .replace(/その中の([^。、]+?)を(\d+)/g, 'その中から$1を$2')
      .replace(/「(.+?)」付き(の)?呪文/g, '「$1」を持つ呪文')
      .replace(/([^。、を]+?)を(\d+)体または([^。、を]+?)を(\d+)枚/g, '$1または$3を$4枚')
      .replace(/残りをシャッフルして/g, '残りを')
      .replace(/(表向きで|表向きにして|裏向きにして|裏向きのまま)(、)?(新しいシールドとして)?(自分の)?(シールドゾーンに(加え|置き)|シールド化し)/g, 'シールド化し')
      .replace(/(、)?新しいシールドとして(自分の)?シールドゾーンに(加え|置き)/g, 'シールド化し')
      .replace(/その後、残りを/g, '残りを')
      .replace(/(\d+)枚(目)?を見る。(その中から|そのうち(の)?)/g, '$1枚を見る。その中から')
      .replace(/(\d+)枚(目)?を表向きにする。(そのうち(の)?)/g, '$1枚を表向きにする。その中から')
      .replace(/シールド化し(る|く)/g, 'シールド化する');
  }
  // 「その中から1枚をA、もう1枚をBに」
  const LOOK2_RE = /^(自分の)?山札の上から2枚を(見る|表向きにする)。その中から1枚を([^、。]+?)、もう1枚を([^、。]+?)。?$/;
  const zoneWord = (t) => (/シールド/.test(t) ? 'shields' : /手札/.test(t) ? 'hand' : /マナ/.test(t) ? 'mana' : /墓地/.test(t) ? 'grave' : /出/.test(t) ? 'battle' : null);
  // 1文の中の「捨てた手札が○○なら、～」「条件なら、～」（再帰しないよう、後半は1文として読む）
  function parseBranch(p) {
    let m = p.match(/^こうして([^、。]+?)を捨てたら、(.+)$/);
    if (m) {
      const t = parseEffect(m[2]);
      if (t) return { act: 'ifLastDiscard', cond: lookCond(m[1]), acts: [t], text: m[1] };
    }
    m = p.match(/^それが([^、。]+?)(なら|であれば)、(.+)$/);
    if (m) {
      const t = parseEffect(m[3]);
      if (t) return { act: 'ifLastDiscard', cond: lookCond(m[1]), acts: [t], text: m[1], anyLast: true };
    }
    m = p.match(/^(こうして)?(捨てた|その捨てた)(手札|カード)が([^、。]+?)(なら|であれば)、(.+)$/);
    if (m) {
      const t = parseEffect(m[6]);
      if (t) return { act: 'ifLastDiscard', cond: lookCond(m[4]), acts: [t], text: m[4] };
    }
    m = p.match(/^([^、。]+?(であれば|ならば|なら|あれば|ければ|いれば|場合))、(.+)$/);
    if (m) {
      const cond = parseCondText(m[1]);
      const t = cond && parseEffect(m[3]);
      if (t) return { act: 'ifCond', cond, acts: [t], text: m[1] };
    }
    return null;
  }
  function parseEffects(body) {
    body = lookNorm(String(body || '').replace(/パワーを\s*-∞\s*する/g, 'パワーを0にする'))
      .replace(/を(、)?裏向き(のまま|にして)(、)?(?=新しいシールドとして)/g, 'を')
      .replace(/を(、)?表向きに(して|し)(、)?新しいシールドとして(自分の)?シールドゾーンに(置く|加える)/g, 'を表向きでシールド化する')
      .replace(/(選び、|選んで)相手に見せ(てから|て|、)(自分の)?/g, '選び、')
      .replace(/相手に見せてから(自分の)?/g, '')
      .replace(/マナゾーンに加え(てもよい|る)/g, (x, y) => (y === 'る' ? 'マナゾーンに置く' : 'マナゾーンに置いてもよい'))
      .replace(/相手は自分自身の/g, '相手は自身の')
      .replace(/(手札を(\d+)枚選び)捨てる/g, '$1、捨てる')
      .replace(/(バトルゾーンにある)?(相手|自分)のクリーチャーすべてのパワーは-(\d+)される/g, 'このターン、$2のクリーチャーすべてのパワーを-$3する')
      .replace(/^そのターン、このターン、/, 'このターン、')
      .replace(/(を|を、)?新しいシールドとして(持ち主の|自分の|自身の)?シールドゾーンに(裏向きにして|裏向きのまま)?(加える|置く|加え、|加えてもよい|置いてもよい)/g, (x, a, b, c, d) => (a || '') + { 加える: 'シールド化する', 置く: 'シールド化する', '加え、': 'シールド化し、', 加えてもよい: 'シールド化してもよい', 置いてもよい: 'シールド化してもよい' }[d])
      .replace(/相手のクリーチャーを(\d+)体選んで破壊し、/g, '相手のクリーチャーを$1体選び、破壊する。')
      .replace(/。?これらのクリーチャーが出ることによって起こる効果やルールはすべて無視する。?/g, '。それらの出た時の効果は起こらない');
    if (/^次の自分のターンのはじめまで、相手は(、)?自身のマナゾーン(にある|の)カードの枚数よりコストが大きいクリーチャーを(バトルゾーンに)?出した(時|とき)、そのクリーチャーを(自身の)?山札の(一番)?下に置く。?$/.test(body)) return [{ act: 'tempBigBottom' }];
    const tsd = body.match(/^相手のパワー(\d+)以下のクリーチャーをすべて(表向きに)?シールド化する。こうしてシールド化したカード1枚につき、自分はカードを1枚引く。?$/);
    if (tsd) return [{ act: 'toShieldAllDraw', maxPower: +tsd[1], faceUp: !!tsd[2] }];
    if (/^自分と相手のシールドを1つずつ選ぶ。このクリーチャーは選ばれたそれらのシールドをブレイクする。?$/.test(body)) return [{ act: 'breakBothOne' }];
    const l3 = body.match(/^(自分の)?山札の上から3枚を(見る|表向きにする)。(その中から|そのうち(の)?)1枚を([^、。]+?)、1枚を([^、。]+?)、(残りの1枚|最後の1枚|もう1枚)を([^、。]+?)。?$/);
    if (l3 && zoneWord(l3[5]) && zoneWord(l3[6]) && zoneWord(l3[8])) return [{ act: 'lookSplit', n: 3, dests: [zoneWord(l3[5]), zoneWord(l3[6]), zoneWord(l3[8])] }];
    const ru = body.match(/^自分の山札の上から([^、。]+?)が(\d+)体出るまで表向きにし、その(\d+)体を(バトルゾーンに)?出す。(その後、)?(自分の)?山札をシャッフルする。?/);
    if (ru) return [{ act: 'revealUntil', cond: lookCond(ru[1]), n: +ru[2] }, ...afterActs(body.slice(ru[0].length))];
    const l2 = body.match(LOOK2_RE);
    if (l2 && zoneWord(l2[3]) && zoneWord(l2[4]) && zoneWord(l2[4]) !== 'battle') {
      return [{ act: 'lookTop', n: 2, reveal: l2[2] === '表向きにする', cond: lookCond(''), take: 1, each: 0, upTo: false, dest: zoneWord(l2[3]), rest: zoneWord(l2[4]), restTapped: /タップ/.test(l2[4]) }];
    }
    body = body.replace(/(その中から[^。]*?)、もう1枚を/, '$1、残りを');
    // 「山札の上から1枚をマナゾーンに置く。それが○○なら、もう1枚マナゾーンに置く」
    const mb = body.match(/^(自分の山札の上から1枚(目)?を(タップして)?マナゾーンに置く)。(その後、)?(それが|そのカードが)(.+?)(なら|であれば)、(自分の)?(山札の上から)?もう1枚(、)?(タップして)?マナゾーンに置く。?/);
    if (mb) {
      const first = parseEffect(mb[1]);
      if (first) return [first, { act: 'lastIf', cond: lookCond(mb[6]), acts: [{ act: 'manaBoost', n: 1, tapped: !!mb[11] }] }, ...afterActs(body.slice(mb[0].length))];
    }
    // 「自分の山札をシャッフルし、（その後、）上からN枚を…」
    let sh = body.match(/^自分の山札をシャッフルし、(その後、)?(自分の山札の)?上から/);
    if (sh) {
      const rest = parseEffects('自分の山札の上から' + body.slice(sh[0].length));
      return rest ? [{ act: 'shuffleDeck' }, ...rest] : null;
    }
    const pb = body.match(/^自分の山札の上から(\d+)枚を見て、(そのうちの|その中から)(\d+)枚を(自分の)?山札の(一番)?下に置く。?/);
    if (pb) return [{ act: 'arrangeTop', n: +pb[1], where: 'pickBottom', k: +pb[3] }, ...afterActs(body.slice(pb[0].length))];
    const hm = body.match(/^自分の山札の上から1枚(目)?を見る。(そのカード|それ)を(自分の)?手札に加えるか、(タップして)?(自分の)?マナゾーンに置く。?/);
    if (hm) return [{ act: 'topHandOrMana', tapped: !!hm[4] }, ...afterActs(body.slice(hm[0].length))];
    const cg = body.match(/^(コスト(\d+)以下の)?((光|水|闇|火|自然)の)?呪文を(\d+)枚、(自分の|いずれかのプレイヤーの)墓地からコストを支払わずに唱え(る|てもよい)。(それを|その呪文を)?唱えた後、(その呪文を|それを)?墓地(に置く)?(の)?かわりに(持ち主の|自分の)?山札の(一番)?下に置く。?/);
    if (cg) return [{ act: 'castFromGrave', maxCost: cg[2] ? +cg[2] : null, civ: cg[4] ? CIVJ[cg[4]] : null, n: +cg[5], optional: cg[7] !== 'る', anyGrave: cg[6] !== '自分の', bottomAfter: true }, ...afterActs(body.slice(cg[0].length))];
    const pf = body.match(/^自分と相手のクリーチャーを1体ずつ選(ぶ|んでもよい)。その2体をバトルさせる。?/);
    if (pf) return [{ act: 'pairFight', optional: pf[1] !== 'ぶ' }, ...afterActs(body.slice(pf[0].length))];
    const ldm = body.match(/^(こうして)?(捨てた|その捨てた)(手札|カード)が([^、。]+?)(なら|であれば)、([^。]+)。?/);
    if (ldm) {
      const then = parseEffects(ldm[6]);
      if (then) return [{ act: 'ifLastDiscard', cond: lookCond(ldm[4]), acts: then, text: ldm[4] }, ...afterActs(body.slice(ldm[0].length))];
    }
    // 「条件なら、効果」（条件の中に「、」があってもよい）
    let cdm = body.match(/^([^、。]+?(であれば|ならば|なら|あれば|ければ|いれば|場合))、(.+)$/);
    if (!cdm || !parseCondText(cdm[1])) {
      const re2 = /(であれば|ならば|なら|あれば|ければ|いれば|場合)、/g;
      let mx;
      while ((mx = re2.exec(body))) {
        const head = body.slice(0, mx.index + mx[1].length);
        if (/。/.test(head)) break;
        if (parseCondText(head)) {
          cdm = [null, head, mx[1], body.slice(mx.index + mx[0].length)];
          break;
        }
      }
    }
    if (cdm) {
      const cond = parseCondText(cdm[1]);
      if (cond) {
        const sent = cdm[3].split(/。/);
        const then = parseEffects(sent[0]);
        if (then && then[0].act !== 'manualNote') {
          const restTxt = sent.slice(1).join('。').trim();
          return [{ act: 'ifCond', cond, acts: then, text: cdm[1] }, ...afterActs(restTxt)];
        }
      }
    }
    // 「Aしてもよい。そうしたら、B」
    const ifm = body.replace(/^その後、/, '').match(/^(.+?)(てもよい|る|す|く)。(そうしたら|そうした場合|そうすれば)、(.+)$/);
    if (ifm && !/。/.test(ifm[1])) {
      const first = parseEffect(ifm[1] + ifm[2]);
      const then = parseEffects(ifm[4]);
      if (first && first.act !== 'manualNote' && then) return [{ act: 'ifDo', first: { ...first, optional: false }, optional: ifm[2] === 'てもよい', acts: then, text: ifm[1] + ifm[2] }];
    }
    let mm;
    if ((mm = body.match(SEARCH_CAST_RE))) return [{ act: 'searchDeck', cond: lookCond(mm.groups.cond), n: 1, upTo: true, dest: 'cast' }, ...afterActs(body.slice(mm[0].length))];
    if ((mm = body.match(SEARCH_RE))) {
      const g = mm.groups;
      return [{ act: 'searchDeck', cond: lookCond(g.cond), n: +g.n, upTo: !!g.upto || /てもよい/.test(g.may || ''), dest: DEST_OF(g.dest.replace(/置$/, '置き')) }, ...(afterActs(body.slice(mm[0].length)) || [])];
    }
    if ((mm = body.match(ARRANGE_RE))) {
      const w = mm.groups.where;
      return [{ act: 'arrangeTop', n: +mm.groups.n, where: /または|か/.test(w) ? 'both' : /下/.test(w) ? 'bottom' : 'top' }, ...afterActs(body.slice(mm[0].length))];
    }
    if ((mm = body.match(TOPCHECK_RE))) {
      const g = mm.groups;
      return [
        {
          act: 'topCheck',
          reveal: /表向き/.test(g.how),
          optional0: !!g.may0 || /てもよい/.test(g.how),
          cond: lookCond(g.cond),
          then: DEST_OF(g.then),
          optional: /てもよい/.test(g.may || ''),
          else: g.else ? ZONE_OF(g.else) : g.how === '表向きにする' ? 'deckTop' : 'deckTop',
          text: g.cond,
        },
        ...afterActs(body.slice(mm[0].length)),
      ];
    }
    const rv = body.match(REVEAL_RE);
    if (rv) {
      const act = { act: 'revealTop', cond: lookCond(rv[2]), optional: /てもよい/.test(rv[6]), rest: { 山札の下: 'deckBottom', マナゾーン: 'mana', 墓地: 'grave', 手札: 'hand' }[rv[10]] };
      const remain = body.slice(rv[0].length).replace(/^その後、/, '').trim();
      const after = remain ? parseEffects(remain) : [];
      return [act, ...(after || [{ act: 'manualNote', text: remain }])];
    }
    const lk = parseLook(body);
    if (lk) {
      const after = lk.remain.trim() ? parseEffects(lk.remain) : [];
      return [lk.act, ...(after || [{ act: 'manualNote', text: lk.remain }])];
    }
    const parts = body
      .replace(/(引き|引いて)、(その後、)?(自分の)?(手札を)?(\d+枚)(選び、)?捨てる/g, '引く。自分の手札を$5捨てる')
      .replace(/カードを(\d+)枚引き、/g, 'カードを$1枚引く。')
      .replace(/相手のクリーチャーを(\d+)体選ぶ。(この|その)ターン、そのクリーチャーのパワーを、?自分の墓地にあるカード(\d+)枚につき-(\d+)する/g, '相手のクリーチャーを$1体選び、墓地の数だけパワーを-$4する')
      .replace(/相手のクリーチャーを(\d+)体選ぶ。(この|その)ターン、そのクリーチャーのパワーを/g, '相手のクリーチャーを$1体選び、パワーを')
      .replace(/自分の手札を(\d+)枚捨て、(その後、)?カードを(\d+)枚引く/g, '自分の手札を$1枚捨てる。カードを$3枚引く')
      .replace(/バトルゾーンにある自分のクリーチャーを(\d+)体選ぶ。次の自分のターンのはじめまで、相手がバトルゾーンにあるクリーチャーを選ぶ時、そのクリーチャーを選ぶことはできない/g, '自分のクリーチャーを$1体選んで次のターンまで選ばれなくする')
      .replace(/選んでもよい。相手はそれをシールド化する/g, '選んでもよい。相手はそれをシールド化する'.replace('。', '、'))
      .replace(/相手のクリーチャーを(\d+)体(まで)?選ぶ。次の自分のターンのはじめまで、(そのクリーチャー|それら)は攻撃もブロックもできない/g, '相手のクリーチャーを$1体選んで次のターンまで攻撃もブロックもできなくする')
      .replace(/自分のシールドゾーンにあるカードを(\d+)枚山札の下に置いてもよい。そうしたら、カードを(\d+)枚引く/g, '自分のシールドを$1枚山札の下に置いて$2枚引く')
      .replace(/自分のクリーチャーを(\d+)体選ぶ。次の自分のターンのはじめまで、そのクリーチャーが破壊される時、墓地に置くかわりにバトルゾーンにとどまる/g, '自分のクリーチャーを$1体選んで次のターンまで破壊されなくする')
      .replace(/(バトルゾーンにある)?自分のクリーチャーを(\d+)体(まで)?選ぶ。このターン、そのクリーチャーはブロックされない/g, '自分のクリーチャーを$2体$3選んでこのターンブロックされなくする')
      .replace(/(バトルゾーンにある)?相手のクリーチャーを(\d+)体選ぶ。そのクリーチャーと、バトルゾーンにある同じ名前を持つクリーチャーをすべてタップする/g, '相手のクリーチャーを$2体選び、同じ名前のクリーチャーをすべてタップする')
      .replace(/相手のクリーチャーを(\d+)体選んでもよい。その選んだクリーチャーとこのクリーチャーをバトルさせる/g, '相手のクリーチャーを$1体選んでバトルさせる')
      .split(/。その後、|、その後、|。/)
      .map((x) => x.trim())
      .filter(Boolean);
    const acts = [];
    let ok = 0;
    for (const p0 of parts) {
      const did = /^(そうしたら|そうした場合)、/.test(p0);
      const p = p0.replace(/^(そうしたら|そうした場合)、/, '');
      let a = parseEffect(p) || parseBranch(p);
      if (!a) {
        const ao = p.match(/^相手は(、)?(自身の)?(.+)$/);
        if (ao && !/自分/.test(ao[3])) {
          const inner = parseEffects((ao[2] ? '自分の' : '') + ao[3].replace(/自身/g, '自分'));
          if (inner && !inner.some((x) => x.act === 'manualNote')) a = { act: 'asOpp', acts: inner };
        }
      }
      if (a && did && acts.length) a = { act: 'ifDidPrev', acts: [a] };
      if (a) {
        acts.push(a);
        ok++;
      } else acts.push({ act: 'manualNote', text: p });
    }
    // 最初の文が読めない時（条件や選び方が分からない時）は、全体を手動にする
    if (!ok || acts[0].act === 'manualNote') return null;
    if (acts.some((x) => x.suppressPrev)) for (const x of acts) if (x.act === 'reanimate' || x.act === 'oppReanimateAny') x.suppress = true;
    // 「クリーチャーを1体選ぶ」の後が強化なら、味方を選ぶ効果
    acts.forEach((x, i) => {
      const nx = acts[i + 1];
      if (x.act === 'pickTarget' && nx && ((nx.act === 'powerLast' && nx.n > 0) || ['grantLast', 'guardLast', 'untapLast'].includes(nx.act))) x.friendly = true;
    });
    return acts;
  }

  const KWD = () => G.Keywords || (typeof require !== 'undefined' ? require('./keywords.js') : null);
  const CIVJ = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' };

  // def: {type, text}
  // 手札にある間に働く能力か
  const FROM_HAND = (acts) => JSON.stringify(acts || []).includes('"selfFromHand"') || JSON.stringify(acts || []).includes('"selfDiscardFromHand"');
  function parseCard(def) {
    const kw = { breaker: 1, powerAttacker: 0 };
    const abilities = []; // {when, acts, cond}
    const manual = []; // 自動化できない文
    const known = []; // 認識したが手動のキーワード {name, desc}
    const hyper = { kw: { breaker: 1, powerAttacker: 0 }, abilities: [] }; // ハイパーモード中だけ有効
    let hyperUsed = false;
    let inHyper = false;
    const A_PUSH = (w, ab) => (inHyper ? hyper.abilities : abilities).push(ab);
    const rawLines = normalize(def.text)
      .split('\n')
      .flatMap((l) => {
        const both = l.match(/^このクリーチャー(、)?(または|か)(、)?自分の他の(.+?)を(バトルゾーンに)?出した(時|とき)、(.+)$/);
        if (both) return ['このクリーチャーが出た時、' + both[7], '自分の他の' + both[4] + 'が出た時、' + both[7]];
        const t = stripReminder(l).trim();
        if (/^[^、。]{2,24}((\s{2,}|　)[^、。]{2,24})+$/.test(t)) return t.split(/\s{2,}|　/);
        return [l];
      })
      .map((l) => l.trim())
      .filter(Boolean);
    // 「▶」「►」で始まる行は、直前の「選ぶ」行の選択肢としてまとめる
    const lines = [];
    for (const l of rawLines) {
      if (/^[▶►]/.test(l) && lines.length) {
        const prev = lines[lines.length - 1];
        (prev.opts = prev.opts || []).push(l.replace(/^[▶►]\s*/, ''));
      } else lines.push(Object.assign(new String(l.replace(/^[■▪・●◆]\s*/, '')), {}));
    }
    const Kd = KWD();
    // 記号のない古い書き方：「次のうちいずれか1つを選ぶ。」の後の行を選択肢にする
    for (let i = 0; i < lines.length; i++) {
      const head = String(lines[i]);
      if (lines[i].opts || !/(次の(うち|中から))?(いずれか)?(\d+)つ(を)?選ぶ。?$/.test(head) || /[▶►]/.test(head)) continue;
      const opts = [];
      let j = i + 1;
      while (j < lines.length && opts.length < 6) {
        const t = String(lines[j]);
        const st = stripReminder(t).trim();
        if (!st || /^[(（]/.test(t) || /両方|すべて選んでもよい/.test(t) || (Kd && Kd.match(st, t))) break;
        opts.push(t);
        j++;
      }
      if (opts.length < 2) continue;
      lines[i].opts = opts;
      // 「両方とも選んでもよい」の行（爆進ダブルなど）
      if (j < lines.length && /両方|すべて選んでもよい/.test(String(lines[j]))) {
        lines[i].bothNote = String(lines[j]);
        j++;
      }
      lines.splice(i + 1, j - i - 1);
    }

    let tapNext = false;
    let linkFrom = null;
    let linkCond = null;
    let markAb = null;
    const applyLink = () => {
      if (linkFrom == null) return;
      const lc = linkCond || { linked: 2 };
      for (const ab of abilities.slice(linkFrom)) ab.cond = ab.cond ? { and: [ab.cond, lc] } : lc;
      linkFrom = null;
      linkCond = null;
    };
    for (const rawObj of lines) {
      applyLink();
      const raw = String(rawObj);
      let line = stripReminder(raw);
      if (!line) continue;
      // 「このクリーチャーがリンクしていて○○時」「リンクしている時、○○時」は、リンク中だけ誘発する
      const lk = line.match(/^このクリーチャーがリンクしてい(て、?|る(時|間)、)(?=(攻撃する|バトルに勝った|ブロックした|自分のターンのはじめ|自分のターンの終わり|相手のクリーチャーが|自分の))/);
      if (lk) {
        line = line.slice(lk[0].length).replace(/^(攻撃する|バトルに勝った|ブロックした)/, 'このクリーチャーが$1');
        linkFrom = abilities.length;
      }
      // ビビッドロー：コストは注意書きの中にある
      if (/^ビビッドロー\s*$/.test(line)) {
        const vm = raw.match(/〔代替([lwdfnc]+)(\d+)〕/);
        if (vm) {
          const CV = { l: 'light', w: 'water', d: 'darkness', f: 'fire', n: 'nature' };
          (inHyper ? hyper.kw : kw).vivid = { cost: +vm[2], civs: [...new Set(vm[1].split(''))].filter((x) => CV[x]).map((x) => CV[x]) };
          continue;
        }
      }
      // バズレンダ
      if (/^バズレンダ/.test(line)) {
        const vm = raw.match(/\[([a-z]+)(\d+)\]/) || raw.match(/〔代替([a-z]+)(\d+)〕/);
        (inHyper ? hyper.kw : kw).buzz = { cost: vm ? +vm[2] : 2 };
        continue;
      }
      if (/^〔バズ〕/.test(line)) {
        const body = parseEffects(line.replace(/^〔バズ〕\s*/, '').replace(/。$/, ''));
        if (body && !body.some((x) => x.act === 'manualNote')) {
          A_PUSH('summon', { when: 'summon', acts: [{ act: 'repeatBuzz', acts: body }], text: raw });
          continue;
        }
      }
      // バラバラエティN：コストが異なる自分のエレメントがN以上あれば
      const bv = line.match(/^バラバラエティ(\d+)[：:]\s*(.+)$/);
      if (bv) {
        if (parseTriggerHead(bv[2]) || TRIGGERS.some((t) => t.re.test(bv[2]))) {
          line = bv[2];
          linkFrom = abilities.length;
          linkCond = { distinctCosts: +bv[1] };
        } else line = `コストが異なる自分のエレメントが${bv[1]}つ以上あれば、${bv[2]}`;
      }
      // パワーがN以上のとき「X」を得る
      const pw = line.match(/^このクリーチャーは(、)?パワーが(\d+)以上の(とき|時|間)、「(.+?)」を得る。?$/);
      if (pw) {
        const KK = inHyper ? hyper.kw : kw;
        (KK.condGrants = KK.condGrants || []).push({ cond: { selfPowerGE: +pw[2] }, power: 0, names: [pw[4]] });
        continue;
      }
      // 召喚する時、手札のカードを見せてコストを下げる
      const shc = line.match(/^このクリーチャーを召喚する(時|とき)、自分の手札から(コスト(\d+)以上の)?([^、。]*?)カードを(\d+)枚、相手に見せてもよい。(そうした場合|そうしたら)、このクリーチャーの召喚コストは(最大)?(\d+)少なくなる。?$/);
      if (shc) {
        (inHyper ? hyper.kw : kw).summonCostOpt = { act: { act: 'showOwn', n: +shc[5], cond: { ...(shc[3] ? { minCost: +shc[3] } : {}), civs: [], text: 'カード' } }, n: +shc[9], text: '手札のカードを見せ' };
        continue;
      }
      // マナがN枚以上あれば、代わりのコストで召喚
      const mal = line.match(/^自分のマナゾーンにカードが(\d+)枚以上あれば、この(クリーチャー|呪文)を〔代替([lwdfn]+)(\d+)〕支払って(召喚して|唱えて)もよい。?$/);
      if (mal) {
        const CV = { l: 'light', w: 'water', d: 'darkness', f: 'fire', n: 'nature' };
        (inHyper ? hyper.kw : kw).altPay = { cost: +mal[4], civs: [...new Set(mal[3].split(''))].map((x) => CV[x]), then: [], text: '', manaGE: +mal[1] };
        continue;
      }
      if (/^フリーズ\s*$/.test(line)) {
        A_PUSH('unblocked', { when: 'unblocked', acts: [{ act: 'tap', side: 'opp', all: false, n: 1, optional: true }, { act: 'freezeLast' }], text: raw });
        continue;
      }
      const bwd = line.match(/^このクリーチャーがバトルに勝った(時|とき)、破壊する。?(その後、(.+))?$/);
      if (bwd) {
        const more = bwd[3] ? parseEffects(bwd[3].replace(/。$/, '')) : [];
        if (more && !more.some((x) => x.act === 'manualNote')) {
          A_PUSH('battleWin', { when: 'battleWin', acts: [{ act: 'selfDestroy', optional: false }, ...more], text: raw });
          continue;
        }
      }
      // 返霊・マーシャル・タッチ：次の行が「このクリーチャーの能力」
      if (markAb) {
        line = line.replace(/^[a-zA-Z]{1,2}\s*(?=[^\x00-\x7f])/, '');
        const body = parseEffects(line.replace(/。$/, ''));
        const mk = markAb;
        markAb = null;
        if (body && !body.some((x) => x.act === 'manualNote')) {
          A_PUSH(mk.when, { when: mk.when, acts: [{ act: 'ifDo', optional: true, first: mk.first, acts: body, text: mk.text }], text: mk.text + ' / ' + raw });
          continue;
        }
      }
      let rm;
      if ((rm = line.match(/^返霊\s*(\d+)\s*$/))) {
        markAb = { when: 'attack', first: { act: 'graveToDeckBottomN', n: +rm[1] }, text: `返霊${rm[1]}：墓地から${rm[1]}枚を山札の下に置く` };
        continue;
      }
      if (/^マーシャル・タッチ\s*$/.test(line)) {
        markAb = { when: 'summon', first: { act: 'bounceOwnOther' }, text: 'マーシャル・タッチ：自分の他のクリーチャーを1体手札に戻す' };
        continue;
      }
      if (/^連鎖\s*$/.test(line)) {
        A_PUSH('summon', { when: 'summon', acts: [{ act: 'chainTop' }], text: raw });
        continue;
      }
      if (/^ロスト・プリズム\s*$/.test(line)) {
        A_PUSH('summon', { when: 'summon', acts: [{ act: 'revealMultiToHand' }], text: raw });
        continue;
      }
      if (/^リサイクル\s*[：:]?\s*$/.test(line)) {
        const vm = raw.match(/〔代替([lwdfnc]+)(\d+)〕|\[([lwdfnc]+)(\d+)\]|コスト(\d+)を支払って/);
        const rc = vm ? +(vm[2] || vm[4] || vm[5]) : +def.cost || 0;
        (inHyper ? hyper.kw : kw).recycle = { cost: rc };
        continue;
      }
      // 呪文の「このターンの終わりに、○○」
      const eot = def.type === 'spell' && line.match(/^(この|その)ターンの終わりに、(.+)$/);
      if (eot) {
        const body = parseEffects(eot[2].replace(/。$/, ''));
        if (body && !body.some((x) => x.act === 'manualNote')) {
          A_PUSH('cast', { when: 'cast', acts: [{ act: 'atEndOfTurn', acts: body }], text: raw });
          continue;
        }
      }
      // 侍流ジェネレート：出た時、手札のクロスギアをコストなしでジェネレート
      if (/^侍流ジェネレート\s*$/.test(line)) {
        A_PUSH('summon', { when: 'summon', acts: [{ act: 'generateFromHand', optional: true }], text: raw });
        continue;
      }
      // リンクしている時の能力
      line = line.replace(/^このクリーチャーは、?リンクしている(時|間)、?(「)/, 'このクリーチャーがリンクしている間、このクリーチャーは$2').replace(/^このクリーチャーは、?リンクしている(時|間)、/, 'このクリーチャーがリンクしている間、');
      // 「この呪文を〔代替〕支払って唱えてもよい。そうしたら、○○」
      const alp = line.match(/^この(呪文|クリーチャー)を〔代替([lwdfn]+)(\d+)〕支払って(唱えて|召喚して)もよい。((そうしたら|そうした場合)、(.+))?$/);
      if (alp) {
        const then = alp[7] ? parseEffects(alp[7].replace(/。$/, '')) : [];
        if (then && !then.some((x) => x.act === 'manualNote')) {
          const CV = { l: 'light', w: 'water', d: 'darkness', f: 'fire', n: 'nature' };
          (inHyper ? hyper.kw : kw).altPay = { cost: +alp[3], civs: [...new Set(alp[2].split(''))].map((x) => CV[x]), then, text: alp[7] || '' };
          continue;
        }
      }
      // 「このクリーチャーを召喚する時、○○してもよい。そうしたら、このクリーチャーの召喚コストをN少なくする」
      const sco = line.match(/^このクリーチャーを召喚する(時|とき)、(.+?)てもよい。(そうしたら|そうした場合)、このクリーチャーの召喚コストを(\d+)少なくする。?$/);
      if (sco) {
        const first = parseEffect(sco[2] + 'てもよい');
        if (first && first.act !== 'manualNote') {
          (inHyper ? hyper.kw : kw).summonCostOpt = { act: { ...first, optional: false }, n: +sco[4], text: sco[2] };
          continue;
        }
      }
      // タップ能力：「このクリーチャーで攻撃するかわりに、タップして（次の）能力を使ってもよい」
      const tapAb = line.match(/^このクリーチャーで攻撃するかわりに、(このクリーチャーと自分のマナゾーンのタップされていないカードを(\d+)枚)?タップして(、)?(次の|その)?\s*([a-z]\s*)?能力を使ってもよい。?\s*(.*)$/);
      if (tapAb) {
        kw.tapAbility = { mana: tapAb[2] ? +tapAb[2] : 0 };
        const rest = (tapAb[6] || '').replace(/^[a-z]\s+/, '').trim();
        if (rest) {
          const acts = parseEffects(rest);
          if (acts) abilities.push({ when: 'tapAbility', acts, text: raw });
          else manual.push(raw);
        } else tapNext = true;
        continue;
      }
      if (tapNext) {
        tapNext = false;
        const acts = parseEffects(line.replace(/^[a-z]\s+/, ''));
        if (acts) {
          abilities.push({ when: 'tapAbility', acts, text: raw });
          continue;
        }
      }
      // 選択肢つきの能力（「次の中から1つ選ぶ」＋ ▶ の行）
      const useN = rawObj.opts && rawObj.opts.length === 1 && line.match(/^(.*?)次の能力を(\d+)回(まで)?使う。?$/);
      if (useN) {
        const inner = parseEffects(stripReminder(rawObj.opts[0]).replace(/。$/, ''));
        let whens2 = [];
        for (const t of TRIGGERS) if (t.re.test(line)) whens2 = [t.when];
        if (!whens2.length) {
          const th = parseTriggerHead(line);
          if (th) whens2 = th.whens;
        }
        if (!whens2.length && def.type === 'spell') whens2 = ['cast'];
        if (inner && whens2.length) {
          const reps = [];
          for (let i = 0; i < +useN[2]; i++) reps.push({ act: 'repeatAsk', i, upTo: !!useN[3], acts: inner });
          for (const w of whens2) A_PUSH(w, { when: w, acts: reps, text: raw });
          continue;
        }
      }
      const inline = !rawObj.opts && line.match(/^(.*?)(次の(中|うち)から|以下から)?(\d+|いずれか1|好きな数|いくつでも)(回|つ)?選ぶ[。：:]\s*(.+)$/);
      if (rawObj.opts || (inline && /[／/]/.test(inline[6]))) {
        const head = rawObj.opts ? line : inline[1] + '選ぶ';
        const optTexts = rawObj.opts || inline[6].split(/[／/]/);
        let whens = [];
        if (/^このクリーチャーが(バトルゾーンに)?出た時(、)?(または|か|、)攻撃する時、/.test(head)) whens = ['summon', 'attack'];
        else for (const t of TRIGGERS) if (t.re.test(head)) whens = [t.when];
        if (!whens.length && def.type === 'spell') whens = ['cast'];
        if (!whens.length) {
          // いつ使うか分からない選択肢は手動扱い
          manual.push(raw);
          continue;
        }
        const cm = (rawObj.opts ? head : line).match(/(\d+)(回|つ)選ぶ/);
        const count = /好きな数|いくつでも/.test(line) ? 'any' : cm ? +cm[1] : 1;
        const repeat = /同じものを(選んでも|何度)|同じ(もの|選択肢)を2回/.test(raw + (rawObj.opts || []).join(''));
        const bothLine = [raw, ...(rawObj.opts || []), rawObj.bothNote || ''].find((x) => /両方|すべて選んでもよい|全部選/.test(x)) || '';
        const bc = bothLine.match(/(光|水|闇|火|自然)(と|、)(光|水|闇|火|自然)/);
        const bcnt = bothLine.match(/(バトルゾーンに)?自分の([^、。()（）]+?)があれば/);
        const bothCond = bothLine ? { civs: bc ? [CIVJ[bc[1]], CIVJ[bc[3]]] : [], count: !bc && bcnt ? { what: bcnt[2], n: 1 } : null, text: bothLine } : null;
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
      const cmp = [
        [/自分のシールドの数が相手より多ければ、/, { shieldsMore: true }],
        [/バトルゾーンにある自分のクリーチャーの数が相手より多ければ、/, { creaturesMore: true }],
        [/相手のマナゾーンにあるカードの(数|枚数)が自分のより多ければ、/, { oppManaMore: true }],
        [/自分のシールドが(\d+)(枚|つ)以下(であれば|の時|なら)、/, (m) => ({ shieldsLE: +m[1] })],
        [/^(バトルゾーンに)?自分の([^、。]+?)が1(体|つ|枚)でもあれば、/, (m) => ({ count: { what: m[2], n: 1 } })],
        [/^バトルゾーンに自分の([^、。]+?)がある間、/, (m) => ({ count: { what: m[1], n: 1 } })],
        [/自分のシールドが(\d+)(枚|つ)以上あれば、/, (m) => ({ shieldsGE: +m[1] })],
        [/バトルゾーンに自分のパワー(\d+)以上のクリーチャーがあれば、/, (m) => ({ powerGE: +m[1] })],
      ];
      for (const [re, v] of cmp) {
        const mm = line.match(re);
        if (mm) {
          cond = { ...(cond || {}), ...(typeof v === 'function' ? v(mm) : v) };
          line = line.replace(mm[0], '');
        }
      }
      const cc = line.match(/(バトルゾーンに)?自分の([^、。]+?)が(\d+)(体|枚|つ)以上あれば、/);
      if (cc && !/マナゾーンに/.test(cc[0]) && !/異なる$/.test(line.slice(0, cc.index))) {
        cond = { ...(cond || {}), count: { what: cc[2], n: +cc[3] } };
        line = line.replace(cc[0], '');
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
      // 条件を外した後の「このクリーチャーのパワーは+Nされ、「○○」を得る」
      // 条件つきの召喚コスト軽減（マナ武装以外も）
      const scm = cond && line.match(/^このクリーチャー(の召喚コスト|を召喚するコスト)(を(\d+)少なくする|は(\d+)少なくなる)。?$/);
      if (scm) {
        (K.selfCostIf = K.selfCostIf || []).push({ cond, n: +(scm[3] || scm[4]) });
        continue;
      }
      // 条件つきで、キーワードの文（「このクリーチャーは破壊されない」「相手は呪文を唱えられない」など）を得る
      if (cond && Kd) {
        const kh = Kd.match(line.replace(/。$/, ''), raw);
        if (kh && kh.e.auto) {
          (K.condGrants = K.condGrants || []).push({ cond, power: 0, names: [line.replace(/。$/, '')] });
          continue;
        }
      }
      if (cond) {
        const ppc = line.match(/^このクリーチャーのパワー(を|は)(、)?(自分の)?(墓地|マナゾーン)にある([^、。]*?)(\d+)(枚|体|つ)につき\+(\d+)(する|される)。?$/);
        if (ppc) {
          (K.condPowerPers = K.condPowerPers || []).push({ cond, zone: ppc[4] === '墓地' ? 'grave' : 'mana', what: ppc[5].replace(/の$/, ''), per: +ppc[6], n: +ppc[8] });
          continue;
        }
        const pg2 = line.match(/^このクリーチャー(は|の|に)(、)?(パワーは\+(\d+)され(、|る)|パワーを\+(\d+)(する|し、))?(「(.+?)」(と「(.+?)」)?を(得る|与える))?。?$/);
        if (pg2 && (pg2[4] || pg2[6] || pg2[9])) {
          (K.condGrants = K.condGrants || []).push({ cond, power: +(pg2[4] || pg2[6] || 0), names: [pg2[9], pg2[11]].filter(Boolean) });
          continue;
        }
      }
      const upp = line.match(/^このクリーチャーのパワー(を|は)(、)?(自分の)?(墓地|マナゾーン)にある([^、。]*?)(\d+)(枚|体|つ)につき\+(\d+)(する|される)。?$/);
      if (upp) {
        (K.condPowerPers = K.condPowerPers || []).push({ cond: {}, zone: upp[4] === '墓地' ? 'grave' : 'mana', what: upp[5].replace(/の$/, ''), per: +upp[6], n: +upp[8] });
        continue;
      }
      // 「条件、このクリーチャーのパワーは、墓地の○○1枚につき+N」
      const gpp = line.match(/^([^。]+?(あれば|なら|いれば|中|間))、このクリーチャーのパワー(を|は)(、)?(自分の)?(墓地|マナゾーン)にある([^、。]*?)(\d+)(枚|体|つ)につき\+(\d+)(する|される)。?$/);
      if (gpp && parseCondText(gpp[1])) {
        (K.condPowerPers = K.condPowerPers || []).push({ cond: parseCondText(gpp[1]), zone: gpp[6] === '墓地' ? 'grave' : 'mana', what: gpp[7].replace(/の$/, ''), per: +gpp[8], n: +gpp[10] });
        continue;
      }
      // 「条件、（キーワードの文）」
      const gk = line.match(/^([^。]+?(あれば|なければ|なら|ならば|いれば|である間|ある間|の間|中|間))、([^、。][^。]*?)。?$/);
      if (gk && Kd) {
        const pc = parseCondText(gk[1]);
        const kh = pc && Kd.match(gk[3], raw);
        if (kh && kh.e.auto) {
          (K.condGrants = K.condGrants || []).push({ cond: pc, power: 0, names: [gk[3]] });
          continue;
        }
        const scm2 = pc && gk[3].match(/^このクリーチャー(の召喚コスト|を召喚するコスト)(を(\d+)少なくする|は(\d+)少なくなる)$/);
        if (scm2) {
          (K.selfCostIf = K.selfCostIf || []).push({ cond: pc, n: +(scm2[3] || scm2[4]) });
          continue;
        }
      }
      // 条件つきで「このクリーチャーは（パワー+Nし、）「○○」を得る」
      let cg = line.match(/^(.+?)(あれば|なければ|なら|もなければ|中|間|ある時|する時|するとき)、このクリーチャー(は|に|の)(、)?(パワーを\+(\d+)し、|パワーは\+(\d+)され、)?「(.+?)」(と「(.+?)」)?を(得る|与える)。?$/);
      if (!cg) {
        const pw = line.match(/^(.+?)(あれば|なければ|なら|もなければ|中|間|ある時|する時|するとき)、このクリーチャーの?パワー(を\+(\d+)する|は\+(\d+)される)。?$/);
        if (pw) cg = [pw[0], pw[1], pw[2], '', '', '', pw[4], pw[5], null, null, null];
      }
      if (!cg) {
        const pw = line.match(/^(.+?)(あれば|なければ|なら|もなければ|中|間)、このクリーチャーの?パワーを\+(\d+)し、「(.+?)」(と「(.+?)」)?を与える。?$/);
        if (pw) cg = [pw[0], pw[1], pw[2], '', '', '', pw[3], null, pw[4], null, pw[6]];
      }
      if (cg) {
        const ct = cg[1] + cg[2];
        const c2 = {};
        let mm;
        if (/^自分のターン中$/.test(ct)) c2.myTurn = true;
        else if (/^相手のターン中$/.test(ct)) c2.oppTurn = true;
        else if (/^バトル中$/.test(ct)) c2.inBattle = true;
        else if ((mm = ct.match(/^(.+?)とバトル(中|する(時|とき))$/))) c2.inBattle = { vs: mm[1] };
        else if ((mm = ct.match(/^コスト(\d+)以下のクリーチャーとバトル中$/))) c2.inBattle = { maxCost: +mm[1] };
        else if ((mm = ct.match(/^自分のマナゾーンにカードが(\d+)枚以上あれば$/))) c2.manaGE = +mm[1];
        else if ((mm = ct.match(/^自分の手札が(\d+)枚以下なら$/))) c2.handLE = +mm[1];
        else if (/^バトルゾーンにある相手のクリーチャーがすべてタップしていれば$/.test(ct)) c2.oppAllTapped = true;
        else if ((mm = ct.match(/^相手の(.+?)がバトルゾーンにある時$/))) c2.oppHas = mm[1];
        else if ((mm = ct.match(/^(バトルゾーンに)?自分の(他の)?([^、。]+?)が(\d+)(体|つ|枚)以下なら$/))) c2.countLE = { what: mm[3], n: +mm[4], others: !!mm[2] };
        else if ((mm = ct.match(/^(バトルゾーンに)?自分の(他の)?([^、。]+?)が(\d+)(体|つ|枚)以上(バトルゾーンに)?あれば$/))) c2.count = { what: mm[3].replace(/^名前に《(.+?)》を持つ/, '$1'), n: +mm[4], others: !!mm[2] };
        else if ((mm = ct.match(/^(バトルゾーンに)?自分の(他の)?([^、。]+?)があれば$/)) && !/シールド|マナ|手札|墓地/.test(mm[3])) c2.count = { what: mm[3], n: 1, others: !!mm[2] };
        else if ((mm = ct.match(/マナ武装\s*(\d+)[：:]\s*自分のマナゾーンに(光|水|闇|火|自然)のカードが(\d+)枚以上あれば/))) Object.assign(c2, { manaCiv: CIVJ[mm[2]], n: +mm[3] });
        else if ((mm = ct.match(/自分のシールドが(\d+)(つ|枚)以上あれば/))) c2.shieldsGE = +mm[1];
        else if ((mm = ct.match(/自分のシールドが(\d+)(つ|枚)もなければ/))) c2.shieldsLE = +mm[1] - 1;
        else if ((mm = ct.match(/(バトルゾーンに)?自分のクリーチャーが(\d+)体以上あれば/))) c2.count = { what: 'クリーチャー', n: +mm[2] };
        else if ((mm = ct.match(/自分のシールドゾーンに表向きのカードが(\d+)枚以上あれば/))) c2.faceUpShieldsGE = +mm[1];
        else if (/自分のシールドの数が相手より多ければ/.test(ct)) c2.shieldsMore = true;
        else if (/バトルゾーンにある自分のクリーチャーの数が相手より多ければ/.test(ct)) c2.creaturesMore = true;
        else {
          const pc = parseCondText(ct);
          if (pc) Object.assign(c2, pc);
          else c2.unknown = true;
        }
        if (!c2.unknown) {
          (K.condGrants = K.condGrants || []).push({ cond: c2, power: +(cg[6] || cg[7] || 0), names: [cg[8], cg[10]].filter(Boolean) });
          continue;
        }
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
      const allyEv = line.match(/^(各ターン、はじめて)?自分の(他の)?([^、]{1,24}?)が(攻撃する|離れた|破壊された)(時|とき)、/);
      if (allyEv && !/^このクリーチャー/.test(line) && !/この|ターン/.test(allyEv[3])) {
        const what = allyEv[3].replace(/(・)?クリーチャー$/, '').replace(/^クリーチャー$/, '');
        const actsE = parseEffects(line.replace(allyEv[0], ''));
        if (actsE) {
          A.push({ when: allyEv[4] === '攻撃する' ? 'allyAttack' : allyEv[4] === '破壊された' ? 'allyDestroyed' : 'allyLeft', acts: actsE, ally: { race: what || null, others: !!allyEv[2], perTurn: allyEv[1] ? 1 : 0 }, text: raw });
          continue;
        }
      }
      const ally = line.match(/^(各ターンに(\d+)度、)?自分の(他の)?([^、]{1,24}?)が(バトルゾーンに)?出た(時|とき)、/);
      if (ally && !/^このクリーチャー/.test(line) && !/この|ターン/.test(ally[4])) {
        const what = ally[4].replace(/(・)?クリーチャー$/, '').replace(/^クリーチャー$/, '');
        const actsA = parseEffects(line.replace(ally[0], ''));
        if (actsA) {
          A.push({ when: 'allyEnter', acts: actsA, ally: { race: what || null, others: !!ally[3] || true, perTurn: ally[2] ? +ally[2] : 0 }, text: raw });
          continue;
        }
      }
      const both = line.match(/^このクリーチャーが(バトルゾーンに)?出た時(、)?(または|か|、)攻撃する時、/);
      const atkBlk = line.match(/^このクリーチャーが攻撃(する時)?(または|か|、)ブロックした時、/);
      const evoBoth = line.match(/^このクリーチャーが、?進化して出た時、?(または|か)進化元になる時、/);
      const sumUntap = line.match(/^このクリーチャーが(召喚によって)?出た時、?(または)(自分のターンのはじめに)?アンタップした時、/);
      if (both) {
        whens = ['summon', 'attack'];
        body = line.replace(both[0], '');
      } else if (atkBlk) {
        whens = ['attack', 'block'];
        body = line.replace(atkBlk[0], '');
      } else if (evoBoth) {
        whens = ['summon', 'evolveSource'];
        body = line.replace(evoBoth[0], '');
      } else if (sumUntap) {
        whens = [sumUntap[1] ? 'summonOnly' : 'summon', 'untapped'];
        body = line.replace(sumUntap[0], '');
      } else {
        for (const t of TRIGGERS) {
          if (t.re.test(line)) {
            whens = [t.when];
            body = line.replace(t.re, '');
            break;
          }
        }
      }
      if (!whens.length) {
        const th = parseTriggerHead(line);
        if (th) {
          whens = th.whens;
          body = th.rest;
          if (Object.keys(th.cond).length) cond = { ...(cond || {}), ...th.cond };
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
      let acts = seal ? [{ act: 'seal', n: +seal[1] }] : parseEffects(body);
      if (!acts && !seal) {
        const th2 = parseTriggerHead(line);
        const a2 = th2 && parseEffects(th2.rest);
        if (a2) {
          acts = a2;
          whens = th2.whens;
          if (Object.keys(th2.cond).length) cond = { ...(cond || {}), ...th2.cond };
        }
      }
      if (acts) for (const w of whens) A.push({ when: w, acts, cond, text: raw, fromGrave: JSON.stringify(acts).includes('"selfFromGrave"') });
      else {
        manual.push(raw);
        if (Kd) for (const e of Kd.mentions(line)) known.push({ name: e.name, desc: e.desc, text: raw });
      }
    }
    // パワーアタッカー・ブレイカーなどの初期値
    applyLink();
    for (const ab of abilities) if (FROM_HAND(ab.acts) || (ab.modal && ab.modal.options.some((o) => FROM_HAND(o.acts)))) ab.fromHand = true;
    return { kw, abilities, manual, known, hyper: hyperUsed ? hyper : null };
  }

  const ZONE_JA = { mana: 'マナ', shields: 'シールド', hand: '手札', deckBottom: '山札の下', grave: '墓地' };
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
    lookTop: (a) => `山札の上から${a.n}枚${a.reveal ? '表向き' : '見る'}→${a.cond.text || 'カード'}を${a.take === 'all' ? 'すべて' : a.take + (a.upTo ? 'まで' : '')}${{ hand: '手札', battle: '場', mana: 'マナ', grave: '墓地', shields: 'シールド' }[a.dest]}へ・残り${{ deckBottom: '山札の下', grave: '墓地', mana: 'マナ', hand: '手札', deckTop: '山札の上' }[a.rest]}`,
    mekuraid: (a) => `${a.race ? a.race + '・' : ''}メクレイド${a.n}`,
    fight: () => '相手1体とバトル',
    ownShieldToGrave: (a) => `自分のシールド${a.n}つを墓地へ`,
    shieldToDeckDraw: (a) => `シールド${a.n}枚を山札の下へ→${a.draw}枚ドロー`,
    protectDestroy: (a) => `自分の${a.n}体を次のターンまで破壊されなくする`,
    teamTempPower: (a) => `次のターンまで自分の${a.others ? '他の' : ''}クリーチャーのパワー+${a.n}`,
    untapAtEnd: (a) => `ターンの終わりに自分の${a.n}体をアンタップ`,
    drawPer: (a) => `${a.what}${a.per}つにつき${a.n}枚ドロー`,
    revealTop: (a) => `山札の上を表向き→${a.cond.text}なら出す`,
    untapAll: (a) => `自分の${a.nameHas ? '《' + a.nameHas + '》' : a.race || ''}クリーチャーをすべてアンタップ`,
    manaToGrave: (a) => `マナから${a.n}枚墓地へ`,
    selfToGrave: () => 'このカードを墓地へ',
    shuffleDeck: () => '山札をシャッフル',
    searchDeck: (a) => `山札から${a.cond.text}を${a.n}枚${{ hand: '手札へ', battle: '出す', mana: 'マナへ', grave: '墓地へ', shields: 'シールドへ' }[a.dest] || ''}→シャッフル`,
    arrangeTop: (a) => `山札の上${a.n}枚を見て${{ both: '上か下', bottom: '下', top: '上' }[a.where]}に好きな順で置く`,
    topCheck: (a) => `山札の上を${a.reveal ? '表向き' : '見る'}→${a.text}なら${{ hand: '手札へ', battle: '出す', mana: 'マナへ', grave: '墓地へ', cast: '唱える' }[a.then]}${a.else && a.else !== 'deckTop' ? '、違えば' + { deckBottom: '山札の下', grave: '墓地', mana: 'マナ', hand: '手札' }[a.else] : ''}`,
    selfDestroy: () => 'このカードを破壊',
    freezeAll: (a) => `相手の${a.tappedOnly ? 'タップしている' : ''}クリーチャーは次のターンのはじめにアンタップしない`,
    grantLast: (a) => `そのクリーチャーに${a.names.map((x) => '「' + x + '」').join('と')}（${a.until === 'next' ? '次のターンまで' : 'このターン'}）`,
    guardLast: (a) => `そのクリーチャーは${a.kind === 'noLeave' ? '離れない' : '破壊されない'}（${a.until === 'next' ? '次のターンまで' : 'このターン'}）`,
    untapLast: () => 'そのクリーチャーをアンタップ',
    endTurnLast: (a) => `ターンの終わりにそのクリーチャーを${{ destroy: '破壊', hand: '手札へ', deckBottom: '山札の下へ', mana: 'マナへ' }[a.to]}`,
    tapOwnCost: (a) => `自分の${a.who || 'クリーチャー'}を${a.n}体タップ`,
    topHandOrMana: () => '山札の上1枚を見て手札かマナへ',
    oppMill: (a) => `相手の山札の上${a.n}枚を墓地へ`,
    selfToHand: () => 'このクリーチャーを墓地から手札へ',
    graveToDeck: () => '墓地を山札に戻してシャッフル',
    underToHand: () => '下にあったカードを手札へ',
    moveTarget: (a) => `${{ opp: '相手の', self: '自分の', any: '' }[a.side]}${a.all ? 'すべて' : a.n + '枚'}を${{ grave: '墓地', mana: 'マナ', shields: 'シールド', deckBottom: '山札の下' }[a.to]}へ`,
    handToMana: (a) => `手札${a.n}枚をマナへ`,
    oppTeamPower: (a) => `相手のクリーチャーすべてのパワー${a.n}`,
    untapManaN: (a) => `マナ${a.n}枚アンタップ`,
    castFromGrave: (a) => `墓地から呪文を${a.n}枚コストなしで唱える`,
    putFromMana: (a) => `マナから${a.cond.text}を${a.n}体出す`,
    selfFromHand: () => 'このクリーチャーを手札から出す',
    selfDiscardFromHand: () => 'このカードを手札から捨てる',
    tempTapDraw: () => '次のターンまで、自分のクリーチャーがタップしたら1枚引ける',
    tempBigBottom: () => '次のターンまで、相手が重いクリーチャーを出したら山札の下へ',
    nextCostDiscount: (a) => `次に使うカードのコストを${a.n}下げる`,
    ifNotDidPrev: (a) => 'しなければ：' + a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、'),
    toShieldAllDraw: (a) => `相手のパワー${a.maxPower}以下をすべてシールド化し、その数だけ引く`,
    breakBothOne: () => '自分と相手のシールドを1つずつブレイク',
    atNextTurnStart: () => '次の自分のターンのはじめに処理',
    stackSelfOnShield: () => 'このカードをシールドの上に表向きで置く',
    stackOppOnShield: (a) => `相手のクリーチャー${a.n}体を持ち主のシールドの上に表向きで置く`,
    discardDrawPlus: (a) => `手札を${a.n}枚まで捨て、捨てた数+${a.plus}枚引く`,
    gearToGrave: (a) => `クロスギアを${a.n}枚墓地へ`,
    oppManaToGrave: (a) => `相手のマナを${a.n}枚墓地へ`,
    tempBreakExtra: (a) => `このターン、シールドをさらに${a.n}つブレイク`,
    tempBreakExtraLast: (a) => `このターン、そのクリーチャーはシールドをさらに${a.n}つブレイク`,
    selfFromHandOrGrave: () => '手札か墓地からこのクリーチャーを出す',
    oppShieldTo: (a) => `相手のシールドを${a.n}つ${a.to === 'grave' ? '墓地' : 'マナ'}へ`,
    teamNoAttackOthers: () => 'このターン、自分の他のクリーチャーは攻撃できない',
    fightEvent: () => 'そのクリーチャーとバトル',
    breakOwn: (a) => `自分のシールドを${a.n}つブレイク`,
    discardAllBoth: () => '各プレイヤーは手札をすべて捨てる',
    untapAfterAttackSelf: () => '攻撃の後アンタップ',
    repeatBuzz: () => 'バズレンダの能力（支払った回数＋1回）',
    graveAllToDeck: () => '墓地をすべて山札に戻してシャッフル',
    resetHands: (a) => `各プレイヤーは手札と墓地を山札に戻し${a.n}枚引く`,
    hyperSummonN: (a) => `超次元ゾーンからコスト${a.n}以下を召喚`,
    revealSort: (a) => `山札の上${a.n}枚を表向きにし振り分け`,
    chainTop: () => '連鎖：山札の上がコストの小さいクリーチャーなら出す',
    revealMultiToHand: () => 'ロスト・プリズム：山札の上が多色なら手札へ',
    graveToDeckBottomN: (a) => `墓地から${a.n}枚を山札の下へ`,
    bounceOwnOther: () => '自分の他のクリーチャーを手札に戻す',
    atEndOfTurn: () => 'ターンの終わりに処理',
    generateFromHand: () => '手札のクロスギアをコストなしでジェネレート',
    graveAnyToMana: (a) => `墓地の${a.cond.text}を好きな数マナへ`,
    moveEvent: (a) => `それを${ZONE_JA[a.to] || a.to}へ`,
    putSumCost: (a) => `${a.from === 'grave' ? '墓地' : '手札'}からコスト合計${a.max}以下で好きな数出す`,
    lastAtEnd: (a) => `ターンの終わりにそれを${{ destroy: '破壊', hand: '手札へ', deckBottom: '山札の下へ' }[a.to]}`,
    payThen: (a) => `コスト${a.cost}を支払って：` + a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、'),
    asOpp: (a) => '相手が：' + a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、'),
    repeatAsk: (a) => `（${a.i + 1}回目）` + a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、'),
    lookSplit: (a) => `山札の上${a.n}枚を見て${a.dests.map((d) => ({ hand: '手札', mana: 'マナ', grave: '墓地', shields: 'シールド' }[d])).join('・')}へ1枚ずつ`,
    revealUntil: (a) => `${a.cond.text}が${a.n}体出るまで山札をめくって出す`,
    oppReanimateAny: () => '相手も墓地から好きな数出す',
    oppManaShieldToGrave: (a) => `相手はマナかシールドを合計${a.n}枚墓地へ`,
    eachPlayerToMana: () => '各プレイヤーのエレメント1つまでをマナへ',
    skipRestOfTurn: () => 'ターンの残りをとばす',
    pairPick: () => '自分と相手のクリーチャーを1体ずつ選ぶ',
    oppHandToShield: (a) => `相手は手札${a.n}枚をシールド化`,
    useEtbOfLast: () => '捨てたカードの「出た時」の能力を使う',
    lastDiscardToBattle: () => '捨てたカードを墓地から出す',
    grantEndLast: (a) => `そのクリーチャーに${a.names.map((x) => '「' + x + '」').join('')}・ターンの終わりに破壊`,
    seq: (a) => a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、'),
    oppOwnTo: (a) => `相手は自分のクリーチャー${a.n}体をマナへ`,
    cancelAttack: () => '攻撃を中止',
    groupGrant: (a) => `それらに${a.names.map((x) => '「' + x + '」').join('')}`,
    tapOppMana: (a) => `相手のマナ${a.n}枚タップ`,
    freezeLastMana: () => 'それは次のターンまでアンタップしない',
    ifDidPrev: (a) => `そうしたら：${a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、')}`,
    handToDeckBottom: (a) => `手札${a.n}枚を山札の下へ`,
    manaAllToHand: () => 'マナの該当カードをすべて手札へ',
    selfFromGrave: () => 'このクリーチャーを墓地から出す',
    reviveAtEnd: () => 'ターンの終わりに墓地から出す',
    evolveOnSelf: () => '手札からこのクリーチャーの上に進化',
    oppPutBottom: (a) => `相手は自分のカード${a.n}枚を山札の下へ`,
    destroyEvent: () => 'そのクリーチャーを破壊',
    graveBottomPick: () => '墓地のカードを好きな数、山札の下へ',
    noop: () => '',
    ifLastDiscard: (a) => `捨てたカードが${a.text}なら：${a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、')}`,
    untapAfterAttackLast: () => 'そのクリーチャーの最初の攻撃の終わりにアンタップ',
    groupGrantEnd: (a) => `出したクリーチャーに${a.names.map((x) => '「' + x + '」').join('')}、ターンの終わりに破壊`,
    destroySum: (a) => `相手のクリーチャーを${a.stat === 'power' ? 'パワー' : 'コスト'}の合計${a.max === 'discard' ? '（捨てたカードのコスト）' : a.max}以下になるよう破壊`,
    perCount: (a) => `${a.what}${a.per}つにつき：${ACT_LABEL[a.inner.act] ? ACT_LABEL[a.inner.act](a.inner) : a.inner.act}`,
    showOwn: (a) => `手札の${a.cond.text}を${a.n}枚見せる`,
    tapManaCost: (a) => `マナを${a.n}枚タップ`,
    underToGrave: (a) => `下のカード${a.n}枚を墓地へ`,
    destroyOwn: (a) => `自分の${a.who || 'クリーチャー'}を${a.n}つ破壊`,
    teamBuff: (a) => `${a.until === 'turn' ? 'このターン' : '次のターンまで'}、自分の${a.who || ''}クリーチャー${a.all ? 'すべて' : a.n + '体'}${a.power ? 'のパワー+' + a.power : ''}${a.names.length ? '・' + a.names.map((x) => '「' + x.slice(0, 12) + '」').join('') : ''}`,
    noLose: (a) => `${a.until === 'turn' ? 'このターン' : '次のターンまで'}負けない`,
    manaFaceDown: (a) => `マナ${a.n}枚を裏向きに`,
    shieldFaceDown: (a) => `表向きのシールド${a.n}枚を裏向きに`,
    shieldFaceUp: (a) => `シールド${a.n}つを表向きに`,
    flipSelf: () => '裏返す（覚醒・龍解）',
    grSummon: (a) => `GR召喚${a.n > 1 ? '×' + a.n : ''}`,
    hyperPut: (a) => `超次元ゾーンから${a.sumCost != null ? 'コスト合計' + a.sumCost + '以下' : (a.maxCost != null ? 'コスト' + a.maxCost + '以下の' : '') + a.n + '枚'}出す`,
    pickTarget: (a) => `${{ opp: '相手の', self: '自分の', any: '' }[a.side]}クリーチャーを${a.n}体選ぶ`,
    powerLast: (a) => `そのクリーチャーのパワー${a.n > 0 ? '+' : ''}${a.n}`,
    lockLast: () => 'そのクリーチャーは次のターンまで攻撃もブロックもできない',
    fightLast: () => 'このクリーチャーとそのクリーチャーをバトル',
    fightLastTwo: () => '選んだ2体をバトル',
    moveLast: (a) => `それを${{ grave: '墓地', hand: '手札', mana: 'マナ', deckShuffle: '山札（シャッフル）', deckBottom: '山札の下' }[a.to]}へ`,
    discardOwnAll: () => '自分の手札をすべて捨てる',
    pairFight: () => '自分と相手のクリーチャーを1体ずつバトル',
    ifCond: (a) => `${a.text}、${a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、')}`,
    lastIf: (a) => `それが${a.cond.text}なら${a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、')}`,
    ifDo: (a) => `${a.text}→そうしたら${a.acts.map((x) => (ACT_LABEL[x.act] ? ACT_LABEL[x.act](x) : x.act)).join('、')}`,
    lockCreature: (a) => `相手${a.n}体を次のターンまで攻撃・ブロック不可`,
    tempUnblockable: (a) => `自分${a.n}体をこのターンブロックされない`,
    oppLock: (a) => `${a.until === 'turn' ? 'このターン' : '次のターンまで'}相手は${a.maxCost ? 'コスト' + a.maxCost + '以下の' : ''}${a.spell ? '呪文を唱えられない' : 'クリーチャーを出せない'}`,
    discardAll: () => '相手の手札をすべて捨てさせる',
    revealHand: () => '相手の手札を見る',
    untapMana: () => 'マナをすべてアンタップ',
    teamWinTurn: () => 'このターン自分のクリーチャーはすべてのバトルに勝つ',
    turnGrant: (a) => `このターン自分の${a.n}体に${a.names.join('・')}`,
    extraTurn: () => '追加ターン',
    tempWinAll: (a) => `${a.until === 'turn' ? 'このターン' : '次のターンまで'}すべてのバトルに勝つ`,
    selfTempGrant: (a) => `次のターンまで${a.names.join('・')}`,
    protectOwn: (a) => `自分の${a.n}体を次のターンまで選ばれなくする`,
    tapSameName: () => '選んだクリーチャーと同名をすべてタップ',
    untapOwn: (a) => `自分のクリーチャー${a.n}体${a.optional ? 'まで' : ''}アンタップ`,
    summonLock: (a) => `相手は次のターンまでコスト${a.maxCost}以下を召喚できない`,
    summonFromShield: () => 'シールドから召喚',
    putFromHand: (a) => `手札から${a.maxCost ? 'コスト' + a.maxCost + '以下の' : ''}クリーチャーを${a.n}体出す`,
    castFromHand: (a) => `手札から${a.maxCost ? 'コスト' + a.maxCost + '以下の' : ''}呪文を${a.n}枚唱える`,
    tapOrUntap: (a) => `クリーチャー${a.n}体をタップかアンタップ`,
    tempGrant: (a) => `次のターンまで自分のクリーチャー${a.all ? 'すべて' : a.n + '体'}に${a.names.join('・')}`,
    manualNote: (a) => `［手動: ${String(a.text).slice(0, 16)}…］`,
    seal: (a) => `封印を${a.n}つ付ける`,
    freezeLast: () => 'それはアンタップしない',
    handToShield: (a) => `手札${a.n}枚をシールドに`,
    selfGuard: (a) => (a.kind === 'noLeave' ? '次のターンまで離れない' : '次のターンまで相手に選ばれない'),
    toShield: (a) => `相手の${a.n}${a.any ? 'つ' : '体'}をシールド化`,
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
  const whenLabel = (x) => (x.ally && WHEN_LABEL[x.when] ? WHEN_LABEL[x.when].replace('（指定の）クリーチャー', (x.ally.others ? '他の' : '') + (x.ally.race ? x.ally.race.replace(/(・)?クリーチャー$/, '') : 'クリーチャー')) + (x.ally.others ? '' : '（自身を含む）') : WHEN_LABEL[x.when]);
  const WHEN_LABEL = { allyCastCrest: '裁きの紋章を唱えた時', linked: 'リンクした時', oppEnterNonSummon: '相手が召喚以外でクリーチャーを出した時', enteredByChange: '革命チェンジ・侵略で出た時', allyEvolved: '自分の進化クリーチャーを置いた時', oppDiscarded: '相手が手札を捨てた時', graveLeft: 'カードが自分の墓地から離れた時', allyEnterAny: '自分のN体目のクリーチャーが出た時', selfPlay: 'コストN以上を使った時', selfDiscarded: '自分が手札を捨てた時', selfDraw: '自分がカードを引いた時', oppPlay: '相手がカードを使った時', oppEnterFree: '相手のクリーチャーがコストなしで出た時', oppShieldAdded: '相手のシールドが増えた時', oppEnterBig: '相手のマナより重いクリーチャーが出た時', allyDestroyed: '自分の（指定の）クリーチャーが破壊された時', toGrave: '墓地に置かれた時', hostDestroyed: '付けたクリーチャーが破壊された時', charged: 'マナに置いた時', hostAttack: '付けたクリーチャーの攻撃時', hostAttackEnd: '付けたクリーチャーの攻撃の終わり', eachTurnEnd: '各ターンの終わり', oppTurnEnd: '相手のターンの終わり', oppEnter: '相手のクリーチャーが出た時', anyEnter: '他のクリーチャーが出た時', anyDestroyed: 'クリーチャーが破壊された時', selfOrAllyDestroyed: '自分のクリーチャーが破壊された時', blocked: 'ブロックされた時', oppUnblocked: '相手の攻撃が通った時', battled: 'バトルした時', targeted: '選ばれた時', oppAttack: '相手の攻撃時', allyCast: '自分が呪文を唱えた時', oppCast: '相手が呪文を唱えた時', allyBattleWin: '自分の（指定の）クリーチャーがバトルに勝った時', oppDestroyed: '相手のクリーチャーが破壊された時', ownShieldLeft: 'シールドが離れた時', attackEnd: '攻撃の終わり', beforeBreak: 'ブレイクの前', unblocked: 'ブロックされなかった時', allyAttack: '自分の（指定の）クリーチャーが攻撃する時', allyLeft: '自分の（指定の）クリーチャーが離れた時', tapped: 'タップした時', untapped: 'アンタップした時', evolveSource: '進化元になる時', tapAbility: 'タップ能力', battleLose: 'バトルに負けた時', allyEnter: '自分の（指定の）クリーチャーが出た時', left: '離れた時', attacked: '攻撃された時', summonOnly: '召喚で出た時', summon: '出た時', attack: '攻撃時', destroyed: '破壊時', turnStart: 'ターン開始時', turnEnd: 'ターン終了時', shieldAdded: 'シールド追加時', cast: '呪文', block: 'ブロック時', battleWin: 'バトルに勝った時', oppTurnStart: '相手のターン開始時', broke: 'ブレイクした時' };

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
    if (k.tapAbility) out.push('タップ能力' + (k.tapAbility.mana ? `（マナ${k.tapAbility.mana}枚タップ）` : ''));
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
        ? `${whenLabel(x)}: 選択（${x.modal.count === 'any' ? '好きな数' : x.modal.count + (x.modal.repeat ? '回・重複可' : 'つ')}${x.modal.bothCond ? '・条件で全部' : ''}）` +
          x.modal.options.map((o) => '［' + (o.acts ? o.acts.map((a) => (ACT_LABEL[a.act] ? ACT_LABEL[a.act](a) : a.act)).join('→') : '手動') + '］').join('')
        : `${whenLabel(x)}: ` + (x.cond && x.cond.n != null ? `[マナに${x.cond.manaCiv ? civJ(x.cond.manaCiv) : ''}${x.cond.n}枚以上なら] ` : '') + x.acts.map((a) => (ACT_LABEL[a.act] ? ACT_LABEL[a.act](a) : a.act) + (a.optional ? '(任意)' : '')).join(' → ');
    for (const x of parsed.abilities) out.push(ab(x));
    if (parsed.hyper) {
      const hk = describe({ kw: parsed.hyper.kw, abilities: parsed.hyper.abilities });
      out.push(`ハイパーモード${k.hyperPower ? '(' + k.hyperPower + ')' : ''}: ${hk.join('・') || '—'}`);
    }
    return out;
  }

  G.TextParse = { parseCard, describe, normalize, parseEffects, parseTriggerHead, lookCond, parseCondText };
  if (typeof module !== 'undefined') module.exports = G.TextParse;
})(typeof globalThis !== 'undefined' ? globalThis : window);
