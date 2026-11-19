// キーワード能力の辞書
// re:   その行（注釈の（）を除いたもの）に当てはまる正規表現
// auto: true … 対戦エンジンが自動で処理する / false … 認識だけして、対戦中に「手動」で知らせる
// set:  kw（キーワード一覧）に書き込む
// desc: 自分の言葉での短い説明（公式の注釈文ではない）
(function (G) {
  'use strict';
  const CIVJ = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature', ゼロ: 'zero' };
  const civsIn = (s) => Object.keys(CIVJ).filter((j) => s.includes(j)).map((j) => CIVJ[j]);

  // 「火または自然のコスト5以上のドラゴン」のような条件を読む
  function condOf(s) {
    s = String(s || '').trim();
    const c = { civs: [], minCost: null, maxCost: null, minPower: null, race: null };
    let m;
    if ((m = s.match(/コスト(\d+)以上/))) c.minCost = +m[1];
    if ((m = s.match(/コスト(\d+)以下/))) c.maxCost = +m[1];
    if ((m = s.match(/パワー(\d+)以上/))) c.minPower = +m[1];
    const head = s.split(/コスト|パワー/)[0];
    c.civs = civsIn(head.replace(/クリーチャー.*$/, ''));
    const tail = s.replace(/^.*(以上|以下)の/, '').replace(/^(光|水|闇|火|自然)((または|か|・|、)(光|水|闇|火|自然))*の?/, '');
    const r = tail.replace(/(クリーチャー|カード)$/, '').replace(/^の/, '').trim();
    if (r && !/^(光|水|闇|火|自然)$/.test(r)) c.race = r;
    c.text = s;
    return c;
  }

  const K = [
    // ===== 自動で処理するもの =====
    { name: 'ブロッカー', re: /^ブロッカー$/, auto: true, set: (k) => (k.blocker = true), desc: '相手の攻撃を、タップして代わりに受けられる' },
    { name: 'スピードアタッカー', re: /^スピードアタッカー$/, auto: true, set: (k) => (k.speedAttacker = true), desc: '出たターンから攻撃できる' },
    { name: 'スレイヤー', re: /^スレイヤー$/, auto: true, set: (k) => (k.slayer = true), desc: 'バトルで負けて破壊された時、相手も破壊する' },
    { name: 'S・トリガー', re: /^S・トリガー(・クリーチャー)?$/, auto: true, set: (k) => (k.shieldTrigger = true), desc: 'シールドから手札に来た時、コストを払わずに使える' },
    { name: 'マッハファイター', re: /^マッハファイター$/, auto: true, set: (k) => (k.machFighter = true), desc: '出たターンに、相手クリーチャーを攻撃できる' },
    { name: 'W・ブレイカー', re: /^W・ブレイカー$/, auto: true, set: (k) => (k.breaker = Math.max(k.breaker, 2)), desc: 'シールドを2つブレイクする' },
    { name: 'T・ブレイカー', re: /^T・ブレイカー$/, auto: true, set: (k) => (k.breaker = Math.max(k.breaker, 3)), desc: 'シールドを3つブレイクする' },
    { name: 'Q・ブレイカー', re: /^Q・ブレイカー$/, auto: true, set: (k) => (k.breaker = Math.max(k.breaker, 4)), desc: 'シールドを4つブレイクする' },
    { name: 'ワールド・ブレイカー', re: /^ワールド・ブレイカー$/, auto: true, set: (k) => (k.breaker = 99), desc: 'シールドをすべてブレイクする' },
    { name: 'パワード・ブレイカー', re: /^パワード・ブレイカー$/, auto: true, set: (k) => (k.poweredBreaker = true), desc: 'パワー6000ごとにシールドを1つブレイクする' },
    { name: 'パワーアタッカー', re: /^パワーアタッカー\+(\d+)$/, auto: true, set: (k, m) => (k.powerAttacker = +m[1]), desc: '攻撃中はパワーが上がる' },
    { name: 'EXライフ', re: /^EXライフ$/, auto: true, set: (k) => (k.exLife = true), desc: '出た時に山札の上をシールドに加え、離れる時はかわりにそのシールドを墓地へ' },
    { name: 'G・ストライク', re: /^G・ストライク$/, auto: true, set: (k) => (k.gStrike = true), desc: 'シールドから手札に来た時、相手クリーチャー1体をそのターン攻撃できなくできる' },
    { name: 'ジャストダイバー', re: /^ジャストダイバー$/, auto: true, set: (k) => (k.justDiver = true), desc: '出てから次の自分のターンのはじめまで、相手に選ばれず攻撃されない' },
    { name: 'シールド・ゴー', re: /^シールド・ゴー$/, auto: true, set: (k) => (k.shieldGo = true), desc: '破壊された時、表向きでシールドになる' },
    { name: 'エスケープ', re: /^エスケープ$/, auto: true, set: (k) => (k.escape = true), desc: '離れる時、かわりに自分のシールドを1つ手札に戻せる' },
    { name: 'ガードマン', re: /^ガードマン$/, auto: true, set: (k) => (k.guardman = true), desc: '自分の他のクリーチャーが攻撃された時、攻撃先をこのクリーチャーに変えられる' },
    { name: 'チャージャー', re: /^(水晶)?チャージャー$/, auto: true, set: (k) => (k.charger = true), desc: '唱えた後、墓地のかわりにマナに置く' },
    { name: 'シンカライズ', re: /^シンカライズ$/, auto: true, set: (k) => (k.sinkarize = true), desc: '進化クリーチャーの進化元にできる' },
    { name: 'ブロックされない', re: /^このクリーチャーはブロックされない。?$/, auto: true, set: (k) => (k.unblockable = true), desc: 'ブロックされない' },
    { name: '攻撃できない', re: /^このクリーチャーは攻撃できない。?$/, auto: true, set: (k) => (k.cantAttack = true), desc: '攻撃できない' },
    { name: 'プレイヤー攻撃不可', re: /^このクリーチャーは(相手)?プレイヤーを攻撃できない。?$/, auto: true, set: (k) => (k.cantAttackPlayer = true), desc: 'プレイヤーを攻撃できない' },
    { name: 'アンタップ攻撃', re: /^このクリーチャーは(、)?(相手の)?アンタップしている(相手の)?クリーチャーを攻撃できる。?$/, auto: true, set: (k) => (k.attackUntapped = true), desc: 'アンタップしているクリーチャーも攻撃できる' },
    { name: '選べない', re: /^相手は(、)?このクリーチャーを選べない。?$/, auto: true, set: (k) => (k.untargetable = true), desc: '相手に選ばれない' },
    { name: 'タップして出る', re: /^このクリーチャーはタップして(バトルゾーンに)?出る。?$/, auto: true, set: (k) => (k.enterTapped = true), desc: 'タップ状態で出る' },
    { name: 'アンタップしない', re: /^このクリーチャーは(、)?自分のターンのはじめにアンタップしない。?$/, auto: true, set: (k) => (k.noUntap = true), desc: '自分のターンのはじめにアンタップしない' },
    { name: '呪文ロック', re: /^相手は(、)?コスト(\d+)以下の呪文を唱えられない。?$/, auto: true, set: (k, m) => (k.spellLockMax = +m[2]), desc: '相手は指定コスト以下の呪文を使えない' },
    { name: 'ブレイク身代わり', re: /^ブレイク身代わり$/, auto: true, set: (k) => (k.breakSubstitute = true), desc: '相手クリーチャーのブレイクを、この1枚で受けられる' },
    { name: 'ニンジャ・ストライク', re: /^ニンジャ・ストライク\s*(\d+)$/, auto: true, set: (k, m) => (k.ninjaStrike = +m[1]), desc: '相手の攻撃時、マナがN枚以上ならコストを払わずに出せる。ターンの終わりに山札の下へ' },
    { name: 'B・A・D', re: /^B・A・D(・S)?\s*(\d+)$/, auto: true, set: (k, m) => (k.bad = +m[2]), desc: 'コストをN下げて使える。使ったらターンの終わりに破壊' },
    { name: 'ササゲール', re: /^ササゲール\s*(\d+)$/, auto: true, set: (k, m, raw) => {
        k.sasage = +m[1];
        const r = String(raw).match(/自分の([^）)を]+?)を召喚/);
        if (r) k.sasageFor = r[1].replace(/^(コスト\d+以上の)?/, '');
      }, desc: 'このカードを破壊して、召喚するカードのコストをN下げられる' },
    { name: 'シンパシー', re: /^シンパシー[：:]\s*(.+)$/, auto: true, set: (k, m) => (k.sympathy = m[1].replace(/。$/, '')), desc: '自分の場の指定のカード1枚につき、コストが1下がる（1未満にはならない）' },
    { name: '革命チェンジ', re: /^革命チェンジ[：:－-]\s*(.+)$/, auto: true, set: (k, m) => (k.revChange = condOf(m[1])), desc: '条件に合う自分のクリーチャーが攻撃する時、手札のこれと入れ替えられる' },
    { name: '侵略', re: /^(S級)?侵略(ZERO)?[：:－-]\s*(.+)$/, auto: true, set: (k, m) => (k.invasion = condOf(m[3])), desc: '条件に合う自分のクリーチャーが攻撃する時、手札のこれをその上に重ねて進化できる' },
    { name: '進化', re: /^(NEO)?進化(クリーチャー)?[：:－-]?\s*(.*)$/, auto: true, set: (k, m) => {
        k.evolution = m[1] ? 'neo' : 'evo';
        const cs = civsIn(String(m[3] || '').split('クリーチャー')[0]);
        if (cs.length) k.evoCivs = cs;
      }, desc: '自分のクリーチャー1体の上に重ねて出す（NEOは重ねずにも出せる）' },
    { name: 'G・ゼロ', re: /^G・ゼロ[：:]\s*(.+)$/, auto: true, set: (k, m) => (k.gZero = m[1]), desc: '条件を満たしていれば、コストを払わずに使える' },
    { name: 'Zラッシュ', re: /^Zラッシュ.*$/, auto: true, set: (k) => (k.zRush = true), desc: '自分のシールドが離れた時、ハイパー化する' },
    { name: 'マナ武装', re: /^マナ武装\s*(\d+)$/, auto: true, set: () => {}, desc: 'マナに指定の文明がN枚以上あれば効果が働く' },
    { name: '封印', re: /^封印$/, auto: true, set: () => {}, desc: '山札の上のカードを裏向きで付ける。付いている間は動けない。自分のコマンドが出ると1つ外れる' },

    // ===== 認識はするが手動で処理するもの =====
    { name: 'S・バック', re: /^S・バック/, desc: 'シールドから手札に来た指定のカードを捨てて、コストを払わずに出せる' },
    { name: 'キズナ', re: /^(スーパー)?キズナ/, desc: '他の自分のクリーチャーが攻撃した時などに、このクリーチャーの能力を使える' },
    { name: 'メテオバーン', re: /^メテオバーン/, desc: '進化元を墓地に置いて効果を使う' },
    { name: '無月の門', re: /^無月の門/, desc: '条件を満たすと、魔導具を墓地に置いて手札や墓地から出せる' },
    { name: 'J・O・E', re: /^J・O・E/, desc: 'ジョーカーズの召喚時に追加コストを払ってカードを出す' },
    { name: 'GR召喚', re: /GR召喚/, desc: '超GRゾーンからクリーチャーを出す（このツールはGRゾーン未対応）' },
    { name: '超天フィーバー', re: /^超天フィーバー/, desc: '超GRゾーンの枚数で効果が強くなる' },
    { name: 'マナドライブ', re: /^マナドライブ/, desc: 'マナに指定の文明があれば効果が働く' },
    { name: 'オレガ・オーラ', re: /オレガ・オーラ/, desc: 'GRクリーチャーに付けて使うカード' },
    { name: 'ドロン・ゴー', re: /^ドロン・ゴー/, desc: '破壊された時、手札の指定のカードを出せる' },
    { name: '革命0トリガー', re: /^革命0トリガー/, desc: 'シールドが0の時の攻撃に対して、手札から使える' },
    { name: '革命', re: /^革命\s*\d+/, desc: '自分のシールドがN以下なら効果が働く' },
    { name: 'ファイナル革命', re: /^(極限)?ファイナル革命/, desc: 'ゲーム中1回だけ使える強力な効果' },
    { name: 'アタック・チャンス', re: /^アタック・チャンス/, desc: '指定のクリーチャーが攻撃した時、手札からコストを払わずに使える' },
    { name: 'ガチンコ・ジャッジ', re: /ガチンコ・ジャッジ/, desc: 'お互い山札の上を見せ、コストが大きければ勝ち' },
    { name: 'ターボラッシュ', re: /^ターボラッシュ/, desc: '他の自分のクリーチャーがシールドをブレイクした後、能力が使える' },
    { name: 'セイバー', re: /セイバー/, desc: '指定のクリーチャーが離れる時、かわりにこのクリーチャーを破壊できる' },
    { name: '鬼タイム', re: /^鬼タイム/, desc: '相手のシールドが自分より多いなどの時に効果が働く' },
    { name: '鬼エンド', re: /^鬼エンド/, desc: 'ターンの終わりに条件を満たすと追加ターンなどの効果' },
    { name: 'フシギバース', re: /^フシギバース/, desc: 'マナのカードを墓地に置いて、その分コストを下げて出す' },
    { name: 'ミクセル', re: /^ミクセル/, desc: '相手がコストの大きいクリーチャーを出す時、かわりにマナや山札に送る' },
    { name: 'ムゲンクライム', re: /^ムゲンクライム/, desc: '自分のクリーチャーをタップしてコストの代わりにする' },
    { name: 'シールド・フォース', re: /^シールド・フォース/, desc: '選んだシールドがある間、効果が働く' },
    { name: 'サバイバー', re: /^サバイバー/, desc: '同じサバイバーのクリーチャーが能力を共有する' },
    { name: 'メガ・ラスト・バースト', re: /^メガ・ラスト・バースト/, desc: '手札か墓地に行く時、ツインパクトの呪文側を使える' },
    { name: 'スター進化', re: /^スター進化/, desc: '進化元が離れる時、かわりに上のカードを置いていける進化' },
    { name: 'ハイパー化', re: /ハイパー化/, desc: 'ハイパーモードの能力が使えるようになる' },
    { name: 'シールド・トリガー・プラス', re: /^S・トリガー・プラス/, desc: 'S・トリガーで使った時に追加の効果' },
  ];

  function match(line, raw) {
    for (const e of K) {
      const m = line.match(e.re);
      if (m) return { e, m, raw };
    }
    return null;
  }
  // 行の中に出てくる「手動」キーワードの説明
  function mentions(line) {
    return K.filter((e) => !e.auto && line.match(e.re instanceof RegExp ? new RegExp(e.re.source.replace(/^\^/, '')) : e.re));
  }

  G.Keywords = { list: K, match, mentions, condOf };
  if (typeof module !== 'undefined') module.exports = G.Keywords;
})(typeof globalThis !== 'undefined' ? globalThis : window);
