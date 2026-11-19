// カードテキスト → 自動処理できる能力 への変換
// 読み取れない文は manual として残し、対戦中に「手動で処理」と表示する。
(function (G) {
  'use strict';

  function normalize(s) {
    return String(s || '')
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[＋]/g, '+')
      .replace(/[，]/g, '、')
      .replace(/[．]/g, '。')
      .replace(/\r/g, '');
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
  ];

  const TRIGGERS = [
    { re: /^この(クリーチャー|タマシード|カード|城|G城)(が|を)(バトルゾーンに出た|出た|召喚した|使った)時、/, when: 'summon' },
    { re: /^このクリーチャーが攻撃する時、/, when: 'attack' },
    { re: /^このクリーチャーが破壊された時、/, when: 'destroyed' },
    { re: /^自分のターンのはじめに、/, when: 'turnStart' },
    { re: /^自分のターンの(終わり|おわり)に、/, when: 'turnEnd' },
    { re: /^自分のシールドゾーンにカードが置かれた時、/, when: 'shieldAdded' },
  ];

  // 対象の側：相手 / 自分 / 指定なし(どちらでも)
  function sideOf(s) {
    if (/相手の/.test(s)) return 'opp';
    if (/自分の/.test(s)) return 'self';
    return 'any';
  }

  function targetFilter(s) {
    const f = {};
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

    if ((m = s.match(/^カードを(最大)?(\d+)枚(まで)?引/))) {
      return { act: 'draw', n: +m[2], optional };
    }
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?(まで)?を(自分の)?マナゾーンに置/))) {
      return { act: 'manaBoost', n: +m[1], optional };
    }
    if ((m = s.match(/^自分の山札の上から(\d+)枚(目)?(まで)?をシールド化する|^自分の山札の上から(\d+)枚(目)?を(自分の)?シールドゾーンに(裏向きのまま)?(加える|置く)/))) {
      return { act: 'shieldAdd', n: +(m[1] || m[4]), optional };
    }
    if (/クリーチャー/.test(s) && /破壊する$|破壊してもよい$/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'destroy', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, ...targetFilter(s) };
    }
    if (/クリーチャー/.test(s) && /手札に戻す$|手札に戻してもよい$/.test(s) && !/墓地/.test(s) && !/マナ/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'bounce', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, ...targetFilter(s) };
    }
    if (/クリーチャー/.test(s) && /(?<!アン)タップする$|(?<!アン)タップしてもよい$/.test(s)) {
      const all = /すべて/.test(s);
      return { act: 'tap', side: sideOf(s), all, n: all ? 0 : countOf(s), optional, ...targetFilter(s) };
    }
    if ((m = s.match(/^相手の手札を見ないで(\d+)枚選び、捨てさせる$/))) {
      return { act: 'discard', n: +m[1], random: true };
    }
    if ((m = s.match(/^相手は(自身|自分)の手札を(\d+)枚選び、捨てる$/))) {
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
    if ((m = s.match(/^自分の山札の上から(\d+)枚を(自分の)?墓地に置く$/))) {
      return { act: 'mill', n: +m[1] };
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
      .split(/。その後、|。/)
      .map((x) => x.trim())
      .filter(Boolean);
    const acts = [];
    for (const p of parts) {
      const a = parseEffect(p);
      if (!a) return null;
      acts.push(a);
    }
    return acts.length ? acts : null;
  }

  // def: {type, text}
  function parseCard(def) {
    const kw = { breaker: 1, powerAttacker: 0 };
    const abilities = []; // {when, acts}
    const manual = []; // 自動化できない文
    const lines = normalize(def.text)
      .split('\n')
      .map((l) => l.replace(/^[■▪・●◆]\s*/, '').trim())
      .filter(Boolean);

    for (const raw of lines) {
      const line = stripReminder(raw);
      if (!line) continue;
      const kwHit = KEYWORDS.find((k) => k.re.test(line));
      if (kwHit) {
        kwHit.set(kw, line.match(kwHit.re));
        continue;
      }
      let when = null;
      let body = line;
      for (const t of TRIGGERS) {
        if (t.re.test(line)) {
          when = t.when;
          body = line.replace(t.re, '');
          break;
        }
      }
      if (!when) {
        if (def.type === 'spell') when = 'cast';
        else {
          manual.push(raw);
          continue;
        }
      }
      const acts = parseEffects(body);
      if (acts) abilities.push({ when, acts, text: raw });
      else manual.push(raw);
    }
    return { kw, abilities, manual };
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
  };
  function sideJ(s) {
    return s === 'opp' ? '相手の' : s === 'self' ? '自分の' : '';
  }
  function filt(a) {
    return (a.maxPower ? `パワー${a.maxPower}以下` : '') + (a.maxCost ? `コスト${a.maxCost}以下` : '');
  }
  const WHEN_LABEL = { summon: '出た時', attack: '攻撃時', destroyed: '破壊時', turnStart: 'ターン開始時', turnEnd: 'ターン終了時', shieldAdded: 'シールド追加時', cast: '呪文' };

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
    for (const ab of parsed.abilities) {
      out.push(`${WHEN_LABEL[ab.when]}: ` + ab.acts.map((a) => ACT_LABEL[a.act](a) + (a.optional ? '(任意)' : '')).join(' → '));
    }
    return out;
  }

  G.TextParse = { parseCard, describe, normalize };
  if (typeof module !== 'undefined') module.exports = G.TextParse;
})(typeof globalThis !== 'undefined' ? globalThis : window);
