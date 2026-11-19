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
    { name: 'スーパー・S・トリガー', re: /^スーパー・S・トリガー/, auto: true, set: (k) => ((k.shieldTrigger = true), (k.superTrigger = true)), desc: 'S・トリガーとして使える（最後のシールドなら追加の効果。追加分は手動）' },
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
    { name: 'スーパーガードマン', re: /^スーパーガードマン/, auto: true, set: (k) => (k.guardman = true), desc: '自分の他のクリーチャーやプレイヤーへの攻撃を引き受けられる（このツールではガードマンとして処理）' },
    { name: 'スマッシュ・バースト', re: /^スマッシュ・バースト/, auto: true, set: (k) => (k.smashBurst = true), desc: '攻撃する時、ツインパクトの呪文側をコストを払わずに唱えられる' },
    { name: '墓地から召喚', re: /^このクリーチャーを(、)?自分の墓地から召喚してもよい。?$/, auto: true, set: (k) => (k.graveSummon = true), desc: '墓地から召喚できる' },
    { name: '呪文封じ', re: /^相手は(、)?呪文を唱えられない。?$/, auto: true, set: (k) => (k.spellLockMax = 999), desc: '相手は呪文を唱えられない' },
    { name: '能力を与える', re: /^自分の(他の)?(.*?)(すべて)?に「(.+?)」(と「(.+?)」)?を与える。?$/, auto: true, set: (k, m) => (k.grant = { others: !!m[1], who: (m[2] || '').replace(/^クリーチャー$/, ''), names: [m[4], m[6]].filter(Boolean) }), desc: '自分のクリーチャーに能力を与える' },
    { name: '数だけコスト軽減', re: /^このクリーチャーの召喚コストを(、)?(自分の|相手の)?(.*?)(\d+)(体|枚|つ)につき(\d+)少なくする.*$/, auto: true, set: (k, m) => (k.costPer = { side: m[2] === '相手の' ? 'opp' : 'self', what: m[3], per: +m[4], n: +m[6] }), desc: '数に応じて召喚コストが下がる（1未満にはならない）' },
    { name: '数だけパワー', re: /^(自分の)?(マナゾーン|墓地|バトルゾーン)(にある|の)(.*?)(\d+)(枚|体|つ)につき(、)?このクリーチャーのパワーを\+(\d+)する。?$/, auto: true, set: (k, m) => (k.powerPer = { zone: m[2], what: m[4], per: +m[5], n: +m[8] }), desc: '数に応じてパワーが上がる' },
    { name: 'ガードマン', re: /^ガードマン$/, auto: true, set: (k) => (k.guardman = true), desc: '自分の他のクリーチャーが攻撃された時、攻撃先をこのクリーチャーに変えられる' },
    { name: 'チャージャー（旧表記）', re: /^この呪文を(自分の手札から)?唱えた後、墓地に置くかわりに(、)?(自分の)?マナゾーンに置く。?$/, auto: true, set: (k) => (k.charger = true), desc: '唱えた後、墓地のかわりにマナに置く' },
    { name: 'パワーで能力を得る', re: /^このクリーチャーは(、)?パワーが(\d+)以上の時、「(.+?)」を得る。?$/, auto: true, set: (k, m) => (k.powerGrant = { min: +m[2], name: m[3] }), desc: 'パワーが一定以上なら能力を得る' },
    { name: '場の数だけパワー', re: /^このクリーチャーのパワーは(、)?バトルゾーンにある(自分の|相手の)?(他の)?(.*?)(\d+)(体|枚|つ)につき\+(\d+)される。?$/, auto: true, set: (k, m) => (k.powerPer = { zone: 'バトルゾーン', side: m[2] === '相手の' ? 'opp' : 'self', others: !!m[3], what: m[4], per: +m[5], n: +m[7] }), desc: '場の数に応じてパワーが上がる' },
    { name: 'ブロック中のパワー', re: /^ブロック中、このクリーチャーのパワーは\+(\d+)される。?$/, auto: true, set: (k, m) => (k.blockPower = +m[1]), desc: 'ブロックしている間パワーが上がる' },
    { name: '呪文コスト増', re: /^相手の呪文を唱えるコストは(\d+)多くなる。?$/, auto: true, set: (k, m) => (k.spellTax = +m[1]), desc: '相手の呪文のコストが上がる' },
    { name: '攻撃先の変更', re: /^このクリーチャーをアンタップして、相手クリーチャーの攻撃先をこのクリーチャー/, auto: true, set: (k) => ((k.guardman = true), (k.guardTapped = true)), desc: '相手の攻撃先を、このクリーチャーに変えられる（ガードマンとして処理）' },
    { name: 'ブレイクしたシールドを墓地へ', re: /^このクリーチャーがシールドをブレイクする時、相手はそのシールドを手札に加えるかわりに墓地に置く。?$/, auto: true, set: (k) => (k.breakToGrave = true), desc: 'このクリーチャーがブレイクしたシールドは、手札ではなく墓地へ' },
    { name: 'すべてのバトルに勝つ', re: /^このクリーチャーは(、)?すべてのバトルに勝つ。?$/, auto: true, set: (k) => (k.winAllBattles = true), desc: 'バトルでは必ず勝つ' },
    { name: '選ばれない（旧表記）', re: /^相手がバトルゾーンにあるクリーチャーを選ぶ時、このクリーチャーを選ぶことはできない。?$/, auto: true, set: (k) => (k.untargetable = true), desc: '相手に選ばれない' },
    { name: 'マナより重いクリーチャーはマナへ', re: /^相手のマナゾーンにあるカードの枚数よりコストが大きい相手のクリーチャーが出る時、かわりにそれを持ち主のマナゾーンに置く。?$/, auto: true, set: (k) => (k.manaGate = true), desc: '相手のマナより重い相手のクリーチャーは、出るかわりにマナへ' },
    { name: 'パワーがあれば離れない', re: /^このクリーチャーが離れる時、そのパワーが(\d+)より大きければ、離れるかわりにとどまる。?$/, auto: true, set: (k, m) => (k.stayIfPower = +m[1]), desc: 'パワーが一定より大きければ離れない' },
    { name: 'マナ武装で強化', re: /^マナ武装\s*(\d+)[：:]自分のマナゾーンに(光|水|闇|火|自然)のカードが(\d+)枚以上あれば、このクリーチャーのパワーを\+(\d+)し、「(.+?)」(と「(.+?)」)?を与える。?$/, auto: true, set: (k, m) => (k.manaArmedBuff = { civ: { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[2]], n: +m[3], power: +m[4], names: [m[5], m[7]].filter(Boolean) }), desc: 'マナ武装：パワーが上がり能力を得る' },
    { name: 'サイレントスキル', re: /^サイレントスキル/, desc: 'タップしていたら、ターンのはじめにアンタップするかわりに能力を使える' },
    { name: 'メタモーフ', re: /^メタモーフ/, desc: 'マナが7枚以上なら追加の能力を得る' },
    { name: '超魂レイド', re: /^超魂レイド/, desc: '出た時に山札の上から進化元になれるカードを下に置ける' },
    { name: 'G-NEO進化', re: /^G-NEO進化[：:－-]?\s*(.*)$/, auto: true, set: (k, m) => (k.evolution = 'neo'), desc: 'NEO進化として処理（G-NEOの追加効果は手動）' },
    { name: '真・エスケープ', re: /^真・エスケープ/, auto: true, set: (k) => (k.escape = true), desc: 'エスケープとして処理' },
    { name: 'チャージャー', re: /^(水晶)?チャージャー$/, auto: true, set: (k) => (k.charger = true), desc: '唱えた後、墓地のかわりにマナに置く' },
    { name: 'シンカライズ', re: /^シンカライズ([：:].*)?$/, auto: true, set: (k) => (k.sinkarize = true), desc: '進化クリーチャーの進化元にできる' },
    { name: 'ブロックされない', re: /^このクリーチャーは(、)?ブロックされない。?$/, auto: true, set: (k) => (k.unblockable = true), desc: 'ブロックされない' },
    { name: '攻撃できない', re: /^このクリーチャーは(、)?攻撃できない。?$/, auto: true, set: (k) => (k.cantAttack = true), desc: '攻撃できない' },
    { name: 'プレイヤー攻撃不可', re: /^このクリーチャーは(、)?(相手)?プレイヤーを攻撃できない。?$/, auto: true, set: (k) => (k.cantAttackPlayer = true), desc: 'プレイヤーを攻撃できない' },
    { name: 'アンタップ攻撃', re: /^このクリーチャーは(、)?(相手の)?アンタップしている(相手の)?クリーチャーを攻撃できる。?$/, auto: true, set: (k) => (k.attackUntapped = true), desc: 'アンタップしているクリーチャーも攻撃できる' },
    { name: '選べない', re: /^相手は(、)?このクリーチャーを選べない。?$/, auto: true, set: (k) => (k.untargetable = true), desc: '相手に選ばれない' },
    { name: 'タップして出てアンタップしない', re: /^このクリーチャーは(、)?タップして(バトルゾーンに)?出て、自分のターンのはじめにアンタップしない。?$/, auto: true, set: (k) => ((k.enterTapped = true), (k.noUntap = true)), desc: 'タップ状態で出て、自分のターンのはじめにアンタップしない' },
    { name: 'タップして出る', re: /^このクリーチャーは(、)?タップして(バトルゾーンに)?出る。?$/, auto: true, set: (k) => (k.enterTapped = true), desc: 'タップ状態で出る' },
    { name: 'アンタップしない', re: /^このクリーチャーは(、)?自分のターンのはじめにアンタップしない。?$/, auto: true, set: (k) => (k.noUntap = true), desc: '自分のターンのはじめにアンタップしない' },
    { name: '呪文ロック', re: /^相手は(、)?コスト(\d+)以下の呪文を唱えられない。?$/, auto: true, set: (k, m) => (k.spellLockMax = +m[2]), desc: '相手は指定コスト以下の呪文を使えない' },
    { name: 'ブレイク身代わり', re: /^(ブレイク身代わり|相手のクリーチャーがシールドを\d+つ以上ブレイクする時、かわりにこのシールドをブレイクさせてもよい。?)$/, auto: true, set: (k) => (k.breakSubstitute = true), desc: '相手クリーチャーのブレイクを、この1枚で受けられる' },
    { name: 'ニンジャ・ストライク', re: /^ニンジャ・ストライク\s*(\d+)$/, auto: true, set: (k, m) => (k.ninjaStrike = +m[1]), desc: '相手の攻撃時、マナがN枚以上ならコストを払わずに出せる。ターンの終わりに山札の下へ' },
    { name: 'B・A・D', re: /^B・A・D(・S)?\s*(\d+)$/, auto: true, set: (k, m) => (k.bad = +m[2]), desc: 'コストをN下げて使える。使ったらターンの終わりに破壊' },
    { name: 'ササゲール', re: /^ササゲール\s*(\d+)$/, auto: true, set: (k, m, raw) => {
        k.sasage = +m[1];
        const r = String(raw).match(/自分の([^）)をの]+?)(を召喚|の召喚コスト)/);
        if (r) k.sasageFor = r[1].replace(/^(コスト\d+以上の)?/, '').replace(/・クリーチャー$/, '');
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

    { name: 'ヨビニオン', re: /^ヨビニオン$/, auto: true, set: (k) => (k.yobinion = true), desc: '召喚した時、山札の上から、このクリーチャーよりコストが小さいクリーチャーが出るまで表向きにし、それを出す。残りは山札の下へ' },
    // ===== 認識はするが手動で処理するもの =====
    { name: '超魂X', re: /^超魂X/, desc: '進化元に応じて能力を得る' },
    { name: 'サバキZ', re: /^サバキZ/, desc: '裁きの紋章を使った時などに、手札からコストを払わずに出せる' },
    { name: 'D・D・D', re: /^D・D・D/, desc: '相手の攻撃中などに、手札からコストを払わずに出せる' },
    { name: 'マジボンバー', re: /^マジボンバー/, desc: '出た時に、手札かマナから指定コスト以下のクリーチャーを出せる' },
    { name: 'アバレチェーン', re: /^アバレチェーン/, desc: '攻撃する時に、手札からクリーチャーを出せる' },
    { name: 'ハイパーエナジー', re: /^ハイパーエナジー/, desc: '自分のクリーチャーをタップして、召喚コストを下げる' },
    { name: 'オシオキムーン', re: /^オシオキムーン/, desc: 'シールドが離れた時に、手札から使える' },
    { name: 'G・リンク', re: /G・リンク/, desc: 'ゴッド同士をつなげて1体として扱う' },
    { name: 'ホーリー・フィールド', re: /^ホーリー・フィールド/, desc: 'シールドの数が相手以上なら能力を得る' },
    { name: 'シビルカウント', re: /^シビルカウント/, desc: '指定の文明のカードの数で効果が働く' },
    { name: 'クロスギア', re: /^クロスギア/, desc: 'クリーチャーにクロスして使う装備カード' },
    { name: 'ウェーブストライカー', re: /^ウェーブストライカー/, desc: 'ウェーブストライカーが3体以上いれば能力を得る' },
    { name: 'レインボーナス', re: /^レインボーナス/, desc: '多色クリーチャーがいれば効果が働く' },
    { name: 'ハンティング', re: /^ハンティング/, desc: 'バトル中、ハンターの数だけパワーが上がる' },
    { name: 'ダイナモ', re: /^ダイナモ/, desc: 'バトルする時に、他のクリーチャーのパワーを足せる' },
    { name: '水晶武装', re: /^水晶武装/, desc: 'マナの裏向きのカードの数で効果が働く' },
    { name: 'ラスト・バースト', re: /^ラスト・バースト/, desc: '離れた時に、ツインパクトの呪文側を使える' },
    { name: 'Jクライム', re: /^Jクライム/, desc: '自分のジョーカーズの上に重ねて、コストを下げて出す' },
    { name: 'Jチェンジ', re: /^Jチェンジ/, desc: '攻撃する時などに、マナのジョーカーズと入れ替える' },
    { name: '逆転撃', re: /^逆転撃/, desc: '相手の攻撃中に、条件を満たせば手札から使える' },
    { name: 'エターナル・Ω', re: /^エターナル・Ω/, desc: '場を離れる時、かわりに手札に戻る' },
    { name: 'ウラ・ニンジャ・ストライク', re: /^ウラ・ニンジャ・ストライク/, desc: '相手の攻撃時、条件を満たせば手札から出し、出た時の能力を使う' },
    { name: '無月の大罪', re: /^無月の大罪/, desc: '条件を満たすと、魔導具を墓地に置いてコストを払わずに出せる' },
    { name: 'S-MAX進化', re: /^S-MAX進化/, desc: '進化元なしでも出せる。負ける時にかわりにこのクリーチャーを破壊する' },

    { name: 'ギャラクシールド', re: /^ギャラクシールド/, desc: 'シールドとして置き、条件を満たすと場に出せる' },
    { name: '龍マナ武装', re: /^龍マナ武装/, desc: 'マナにドラゴンがN枚以上あれば効果が働く' },
    { name: '超無限進化', re: /^超無限進化/, desc: '複数のクリーチャーの上に重ねて出す進化' },
    { name: 'マナ進化', re: /^マナ進化/, desc: 'マナゾーンのカードを進化元にして出す' },
    { name: 'エクストラEXライフ', re: /^エクストラEXライフ/, desc: 'EXライフの強化版（このツールでは手動）' },
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
