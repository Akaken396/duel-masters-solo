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
    { re: /^この(クリーチャー|タマシード|カード|城|G城)(が|を)(、)?(バトルゾーンに出た|バトルゾーンに出した|出た|召喚した|使った|進化して出た)(時|とき)、/, when: 'summon' },
    { re: /^このクリーチャーまたは自分の[^、]{1,20}が(バトルゾーンに)?出た(時|とき)、/, when: 'summon' },
    { re: /^このカードが表向きで自分のシールドゾーンに置かれた時(またはこのクリーチャーが出た時)?、/, when: 'summon' },
    { re: /^カードが表向きで自分のシールドゾーンに置かれた時、/, when: 'shieldAdded' },
    { re: /^このクリーチャーが攻撃する(時|とき)、/, when: 'attack' },
    { re: /^このクリーチャーの攻撃の終わりに、/, when: 'attackEnd' },
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
    if ((m = s.replace(/、?進化ではない、?/, '').match(/^(コスト(\d+)以下の)?(光|水|闇|火|自然)?の?(コスト(\d+)以下の)?(クリーチャー|タマシード)(または|か)?(クリーチャー|タマシード)?を(\d+)(体|つ|枚)(まで)?、?(自分の)?墓地から(バトルゾーンに)?出/))) {
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
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?(まで)?をシールド化(する|してもよい)|^自分の山札の上から(\d+)枚(目)?を(自分の)?シールドゾーンに(裏向きのまま)?(加える|置く)/))) {
      if (m[5]) m[4] = m[5];
      return { act: 'shieldAdd', n: +(m[1] || m[4]), optional };
    }
    if (/クリーチャー|エレメント/.test(s) && /破壊する$|破壊してもよい$/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'destroy', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, any: /エレメント/.test(s), ...targetFilter(s) };
    }
    if (/クリーチャー|エレメント/.test(s) && /(持ち主の)?山札の下に置く$|山札の下に置いてもよい$/.test(s) && !/墓地から|マナゾーンから/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'deckBottom', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, any: /エレメント/.test(s), ...targetFilter(s) };
    }
    if (/クリーチャー|エレメント/.test(s) && /(持ち主の)?マナゾーンに置く$|マナゾーンに置いてもよい$/.test(s) && !/山札の上|墓地から|手札から/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'toMana', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, any: /エレメント/.test(s), ...targetFilter(s) };
    }
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?を裏向きのまま、新しいシールドとして(自分の)?シールドゾーンに(加え|置)(る|く|てもよい)$/))) {
      return { act: 'shieldAdd', n: +m[1], optional: /てもよい/.test(s) };
    }
    if ((m = s.match(/^自分の手札を(\d+)枚(、)?裏向きのまま(、)?新しいシールドとして(自分の)?シールドゾーンに(加え|置)(る|く|てもよい)$/))) {
      return { act: 'handToShield', n: +m[1], optional: /てもよい/.test(s) };
    }
    if ((m = s.match(/^次の自分のターンのはじめまで、このクリーチャーは(相手に選ばれない|離れない)$/))) {
      return { act: 'selfGuard', kind: m[1] === '離れない' ? 'noLeave' : 'untargetable' };
    }
    if ((m = s.match(/^(バトルゾーンにある)?相手の(コスト(\d+)以下の)?(進化ではない)?(クリーチャー|エレメント)を(\d+)(体|つ)選び、(持ち主の)?シールド化(する|してもよい)$/))) {
      return { act: 'toShield', side: 'opp', n: +m[6], optional: /てもよい/.test(s), any: m[5] === 'エレメント', maxCost: m[3] ? +m[3] : null };
    }
    if ((m = s.match(/^自分のシールドを(\d+)つ(まで)?、?(選び、)?手札に加え(る|てもよい)(。ただし、その「S・トリガー」は使えない)?$/))) {
      return { act: 'shieldToHand', n: +m[1], optional: !!m[2] || /てもよい/.test(s), noTrigger: true };
    }
    if (/^自分は(、)?ゲームに負ける$/.test(s)) return { act: 'loseGame' };
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
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?を(、)?(裏向きのまま|裏向きにして|表向きにし|表向きにして)?(、)?(新しいシールドとして)?(、)?(自分の)?(シールド(ゾーン)?|シールド(\d+)つの上)に(表向きにして)?(加え|置)(る|く|てもよい)$/))) return { act: 'shieldAdd', n: +m[1], optional: /てもよい/.test(s) };
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?を表向きにして、?自分のシールド(\d+)つの上に置く$/))) return { act: 'shieldAdd', n: +m[1] };
    if (/^自分のシールドをすべて手札に加える(。ただし、その「S・トリガー」は使えない)?$/.test(s)) return { act: 'shieldToHand', n: 99, noTrigger: true };
    if ((m = s.match(/^自分のシールドを(\d+)(つ|枚)、?墓地に置く$/))) return { act: 'ownShieldToGrave', n: +m[1] };
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
    if (/^(この|その)ターン、この(進化した)?クリーチャーはすべてのバトルに勝つ$/.test(s)) return { act: 'tempWinAll', until: 'turn' };
    if (/^次の自分のターンのはじめまで、この(進化した)?クリーチャーはすべてのバトルに勝つ$/.test(s)) return { act: 'tempWinAll', until: 'next' };
    if ((m = s.match(/^次の自分のターンのはじめまで、この(進化した)?クリーチャーは「(.+?)」(と「(.+?)」)?を得(る)?$/))) return { act: 'selfTempGrant', names: [m[2], m[4]].filter(Boolean) };
    if (/^このクリーチャーはシールドを1つブレイクしてもよい$/.test(s)) return { act: 'breakShield', n: 1, optional: true };
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
    if (/クリーチャー|エレメント/.test(s) && /手札に戻す$|手札に戻してもよい$/.test(s) && !/墓地/.test(s) && !/マナ/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'bounce', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, any: /エレメント/.test(s), ...targetFilter(s) };
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
    if ((m = s.match(/^自分の山札の上から(\d+)枚(まで)?を?(自分の)?墓地に置(く|いてもよい)$/))) {
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

  // 「山札の上からN枚を見る／表向きにする。その中から○○を△に、残りを□に」
  const LOOK_RE = /^(自分の)?山札の上から(?<n>\d+)枚を(?<how>見る|表向きにする)。(その後、)?その中から(、)?((?<cond>[^。]+?)を)?(?<take>すべて|好きな数|それぞれ(?<each>\d+)(枚|体|つ)(?<eupto>まで)?|(?<cnt>\d+)(枚|体|つ)(?<upto>まで)?)(を)?(、)?(選び、)?(、)?(表向きにし(てから)?、?)?(自分の)?(タップして)?(?<dest>手札に加え|バトルゾーンに出し|マナゾーンに置き|墓地に置き|シールド化し)(?<may>てもよい)?(。その後、|、|。)?(残り(のカード)?を(好きな順序で|ランダムな順序で)?(自分の)?(?<rest>山札の下|墓地|マナゾーン|手札|山札の上)に(置く|戻す|加える)。?)?/;
  function lookCond(t) {
    t = String(t || '');
    const c = {};
    let m;
    if ((m = t.match(/コスト(\d+)以下/))) c.maxCost = +m[1];
    if ((m = t.match(/コスト(\d+)以上/))) c.minCost = +m[1];
    if (/進化ではない/.test(t)) c.notEvo = true;
    const civ = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' };
    c.civs = Object.keys(civ).filter((j) => new RegExp(j + '(の|または|か|・)').test(t)).map((j) => civ[j]);
    if (/呪文/.test(t) && !/クリーチャー/.test(t)) c.types = ['spell'];
    else if (/タマシード/.test(t) && !/クリーチャー/.test(t)) c.types = ['tamaseed'];
    else if (/クリーチャー/.test(t) && !/呪文|カード/.test(t.replace(/クリーチャー・カード/, 'クリーチャー'))) c.types = ['creature'];
    // 種族（「ドラゴン・クリーチャー」「ドラゴン・カード」「ジョーカーズ」など）
    const r = t
      .replace(/コスト\d+(以下|以上)の、?/g, '')
      .replace(/進化ではない、?/g, '')
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
    c.text = t;
    return c;
  }
  function parseLook(body) {
    const m = body.match(LOOK_RE);
    if (!m) return null;
    const g = m.groups;
    const dest = { 手札に加え: 'hand', バトルゾーンに出し: 'battle', マナゾーンに置き: 'mana', 墓地に置き: 'grave', シールド化し: 'shields' }[g.dest];
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
      },
      remain: body.slice(m[0].length).replace(/^[。、]/, '').replace(/^その後、/, ''),
    };
  }

  // 「その後、」や「。」で区切った複数効果を読む。全部読めた時だけ配列を返す
  // 「山札の上から1枚を表向きにする。それが○○なら出す。それ以外なら△に置く」をひとまとめに
  const REVEAL_RE = /^自分の山札の上から1枚(目)?を表向きにする。それが(.+?)(なら|であれば)(、)?(バトルゾーンに)?出(す|してもよい)。(それ以外なら|こうして出さなければ)(、)?(自分の)?(山札の下|マナゾーン|墓地|手札)に(置く|加える)。?/;
  function parseEffects(body) {
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
    const rawLines = normalize(def.text)
      .split('\n')
      .flatMap((l) => (/^[^、。]{2,24}(\s{2,}|　)[^、。]{2,24}$/.test(l.trim()) ? l.trim().split(/\s{2,}|　/) : [l]))
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

    let tapNext = false;
    for (const rawObj of lines) {
      const raw = String(rawObj);
      let line = stripReminder(raw);
      if (!line) continue;
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
      const cmp = [
        [/自分のシールドの数が相手より多ければ、/, { shieldsMore: true }],
        [/バトルゾーンにある自分のクリーチャーの数が相手より多ければ、/, { creaturesMore: true }],
        [/相手のマナゾーンにあるカードの(数|枚数)が自分のより多ければ、/, { oppManaMore: true }],
        [/自分のシールドが(\d+)(枚|つ)以下であれば、/, (m) => ({ shieldsLE: +m[1] })],
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
      const cc = line.match(/(バトルゾーンに)?自分の(.+?)が(\d+)(体|枚|つ)以上あれば、/);
      if (cc && !/マナゾーンに/.test(cc[0])) {
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
      const allyEv = line.match(/^自分の(他の)?([^、]{1,24}?)が(攻撃する|離れた|破壊された)(時|とき)、/);
      if (allyEv && !/^このクリーチャー/.test(line)) {
        const what = allyEv[2].replace(/(・)?クリーチャー$/, '').replace(/^クリーチャー$/, '');
        const actsE = parseEffects(line.replace(allyEv[0], ''));
        if (actsE) {
          A.push({ when: allyEv[3] === '攻撃する' ? 'allyAttack' : 'allyLeft', acts: actsE, ally: { race: what || null, others: !!allyEv[1] }, text: raw });
          continue;
        }
      }
      const ally = line.match(/^(各ターンに(\d+)度、)?自分の(他の)?([^、]{1,24}?)が(バトルゾーンに)?出た(時|とき)、/);
      if (ally && !/^このクリーチャー/.test(line)) {
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
  const WHEN_LABEL = { attackEnd: '攻撃の終わり', beforeBreak: 'ブレイクの前', unblocked: 'ブロックされなかった時', allyAttack: '味方が攻撃する時', allyLeft: '味方が離れた時', tapped: 'タップした時', untapped: 'アンタップした時', evolveSource: '進化元になる時', tapAbility: 'タップ能力', battleLose: 'バトルに負けた時', allyEnter: '味方が出た時', left: '離れた時', attacked: '攻撃された時', summonOnly: '召喚で出た時', summon: '出た時', attack: '攻撃時', destroyed: '破壊時', turnStart: 'ターン開始時', turnEnd: 'ターン終了時', shieldAdded: 'シールド追加時', cast: '呪文', block: 'ブロック時', battleWin: 'バトルに勝った時', oppTurnStart: '相手のターン開始時', broke: 'ブレイクした時' };

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
