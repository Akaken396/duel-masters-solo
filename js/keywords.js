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
    { name: 'S・トリガーX', re: /^S・トリガーX$/, auto: true, set: (k) => (k.shieldTrigger = true), desc: 'S・トリガーとして使える（追加の効果は手動）' },
    { name: 'ドラゴン・T・ブレイカー', re: /^ドラゴン・T・ブレイカー$/, auto: true, set: (k) => { k.breaker = Math.max(k.breaker, 3); k.dragonBreaker = true; }, desc: 'シールドを3つブレイクする。各ブレイクの前に山札の上をシールド化するか、表向きでシールドの上に置く' },
    { name: 'ドラゴン・W・ブレイカー', re: /^ドラゴン・W・ブレイカー$/, auto: true, set: (k) => { k.breaker = Math.max(k.breaker, 2); k.dragonBreaker = true; }, desc: 'W・ブレイカーとして処理（ドラゴンに関する追加分は手動）' },
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
    { name: 'コストを増減する（場にある間）', re: /^(相手の|自分の)(、)?(?<subj>[^。]+?)(を(召喚する|唱える|実行する|使う|召喚)|の(召喚|実行))?コストを(最大)?(?<n>\d+)(?<dir>少なく|多く)する(。ただし、?コストは0以下に(は)?ならない)?。?$/, auto: true,
      test: (line) => !/このクリーチャー|次に|につき|\d+(体|枚)目|墓地にある|手札にある|ターン/.test(line),
      set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: m[1] === '相手の' ? 'opp' : 'self', subj: m.groups.subj.replace(/(を|の)$/, ''), n: +m.groups.n * (m.groups.dir === '多く' ? 1 : -1) })), desc: '場にある間、条件に合うカードのコストを変える' },
    { name: '相手は手札以外から出せない', re: /^相手の(クリーチャー|エレメント)は(、)?相手の手札以外から(バトルゾーンに)?出ない。?$/, auto: true, set: (k) => (k.oppOnlyFromHand = true), desc: '相手のクリーチャーは手札からしか出られない' },
    { name: '攻撃先は変更されない', re: /^このクリーチャーの攻撃先は変更されない。?$/, auto: true, set: (k) => { k.noRedirect = true; k.unblockable = true; }, desc: 'ブロックなどで攻撃先が変わらない（ブロックされない）' },
    { name: '引いた枚数で攻撃可能', re: /^このターンに自分がカードを(\d+)枚以上引いていなければ、このクリーチャーは攻撃できない。?$/, auto: true, set: (k, m) => (k.attackNeedDraws = +m[1]), desc: 'このターンにカードを指定枚数以上引いていないと攻撃できない' },
    { name: '手札の数だけパワー', re: /^(相手のターン中、)?(自分|相手)の手札(\d+)枚につき、このクリーチャーのパワーを\+(\d+)する。?$/, auto: true, set: (k, m) => (k.powerPerHand = { oppTurn: !!m[1], opp: m[2] === '相手', per: +m[3], n: +m[4] }), desc: '手札の枚数に応じてパワーが上がる' },
    { name: 'アンタップした数だけコスト軽減', re: /^このターンアンタップしたクリーチャー1体につき、このクリーチャーの召喚コストを(\d+)少なくする。?$/, auto: true, set: (k, m) => (k.costPerUntapped = +m[1]), desc: 'このターンにアンタップしたクリーチャーの数だけ召喚コストが下がる' },
    { name: '呪文のコスト軽減（最大）', re: /^自分の([^、。「」《》]*?呪文)を唱えるコストを(最大)?(\d+)少なく(してもよい|する)。?$/, auto: true, set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: m[1], n: -m[3] })), desc: '呪文を唱えるコストを下げる' },
    { name: '進化元のコスト軽減', re: /^この(タマシード|クリーチャー|エレメント)から進化する([^、。]*?)クリーチャーの(召喚)?コストを(\d+)少なくする。?$/, auto: true, set: (k, m) => (k.evoBaseDiscount = { n: +m[4], cond: m[2] || '' }), desc: 'これから進化するクリーチャーのコストが下がる' },
    { name: '可能なら毎ターン攻撃（対象つき）', re: /^このクリーチャーは(、)?可能(であれ|な)ら毎ターン(、)?(クリーチャー|相手プレイヤー)を攻撃する。?$/, auto: true, set: (k) => (k.mustAttack = 'self'), desc: 'できれば毎ターン攻撃する' },
    { name: 'パワー+（常在・される）', re: /^このクリーチャーのパワーは\+(\d+)される。?$/, auto: true, set: (k, m) => (k.soulPower = (k.soulPower || 0) + +m[1]), desc: 'パワーが上がる' },
    { name: '自軍は小さいものにブロックされない', re: /^自分のクリーチャーは(、)?それよりパワーが小さいクリーチャーにブロックされない。?$/, auto: true, set: (k) => (k.teamUnblockSmaller = true), desc: '自分のクリーチャーは、それよりパワーが小さいクリーチャーにブロックされない' },
    { name: '小さいものにブロックされない（別表記）', re: /^このクリーチャーは(、)?このクリーチャーよりパワーの?小さいクリーチャーにブロックされない。?$/, auto: true, set: (k) => (k.unblockableSmaller = true), desc: 'パワーが小さいクリーチャーにブロックされない' },
    { name: '文明にブロックされない', re: /^このクリーチャーは(、)?((光|水|闇|火|自然)(または|か|、)?)+のクリーチャーにブロックされない。?$/, auto: true, set: (k, m) => (k.unblockCivs = (m[0].replace(/^このクリーチャーは(、)?/, '').match(/光|水|闇|火|自然/g) || []).map((x) => ({ 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[x]))), desc: '指定の文明のクリーチャーにブロックされない' },
    { name: 'アンタップ攻撃（される）', re: /^このクリーチャーは(、)?アンタップされているクリーチャーを攻撃できる。?$/, auto: true, set: (k) => (k.attackUntapped = true), desc: 'アンタップしているクリーチャーを攻撃できる' },
    { name: '相手のシールドがなければ攻撃できない', re: /^相手にシールドが1(枚|つ)もなければ、このクリーチャーは攻撃できない。?$/, auto: true, set: (k) => (k.attackNeedOppShield = true), desc: '相手にシールドがなければ攻撃できない' },
    { name: 'クリーチャー攻撃時ブロックされない', re: /^このクリーチャーは(、)?クリーチャーを攻撃する(とき|時)(、)?ブロックされない。?$/, auto: true, set: (k) => (k.unblockVsCreature = true), desc: 'クリーチャーを攻撃する時はブロックされない' },
    { name: '進化の時だけ攻撃', re: /^このクリーチャーは(、)?進化クリーチャーである(時|とき|間)しか攻撃できない。?$/, auto: true, set: (k) => (k.attackNeedEvo = true), desc: '進化クリーチャーである時しか攻撃できない' },
    { name: '手札から召喚できない', re: /^このクリーチャーは(、)?自分の手札から召喚できない。?$/, auto: true, set: (k) => (k.cannotSummon = true), desc: '手札から召喚できない' },
    { name: '手札が少なければ召喚できる', re: /^このクリーチャーは(、)?自分の手札が(\d+)枚以下なら召喚できる。?$/, auto: true, set: (k, m) => (k.summonNeedHandLE = +m[2]), desc: '手札が指定枚数以下の時だけ召喚できる' },
    { name: '手札から召喚ならコスト増', re: /^手札から召喚するなら、このクリーチャーの召喚コストを(\d+)多くする。?$/, auto: true, set: (k, m) => (k.handSummonTax = +m[1]), desc: '手札から召喚する時はコストが上がる' },
    { name: 'エレメントの数で呪文コスト軽減', re: /^この(呪文|クリーチャー)を(唱える|召喚する)コストを、自分のコスト(\d+)以下のエレメント1つにつき(\d+)少なくする。?$/, auto: true, set: (k, m) => (k.costPerSmallElem = { maxCost: +m[3], n: +m[4] }), desc: '自分の軽いエレメントの数だけコストが下がる' },
    { name: 'いずれかがなければ攻撃できない', re: /^このクリーチャーは(、)?自分の(、)?(.+?)がなければ攻撃できない。?$/, auto: true, test: (l) => !/この|ターン/.test(l.replace(/^このクリーチャーは/, '')), set: (k, m) => (k.attackNeedAny = m[3]), desc: '指定のカードがなければ攻撃できない' },
    { name: '相手のクリーチャーはタップして出る', re: /^相手のクリーチャーは(、)?タップして出る。?$/, auto: true, set: (k) => (k.enterTappedAura = { opp: true }), desc: '相手のクリーチャーはタップして出る' },
    { name: '手札は捨てられない（別表記）', re: /^自分の手札は(、)?相手の(呪文の効果(や|または)(相手の)?クリーチャーの能力|呪文またはクリーチャーの能力|クリーチャーの能力または呪文)によって捨てられない。?$/, auto: true, set: (k) => (k.noDiscardByOpp = true), desc: '相手の効果で手札を捨てさせられない' },
    { name: '相手の呪文のコスト増（すべて）', re: /^相手の呪文を唱えるコストは(すべて)?(\d+)多くなる。?$/, auto: true, set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'opp', subj: '呪文', n: +m[2] })), desc: '相手の呪文のコストが上がる' },
    { name: 'コスト以下に能力を与える', re: /^自分のコスト(\d+)以下の(、)?([^、。「」]*?)クリーチャー(すべて)?は「(.+?)」(と「(.+?)」)?を得る。?$/, auto: true, set: (k, m) => (k.grant = { others: false, who: m[3] || '', maxCost: +m[1], names: [m[5], m[7]].filter(Boolean) }), desc: '軽いクリーチャーに能力を与える' },
    { name: 'アンタップなら離れない', re: /^このクリーチャーがバトルゾーンを離れる時に?アンタップしていたら、離れるかわりにとどまる。?$/, auto: true, set: (k) => (k.stayIfUntapped = true), desc: 'アンタップしていれば離れない' },
    { name: '数だけコスト軽減2', re: /^(自分の墓地の|自分の墓地にある|すべての墓地にある|バトルゾーンにある|自分のマナゾーンにある|相手のマナゾーンにある|自分の手札にある)(他の)?(呪文|クリーチャー|カード)(\d+)(枚|体|つ)につき、このクリーチャーの召喚コストを(\d+)少なくする。?$|^(すべての墓地)にある(カード)の数だけ、このクリーチャーの召喚コストを(1)少なくする。?$/, auto: true, set: (k, m) => { const z = m[1] || m[7]; k.costPer2 = { where: /すべての墓地/.test(z) ? 'allGrave' : /墓地/.test(z) ? 'grave' : /バトル/.test(z) ? 'allBattle' : /相手のマナ/.test(z) ? 'oppMana' : /手札/.test(z) ? 'hand' : 'mana', type: m[3] || m[8], per: +(m[4] || 1), n: +(m[6] || m[9]) }; }, desc: 'ゾーンのカードの数に応じて召喚コストが下がる' },
    { name: '数だけコスト軽減', re: /^このクリーチャーの召喚コストを(、)?(自分の|相手の)?(.*?)(\d+)(体|枚|つ)につき(\d+)少なくする.*$/, auto: true, set: (k, m) => (k.costPer = { side: m[2] === '相手の' ? 'opp' : 'self', what: m[3], per: +m[4], n: +m[6] }), desc: '数に応じて召喚コストが下がる（1未満にはならない）' },
    { name: '数だけパワー', re: /^(自分の)?(マナゾーン|墓地|バトルゾーン)(にある|の)(.*?)(\d+)(枚|体|つ)につき(、)?このクリーチャーのパワーを\+(\d+)する。?$/, auto: true, set: (k, m) => (k.powerPer = { zone: m[2], what: m[4], per: +m[5], n: +m[8] }), desc: '数に応じてパワーが上がる' },
    { name: 'ガードマン', re: /^ガードマン$/, auto: true, set: (k) => (k.guardman = true), desc: '自分の他のクリーチャーが攻撃された時、攻撃先をこのクリーチャーに変えられる' },
    { name: 'チャージャー（旧表記）', re: /^この呪文を(自分の手札から)?唱えた後、墓地に置くかわりに(、)?(自分の)?マナゾーンに置く。?$/, auto: true, set: (k) => (k.charger = true), desc: '唱えた後、墓地のかわりにマナに置く' },
    { name: 'パワーで能力を得る', re: /^このクリーチャーは(、)?パワーが(\d+)以上の時、「(.+?)」を得る。?$/, auto: true, set: (k, m) => (k.powerGrant = { min: +m[2], name: m[3] }), desc: 'パワーが一定以上なら能力を得る' },
    { name: '場の数だけパワー', re: /^このクリーチャーのパワーは(、)?バトルゾーンにある(自分の|相手の)?(他の)?(.*?)(\d+)(体|枚|つ)につき\+(\d+)される。?$/, auto: true, set: (k, m) => (k.powerPer = { zone: 'バトルゾーン', side: m[2] === '相手の' ? 'opp' : 'self', others: !!m[3], what: m[4], per: +m[5], n: +m[7] }), desc: '場の数に応じてパワーが上がる' },
    { name: 'ブロック中のパワー', re: /^(ブロック中、|このクリーチャーがブロックしている(時|間)、)このクリーチャーのパワーは\+(?<n>\d+)される。?$/, auto: true, set: (k, m) => (k.blockPower = +m.groups.n), desc: 'ブロックしている間パワーが上がる' },
    { name: '呪文コスト増', re: /^相手の呪文を唱えるコストは(\d+)多くなる。?$/, auto: true, set: (k, m) => (k.spellTax = +m[1]), desc: '相手の呪文のコストが上がる' },
    { name: '攻撃先の変更', re: /^このクリーチャーをアンタップして、相手クリーチャーの攻撃先をこのクリーチャー/, auto: true, set: (k) => ((k.guardman = true), (k.guardTapped = true)), desc: '相手の攻撃先を、このクリーチャーに変えられる（ガードマンとして処理）' },
    { name: 'ブレイクしたシールドを墓地へ', re: /^このクリーチャーがシールドをブレイクする時、相手はそのシールドを手札に加えるかわりに墓地に置く。?$/, auto: true, set: (k) => (k.breakToGrave = true), desc: 'このクリーチャーがブレイクしたシールドは、手札ではなく墓地へ' },
    { name: 'すべてのバトルに勝つ', re: /^このクリーチャーは(、)?すべてのバトルに勝つ。?$/, auto: true, set: (k) => (k.winAllBattles = true), desc: 'バトルでは必ず勝つ' },
    { name: '選ばれない（旧表記）', re: /^相手がバトルゾーンにあるクリーチャーを選ぶ時、このクリーチャーを選ぶことはできない。?$/, auto: true, set: (k) => (k.untargetable = true), desc: '相手に選ばれない' },
    { name: 'マナより重いクリーチャーはマナへ', re: /^相手のマナゾーンにあるカードの枚数よりコストが大きい相手のクリーチャーが出る時、かわりにそれを持ち主のマナゾーンに置く。?$/, auto: true, set: (k) => (k.manaGate = true), desc: '相手のマナより重い相手のクリーチャーは、出るかわりにマナへ' },
    { name: 'パワーがあれば離れない', re: /^このクリーチャーが(バトルゾーンを)?離れる時、そのパワーが(\d+)より大きければ、(離れる)?かわりにとどまる。?$/, auto: true, set: (k, m) => (k.stayIfPower = +m[2]), desc: 'パワーが一定より大きければ離れない' },
    { name: 'マナ武装で強化', re: /^マナ武装\s*(\d+)[：:]自分のマナゾーンに(光|水|闇|火|自然)のカードが(\d+)枚以上あれば、このクリーチャーのパワーを\+(\d+)し、「(.+?)」(と「(.+?)」)?を与える。?$/, auto: true, set: (k, m) => (k.manaArmedBuff = { civ: { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[2]], n: +m[3], power: +m[4], names: [m[5], m[7]].filter(Boolean) }), desc: 'マナ武装：パワーが上がり能力を得る' },
    { name: 'メタモーフ', re: /^メタモーフ/, desc: 'マナが7枚以上なら追加の能力を得る' },
    { name: '超魂レイド', re: /^超魂レイド/, desc: '出た時に山札の上から進化元になれるカードを下に置ける' },
    { name: '相手に選ばせない（場にある間）', re: /^このクリーチャーがバトルゾーンにある間、相手が(バトルゾーンにある)?クリーチャーを選ぶ(時|とき)、(自分の)?(.+?)を選ぶことはできない。?$/, auto: true, set: (k, m) => (k.protect = { who: m[4].replace(/^自分の/, '') }), desc: '場にある間、相手は指定のクリーチャーを選べない' },
    { name: '多色を選ばせない', re: /^相手が(バトルゾーンにある)?クリーチャーを選ぶ(時|とき)、自分の多色クリーチャーは選べない。?$/, auto: true, set: (k) => (k.protect = { multi: true }), desc: '相手は自分の多色クリーチャーを選べない' },
    { name: 'シールドに置かれた時に手札から出る', re: /^(自分のシールドゾーンにカードが|カードが自分のシールドゾーンに)置かれた時、このクリーチャーを自分の手札からバトルゾーンに出してもよい。?$/, auto: true, set: (k) => (k.enterOnShieldAdd = true), desc: '自分のシールドが増えた時、手札から出せる' },
    { name: '種族や文明の全体パワー', re: /^(バトルゾーンにある)?自分の(他の)?(、)?(?<who>[^。、]*?)すべてのパワーを\+(?<n>\d+)(する|し、「(?<g1>.+?)」(と「(?<g2>.+?)」)?を与える)。?$/, auto: true,
      set: (k, m) => {
        let who = m.groups.who.replace(/(・)?クリーチャー$/, '');
        const cm = who.match(/^(光|水|闇|火|自然)の/);
        const civ = cm ? CIVJ[cm[1]] : null;
        if (cm) who = who.slice(cm[0].length).replace(/(・)?クリーチャー$/, '');
        (k.teamPowers = k.teamPowers || []).push({ n: +m.groups.n, others: !!m[2], who: who || null, civ });
        if (m.groups.g1) k.grant = { others: !!m[2], who: who || null, civ, names: [m.groups.g1, m.groups.g2].filter(Boolean) };
      }, desc: '自分の（種族・文明の）クリーチャーのパワーを上げる' },
    { name: '全体のパワー', re: /^バトルゾーンにある自分の(他の)?(.*?)(クリーチャー)?すべてのパワーは\+(\d+)される。?$/, auto: true, set: (k, m) => (k.teamPower = { n: +m[4], others: !!m[1], who: m[2] }), desc: '自分のクリーチャーのパワーを上げる' },
    { name: '唱えた後シールドの上に置く', re: /^この呪文を(自分の手札から)?唱えた後、墓地(に置く|の)かわりに(、)?(表向きのまま)?(自分の)?(表向きのまま)?シールド(ゾーンにある)?(\d+)つの上に(表向きに(して)?)?置く。?$/, auto: true, set: (k, m) => { k.fortifyAfterCast = true; if (m[1]) k.fortifyFromHand = true; }, desc: '唱えた後、シールドの上に表向きで置く（城と同じく、ブレイクされると墓地へ）' },
    { name: 'タマシードから進化でコスト減', re: /^タマシードから進化するなら、このクリーチャーの召喚コストを(\d+)少なくする。?$/, auto: true, set: (k, m) => (k.tamaEvoDiscount = +m[1]), desc: 'タマシードを進化元にすると召喚コストが下がる' },
    { name: '数があればコスト減', re: /^(バトルゾーンに)?自分の(.+?)が(\d+)(体|枚|つ)以上あれば、このクリーチャーの召喚コストを(\d+)少なくする。?$/, auto: true, set: (k, m) => (k.costIfCount = { what: m[2], n: +m[3], minus: +m[5] }), desc: '条件の数がそろうと召喚コストが下がる' },
    { name: '離れるかわりに他を破壊', re: /^このクリーチャーが(バトルゾーンを)?離れる時、かわりに自分の(他の)?(《(.+?)》|クリーチャー)を?(\d+)(体|つ)(を)?破壊(する|してもよい)。?$/, auto: true, set: (k, m) => (k.leaveSub = { name: m[4] || null, optional: /してもよい/.test(m[0]) }), desc: '離れるかわりに自分の他のカードを破壊する' },
    { name: '離れる・破壊されるかわりに他を破壊', re: /^(?<w>このクリーチャーが(バトルゾーンを)?離れる|このクリーチャーが破壊される)時、かわりに自分の他の(、)?(?<who>[^、。]+?)を(\d+)(体|つ)(、)?破壊(する|してもよい)。?$/, auto: true,
      set: (k, m) => (k.leaveSub = { who: m.groups.who, destroyOnly: /破壊される/.test(m.groups.w), optional: /してもよい/.test(m[0]) }), desc: '離れる（破壊される）かわりに自分の他のカードを破壊する' },
    { name: '離れるかわりに手札を捨てる', re: /^このクリーチャーが(バトルゾーンを離れる|破壊される)時、(墓地に置く)?かわりに(?<who>[^、。]*?)を1(体|枚)、自分の手札から捨ててもよい。?$/, auto: true,
      set: (k, m) => (k.leaveSubDiscard = { who: m.groups.who, destroyOnly: /破壊/.test(m[1]) }), desc: '離れるかわりに手札を1枚捨てる' },
    { name: '離れるかわりにシールドを墓地へ', re: /^このクリーチャーがバトルゾーンを離れる時、かわりにカードを1枚、自分のシールドゾーンから墓地に置いてもよい。?$/, auto: true, set: (k) => (k.leaveSubShield = true), desc: '離れるかわりに自分のシールドを1つ墓地に置く' },
    { name: '破壊されるかわりにシールドを手札へ', re: /^このクリーチャーが破壊される時、(このクリーチャーを)?墓地に置くかわりに自分のシールドを1(枚|つ)(選び、)?手札に加えてもよい。?$/, auto: true, set: (k) => (k.escape = true), desc: 'エスケープと同じ' },
    { name: '相手のクリーチャーが出るかわりに', re: /^(?<turn>相手のターン中(に)?、)?(?<side>相手の|)(、)?(?<who>[^、。]*?)クリーチャーが(?<ns>召喚以外の方法で)?出る時、(相手は)?かわりに(それを|そのクリーチャーを)?(持ち主の)?(?<to>墓地|マナゾーン|山札の下)に置(く|かれる)。?$/, auto: true,
      set: (k, m) => {
        const g = m.groups;
        let who = (g.who || '').replace(/(の|、)$/, '');
        const neg = /ではない$/.test(who);
        who = who.replace(/ではない$/, '');
        (k.enterReplace = k.enterReplace || []).push({ side: g.side ? 'opp' : 'all', oppTurnOnly: !!g.turn, nonSummon: !!g.ns, who: who || null, neg, to: g.to === '墓地' ? 'grave' : g.to === 'マナゾーン' ? 'mana' : 'deckBottom' });
      }, desc: 'クリーチャーが出る時、かわりに別の場所へ置かせる' },
    { name: '手札から捨てられたら出る', re: /^(相手のターン(中)?に、?|相手のターン中、|相手の[^。]*?によって、)このクリーチャー(が|を)(自分の)?手札から捨て(られる|る)時、墓地に置くかわりに(自分の)?(バトルゾーンに)?(出|置)(す|く|してもよい|いてもよい)。?$/, auto: true, set: (k, m) => (k.madness = { turnOnly: /^相手のターン/.test(m[1] || '') }), desc: '相手の効果で手札から捨てられる時、かわりに場に出る' },
    { name: '最初の攻撃の終わりにアンタップ', re: /^各ターン、自分の各(.+?)の最初の攻撃の終わりに、そのクリーチャーをアンタップする。?$/, auto: true, set: (k, m) => (k.firstAttackUntap = { who: m[1] }), desc: '各ターン最初の攻撃の終わりにアンタップする' },
    { name: '攻撃の終わりに破壊（文明以外）', re: /^(光|水|闇|火|自然)ではないクリーチャーの攻撃の終わりに、そのクリーチャーを破壊する。?$/, auto: true, set: (k, m) => (k.attackEndDestroyNot = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[1]]), desc: '指定の文明以外のクリーチャーは、攻撃の終わりに破壊される' },
    { name: '相手は呪文を唱えられない（条件つき）', re: /^(自分のターン中、)?相手は(、)?((光|水|闇|火|自然)ではない|コスト(\d+)以下の)?呪文を唱えられない。?$/, auto: true, set: (k, m) => (k.spellLock2 = { myTurnOnly: !!m[1], notCiv: m[4] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[4]] : null, maxCost: m[5] ? +m[5] : null }), desc: '相手は呪文を唱えられない（条件つき）' },
    { name: '相手は出たターン攻撃できない', re: /^相手のクリーチャーは(、)?出たターン(に)?攻撃できない。?$/, auto: true, set: (k) => (k.oppNoAttackOnEntry = true), desc: '相手のクリーチャーは出たターン攻撃できない' },
    { name: '攻撃できない（旧表記）', re: /^このクリーチャーは(、)?攻撃することができない。?$/, auto: true, set: (k) => (k.cantAttack = true), desc: '攻撃できない' },
    { name: '選ばれない（旧表記2）', re: /^バトルゾーンにある自分のクリーチャーを相手が選ぶ時、このクリーチャーを選ぶことはできない。?$/, auto: true, set: (k) => (k.untargetable = true), desc: '相手に選ばれない' },
    { name: '墓地の枚数が足りないと攻撃できない', re: /^自分の墓地にカードが(\d+)枚以上なければ、このクリーチャーは攻撃できない。?$/, auto: true, set: (k, m) => (k.attackNeedGrave = +m[1]), desc: '墓地に指定の枚数がないと攻撃できない' },
    { name: '自分のクリーチャーはすべてのバトルに勝つ', re: /^自分のクリーチャーはすべてのバトルに勝つ。?$/, auto: true, set: (k) => (k.teamWinAll = true), desc: '自分のクリーチャーはすべてのバトルに勝つ' },
    { name: '相手のターン中の全体パワー', re: /^相手のターン中、自分の(他の)?クリーチャーすべてのパワーを\+(\d+)する。?$/, auto: true, set: (k, m) => (k.teamPower = { n: +m[2], others: !!m[1], oppTurnOnly: true }), desc: '相手のターン中、自分のクリーチャーのパワーが上がる' },
    { name: '他の全体パワーと能力', re: /^自分の他のクリーチャーすべてのパワーを\+(\d+)し、「(.+?)」(と「(.+?)」)?を与える。?$/, auto: true, set: (k, m) => ((k.teamPower = { n: +m[1], others: true }), (k.grant = { others: true, names: [m[2], m[4]].filter(Boolean) })), desc: '自分の他のクリーチャーのパワーを上げて能力を与える' },
    { name: '墓地の数だけパワー（別の書き方）', re: /^このクリーチャーのパワーを、?(自分の|すべての)墓地にある(呪文|カード|クリーチャー)(\d+)枚につき\+(\d+)する。?$/, auto: true, set: (k, m) => (k.powerPer = { zone: '墓地', all: m[1] === 'すべての', what: m[2] === 'カード' ? '' : m[2], per: +m[3], n: +m[4] }), desc: '墓地の数に応じてパワーが上がる' },
    { name: 'すべての墓地の数だけパワー', re: /^すべての墓地にあるカード(\d+)枚につき、このクリーチャーのパワーを\+(\d+)する。?$/, auto: true, set: (k, m) => (k.powerPer = { zone: '墓地', all: true, what: '', per: +m[1], n: +m[2] }), desc: 'すべての墓地の数に応じてパワーが上がる' },
    { name: '下のカードの数だけパワー', re: /^このクリーチャーの下にあるカード(\d+)枚につき、このクリーチャーのパワーを\+(\d+)する。?$/, auto: true, set: (k, m) => (k.powerPerUnder = { per: +m[1], n: +m[2] }), desc: '下にあるカードの数に応じてパワーが上がる' },
    { name: '破壊される時マナへ', re: /^このクリーチャーが(バトルゾーンから)?破壊される時、墓地(に置く|の)かわりに(自分の)?マナゾーンに置く。?$/, auto: true, set: (k) => (k.destroyToMana = true), desc: '破壊される時、墓地のかわりにマナに置く' },
    { name: '唱えた後手札に戻る', re: /^この呪文を(自分の手札から)?唱えた後、墓地に置くかわりに(自分の)?手札に戻す。?$/, auto: true, set: (k) => (k.returnAfterCast = true), desc: '唱えた後、墓地のかわりに手札に戻る' },
    { name: 'クリーチャーをタップして唱える', re: /^コストを支払うかわりに、自分の(光|水|闇|火|自然)?の?クリーチャーを(\d+)体タップして、この呪文を唱えてもよい。?$/, auto: true, set: (k, m) => (k.altTapCost = { civ: m[1] ? { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[1]] : null, n: +m[2] }), desc: 'マナのかわりに自分のクリーチャーをタップして唱えられる' },
    { name: 'ブレイクされる時タップで身代わり', re: /^自分のシールドがブレイクされる時、かわりに自分のクリーチャーを(\d+)体タップしてもよい。?$/, auto: true, set: (k) => (k.breakSubTap = true), desc: '自分のシールドがブレイクされる時、かわりに自分のクリーチャーをタップできる' },
    { name: '最初のブレイクを新しいシールドで受ける', re: /^各ターン、自分のシールドがはじめてブレイクされる時、かわりに自分の山札の上から1枚目を裏向きのまま、新しいシールドとして(自分の)?シールドゾーンに置いてもよい。?$/, auto: true, set: (k) => (k.firstBreakNewShield = true), desc: '各ターン最初のブレイクのかわりに、山札の上からシールドを増やせる' },
    { name: '相手がシールドに置く時墓地へ', re: /^相手のカードの効果によって、相手が自身のカードをシールドゾーンに置く時、かわりに墓地に置く。?$/, auto: true, set: (k) => (k.oppShieldToGrave = true), desc: '相手が自分のカードの効果でシールドを増やす時、かわりに墓地へ' },
    { name: '手札以外から出る時手札へ', re: /^エレメントが手札以外から出る時、かわりに持ち主の手札に戻す。?$/, auto: true, set: (k) => (k.noNonHandEntry = true), desc: '手札以外から出るエレメントは、かわりに手札へ' },
    { name: '条件つきで破壊時マナへ', re: /^このクリーチャーが破壊される時、バトルゾーンに自分の(光|水|闇|火|自然)のクリーチャーがあれば、墓地(に置く|の)かわりにマナゾーンに置く。?$/, auto: true, set: (k, m) => (k.destroyToManaIf = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[1]]), desc: '条件を満たせば、破壊される時マナへ' },
    { name: 'ブロック後にアンタップ', re: /^このクリーチャーがブロックした(時|とき)、バトルの後でアンタップする。?$/, auto: true, set: (k) => (k.untapAfterBlock = true), desc: 'ブロックしたバトルの後でアンタップする' },
    { name: 'ターンの終わりにアンタップ', re: /^(このクリーチャーがバトルゾーンにある間、)?自分のターンの終わりに、(このクリーチャー|これ)をアンタップ(する|してもよい|してよい)。?$/, auto: true, set: (k) => (k.untapAtEnd = true), desc: '自分のターンの終わりにアンタップする' },
    { name: '自分だけならパワー', re: /^バトルゾーンにある自分のクリーチャーがこのクリーチャーだけなら、パワーを\+(\d+)する。?$/, auto: true, set: (k, m) => (k.aloneBuff = +m[1]), desc: '自分のクリーチャーがこれだけならパワーが上がる' },
    { name: 'クリーチャーが足りないと攻撃できない', re: /^バトルゾーンに自分のクリーチャーが(\d+)体以上なければ、このクリーチャーは(相手プレイヤーを)?攻撃できない。?$/, auto: true, set: (k, m) => (k.attackNeedCreatures = { n: +m[1], playerOnly: !!m[2] }), desc: '自分のクリーチャーが足りないと攻撃できない' },
    { name: 'シールドが増えたターンだけプレイヤー攻撃', re: /^このターン中に(カードが)?自分のシールドゾーンに(カードが)?置かれていなければ、このクリーチャーは相手プレイヤーを攻撃できない。?$/, auto: true, set: (k) => (k.playerAttackNeedShieldAdded = true), desc: 'そのターンにシールドが増えていないとプレイヤーを攻撃できない' },
    { name: 'シールドの数でコスト増減', re: /^このクリーチャーを召喚するコストは、自分のシールド(\d+)枚につき(\d+)(多く|少なく)なる。?/, auto: true, set: (k, m) => (k.costPerShield = { per: +m[1], n: +m[2] * (m[3] === '多く' ? 1 : -1) }), desc: '自分のシールドの数で召喚コストが変わる' },
    { name: '文明以外の呪文のコスト増（全員）', re: /^(光|水|闇|火|自然)以外の呪文を唱えるコストは(\d+)多くなる。?$/, auto: true, set: (k, m) => (k.globalSpellTax = { exceptCiv: { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[1]], n: +m[2] }), desc: '指定文明以外の呪文のコストが上がる（全員）' },
    { name: '呪文を唱えたターンだけ召喚', re: /^呪文を唱えたターンのみ、このクリーチャーを召喚することができる。?$/, auto: true, set: (k) => (k.summonAfterSpell = true), desc: '呪文を唱えたターンだけ召喚できる' },
    { name: '可能なら選ばせる', re: /^相手がクリーチャーを選ぶなら、可能ならこのクリーチャーを選ぶ。?$/, auto: true, set: (k) => (k.forceChoose = true), desc: '相手はクリーチャーを選ぶ時、できればこのクリーチャーを選ぶ' },
    { name: '可能なら攻撃させる', re: /^相手のクリーチャーが攻撃するなら、可能ならこのクリーチャーを攻撃する。?$/, auto: true, set: (k) => (k.forceAttack = true), desc: '相手のクリーチャーは攻撃する時、できればこのクリーチャーを攻撃する' },
    { name: '場か表向きシールドにあれば全員勝つ', re: /^このクリーチャーがバトルゾーンまたは表向きで自分のシールドゾーンにあれば、自分のクリーチャーはすべてのバトルに勝つ。?$/, auto: true, set: (k) => (k.teamWinAll = true), desc: '自分のクリーチャーはすべてのバトルに勝つ' },
    { name: '場か表向きシールドにあれば能力を与える', re: /^このクリーチャーがバトルゾーンまたは表向きで自分のシールドゾーンにあれば、自分の他のクリーチャーすべてに「(.+?)」を与える。?$/, auto: true, set: (k, m) => (k.grant = { others: true, names: [m[1]] }), desc: '自分の他のクリーチャーに能力を与える' },
    { name: '他の文明のクリーチャーに能力', re: /^このクリーチャーがバトルゾーンにある間、バトルゾーンにある自分の他の(光|水|闇|火|自然)のクリーチャーは「(.+?)」を得る。?$/, auto: true, set: (k, m) => (k.grant = { others: true, civ: { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[1]], names: [m[2]] }), desc: '自分の他の指定文明のクリーチャーに能力を与える' },
    { name: '全員のパワーと能力', re: /^バトルゾーンにある自分のクリーチャーすべてのパワーは\+(\d+)され、「(.+?)」(と「(.+?)」)?を得る。?$/, auto: true, set: (k, m) => ((k.teamPower = { n: +m[1] }), (k.grant = { names: [m[2], m[4]].filter(Boolean) })), desc: '自分のクリーチャー全員のパワーを上げて能力を与える' },
    { name: 'パワーと能力', re: /^このクリーチャーのパワーは\+(\d+)され、「(.+?)」を得る。?$/, auto: true, set: (k, m) => (k.selfBuff = { n: +m[1], names: [m[2]] }), desc: 'パワーが上がり能力を得る' },
    { name: '破壊される時の行き先', re: /^このクリーチャーが(破壊される|バトルゾーンから自分の墓地に置かれる)(時|とき)、(このクリーチャーを)?(墓地に置くかわりに)?(、)?(自分の)?(手札に戻す|山札の一番上に置(く|いてもよい)|山札の一番下に置く|山札に戻す。その後、山札をシャッフルする|シールド化(する|してもよい)|裏向きにして自分のシールドに加える|表向きのまま(、)?(新しいシールドとして)?(自分の)?シールド(ゾーン|(\d+)つの上)に置く|新しいシールドとして自分のシールドゾーンに裏向きにして加える|裏向きにして自分のシールドゾーンに新しいシールドとして置く|かわりに自分の山札の上に置く)。?$/, auto: true, set: (k, m) => (k.destroyTo = /山札の上に置く$/.test(m[0].replace(/。$/, '')) ? 'deckTop' :  /手札/.test(m[7]) ? 'hand' : /一番上/.test(m[7]) ? 'deckTop' : /一番下/.test(m[7]) ? 'deckBottom' : /シャッフル/.test(m[7]) ? 'deckShuffle' : 'shields'), desc: '破壊される時、墓地のかわりに別の場所へ' },
    { name: 'アクセル', re: /^アクセル/, desc: 'このクリーチャーを召喚したターン、追加の能力を得る' },
    { name: 'ナイト・マジック', re: /^ナイト・マジック/, desc: 'ナイトがいれば呪文の効果を2回使う' },
    { name: 'サイクロン', re: /^サイクロン/, desc: 'ゴッドのリンクに関する能力' },
    { name: 'スペース・チャージ', re: /^スペース・チャージ/, desc: '指定の文明の呪文を唱えた時に能力を使う' },
    { name: 'ソウルシフト', re: /^ソウルシフト/, desc: '種族を持つクリーチャーの数だけコストが下がる' },
    { name: 'デュエリスト', re: /^デュエリスト/, desc: 'デュエリストに関する能力' },
    { name: 'バズレンダ', re: /^バズレンダ/, desc: '追加コストを払った回数だけ効果を繰り返す' },
    { name: 'ニンジャ・チェンジ', re: /^ニンジャ・チェンジ/, desc: '攻撃中に手札のシノビと入れ替える' },
    { name: 'O・ドライブ', re: /^O・ドライブ/, desc: '追加コストを払うと追加の効果' },
    { name: 'キリフダッシュ', re: /^キリフダッシュ\s*〔代替([lwdfnc]+)(\d{2})〕/, auto: true, set: (k, m) => {
        const CV = { l: 'light', w: 'water', d: 'darkness', f: 'fire', n: 'nature' };
        k.kirifuda = { cost: +m[2], civs: [...new Set(m[1].split(''))].map((x) => CV[x]).filter(Boolean) };
      }, desc: '自分のクリーチャーの攻撃の終わりに、その攻撃でシールドをブレイクしていれば、指定のコストで召喚できる' },
    { name: 'メカ・フレンド・バースト', re: /^メカ・フレンド・バースト/, desc: 'メカが出た時に呪文側を唱えられる' },
    { name: '水晶ソウル', re: /^水晶ソウル/, desc: 'マナの裏向きカードに関する能力' },
    { name: 'フォートE', re: /^フォートE/, desc: '指定のカードとして扱う能力' },
    { name: 'ループ覚醒', re: /^ループ覚醒/, desc: '裏返して別の面になる' },
    { name: '光臨', re: /^光臨/, desc: 'ターンの終わりにタップしていれば、山札からクリーチャーを出す' },
    { name: '龍解', re: /^龍解/, desc: 'ドラグハートを裏返してクリーチャー側にする' },
    { name: 'シールド・プラス', re: /^シールド・プラス/, desc: 'シールドの下にカードを重ねる' },
    { name: 'Jトルネード', re: /^(Jトルネード)\s*$/, desc: '自分のジョーカーズを手札に戻して効果を使う' },
    { name: '城（旧）', re: /^城[－\-―]/, desc: 'シールドに付けて要塞化する（このツールでは手動）' },
    { name: 'G-NEO進化', re: /^G-NEO進化[：:－-]?\s*(.*)$/, auto: true, set: (k, m) => (k.evolution = 'neo'), desc: 'NEO進化として処理（G-NEOの追加効果は手動）' },
    { name: '真・エスケープ', re: /^真・エスケープ/, auto: true, set: (k) => (k.escape = true), desc: 'エスケープとして処理' },
    { name: 'チャージャー', re: /^(水晶)?チャージャー$/, auto: true, set: (k) => (k.charger = true), desc: '唱えた後、墓地のかわりにマナに置く' },
    { name: 'シンカライズ', re: /^シンカライズ([：:].*)?$/, auto: true, set: (k) => (k.sinkarize = true), desc: '進化クリーチャーの進化元にできる' },
    { name: 'ブロックされない', re: /^このクリーチャーは(、)?ブロックされない。?$/, auto: true, set: (k) => (k.unblockable = true), desc: 'ブロックされない' },
    { name: '誰も文明以外を使えない', re: /^(?<cond>相手のシールドが(\d+)つ以下なら、)?(このクリーチャーがバトルゾーンにある間、)?誰も(、)?(?<cr>(?<cv1>光|水|闇|火|自然)以外のクリーチャーを召喚したり、)?(?<cv2>光|水|闇|火|自然)以外の呪文を唱えられない。?$/, auto: true,
      set: (k, m) => (k.globalBan = { exceptCiv: CIVJ[m.groups.cv2], creature: !!m.groups.cr, oppShieldsLE: m.groups.cond ? +m[2] : null }), desc: '誰も指定の文明以外の呪文（とクリーチャー）を使えない' },
    { name: '各ターンの回数制限', re: /^(?<who>相手|プレイヤー)は(、)?(各ターン(、)?|自身のターンに)(?<what>クリーチャーを|呪文を)?(?<n>\d+)(体|回)(まで)?しか(クリーチャーを|呪文を)?(バトルゾーンに)?(出せない|唱えられない)。?$/, auto: true,
      set: (k, m) => {
        const sp = /唱え/.test(m[0]);
        (k.turnLimit = k.turnLimit || []).push({ side: m.groups.who === '相手' ? 'opp' : 'all', spell: sp, n: +m.groups.n, oppTurnOnly: /自身のターン/.test(m[0]) });
      }, desc: '1ターンに出せる・唱えられる回数を制限する' },
    { name: '各ターンの回数制限2', re: /^(?<turn>相手のターン中、)?(?<who>相手|プレイヤー)は(、)?(各ターン(、)?)?(自身の)?クリーチャーを(各ターン)?(?<n>\d+)体(まで)?しか(バトルゾーンに)?出せない。?$/, auto: true,
      set: (k, m) => (k.turnLimit = (k.turnLimit || []).concat({ side: m.groups.who === '相手' ? 'opp' : 'all', spell: false, n: +m.groups.n, oppTurnOnly: !!m.groups.turn })), desc: '1ターンに出せるクリーチャーの数を制限する' },
    { name: '相手は自分を攻撃できない', re: /^相手のクリーチャーは(、)?自分を攻撃できない。?$/, auto: true, set: (k) => (k.noPlayerAttack = true), desc: '相手のクリーチャーはプレイヤーを攻撃できない' },
    { name: '相手のブレイク数を1に', re: /^相手のクリーチャーは(、)?攻撃1回につきシールドを1枚しかブレイクできない。?$/, auto: true, set: (k) => (k.oppBreakCap = 1), desc: '相手のクリーチャーは1回の攻撃でシールドを1つしかブレイクできない' },
    { name: 'パワーで攻撃できない', re: /^(このクリーチャーがバトルゾーンにある間、)?(パワー(?<max>\d+)以下の相手の|パワー(?<min>\d+)以上の|このクリーチャーよりパワーが小さい)クリーチャーは攻撃できない。?$/, auto: true,
      set: (k, m) => (k.attackBan = { maxPower: m.groups.max ? +m.groups.max : null, minPower: m.groups.min ? +m.groups.min : null, lessThanSelf: /小さい/.test(m[0]), oppOnly: /相手の/.test(m[0]) }), desc: 'パワーの条件でクリーチャーは攻撃できない' },
    { name: '仲間がいないと攻撃できない', re: /^(バトルゾーンに)?自分の(?<other>他の)?(?<what>[^、。]+?)が(1体も)?なければ、このクリーチャーは(?<pl>相手プレイヤーを)?攻撃できない。?$/, auto: true,
      set: (k, m) => (k.attackNeedWhat = { what: m.groups.what, others: !!m.groups.other, playerOnly: !!m.groups.pl }), desc: '指定のカードが自分の場にないと攻撃できない' },
    { name: '攻撃できない能力を無視', re: /^自分の(?<who>[^、。]*?)(クリーチャー)?(が持つ|の持つ|の)、(?<pl>相手(プレイヤー)?を)?攻撃できない(能力|効果)(を|は)(すべて)?(無効にする|無視する|無効になる)。?$/, auto: true,
      set: (k, m) => (k.ignoreCantAttack = { who: (m.groups.who || '').replace(/^「(.+?)」を持つ$/, '「$1」を持つ') || null, playerOnly: !!m.groups.pl }), desc: '自分のクリーチャーの「攻撃できない」を無視する' },
    { name: 'エレメントは手札以外から出ない', re: /^(クリーチャー|エレメント)は(、)?持ち主の手札以外から(バトルゾーンに)?出ない。?$/, auto: true, set: (k) => (k.noNonHandPut = 'all'), desc: '手札以外からは出せない' },
    { name: '相手は手札以外から出せない', re: /^(相手|誰も)は?(、)?手札以外から(カード|クリーチャー)を出せない。?$/, auto: true, set: (k, m) => (k.noNonHandPut = m[1] === '相手' ? 'opp' : 'all'), desc: '手札以外からカードを出せない' },
    { name: '多色はタップして置く', re: /^(マナゾーンに置く(時|とき)、)?このカードはタップして置く。?$/, auto: true, set: () => {}, desc: 'マナゾーンにタップして置く（多色カード）' },
    { name: 'タップされていないクリーチャーを攻撃', re: /^このクリーチャーは(、)?(タップされていない|アンタップしている)クリーチャーを攻撃できる。?$/, auto: true, set: (k) => (k.attackUntapped = true), desc: 'アンタップしているクリーチャーも攻撃できる' },
    { name: 'クリーチャーを攻撃できない', re: /^このクリーチャーは(、)?(相手の)?クリーチャーを攻撃できない。?$/, auto: true, set: (k) => (k.cantAttackCreature = true), desc: 'クリーチャーを攻撃できない' },
    { name: '可能ならこのクリーチャーを攻撃（別表記）', re: /^(各ターン、)?相手のクリーチャーが(はじめて)?攻撃する(時|なら)、可能ならこのクリーチャーを攻撃する。?$/, auto: true, set: (k) => (k.forceAttack = true), desc: '相手のクリーチャーはできればこのクリーチャーを攻撃する' },
    { name: '可能なら毎ターン攻撃', re: /^(?<who>このクリーチャーは|すべてのクリーチャーは|相手のクリーチャーはすべて)(、)?可能(であれば|なら)(毎ターン)?攻撃する。?$/, auto: true,
      set: (k, m) => (k.mustAttack = /この/.test(m.groups.who) ? 'self' : /相手/.test(m.groups.who) ? 'opp' : 'all'), desc: 'できれば毎ターン攻撃する' },
    { name: '解除', re: /^解除$/, auto: true, set: (k) => (k.release = true), desc: '離れる時、かわりに表（コストの小さいほう）に戻る' },
    { name: '付いているクリーチャーの強化', re: /^これを(装備|クロス|付け)(した|た)クリーチャー(のパワー(は|を)\+(?<p>\d+)(される|する|され、|し、))?(は|に)?(、)?(「(?<g1>.+?)」(と「(?<g2>.+?)」)?を(得る|与える))?(?<ub>はブロックされない)?。?$/, auto: true,
      test: (line) => /パワー|「|ブロックされない/.test(line),
      set: (k, m) => {
        const hb = (k.hostBuff = k.hostBuff ? { ...k.hostBuff } : { power: 0, names: [] });
        if (m.groups.p) hb.power += +m.groups.p;
        hb.names = hb.names.concat([m.groups.g1, m.groups.g2].filter(Boolean));
        if (m.groups.ub) hb.unblockable = true;
      }, desc: '付けた（装備・クロスした）クリーチャーのパワーや能力を上げる' },
    { name: 'クロスギアのマナ置き', re: /^このクロスギアはマナゾーンにタップして置かれる。?$/, auto: true, set: () => {}, desc: 'マナゾーンにタップして置く' },
    { name: '破壊される時に下に置く', re: /^(?<who>このクリーチャー|自分の他の(、)?[^、。]+?)が破壊される時、墓地に置くかわりに(?<host>このクリーチャー|自分の[^、。]+?)(\d+体)?の下に置いてもよい。?$/, auto: true,
      set: (k, m) => (k.underRepl = (k.underRepl || []).concat({ self: m.groups.who === 'このクリーチャー', who: m.groups.who.replace(/^自分の他の(、)?/, ''), host: m.groups.host === 'このクリーチャー' ? null : m.groups.host.replace(/^自分の/, '') })), desc: '破壊される時、墓地のかわりにクリーチャーの下に置ける' },
    { name: 'バトル中破壊されない', re: /^(このクリーチャーは(、)?バトル中(、)?|バトル中、このクリーチャーは)破壊されない。?$/, auto: true, set: (k) => (k.noDestroyInBattle = true), desc: 'バトルでは破壊されない' },
    { name: '同じ名前のエグザイルは1体まで', re: /^自分の他の(、)?名前に《(.+?)》とある(エグザイル・)?クリーチャーを(バトルゾーンに)?出すことはできない。?$/, auto: true, set: (k, m) => (k.exileLock = m[2]), desc: '名前に《○○》とある自分のクリーチャーは、他に1体しか出せない' },
    { name: '味方が破壊される時の行き先', re: /^自分の(他の)?(、)?(?<who>[^、。]+?)が破壊される時、(そのクリーチャーを)?墓地(に置く|の)かわりに(、)?(タップして)?(自分の)?(持ち主の)?(?<to>マナゾーン|手札|新しいシールドとして自分のシールドゾーン)に(裏向きにして)?(置く|戻す|加える|置いてもよい|戻してもよい|加えてもよい)。?$/, auto: true,
      set: (k, m) => (k.allyDestroyTo = (k.allyDestroyTo || []).concat({ who: m.groups.who, others: !!m[1], to: m.groups.to === '手札' ? 'hand' : /シールド/.test(m.groups.to) ? 'shields' : 'mana', optional: /もよい/.test(m[0]) })), desc: '自分のクリーチャーが破壊される時、墓地のかわりに別の場所へ' },
    { name: '相手は手札と山札以外から使えない', re: /^相手は(、)?自身の手札(または|か)山札以外からカードを使えない。?$/, auto: true, set: (k) => (k.oppUseOnlyHandDeck = true), desc: '相手は手札と山札以外からカードを使えない' },
    { name: '相手は手札と山札以外から出せない', re: /^相手の(エレメント|クリーチャー)は(、)?(相手の|自身の)手札(または|か)山札以外から出ない。?$/, auto: true, set: (k) => (k.oppEnterOnlyHandDeck = true), desc: '相手のカードは手札と山札以外からバトルゾーンに出ない' },
    { name: '自分のクリーチャーすべてに能力', re: /^(バトルゾーンにある)?自分の(他の)?(、)?(?<who>[^、。「」]*?)(クリーチャー)?(は|に)?すべて(に)?(、)?「(?<g1>.+?)」(と「(?<g2>.+?)」)?を(得る|与える)。?$/, auto: true,
      set: (k, m) => {
        let who = (m.groups.who || '').replace(/(・)?クリーチャー$/, '').replace(/の$/, '');
        const cm = who.match(/^(光|水|闇|火|自然)(の)?/);
        const civ = cm ? CIVJ[cm[1]] : null;
        if (cm) who = who.slice(cm[0].length).replace(/(・)?クリーチャー$/, '');
        k.grant = { others: !!m[2], who: who || null, civ, names: [m.groups.g1, m.groups.g2].filter(Boolean) };
      }, desc: '自分のクリーチャーすべてに能力を与える' },
    { name: '相手はキーワードを使えない', re: /^(?<who>相手は|誰も)(、)?((?<civ>光|水|闇|火|自然)のカードの)?「(?<kw>S・トリガー|G・ストライク|ニンジャ・ストライク|革命チェンジ|侵略)」(能力)?を使えない。?$/, auto: true,
      set: (k, m) => (k.kwBan = { side: m.groups.who === '相手は' ? 'opp' : 'all', kw: m.groups.kw, civ: m.groups.civ ? CIVJ[m.groups.civ] : null }), desc: '相手（全員）は指定の能力を使えない' },
    { name: '負けない（常時）', re: /^自分は(、)?ゲームに負けない。?$/, auto: true, set: (k) => (k.noLoseStatic = true), desc: '自分はゲームに負けない' },
    { name: '勝つ（常時）', re: /^自分は(、)?ゲームに(勝つ|勝利する)。?$/, auto: true, set: (k) => (k.winStatic = true), desc: '条件を満たすとゲームに勝つ' },
    { name: 'このクリーチャーは破壊以外で離れない', re: /^このクリーチャーは(、)?破壊以外の方法で(バトルゾーンを)?離れない。?$/, auto: true, set: (k) => (k.selfOnlyDestroy = true), desc: 'このクリーチャーは破壊以外で離れない' },
    { name: '破壊以外で離れない', re: /^自分のクリーチャーは(、)?破壊以外の方法で(バトルゾーンを)?離れない。?$/, auto: true, set: (k) => (k.teamOnlyDestroy = true), desc: '自分のクリーチャーは破壊以外で離れない' },
    { name: '種族のマナはアンタップ', re: /^(自分の)?([^、。]+?)(・カード|カード)を(自分の)?マナゾーンに置いた(時|とき)、(それ|そのカード)をアンタップする。?$/, auto: true, set: (k, m) => (k.manaUntapWho = m[2]), desc: '指定のカードをマナゾーンに置いた時、アンタップする' },
    { name: '重いとさらにコスト軽減', re: /^自分の(?<subj>[^、。]+?)の召喚コストを(?<n>\d+)少なくする。そのコストが(?<c>\d+)以上なら、追加で(?<n2>\d+)少なくする。?$/, auto: true,
      set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: m.groups.subj, n: -m.groups.n }, { side: 'self', subj: 'コスト' + m.groups.c + '以上の' + m.groups.subj, n: -m.groups.n2 })), desc: '召喚コストを下げる（重ければさらに下げる）' },
    { name: '唱えられなくする効果を無視', re: /^この(呪文|カード)を(唱えられなく|使えなく)する効果を無視する。?$/, auto: true, set: (k) => (k.ignoreLock = true), desc: '唱えられなくする効果を受けない' },
    { name: '単色の効果を無視', re: /^多色ではない(、)?クリーチャーの能力と呪文の効果を無視する。?$/, auto: true, set: (k) => (k.ignoreMono = true), desc: '多色ではないカードの能力・効果を受けない' },
    { name: 'パワー0以下の間は離れない', re: /^このクリーチャーは(、)?パワーが0以下の間(、)?離れない。?$/, auto: true, set: (k) => (k.zeroNoLeave = true), desc: 'パワーが0以下の間、離れない' },
    { name: '攻撃中は相手が出せない', re: /^このクリーチャーの攻撃中、相手はクリーチャーを(バトルゾーンに)?出せない。?$/, auto: true, set: (k) => (k.noEnterWhileAttack = true), desc: 'このクリーチャーの攻撃中、相手はクリーチャーを出せない' },
    { name: '種族はすべてのバトルに勝つ', re: /^自分の([^、。]+?)(・)?クリーチャーは(、)?すべてのバトルに勝つ。?$/, auto: true, set: (k, m) => (k.teamWinRace = m[1]), desc: '指定の自分のクリーチャーはすべてのバトルに勝つ' },
    { name: '出たターンに攻撃できない（全体）', re: /^([^、。]+?)ではないクリーチャーは(、)?(バトルゾーンに)?出たターンに攻撃できない。?$/, auto: true, set: (k, m) => (k.globalSickExcept = m[1]), desc: '指定以外のクリーチャーは出たターンに攻撃できない' },
    { name: 'マナに置いた時に見せてアンタップ', re: /^このカードを自分の(手札から)?マナゾーンに置いた(時|とき)、自分の手札にある([^、。]+?)(・)?カードを1枚、(表向きにして|相手に見せて)もよい。そうしたら、このカードをアンタップする。?$/, auto: true, set: (k, m) => (k.chargeReveal = m[3]), desc: '手札からマナに置いた時、指定のカードを見せればアンタップ' },
    { name: '超GRに3枚以上', re: /^(このカード|《.+?》)は(、)?(\d+)枚より多く超GRに入れることができる。?$/, auto: true, set: (k) => (k.noCopyLimit = true), desc: '超GRに3枚以上入れられる' },
    { name: 'どの種族の進化でも置ける', re: /^(この(クリーチャー|タマシード)の上に、どの種族の進化クリーチャーを置いてもよい|どんな種族の進化クリーチャーを、このクリーチャーの上に置いてもよい)。?$/, auto: true, set: () => {}, desc: '種族を問わず進化元になれる（この対戦エンジンは進化元の種族を問わないので常に満たす）' },
    { name: '飛行', re: /^飛行$/, auto: true, set: (k) => (k.flying = true), desc: '飛行を持たないクリーチャーから攻撃もブロックもされない' },
    { name: 'G・ブレイカー', re: /^G・ブレイカー$/, auto: true, set: (k) => { k.breaker = 99; k.gBreaker = true; }, desc: '相手のシールドをすべてブレイクし、攻撃の後に自分のシールドもすべてブレイクする' },
    { name: 'タップして出てもよい', re: /^このクリーチャーを(、)?タップしてバトルゾーンに出してもよい。?$/, auto: true, set: (k) => (k.enterTappedOpt = true), desc: 'タップして出すかを選べる' },
    { name: 'タップして出る（置く）', re: /^バトルゾーンに出す時、このクリーチャーはタップして置く。?$/, auto: true, set: (k) => (k.enterTapped = true), desc: 'タップして出る' },
    { name: 'バトルに勝っても破壊される', re: /^このクリーチャーは(、)?バトルに勝っても、バトルの(後|あと)(、)?(破壊される|持ち主の墓地に置かれる)。?$/, auto: true, set: (k) => (k.dieAfterBattle = true), desc: 'バトルの後、破壊される' },
    { name: '呪文で選ばれない', re: /^このクリーチャーは(、)?呪文によって相手に選ばれない。?$/, auto: true, set: (k) => (k.untargetableSpell = true), desc: '相手の呪文で選ばれない' },
    { name: '小さいものにブロックされない', re: /^このクリーチャーは(、)?これよりパワーが小さいクリーチャーにブロックされない。?$/, auto: true, set: (k) => (k.unblockableSmaller = true), desc: '自分よりパワーが小さいクリーチャーにブロックされない' },
    { name: 'アンタップの文明を攻撃', re: /^このクリーチャーは(、)?タップされていない(光|水|闇|火|自然)のクリーチャーを攻撃できる。?$/, auto: true, set: (k, m) => (k.attackUntappedCiv = civsIn(m[2])[0]), desc: '指定の文明のアンタップしているクリーチャーも攻撃できる' },
    { name: 'シールドの数だけパワー減', re: /^自分のシールド(\d+)(つ|枚)につき、このクリーチャーのパワーを-(\d+)する。?$/, auto: true, set: (k, m) => (k.powerPerShield = { per: +m[1], n: -m[3] }), desc: '自分のシールドの数だけパワーが下がる' },
    { name: '名前のエグザイルは出せない', re: /^自分の他の(、)?名前に[《「](.+?)[》」]とある(エグザイル・)?クリーチャーは(バトルゾーンに)?出せない。?$/, auto: true, set: (k, m) => (k.exileLock = m[2]), desc: '名前に○○とある自分のクリーチャーは、他に出せない' },
    { name: '相手は出たターン自分を攻撃できない', re: /^相手のクリーチャーは(、)?(バトルゾーンに)?出たターン(、|に)?(自分|あなた)を攻撃できない。?$/, auto: true, set: (k) => (k.oppSickNoPlayer = true), desc: '相手のクリーチャーは出たターン、プレイヤーを攻撃できない' },
    { name: '可能ならブロックする', re: /^相手のクリーチャーが攻撃する時、このクリーチャーは可能であればブロックする。?$/, auto: true, set: (k) => (k.mustBlock = true), desc: '可能ならブロックする' },
    { name: '名前のコスト軽減', re: /^自分の(、)?名前に[《「](.+?)[》」]とあるクリーチャーを召喚するコストを(\d+)少なくしてもよい。?$/, auto: true, set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: 'クリーチャー', nameHas: m[2], n: -m[3] })), desc: '名前に○○とあるクリーチャーのコストを下げる' },
    { name: '種族のコスト軽減', re: /^自分の([^、。「」《》]+?)を召喚するコストを(\d+)少なくしてもよい。?$/, auto: true, set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: m[1], n: -m[2] })), desc: '指定のクリーチャーのコストを下げる' },
    { name: '文明のクリーチャーに能力', re: /^(バトルゾーンにある)?自分の(光|水|闇|火|自然)と(光|水|闇|火|自然)のクリーチャーは「(.+?)」を得る。?$/, auto: true, set: (k, m) => (k.grant = { others: false, who: null, civ: null, civs: civsIn(m[2] + m[3]), names: [m[4]] }), desc: '指定の文明のクリーチャーに能力を与える' },
    { name: 'マナ進化', re: /^マナ進化(GV|V)?\s*[：:\-－―]\s*(.+)$/, auto: true,
      set: (k, m) => {
        const t = m[2];
        const n = +((t.match(/(\d+)体/) || [])[1] || (m[1] === 'GV' ? 3 : m[1] === 'V' ? 2 : 1));
        const what = (t.match(/^([^、。]*?)(・)?クリーチャーを/) || [])[1] || '';
        k.evolution = 'grave';
        k.graveEvo = { n, any: false, civs: civsIn(what), what: /^(光|水|闇|火|自然)の?$/.test(what) ? '' : what, zone: 'mana' };
      }, desc: '自分のマナゾーンのクリーチャーの上に重ねて出す' },
    { name: '種族にサバイバーを追加', re: /^自分の(光|水|闇|火|自然)のクリーチャーはすべて、種族にサバイバーを追加する。?$/, auto: true, set: (k, m) => (k.addSurvivor = { 光: 'light', 水: 'water', 闇: 'darkness', 火: 'fire', 自然: 'nature' }[m[1]]), desc: '指定の文明のクリーチャーをサバイバーとして扱う' },
    { name: 'サバイバー', re: /^サバイバー\s*$/, auto: true, set: () => {}, desc: 'このクリーチャーがバトルゾーンにある間、自分の他のサバイバーもすぐ上の能力を得る' },
    { name: 'サイレントスキル', re: /^サイレントスキル\s*$/, auto: true, set: (k) => (k.silentSkill = true), desc: '自分のターンのはじめにタップしていたら、アンタップするかわりに次の能力を使ってもよい' },
    { name: '手札進化', re: /^手札進化\s*[：:\-－―]\s*(.+)$/, auto: true,
      set: (k, m) => {
        const t = m[1];
        k.evolution = 'grave';
        k.graveEvo = { n: +((t.match(/(\d+)体/) || [])[1] || 1), any: false, civs: civsIn(t), what: '', zone: 'hand' };
      }, desc: '自分の手札のクリーチャーの上に重ねて出す' },
    { name: '選べない（相手がクリーチャーを選ぶ時）', re: /^相手が(自分の|バトルゾーンの|バトルゾーンにある)?クリーチャーを選ぶ(時|とき)、(相手は)?このクリーチャーを選(ぶことはできない|べない)。?$/, auto: true, set: (k) => (k.untargetable = true), desc: '相手に選ばれない' },
    { name: '墓地に置かれる時マナへ（自分）', re: /^このクリーチャーが(バトルゾーンから)?(自分の)?墓地に置かれる(時|とき)、墓地に置くかわりに(自分の)?(マナゾーン|手札)に(置く|戻す|加える)。?$/, auto: true, set: (k, m) => (k.selfDestroyTo = { to: m[5] === '手札' ? 'hand' : 'mana', optional: false, any: true }), desc: '墓地に置かれる時、かわりにマナ（手札）へ' },
    { name: '相手のマナはタップして置く', re: /^相手は(、)?(カードを(自身の)?マナゾーンに|自身のマナゾーンにカードを)置く(時|とき)、タップして置く。?$/, auto: true, set: (k) => (k.oppManaTapped = true), desc: '相手はマナゾーンにカードをタップして置く' },
    { name: '相手の指定文明はタップして出る', re: /^相手は(、)?(光|水|闇|火|自然)(または(光|水|闇|火|自然))?のクリーチャーをバトルゾーンに出す(時|とき)、そのクリーチャーをタップして置く。?$/, auto: true, set: (k, m) => (k.enterTappedAura = { opp: true, onlyCivs: civsIn(m[2] + (m[4] || '')) }), desc: '相手の指定文明のクリーチャーはタップして出る' },
    { name: '可能ならこのクリーチャーを攻撃（場合）', re: /^相手のクリーチャーが攻撃する場合、可能であればこのクリーチャーを攻撃する。?$/, auto: true, set: (k) => (k.forceAttack = true), desc: '相手のクリーチャーは可能ならこのクリーチャーを攻撃する' },
    { name: 'シールドをブレイクできない', re: /^このクリーチャーは(、)?シールドをブレイクできない。?$/, auto: true, set: (k) => (k.nullBreaker = true), desc: 'シールドをブレイクしない' },
    { name: '破壊される時マナへ（自分）', re: /^このクリーチャー(または自分の他の(?<who>[^、。]*?))?が破壊される(時|とき)、墓地に置くかわりに(自分の)?(持ち主の)?(マナゾーン|手札)に(置く|戻す|加える|置いてもよい|戻してもよい)。?$/, auto: true,
      set: (k, m) => {
        const to = m[6] === '手札' ? 'hand' : 'mana';
        if (m[1]) k.allyDestroyTo = (k.allyDestroyTo || []).concat({ who: (m.groups.who || 'クリーチャー').replace(/^他の/, ''), others: false, to, optional: /もよい/.test(m[0]) }), (k.selfDestroyTo = { to, optional: /もよい/.test(m[0]) });
        else k.selfDestroyTo = { to, optional: /もよい/.test(m[0]) };
      }, desc: '破壊される時、墓地のかわりにマナ（手札）へ' },
    { name: '捨てる時マナへ', re: /^自分が手札を捨てる(時|とき)、墓地に置くかわりに(自分の)?マナゾーンに置(く|いてもよい)。?$/, auto: true, set: (k) => (k.discardToMana = true), desc: '手札を捨てる時、墓地のかわりにマナへ' },
    { name: '召喚コストを下げる（支払うコスト）', re: /^このクリーチャーがバトルゾーンにある間、自分の([^、。]*?)を召喚する(時|とき)、支払うコストは(\d+)少なくなる。?$/, auto: true, set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: m[1], n: -m[3] })), desc: '指定のクリーチャーのコストを下げる' },
    { name: '墓地以外へ行かずにとどまる', re: /^自分のクリーチャーがバトルゾーンから(自分の)?墓地以外のゾーンに置かれる(時|とき)、かわりにバトルゾーンにとどまる。?$/, auto: true, set: (k) => (k.teamStayNonGrave = true), desc: '自分のクリーチャーは墓地以外へは離れない' },
    { name: '離れる時シールドを手札に', re: /^(各ターンに(1|一)度、)?自分の(他の)?([^、。]*?)が(バトルゾーンを)?離れる(時|とき)、かわりに自分のシールドを(\d+)(つ|枚)(、)?手札に(加え|戻し)てもよい。?$/, auto: true,
      set: (k, m) => (k.leaveSubHand = { once: !!m[1], others: !!m[3], who: m[4].replace(/(・)?クリーチャー$/, ''), n: +m[7] }), desc: '自分のクリーチャーが離れる時、かわりにシールドを手札に加えられる' },
    { name: '相手はタップして出す', re: /^(相手のクリーチャー|(光|水|闇|火|自然)以外のクリーチャー|自分のマナゾーンにあるカードの枚数よりコストが小さい相手のクリーチャー)は(、)?バトルゾーンに(出す時)?タップして置く。?$/, auto: true,
      set: (k, m) => (k.enterTappedAura = { opp: /相手の/.test(m[1]), exceptCiv: m[2] ? civsIn(m[2])[0] : null, lessThanMana: /枚数より/.test(m[1]) }), desc: '指定のクリーチャーはタップして出る' },
    { name: '相手はタップして出す（出す時）', re: /^相手のクリーチャーは(、)?バトルゾーンに出す時タップして置く。?$/, auto: true, set: (k) => (k.enterTappedAura = { opp: true }), desc: '相手のクリーチャーはタップして出る' },
    { name: 'マナにタップして置く', re: /^(マナゾーンに置く時、)?このカードは(マナゾーンに)?タップして置く。?$/, auto: true, set: (k) => (k.manaTapped = true), desc: 'マナゾーンにタップして置く' },
    { name: 'かわりにバトルする', re: /^自分の(他の)?([^、。]*?)が(相手(の)?クリーチャーと)?バトルする(時|とき)、かわりにこのクリーチャーにバトルさせてもよい。?$/, auto: true, set: (k, m) => (k.battleSub = { others: !!m[1], who: m[2].replace(/^「(.+?)」を持つ/, '$1').replace(/(・)?クリーチャー$/, '') }), desc: '指定の自分のクリーチャーのかわりにバトルできる' },
    { name: '唱えた後シールドの上に置く（束）', re: /^この呪文を(自分の手札から)?唱えた後、(墓地に置くかわりに(、)?)?自分のシールド(\d+)つの上に(、)?表向きにして置く。?$/, auto: true, set: (k, m) => { k.fortifyAfterCast = true; if (m[1]) k.fortifyFromHand = true; }, desc: '唱えた後、自分のシールドの上に表向きで重ねる' },
    { name: '数が足りなければ攻撃できない（マナも）', re: /^自分の、([^、。]+?)とマナゾーンにある([^、。]+?)(・カード|カード)が合計(\d+)(つ|枚)以上なければ、このクリーチャーは攻撃できない。?$/, auto: true, set: (k, m) => (k.attackNeedCount = { race: m[1], n: +m[4], withMana: true }), desc: '指定のカードが場とマナに合計N以上なければ攻撃できない' },
    { name: 'クリーチャー以外を使っていなければ攻撃できない', re: /^このターンに自分がクリーチャーではないカードを(実行|使用)していなければ、このクリーチャーは攻撃できない。?$/, auto: true, set: (k) => (k.attackNeedNonCreature = true), desc: 'このターンにクリーチャー以外を使っていなければ攻撃できない' },
    { name: 'コスト軽減（表向きで追加）', re: /^自分の([^、。]+?)(・カード)?を(実行|召喚)するコストを(\d+)少なくする。自分のシールドゾーンに表向きのカードがあれば、追加で(\d+)少なくする。?$/, auto: true,
      set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: m[1], n: -m[4] }, { side: 'self', subj: m[1], n: -m[5], needFaceUp: true })), desc: '指定のカードのコストを下げる（表向きのカードがあれば追加）' },
    { name: '離れるかわりに表向きを裏返す', re: /^自分の([^、。]+?)が(バトルゾーンを)?離れる(時|とき)、かわりに自分のシールドゾーンにある表向きのカードを1枚、裏向きにしてもよい。?$/, auto: true, set: (k, m) => (k.leaveSubFlip = { who: m[1].replace(/(・)?クリーチャー$/, '') }), desc: '指定の自分のクリーチャーが離れる時、かわりに表向きのカードを裏返せる' },
    { name: 'Nつブレイク（文章）', re: /^このクリーチャーは(、)?相手のシールドを(\d+)(枚|つ)ブレイクする。?$/, auto: true, set: (k, m) => (k.breaker = Math.max(k.breaker, +m[2])), desc: 'シールドをN枚ブレイクする' },
    { name: '毎ターン攻撃しなければならない', re: /^このクリーチャーは(、)?毎ターン(、)?攻撃しなければならない。?$/, auto: true, set: (k) => (k.mustAttack = 'self'), desc: 'できれば毎ターン攻撃する' },
    { name: 'タップして置く（バトルゾーン）', re: /^バトルゾーンに(置く|出す)時、このカードはタップして置く。?$/, auto: true, set: (k) => (k.enterTapped = true), desc: 'タップして出る' },
    { name: 'ステルス', re: /^(光|水|闇|火|自然)ステルス$/, auto: true, set: (k, m) => (k.stealth = civsIn(m[1])[0]), desc: '相手のマナゾーンに指定の文明があればブロックされない' },
    { name: '相手の呪文では離れない', re: /^相手の呪文の効果でこのクリーチャーがバトルゾーンから離れる(時|とき)、バトルゾーンから離れずにとどまる。?$/, auto: true, set: (k) => (k.noLeaveBySpell = true), desc: '相手の呪文で離れない' },
    { name: '相手のクリーチャーの数だけコスト軽減', re: /^(バトルゾーンにある)?相手のクリーチャー(\d+)体につき、このクリーチャーの召喚コストを(\d+)少なくする。?$/, auto: true, set: (k, m) => (k.costPer = { side: 'opp', what: 'クリーチャー', per: +m[2], n: +m[3] }), desc: '相手のクリーチャーの数だけコストが下がる' },
    { name: '破壊されるかわりに墓地を山札の下へ', re: /^このクリーチャーが破壊される(時|とき)、墓地に置くかわりに、カードを(\d+)枚、自分の墓地から好きな順序で山札の下に置いてもよい。?$/, auto: true, set: (k, m) => (k.destroyRepGraveBottom = +m[2]), desc: '破壊される時、かわりに墓地のカードを山札の下に置ける' },
    { name: '相手の手札の呪文の数だけパワー', re: /^このクリーチャーのパワーは(、)?相手の手札にある呪文(\d+)枚につき\+(\d+)される。?$/, auto: true, set: (k, m) => (k.powerPerOppHandSpell = { per: +m[2], n: +m[3] }), desc: '相手の手札の呪文の数だけパワーが上がる' },
    { name: '全員にブロッカーとターン終わりアンタップ', re: /^自分の(他の)?(コスト(\d+)以下の)?クリーチャー(すべてに「ブロッカー」を与え、それらを|はすべて「ブロッカー」を得、)自分のターンの終わりにアンタップする。?$/, auto: true, set: (k, m) => (k.grant = { others: !!m[1], who: m[3] ? null : null, maxCost: m[3] ? +m[3] : null, civ: null, names: ['ブロッカー', 'このクリーチャーは自分のターンの終わりにアンタップする'] }), desc: '自分のクリーチャーにブロッカーを与え、ターンの終わりにアンタップする' },
    { name: '仲間の数だけ相手の呪文のコスト増', re: /^自分の他のクリーチャー(\d+)体につき、相手の呪文を唱えるコストを(\d+)多くする。?$/, auto: true, set: (k, m) => (k.spellTaxPer = { per: +m[1], n: +m[2] }), desc: '自分の他のクリーチャーの数だけ相手の呪文のコストが上がる' },
    { name: '相手の効果で手札を捨てられない', re: /^相手の(、)?(呪文の効果(や|または)(相手の)?クリーチャーの能力|呪文またはクリーチャーの能力)によって、自分の手札は捨てられない。?$/, auto: true, set: (k) => (k.noDiscardByOpp = true), desc: '相手の効果で手札を捨てさせられない' },
    { name: '相手は各ターン1度しか攻撃できない', re: /^相手は各ターンに一度しか、自分または自分のクリーチャーを攻撃できない。?$/, auto: true, set: (k) => (k.oppAttackOnce = true), desc: '相手は各ターンに1度しか攻撃できない' },
    { name: '相手は各ターンN回までしか使えない', re: /^相手は各ターン合計(\d+)回までしか、クリーチャーを召喚したり呪文を唱えたりできない。?$/, auto: true, set: (k, m) => (k.oppPlayLimit = +m[1]), desc: '相手は各ターンN回までしか召喚・呪文ができない' },
    { name: '相手のコスト軽減は無効', re: /^相手のカードを使うコストを少なくする能力は無効になる。?$/, auto: true, set: (k) => (k.oppNoDiscount = true), desc: '相手のコスト軽減は無効' },
    { name: '小さいものとのバトルで破壊されない', re: /^このクリーチャーは(、)?パワー(\d+)以下のクリーチャーとのバトル中(、)?破壊されない。?$/, auto: true, set: (k, m) => (k.noDestroyVsPowerLE = +m[2]), desc: 'パワーが低い相手とのバトルでは破壊されない' },
    { name: '破壊される時シールドへ', re: /^このクリーチャーが破壊される(時|とき)、(墓地に置くかわりに、?)?裏向きにして、新しいシールドとして自分のシールドゾーンに(置く|加える)。?$/, auto: true, set: (k) => (k.selfDestroyTo = { to: 'shields', optional: false }), desc: '破壊される時、かわりにシールドになる' },
    { name: 'コストを下げてタップして出る', re: /^このクリーチャーを召喚するコストを(\d+)少なくしてもよい。そうしたら、このクリーチャーはタップしてバトルゾーンに出る。?$/, auto: true, set: (k, m) => (k.discountTapped = +m[1]), desc: 'コストを下げて、タップして出られる' },
    { name: '墓地の名前の呪文の数だけコスト軽減', re: /^このクリーチャーを召喚するコストは、自分の墓地にある、名前に《(.+?)》とある呪文(\d+)枚につき、(\d+)少なくなる。?$/, auto: true, set: (k, m) => (k.costPer = { side: 'self', zone: 'grave', what: m[1], spellName: true, per: +m[2], n: +m[3] }), desc: '墓地の指定の呪文の数だけコストが下がる' },
    { name: '相手はターンを追加できない', re: /^相手は(、)?ターンを追加できない。?$/, auto: true, set: (k) => (k.oppNoExtraTurns = true), desc: '相手はターンを追加できない' },
    { name: '自分のクリーチャーはブロック中破壊されない', re: /^自分のクリーチャーは(、)?ブロック中(、)?破壊されない。?$/, auto: true, set: (k) => (k.teamNoDestroyBlocking = true), desc: '自分のクリーチャーはブロック中破壊されない' },
    { name: 'バトル中、自分のクリーチャーは破壊されない', re: /^(バトル中、自分のクリーチャーは|自分のクリーチャーは(、)?バトル中(、)?)破壊されない。?$/, auto: true, set: (k) => (k.teamNoDestroyInBattle = true), desc: 'バトル中、自分のクリーチャーは破壊されない' },
    { name: '自分の他のクリーチャーは破壊以外で離れない', re: /^自分の他のクリーチャーは(、)?破壊以外の方法で(バトルゾーンを)?離れない。?$/, auto: true, set: (k) => (k.teamOnlyDestroyOthers = true), desc: '自分の他のクリーチャーは破壊以外で離れない' },
    { name: '相手は手札以外から呪文を唱えられない', re: /^相手は(、)?手札以外から呪文を唱えられない。?$/, auto: true, set: (k) => (k.oppSpellHandOnly = true), desc: '相手は手札以外から呪文を唱えられない' },
    { name: '出たターン離れない', re: /^このクリーチャーは(、)?(バトルゾーンに)?出たターン(、)?(バトルゾーンを)?離れない。?$/, auto: true, set: (k) => (k.noLeaveEnteredTurn = true), desc: '出たターンは離れない' },
    { name: '自分のクリーチャーは離れない', re: /^自分のクリーチャーは(、)?(バトルゾーンを)?離れない。?$/, auto: true, set: (k) => (k.teamNoLeave = true), desc: '自分のクリーチャーは離れない' },
    { name: '全員の出せる数・唱えられる数', re: /^すべてのプレイヤーは(、)?各ターン(、)?(クリーチャーを(\d+)体まで|呪文を(\d+)枚まで)しか(バトルゾーンに出せ|唱えられ)ない。?$/, auto: true, set: (k, m) => { if (m[4]) k.allEnterLimit = +m[4]; else k.allSpellLimit = +m[5]; }, desc: '各プレイヤーは各ターン、決まった数までしか出せない（唱えられない）' },
    { name: '自分のターン中、相手は召喚できない', re: /^自分のターン中、相手はクリーチャーを召喚できない。?$/, auto: true, set: (k) => (k.oppNoSummonMyTurn = true), desc: '自分のターン中、相手は召喚できない' },
    { name: 'マナから種族を召喚', re: /^自分のマナゾーンから([^、。]+?)を召喚してもよい。?$/, auto: true, set: (k, m) => (k.zonePlay = (k.zonePlay || []).concat({ zone: 'mana', what: m[1], once: false, free: false, summon: true })), desc: 'マナゾーンから指定のクリーチャーを召喚できる' },
    { name: '手札を表向きにしてプレイ', re: /^相手は(、)?手札を表向きにしてプレイする。?$/, auto: true, set: () => {}, desc: '相手は手札を公開してプレイする（ひとり回しでは常に見えるので影響なし）' },
    { name: '追加ターンに唱えられない', re: /^追加ターンにこの呪文を唱えられない。?$/, auto: true, set: (k) => (k.noCastExtra = true), desc: '追加ターン中は唱えられない' },
    { name: '∞ブレイカー（ルビ）', re: /^∞\s*(\(|（)?ルビ[：:]\s*インフィニティ(\)|）)?\s*ブレイカー$/, auto: true, set: (k) => (k.breaker = 99), desc: 'シールドをすべてブレイクする' },
    { name: '相手は出せる数が限られる', re: /^各ターン、相手はクリーチャーを(\d+)体までしか(バトルゾーンに)?出せない。?$/, auto: true, set: (k, m) => (k.oppEnterLimit = +m[1]), desc: '相手は各ターンN体までしかクリーチャーを出せない' },
    { name: 'タップして出てアンタップしない（置かれ）', re: /^このクリーチャーはタップしてバトルゾーンに置かれ、自分のターンのはじめにアンタップしない。?$/, auto: true, set: (k) => { k.enterTapped = true; k.noUntap = true; }, desc: 'タップして出て、アンタップしない' },
    { name: 'N枚以上入れられる', re: /^(このカード|《.+?》)は(、)?(\d+)枚以上デッキに入れることができる。?$/, auto: true, set: (k) => (k.noCopyLimit = true), desc: 'デッキに5枚以上入れられる' },
    { name: '破壊される時マナへ（かわりに）', re: /^このクリーチャーが破壊される(時|とき)、かわりに(自分の)?(マナゾーン|手札)に(置く|戻す|加える)。?$/, auto: true, set: (k, m) => (k.selfDestroyTo = { to: m[3] === '手札' ? 'hand' : 'mana', optional: false }), desc: '破壊される時、墓地のかわりにマナ（手札）へ' },
    { name: '相手は可能なら攻撃する', re: /^相手のクリーチャーは(、)?可能(なら|であれば)攻撃する。?$/, auto: true, set: (k) => (k.mustAttack = 'opp'), desc: '相手のクリーチャーは可能なら攻撃する' },
    { name: 'マナゾーンから唱えられる', re: /^この呪文を(、)?自分のマナゾーンから唱えてもよい。?$/, auto: true, set: (k) => (k.manaCast = true), desc: 'マナゾーンから唱えられる' },
    { name: '∞ブレイカー', re: /^∞ブレイカー$/, auto: true, set: (k) => (k.breaker = 99), desc: 'シールドをすべてブレイクする' },
    { name: 'マナはすべての文明', re: /^自分のマナゾーンにあるカードは(、)?すべての文明を持つ。?$/, auto: true, set: (k) => (k.rainbowMana = true), desc: 'マナはすべての文明を持つ' },
    { name: '誰もターンを追加できない', re: /^誰もターンを追加できない。?$/, auto: true, set: (k) => (k.noExtraTurns = true), desc: 'ターンを追加できない' },
    { name: 'タップしていれば攻撃されない', re: /^このクリーチャーがタップしていれば、自分は攻撃されない。?$/, auto: true, set: (k) => (k.noPlayerAttackIfTapped = true), desc: 'このクリーチャーがタップしていれば、プレイヤーは攻撃されない' },
    { name: '相手は単色呪文を唱えられない', re: /^相手は(、)?多色ではない呪文を唱えられない。?$/, auto: true, set: (k) => (k.oppNoMonoSpell = true), desc: '相手は多色ではない呪文を唱えられない' },
    { name: '召喚できない', re: /^このクリーチャーは(、)?召喚できない。?$/, auto: true, set: (k) => (k.cannotSummon = true), desc: '召喚できない（効果で出すことはできる）' },
    { name: '他が攻撃していなければ攻撃できない', re: /^このターン(に|、)他のクリーチャーが攻撃していなければ、このクリーチャーは攻撃できない。?$/, auto: true, set: (k) => (k.attackNeedOtherAttack = true), desc: 'このターン他のクリーチャーが攻撃していなければ攻撃できない' },
    { name: '墓地のクリーチャーの数だけコスト軽減', re: /^自分の墓地にあるクリーチャー(\d+)体につき、このクリーチャーの召喚コストを(\d+)少なくする。?$/, auto: true, set: (k, m) => (k.costPer = { side: 'self', zone: 'grave', what: 'クリーチャー', per: +m[1], n: +m[2] }), desc: '墓地のクリーチャーの数だけコストが下がる' },
    { name: '相手の呪文は無限のコスト', re: /^相手の呪文を唱えるコストは無限のマナを必要とする。?$/, auto: true, set: (k) => (k.oppSpellBan = true), desc: '相手は呪文を唱えられない' },
    { name: 'クルー・ブレイカー', re: /^クルー・ブレイカー\s*[：:]\s*(.+?)$/, auto: true, set: (k, m) => (k.crewBreaker = m[1].trim()), desc: '自分の他の指定のクリーチャー1体につき、シールドをさらに1枚ブレイクする' },
    { name: 'ダブル・シンパシー', re: /^(ダブル|トリプル)・シンパシー\s*[：:]\s*(.+)$/, auto: true, set: (k, m) => { k.sympathy = m[2].replace(/。$/, ''); k.sympathyMul = m[1] === 'ダブル' ? 2 : 3; }, desc: '指定のカード1枚につきコストが2（3）下がる' },
    { name: '相手全体のパワー減（常在）', re: /^(バトルゾーンにある)?相手のクリーチャーすべてのパワーは-(\d+)される。?$/, auto: true, set: (k, m) => (k.oppPowerAura = -m[2]), desc: '相手のクリーチャーすべてのパワーが下がる' },
    { name: '自分のターン中、数だけパワー', re: /^自分のターン中、自分の(他の)?([^、。]+?)(\d+)(つ|体|枚)につき、このクリーチャーのパワーを\+(\d+)する。?$/, auto: true, set: (k, m) => (k.powerPerMyTurn = { others: !!m[1], who: m[2], per: +m[3], n: +m[5] }), desc: '自分のターン中、指定のカードの数だけパワーが上がる' },
    { name: '手札が多ければタダで使う', re: /^自分の手札が(\d+)枚以上あれば、自分のターンに(1|一)度、(光|水|闇|火|自然)?(の)?カードを自分の手札からコストを支払わずに(実行し|使っ|唱え)てもよい。?$/, auto: true, set: (k, m) => (k.freeIfHand = { n: +m[1], civ: m[3] ? civsIn(m[3])[0] : null }), desc: '手札が多ければ、ターンに1度コストなしで使える' },
    { name: 'マスター・G・ブレイカー', re: /^マスター・G・ブレイカー$/, auto: true, set: (k) => { k.breaker = 99; k.gBreaker = true; k.masterG = true; }, desc: '相手のシールドをすべてブレイクし、攻撃の後に自分のシールドもすべてブレイク。出たターンは各ブレイクの前に相手を1体破壊' },
    { name: '種族のカードは虹色マナ', re: /^自分の([^、。]+?)(・カード)?を(実行|召喚|使用)する(時|とき)、自分のマナゾーンにあるカードをすべての文明を持つかのようにタップしてもよい。?$/, auto: true, set: (k, m) => (k.rainbowFor = m[1].replace(/・カード$/, '')), desc: '指定のカードを使う時、マナをすべての文明として払える' },
    { name: 'W・シンパシー', re: /^W・シンパシー[：:]\s*(.+)$/, auto: true, set: (k, m) => { k.sympathy = m[1].replace(/。$/, ''); k.sympathyMul = 2; }, desc: '指定のカード1枚につきコストが2下がる' },
    { name: '離れるかわりに表向きのカードを墓地へ', re: /^自分のクリーチャーが(バトルゾーンを)?離れる(時|とき)、かわりにいずれかのシールドゾーンにある表向きのカードを1枚選び、持ち主の墓地に置いてもよい。?$/, auto: true, set: (k) => (k.leaveSubFaceUp = true), desc: '自分のクリーチャーが離れる時、かわりにシールドゾーンの表向きのカードを1枚墓地に置ける' },
    { name: '紋章のロックを無視', re: /^自分は(、)?裁きの紋章を唱えられなくする効果を無視する。?$/, auto: true, set: (k) => (k.ignoreCrestLock = true), desc: '裁きの紋章を唱えられなくする効果を無視する' },
    { name: '表向きを含むシールドは裏返して守る', re: /^自分の(、)?表向きのカードを含むシールドがブレイクされる(時|とき)、かわりにそのシールドに含まれる表向きのカードをすべて裏返す。?$/, auto: true, set: (k) => (k.flipInsteadOfBreak = true), desc: '表向きのカードを含むシールドがブレイクされる時、かわりにそれを裏返す' },
    { name: 'サバキZ', re: /^サバキZ$/, auto: true, set: (k) => (k.sabakiZ = true), desc: '裁きの紋章がシールドゾーンから手札に加わった時、それを捨ててこの呪文をコストなしで唱えられる' },
    { name: 'エターナル・Κ', re: /^エターナル・Κ$/, auto: true, set: (k) => (k.eternalK = 3), desc: '離れる時、かわりに裏向きのマナ3枚を表向きにしてもよい' },
    { name: 'ヌル・ブレイカー', re: /^ヌル・ブレイカー$/, auto: true, set: (k) => (k.nullBreaker = true), desc: 'シールドをブレイクしない' },
    { name: 'Evoチャージャー', re: /^Evoチャージャー$/, auto: true, set: (k) => (k.evoCharger = true), desc: '唱えた後マナに置き、マナのクリーチャーを進化クリーチャーの下に置ける' },
    { name: '出たターンにプレイヤーを攻撃できる', re: /^このクリーチャーは(、)?(バトルゾーンに)?出たターン(、|に)?相手プレイヤー(を|に)攻撃できる。?$/, auto: true, set: (k) => (k.sickPlayerOk = true), desc: '出たターンでも相手プレイヤーを攻撃できる' },
    { name: '離れる時に下のカードを墓地へ', re: /^このクリーチャーが(バトルゾーンを)?離れる時、カードがこれの下にあれば、かわりに下にあるカードをすべて墓地に置く。?$/, auto: true, set: (k) => (k.underShield = true), desc: '離れる時、下にカードがあれば、かわりに下のカードをすべて墓地に置く' },
    { name: '唱えた後もう一度', re: /^この呪文を(自分の)?手札から唱えた後、この呪文を(自分の)?墓地からコストを支払わずに唱えてもよい。?$/, auto: true, set: (k) => (k.castAgain = true), desc: '手札から唱えた後、墓地からもう一度唱えてよい' },
    { name: '唱えた後山札へ', re: /^この呪文を唱えた後、墓地に置くかわりに(自分の)?山札に加えてシャッフルする。?$/, auto: true, set: (k) => (k.afterCastTo = 'deckShuffle'), desc: '唱えた後、山札に加えてシャッフルする' },
    { name: '唱えた後山札の下へ', re: /^この呪文を唱えた後、墓地に置くかわりに(自分の)?山札の(一番)?下に置く。?$/, auto: true, set: (k) => (k.afterCastTo = 'deckBottom'), desc: '唱えた後、山札の下に置く' },
    { name: '相手はクリーチャーを攻撃する', re: /^相手のクリーチャーが攻撃する時、可能ならクリーチャーを攻撃する。?$/, auto: true, set: (k) => (k.oppMustAttackCreature = true), desc: '相手のクリーチャーは可能ならクリーチャーを攻撃する' },
    { name: 'コストを下げてターン終わりに破壊', re: /^このクリーチャーの召喚コストを(\d+)少なくしてもよい。そうしたら、このターンの終わりに、このクリーチャーを破壊する。?$/, auto: true, set: (k, m) => (k.bad = +m[1]), desc: '召喚コストをN下げられる。下げたらターンの終わりに破壊' },
    { name: 'マナのクリーチャーの数だけコスト軽減', re: /^自分のマナゾーンにある([^、。]*?)クリーチャー(\d+)体につき、このクリーチャーを召喚するコストは(\d+)少なくなる。?$/, auto: true, set: (k, m) => (k.costPer = { side: 'self', zone: 'mana', what: m[1].replace(/の$/, '') + 'クリーチャー', per: +m[2], n: +m[3] }), desc: 'マナのクリーチャーの数だけコストが下がる' },
    { name: '文明のコスト軽減（2文明）', re: /^自分の(光|水|闇|火|自然)のクリーチャーと(光|水|闇|火|自然)のクリーチャーを召喚するコストを(\d+)少なくしてもよい。?$/, auto: true, set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: m[1] + 'のクリーチャー', n: -m[3] }, { side: 'self', subj: m[2] + 'のクリーチャー', n: -m[3] })), desc: '指定の文明のクリーチャーのコストを下げる' },
    { name: '進化クリーチャーのコスト軽減', re: /^自分の(光|水|闇|火|自然)?(の)?進化クリーチャーを召喚するコストを(\d+)少なくしてもよい。?$/, auto: true, set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: (m[1] ? m[1] + 'の' : '') + 'クリーチャー', evoOnly: true, n: -m[3] })), desc: '進化クリーチャーのコストを下げる' },
    { name: '文明のコスト増加（両者）', re: /^このクリーチャーがバトルゾーンにある間、(光|水|闇|火|自然)のクリーチャーを召喚するコストと(光|水|闇|火|自然)の呪文を唱えるコストは、それぞれ\+(\d+)される。?$/, auto: true, set: (k, m) => (k.costAura = (k.costAura || []).concat(...['self', 'opp'].flatMap((sd) => [{ side: sd, subj: m[1] + 'のクリーチャー', n: +m[3] }, { side: sd, subj: m[2] + 'の呪文', n: +m[3] }]))), desc: '指定の文明のクリーチャーと呪文のコストが上がる（両プレイヤー）' },
    { name: '文明の数だけパワー減', re: /^このクリーチャーのパワーは、(バトルゾーンにある)?(光|水|闇|火|自然)(または(光|水|闇|火|自然))?のクリーチャー(\d+)体につき-(\d+)される。?$/, auto: true, set: (k, m) => (k.powerPerCiv = { civs: civsIn(m[2] + (m[4] || '')), per: +m[5], n: -m[6] }), desc: '指定の文明のクリーチャーの数だけパワーが下がる' },
    { name: '名前のエグザイルは1体まで（「」）', re: /^自分の他の(、)?名前に「(.+?)」とある(エグザイル・)?クリーチャーを(バトルゾーンに)?出すことはできない。?$/, auto: true, set: (k, m) => (k.exileLock = m[2]), desc: '名前に○○とある自分のクリーチャーは、他に1体しか出せない' },
    { name: 'クロスギア（説明）', re: /^クロスギア\s*[：:]\s*このカードをバトルゾーンに置く。/, auto: true, set: () => {}, desc: 'バトルゾーンに出し（ジェネレート）、コストを払ってクリーチャーにクロスする' },
    { name: '究極進化', re: /^究極進化(MAX)?\s*[：:\-－―]?\s*(自分の)?([^、。]*?)(究極)?進化クリーチャー(\d+)体の上に置く。?$/, auto: true,
      set: (k, m) => {
        k.evolution = 'evo';
        k.evoNeedEvo = m[1] ? 'ultimate' : 'evo';
        const cs = civsIn(m[3] || '');
        if (cs.length) k.evoCivs = cs;
      }, desc: '自分の進化クリーチャー（MAXは究極進化クリーチャー）の上に重ねて出す' },
    { name: '墓地進化', re: /^(超無限)?墓地進化(GV|V)?\s*[：:\-－―]\s*(.+)$/, auto: true,
      set: (k, m) => {
        const t = m[3];
        const n = +((t.match(/(\d+)体/) || [])[1] || (m[2] === 'GV' ? 3 : m[2] === 'V' ? 2 : 1));
        const what = (t.match(/(?:自分の墓地にある、?)?([^、。]*?)(クリーチャー)?を?(\d+)体/) || [])[1] || '';
        k.evolution = 'grave';
        k.graveEvo = { n, any: !!m[1], civs: civsIn(what), what: what.replace(/^自分の墓地にある、?/, '') };
      }, desc: '自分の墓地のクリーチャーの上に重ねて出す' },
    { name: 'デッキ進化', re: /^デッキ進化(GV|V)?\s*[：:\-－―]\s*(.+)$/, auto: true,
      set: (k, m) => {
        k.evolution = 'deck';
        k.deckEvo = { n: +((m[2].match(/上から(\d+)枚の上/) || [])[1] || 1), reveal: !/の上に重ねつつ出す/.test(m[2].split('。')[0]) || /表向き/.test(m[2]) };
      }, desc: '山札の上のカードの上に重ねて出す' },
    { name: 'マナ爆誕', re: /^マナ爆誕\s*(\d+)/, auto: true, set: (k, m) => { k.manaSummon = true; k.manaBirth = +m[1]; }, desc: 'マナゾーンから指定のコストで召喚できる' },
    { name: 'タマシードがクリーチャーになる条件', re: /^自分の(光|水|闇|火|自然)のクリーチャーまたは(光|水|闇|火|自然)のタマシードが合計(\d+)つ以上なければ、バトルゾーンにあるこのタマシードはクリーチャーとして扱わない。?$/, auto: true, set: (k, m) => (k.creatureIf = { civ: civsIn(m[1])[0], n: +m[3] }), desc: '指定の文明のクリーチャーとタマシードが合計N以上ある時だけクリーチャーとして扱う' },
    { name: '多色をマナに置いた時アンタップ', re: /^各ターン、自分がはじめて多色カードを(自分の)?マナゾーンに置いた(時|とき)、そのカードをアンタップ(し、カードを1枚引く|する)。?$/, auto: true, set: (k, m) => (k.firstMultiUntap = { draw: /引く/.test(m[3]) }), desc: '各ターン最初にマナに置いた多色カードをアンタップする' },
    { name: 'G・リンク（左右）', re: /^(左|右|中央)G・リンク$/, auto: true, set: (k, m) => (k.gLink = { side: { 左: 'L', 右: 'R', 中央: 'C' }[m[1]] }), desc: '出る時、他のゴッドとリンクして1体のクリーチャーになれる' },
    { name: 'G・リンク（名前）', re: /^G・リンク\s*(《.+)$/, auto: true, set: (k, m) => (k.gLink = { names: (m[1].match(/《([^》]+)》/g) || []).map((x) => x.slice(1, -1)) }), desc: '出る時、指定のゴッドとリンクして1体のクリーチャーになれる' },
    { name: 'リンクしていなければ攻撃できない', re: /^このクリーチャーは(、)?リンクしていなければ攻撃できない。?$/, auto: true, set: (k) => (k.attackNeedLink = true), desc: 'リンクしていないと攻撃できない' },
    { name: 'シールドをさらにブレイク', re: /^(このクリーチャーは(、)?)?シールドをさらに(\d+)(枚|つ)ブレイクする。?$/, auto: true, set: (k, m) => (k.breakExtra = (k.breakExtra || 0) + +m[3]), desc: 'ブレイクするシールドが増える' },
    { name: '召喚以外で出ない', re: /^このクリーチャーは(、)?召喚以外の方法で(バトルゾーンに)?出ない。?$/, auto: true, set: (k) => (k.summonOnlyEntry = true), desc: '召喚でしかバトルゾーンに出ない' },
    { name: '相手は単色を出せない', re: /^(自分のターン中、)?相手は(、)?多色ではないクリーチャーを(バトルゾーンに)?出せない。?$/, auto: true, set: (k, m) => (k.oppNoMono = { myTurnOnly: !!m[1] }), desc: '相手は多色ではないクリーチャーを出せない' },
    { name: 'パワー0以下の間は不死', re: /^このクリーチャーは(、)?パワーが0以下の間(、)?破壊されず、すべてのバトルに勝つ。?$/, auto: true, set: (k) => (k.zeroGuard = true), desc: 'パワーが0以下の間、破壊されずすべてのバトルに勝つ' },
    { name: '破壊されない', re: /^このクリーチャーは(、)?破壊されない。?$/, auto: true, set: (k) => (k.noDestroy = true), desc: '破壊されない' },
    { name: '離れない', re: /^このクリーチャーは(、)?(バトルゾーンを)?離れない。?$/, auto: true, set: (k) => (k.noLeave = true), desc: 'バトルゾーンを離れない' },
    { name: '超次元ゾーンから召喚', re: /^このクリーチャーを(、)?(自分の)?超次元ゾーンから召喚してもよい。?$/, auto: true, set: (k) => (k.hyperSummon = true), desc: '超次元ゾーンから召喚できる' },
    { name: 'マナゾーンから召喚', re: /^このクリーチャーを(、)?(自分の)?マナゾーンから召喚してもよい。?$/, auto: true, set: (k) => (k.manaSummon = true), desc: 'マナゾーンから召喚できる' },
    { name: 'アビスラッシュ', re: /^アビスラッシュ([：:]このクリーチャーを自分の墓地から召喚してもよい。そうしたら、このターン、このクリーチャーはプレイヤーを攻撃でき、ターンの終わりに山札の下に置かれる。?)?$/, auto: true, set: (k) => ((k.graveSummon = true), (k.abyssRush = true)), desc: '墓地から召喚でき、そのターンはプレイヤーを攻撃できる。ターンの終わりに山札の下へ' },
    { name: '条件でブロックされない', re: /^このクリーチャーは(、)?(このクリーチャーよりパワーが小さい|パワー(?<p>\d+)以下の)クリーチャーにブロックされない。?$/, auto: true, set: (k, m) => (k.unblockableBy = { maxPower: m.groups.p ? +m.groups.p : null, lessThanSelf: !m.groups.p }), desc: '条件に合うクリーチャーにはブロックされない' },
    { name: 'パワード・ブロッカー', re: /^パワード・ブロッカー\s*\+?(\d+)$/, auto: true, set: (k, m) => ((k.blocker = true), (k.blockPower = +m[1])), desc: 'ブロッカー。ブロックしている間パワーが上がる' },
    { name: 'マナに置いた時アンタップ', re: /^このカードを(自分の)?手札からマナゾーンに置いた時、アンタップする。?$/, auto: true, set: (k) => (k.chargeUntapped = true), desc: '手札からマナに置いた時はアンタップで置く' },
    { name: 'タップして出してもよい', re: /^このクリーチャーをタップして出してもよい。?$/, auto: true, set: () => {}, desc: 'タップして出してもよい（通常はアンタップで出す）' },
    { name: '4枚より多く入れられる', re: /^(このカード|《.+?》)は(、)?(\d+)枚より多くデッキに入れることができる。?$/, auto: true, set: (k) => (k.noCopyLimit = true), desc: 'デッキに5枚以上入れられる' },
    { name: 'バトルの後に破壊', re: /^このクリーチャーがバトルする時、バトルの後、このクリーチャーを破壊する。?$/, auto: true, set: (k) => (k.dieAfterBattle = true), desc: 'バトルの後、このクリーチャーは破壊される' },
    { name: 'マナはすべての文明', re: /^自分のマナゾーンにあるカードを(、)?すべての文明のカードとして扱う。?$/, auto: true, set: (k) => (k.rainbowMana = true), desc: '自分のマナはすべての文明として使える' },
    { name: '攻撃できない', re: /^このクリーチャーは(、)?攻撃できない。?$/, auto: true, set: (k) => (k.cantAttack = true), desc: '攻撃できない' },
    { name: 'プレイヤー攻撃不可', re: /^このクリーチャーは(、)?(相手)?プレイヤーを攻撃できない。?$/, auto: true, set: (k) => (k.cantAttackPlayer = true), desc: 'プレイヤーを攻撃できない' },
    { name: 'アンタップ攻撃', re: /^このクリーチャーは(、)?(相手の)?アンタップしている(相手の)?クリーチャーを攻撃できる。?$/, auto: true, set: (k) => (k.attackUntapped = true), desc: 'アンタップしているクリーチャーも攻撃できる' },
    { name: '選ばれない（条件・呪文つき）', re: /^(?<turn>相手のターン中、)?(?<by>(?<bciv>光以外の|(光|水|闇|火|自然)の)?(呪文(の効果)?|呪文またはクリーチャーの能力|呪文の効果やクリーチャーの能力)によって、?)?((相手が(、)?(バトルゾーンにある)?(自分の)?クリーチャーを選ぶ時|バトルゾーンにある(自分の)?クリーチャーを相手が選ぶ時|自分のクリーチャーを相手が選ぶ時|相手が自分のクリーチャーを選ぶ時)、)?(?<cond>[^、。]+?(あれば|なら)、)?(このクリーチャー(は|を)(、)?(相手に)?(選べない|選ばれない|選ぶことはできない)|自分の(?<who>[^、。]+?)(は(、)?(呪文によって)?(相手に)?選ばれない|を選ぶことはできない|は選べない))。?$/, auto: true,
      test: (line) => /選/.test(line) && !/攻撃またはブロック/.test(line),
      set: (k, m) => {
        const g = m.groups;
        const o = {};
        if (g.by || /呪文によって/.test(m[0])) o.bySpell = true;
        if (g.bciv) {
          const cv = g.bciv.match(/(光|水|闇|火|自然)/)[1];
          if (/以外/.test(g.bciv)) o.exceptCiv = CIVJ[cv];
          else o.onlyCiv = CIVJ[cv];
        }
        if (g.turn) o.oppTurn = true;
        if (g.cond) {
          const c = g.cond;
          let mm;
          if ((mm = c.match(/^(バトルゾーンに)?自分の(他の)?([^、。]+?)が(\d+)(体|つ)以上あれば、$/))) o.count = { what: mm[3], n: +mm[4], others: !!mm[2] };
          else if ((mm = c.match(/^(バトルゾーンに)?自分の(他の)?([^、。]+?)があれば、$/))) o.count = { what: mm[3], n: 1, others: !!mm[2] };
          else if (/シールドゾーンに表向きであれば/.test(c)) o.faceUpShieldsGE = 1;
          else o.unknown = true;
        }
        if (g.who) {
          (k.protects = k.protects || []).push({ ...o, who: g.who.replace(/^、/, '') });
        } else k.untargetable = Object.keys(o).length ? o : true;
      }, desc: '相手に選ばれない（条件つき）' },
    { name: '攻撃されない', re: /^(?<other>自分の他のクリーチャーがあれば、)?このクリーチャーは(、)?((?<civ>光|水|闇|火|自然)のクリーチャー(から|に))?攻撃(?<blk>またはブロック|もブロックも)?されない。?$/, auto: true,
      set: (k, m) => {
        k.noBeAttacked = m.groups.other || m.groups.civ ? { needOther: !!m.groups.other, byCiv: m.groups.civ ? CIVJ[m.groups.civ] : null } : true;
        if (m.groups.blk) k.unblockable = true;
      }, desc: '攻撃されない' },
    { name: '自分より小さいクリーチャーにプレイヤーが攻撃されない', re: /^自分は(、)?このクリーチャーよりパワーが小さいクリーチャーに攻撃されない。?$/, auto: true, set: (k) => (k.playerGuardPower = true), desc: 'このクリーチャーよりパワーが小さいクリーチャーは自分を攻撃できない' },
    { name: '種族がブロックされない', re: /^自分の(?<who>[^、。「」]+?)(すべてに「(?<g>.+?)」を与え、それらはすべて|は(、)?)ブロックされない。?$/, auto: true,
      test: (line) => !/^自分のクリーチャーは/.test(line) || true,
      set: (k, m) => {
        const who = m.groups.who.replace(/(・)?クリーチャー$/, '');
        k.teamUnblock = { who: who === '' ? null : who };
        if (m.groups.g) k.grant = { who: who || null, names: [m.groups.g] };
      }, desc: '自分の（種族の）クリーチャーはブロックされない' },
    { name: '選べない', re: /^相手は(、)?このクリーチャーを選べない。?$/, auto: true, set: (k) => (k.untargetable = true), desc: '相手に選ばれない' },
    { name: 'タップして出てアンタップしない', re: /^このクリーチャーは(、)?タップして(バトルゾーンに)?出て、自分のターンのはじめにアンタップしない。?$/, auto: true, set: (k) => ((k.enterTapped = true), (k.noUntap = true)), desc: 'タップ状態で出て、自分のターンのはじめにアンタップしない' },
    { name: 'タップして出る', re: /^このクリーチャーは(、)?タップして(バトルゾーンに)?出る。?$/, auto: true, set: (k) => (k.enterTapped = true), desc: 'タップ状態で出る' },
    { name: 'アンタップしない', re: /^(このクリーチャーは(、)?自分のターンのはじめに|自分のターンのはじめに、このクリーチャーは)アンタップしない。?$/, auto: true, set: (k) => (k.noUntap = true), desc: '自分のターンのはじめにアンタップしない' },
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
    { name: 'S革命チェンジ', re: /^S革命チェンジ\s*[：:－\-―─]\s*(.+)$/, auto: true, set: (k, m) => { k.revChange = condOf(m[1]); k.sRevChange = true; }, desc: '条件に合う自分のクリーチャーが攻撃する時、手札か表向きでシールドゾーンにあるこれと入れ替えられる' },
    { name: '革命チェンジ', re: /^革命チェンジ\s*[：:－\-―─]\s*(.+)$/, auto: true, set: (k, m) => (k.revChange = condOf(m[1])), desc: '条件に合う自分のクリーチャーが攻撃する時、手札のこれと入れ替えられる' },
    { name: '侵略', re: /^(S級)?侵略(ZERO)?[：:－\-―─]\s*(.+)$/, auto: true, set: (k, m) => (k.invasion = condOf(m[3])), desc: '条件に合う自分のクリーチャーが攻撃する時、手札のこれをその上に重ねて進化できる' },
    { name: '進化', re: /^(NEO)?進化(クリーチャー)?[：:－-]?\s*(.*)$/, auto: true, set: (k, m) => {
        k.evolution = m[1] ? 'neo' : 'evo';
        const cs = civsIn(String(m[3] || '').split('クリーチャー')[0]);
        if (cs.length) k.evoCivs = cs;
      }, desc: '自分のクリーチャー1体の上に重ねて出す（NEOは重ねずにも出せる）' },
    { name: 'G・ゼロ', re: /^G・ゼロ\s*[：:\-―－ー]\s*(.+)$/, auto: true, test: (line) => { const t = line.replace(/^G・ゼロ\s*[：:\-―－ー]\s*/, ''); const ct = (t.match(/^(.+?(あれば|いれば|なければ|ていれば))、この/) || [])[1]; return !!(ct && G.TextParse && G.TextParse.parseCondText(ct)) || /自分の(.+?)(が|を)(\d+体以上)?(いれば|あれば)、この/.test(t); }, set: (k, m) => { k.gZero = m[1]; const ct = (m[1].match(/^(.+?(あれば|いれば|なければ|ていれば))、この/) || [])[1]; const pc = ct && G.TextParse && G.TextParse.parseCondText(ct); if (pc) k.gZeroCond = pc; }, desc: '条件を満たしていれば、コストを払わずに使える' },
    { name: 'Zラッシュ', re: /^Zラッシュ.*$/, auto: true, set: (k) => (k.zRush = true), desc: '自分のシールドが離れた時、ハイパー化する' },
    { name: 'マナ武装', re: /^マナ武装\s*(\d+)$/, auto: true, set: () => {}, desc: 'マナに指定の文明がN枚以上あれば効果が働く' },
    { name: '封印', re: /^封印$/, auto: true, set: () => {}, desc: '山札の上のカードを裏向きで付ける。付いている間は動けない。自分のコマンドが出ると1つ外れる' },

    { name: 'ヨビニオン', re: /^ヨビニオン$/, auto: true, set: (k) => (k.yobinion = true), desc: '召喚した時、山札の上から、このクリーチャーよりコストが小さいクリーチャーが出るまで表向きにし、それを出す。残りは山札の下へ' },
    // ===== 認識はするが手動で処理するもの =====
    { name: '超魂X', re: /^超魂X/, auto: true, set: () => {}, desc: 'これがクリーチャーの下にあれば、そのクリーチャーにも以下の能力を与える' },
    { name: 'パワー+（常在）', re: /^このクリーチャーのパワーを\+(\d+)する。?$/, auto: true, set: (k, m) => (k.soulPower = (k.soulPower || 0) + +m[1]), desc: 'パワーが上がる' },
    { name: 'サバキZ', re: /^サバキZ/, desc: '裁きの紋章を使った時などに、手札からコストを払わずに出せる' },
    { name: 'D・D・D', re: /^D・D・D\s*(\[([lwdfnc]+)(\d+)\]|〔代替([lwdfnc]+)(\d+)〕)?/, auto: true, set: (k, m, raw) => {
        const x = (String(raw || '') + ' ' + m[0]).match(/[\[〔](?:代替)?([lwdfnc]+)(\d{2})[\]〕]/);
        const code = x ? x[1] : '';
        const n = x ? +x[2] : 0;
        const CV = { l: 'light', w: 'water', d: 'darkness', f: 'fire', n: 'nature' };
        k.ddd = { cost: n, civs: [...new Set(String(code).split(''))].map((x) => CV[x]).filter(Boolean) };
      }, desc: '自分のクリーチャーが攻撃する時、指定のコストを払って手札から使える' },
    { name: 'アバレチェーン', re: /^アバレチェーン/, desc: '攻撃する時に、手札からクリーチャーを出せる' },
    { name: 'ハイパーエナジー', re: /^ハイパーエナジー\s*$/, auto: true, set: (k) => (k.hyperEnergy = true), desc: '自分のクリーチャーを1体タップするごとに、召喚コストを2少なくする' },
    { name: 'オシオキムーン', re: /^オシオキムーン/, desc: 'シールドが離れた時に、手札から使える' },
    { name: 'G・リンク', re: /^(G・リンク)\s*$/, desc: 'ゴッド同士をつなげて1体として扱う' },
    { name: 'ホーリー・フィールド', re: /^ホーリー・フィールド/, desc: 'シールドの数が相手以上なら能力を得る' },
    { name: 'シビルカウント', re: /^シビルカウント/, desc: '指定の文明のカードの数で効果が働く' },
    { name: 'クロスギア', re: /^クロスギア$/, auto: true, set: () => {}, desc: 'バトルゾーンに出し（ジェネレート）、コストを払ってクリーチャーにクロスする' },
    { name: 'ウェーブストライカー', re: /^ウェーブストライカー/, desc: 'ウェーブストライカーが3体以上いれば能力を得る' },
    { name: 'レインボーナス', re: /^レインボーナス/, desc: '多色クリーチャーがいれば効果が働く' },
    { name: 'ダイナモ', re: /^ダイナモ/, desc: 'バトルする時に、他のクリーチャーのパワーを足せる' },
    { name: 'Jクライム', re: /^Jクライム/, desc: '自分のジョーカーズの上に重ねて、コストを下げて出す' },
    { name: '逆転撃', re: /^逆転撃/, desc: '相手の攻撃中に、条件を満たせば手札から使える' },
    { name: 'ウラ・ニンジャ・ストライク', re: /^ウラ・ニンジャ・ストライク/, desc: '相手の攻撃時、条件を満たせば手札から出し、出た時の能力を使う' },
    { name: 'S-MAX進化', re: /^S-MAX進化/, desc: '進化元なしでも出せる。負ける時にかわりにこのクリーチャーを破壊する' },

    { name: '龍マナ武装', re: /^龍マナ武装/, desc: 'マナにドラゴンがN枚以上あれば効果が働く' },
    { name: '超無限進化', re: /^超無限進化/, desc: '複数のクリーチャーの上に重ねて出す進化' },
    { name: 'エクストラEXライフ', re: /^エクストラEXライフ/, desc: 'EXライフの強化版（このツールでは手動）' },
    { name: 'S・バック', re: /^S・バック/, desc: 'シールドから手札に来た指定のカードを捨てて、コストを払わずに出せる' },
    { name: 'キズナ', re: /^(スーパー)?キズナ(コンプ|プラス)?\s*$/, auto: true, set: (k, m) => (k.kizuna = m[2] === 'コンプ' ? 'comp' : m[2] === 'プラス' ? 'plus' : 'enter'), desc: 'キズナ：出た時、自分のクリーチャーのP能力を使う（プラス・コンプは攻撃する時）' },
    { name: 'メテオバーン', re: /^メテオバーン/, desc: '進化元を墓地に置いて効果を使う' },
    { name: '無月の門（出した時）', re: /^無月の門[：:]自分の魔導具を(バトルゾーンに)?出した(時とき|時|とき)、自分の魔導具をバトルゾーンと墓地から(\d+)つずつ選び、このクリーチャーを自分の手札または墓地からそれら(\d+)枚の上にコストを支払わずに召喚してもよい。?$/, auto: true, set: (k, m) => (k.mugetsu = { when: 'enter', battle: +m[3], grave: +m[3] }), desc: '魔導具を出した時、魔導具を重ねて手札か墓地から召喚できる' },
    { name: '無月の門・絶', re: /^無月の門・絶[：:]各ターンの終わりに、自分の魔導具をバトルゾーンまたは墓地から合計(\d+)つ選び、このクリーチャーを自分の手札または墓地からそれら(\d+)枚の上にコストを支払わずに召喚してもよい。?$/, auto: true, set: (k, m) => (k.mugetsu = { when: 'end', total: +m[1] }), desc: '各ターンの終わりに、魔導具を重ねて手札か墓地から召喚できる' },
    { name: '無月の門', re: /^無月の門/, desc: '条件を満たすと、魔導具を墓地に置いて手札や墓地から出せる' },
    { name: 'J・O・E', re: /^J・O・E\s*(\d+)\s*$/, auto: true, set: (k, m, raw) => { const d2 = String(raw || '').normalize('NFKC').match(/カードを(\d+)枚引く/); k.joe = { n: +m[1], draw: d2 ? +d2[1] : 1 }; }, desc: 'コストをN少なくして召喚してもよい。そうしたら、ターンの終わりに山札の下に置き、カードを引く' },
    { name: 'GR召喚', re: /^GR召喚$/, desc: '超GRの上から1枚を出す' },
    { name: '超天フィーバー', re: /^超天フィーバー/, desc: '超GRゾーンの枚数で効果が強くなる' },
    { name: 'マナドライブ', re: /^マナドライブ/, desc: 'マナに指定の文明があれば効果が働く' },
    { name: 'オレガ・オーラ', re: /^オレガ・オーラ$/, auto: true, set: () => {}, desc: '自分のGRクリーチャーに付ける（いなければGR召喚して付ける）' },
    { name: 'ドロン・ゴー', re: /^ドロン・ゴー/, desc: '破壊された時、手札の指定のカードを出せる' },
    { name: '革命0トリガー', re: /^革命0トリガー/, desc: 'シールドが0の時の攻撃に対して、手札から使える' },
    { name: '革命', re: /^革命\s*\d+/, desc: '自分のシールドがN以下なら効果が働く' },
    { name: 'ファイナル革命', re: /^(極限)?ファイナル革命/, desc: 'ゲーム中1回だけ使える強力な効果' },
    { name: 'アタック・チャンス（対象）', re: /^アタック・チャンス\s*[：:\-－―]\s*(.+?)\s*$/, auto: true, set: (k, m) => (k.attackChance = m[1]), desc: '指定の自分のクリーチャーが攻撃する時、この呪文をコストを支払わずに唱えてもよい' },
    { name: 'ガチンコ・ジャッジ', re: /^(ガチンコ・ジャッジ)\s*$/, desc: 'お互い山札の上を見せ、コストが大きければ勝ち' },
    { name: 'ターボラッシュ', re: /^ターボラッシュ/, desc: '他の自分のクリーチャーがシールドをブレイクした後、能力が使える' },
    { name: 'シールド・セイバー', re: /^シールド・セイバー\s*$/, auto: true, set: (k) => (k.shieldSaver = true), desc: '自分のシールドがブレイクされる時、かわりにこのクリーチャーを破壊してもよい' },
    { name: 'セイバー（種類）', re: /^(ウルトラ・)?セイバー\s*[：:]\s*(.+?)\s*$/, auto: true, set: (k, m) => (k.saverFor = m[2]), desc: '指定のクリーチャーが破壊される時、かわりにこのクリーチャーを破壊してもよい' },
    { name: 'セイバー', re: /^(セイバー)\s*$/, desc: '指定のクリーチャーが離れる時、かわりにこのクリーチャーを破壊できる' },
    { name: '鬼タイム', re: /^鬼タイム/, desc: '相手のシールドが自分より多いなどの時に効果が働く' },
    { name: '鬼エンド', re: /^鬼エンド/, desc: 'ターンの終わりに条件を満たすと追加ターンなどの効果' },
    { name: 'フシギバース', re: /^フシギバース/, auto: true, set: (k, m, raw) => { const xs = [...String(raw || '').matchAll(/\[([lwdfnc]+)(\d{2})\]|〔代替([lwdfnc]+)(\d{2})〕/g)]; const CV = { l: 'light', w: 'water', d: 'darkness', f: 'fire', n: 'nature' }; if (!xs.length) return; const code = xs[0][1] || xs[0][3]; k.fushigi = { n: +(xs[0][2] || xs[0][4]), min: xs.length > 2 ? +(xs[xs.length - 1][2] || xs[xs.length - 1][4]) : 1, civs: [...new Set(code.split(''))].map((y) => CV[y]).filter(Boolean) }; }, desc: '自分のクリーチャーを1体タップしてマナに置き、そのコストぶん安く墓地から召喚できる' },
    { name: 'ミクセル', re: /^ミクセル/, desc: '相手がコストの大きいクリーチャーを出す時、かわりにマナや山札に送る' },
    { name: 'シールド・フォース', re: /^シールド・フォース/, desc: '選んだシールドがある間、効果が働く' },
    { name: 'ギャラクシールド', re: /^ギャラクシールド\s*〔代替([lwdfnc]+)(\d{2})〕/, auto: true, set: (k, m) => { const CV = { l: 'light', w: 'water', d: 'darkness', f: 'fire', n: 'nature' }; k.galaxy = { cost: +m[2], civs: [...new Set(m[1].split(''))].map((x) => CV[x]).filter(Boolean) }; }, desc: 'かわりのコストを払って、表向きのシールドとして置ける' },
    { name: '無月の大罪', re: /^無月の大罪\s*(\d+)\s*$/, auto: true, set: (k, m) => (k.mugetsuSin = +m[1]), desc: 'コストをN少なくしてもよい。そうしたら、ターンの終わりに自分のクリーチャーを1体破壊する' },
    { name: 'Jチェンジ', re: /^Jチェンジ\s*(\d+)\s*$/, auto: true, set: (k, m) => (k.jChange = +m[1]), desc: '攻撃する時、マナの指定コスト以下のジョーカーズと入れ替えられる' },
    { name: 'ムゲンクライム', re: /^ムゲンクライム\s*(\d+)\s*$/, auto: true, set: (k, m, raw) => { const x = String(raw || '').match(/\[([lwdfnc]+)(\d{2})\]|〔代替([lwdfnc]+)(\d{2})〕/); const CV = { l: 'light', w: 'water', d: 'darkness', f: 'fire', n: 'nature' }; const code = x ? x[1] || x[3] : ''; k.mugenClimb = { n: +m[1], cost: x ? +(x[2] || x[4]) : 0, civs: [...new Set(code.split(''))].map((y) => CV[y]).filter(Boolean) }; }, desc: '自分のクリーチャーをN体タップし、指定のコストを払って、手札か墓地から召喚できる' },
    { name: 'ハンティング', re: /^ハンティング\s*$/, auto: true, set: (k, m, raw) => { const x = String(raw || '').normalize('NFKC').match(/\+(\d+)/); k.hunting = x ? +x[1] : 1000; }, desc: 'バトル中、自分のハンター1体につきパワーが上がる' },
    { name: 'エターナル・Ω', re: /^エターナル・Ω\s*$/, auto: true, set: (k) => (k.eternalOmega = true), desc: 'バトルゾーンを離れる時、かわりに手札に戻る' },
    { name: 'ラスト・バースト', re: /^(メガ・)?ラスト・バースト\s*$/, auto: true, set: (k, m) => (k.lastBurst = m[1] ? 'mega' : 'normal'), desc: '破壊された時（メガは手札・マナ・墓地に置かれた時）、呪文側をコストを支払わずに唱えてもよい' },
    { name: 'マジボンバー', re: /^マジボンバー\s*(\d+)\s*$/, auto: true, set: (k, m) => (k.majiBomber = +m[1]), desc: '攻撃する時、山札の上を見て、指定コスト以下のクリーチャーを手札か山札の上から出せる' },
    { name: 'スター進化（条件）', re: /^スター進化[：:]\s*(.+?)1体の上に置く。?$/, auto: true, set: (k, m) => {
        k.evolution = 'evo';
        k.starEvo = true;
        const cs = civsIn(m[1].replace(/^.*?または/, ''));
        if (cs.length) k.evoCivs = cs;
        const rm = m[1].match(/^(.+?)または/);
        if (rm) k.evoRaceOr = rm[1];
      }, desc: '指定のクリーチャーの上に置く進化。離れる時、かわりに一番上のカードだけが離れる' },
    { name: 'ハイパー化', re: /^(OVER)?ハイパー化\s*[：:]\s*自分の他のクリーチャーを(\d+)体タップする。?$/, auto: true, set: (k, m) => (k.hyperize = { tapOthers: +m[2], over: !!m[1] }), desc: '自分のターン中、他のクリーチャーをタップしてハイパーモードを解放する（次の自分のターンのはじめまで）' },
    { name: 'ハイパー化（その他）', re: /^(ハイパー化)\s*$/, desc: 'ハイパーモードの能力が使えるようになる' },
    { name: '別のゾーンから使える', re: /^(?<when>自分のターン中|各ターンに(1|一)度|自分のターンに(1|一)度)(、)?(?<cond>自分の手札が1枚もなければ、)?(?<what>[^、。]*?)を((?<n>\d+)(体|枚|つ)(、)?)?自分の(?<zone>墓地|マナゾーン|山札の上)から(?<free>コストを支払わずに)?(?<verb>召喚|実行|使|唱え)(してもよい|ってもよい|てもよい)。?$/, auto: true,
      set: (k, m) => (k.zonePlay = (k.zonePlay || []).concat({ zone: { 墓地: 'grave', マナゾーン: 'mana', 山札の上: 'deck' }[m.groups.zone], what: m.groups.what.replace(/^(コスト(\d+)以下の)?/, '$1'), once: !/自分のターン中/.test(m.groups.when), free: !!m.groups.free, summon: m.groups.verb === '召喚', emptyHand: !!m.groups.cond })), desc: '墓地・マナ・山札の上からカードを使える' },
    { name: '別のゾーンから使える2', re: /^(?<when>各ターンに(1|一)度|自分のターンに(1|一)度|自分のターン中)、自分の(?<zone>墓地|マナゾーン)から(?<what>[^、。]*?)を((\d+)(体|枚))?(?<verb>召喚|実行)してもよい。?$/, auto: true,
      set: (k, m) => (k.zonePlay = (k.zonePlay || []).concat({ zone: m.groups.zone === '墓地' ? 'grave' : 'mana', what: m.groups.what, once: !/自分のターン中/.test(m.groups.when), free: false, summon: m.groups.verb === '召喚' })), desc: '墓地・マナからカードを使える' },
    { name: '山札の上をいつでも見る', re: /^自分のターン中、自分の山札の上から1枚(目)?をいつでも見てもよい。?$/, auto: true, set: (k) => (k.peekTop = true), desc: '自分のターン中、山札の上を見てよい（山札のメニュー「上の1枚を見る」）' },
    { name: '各ターン1体目のコスト軽減', re: /^各ターン、自分の(?<subj>[^。]*?)(クリーチャー)?(\d+)体目の召喚コストを(?<n>\d+)少なく(する|してもよい)。?$/, auto: true,
      set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: (m.groups.subj || '') + 'クリーチャー', n: -m.groups.n, once: true })), desc: '各ターン、最初に召喚するクリーチャーのコストを下げる' },
    { name: 'コスト軽減（してもよい）', re: /^自分の(?<subj>[^。]+?)(の召喚|を(唱える|使う|実行する))コストを(?<n>\d+)少なくしてもよい。?$/, auto: true,
      set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: m.groups.subj, n: -m.groups.n })), desc: '条件に合うカードのコストを下げる' },
    { name: '各ターン1度のコスト軽減', re: /^各ターンに(1|一)度、自分の(?<subj>[^。]+?)(を(実行|使う|唱える|召喚)する|を(使う|唱える)|の(召喚|実行))コストを(?<n>\d+)少なくしてもよい。?$/, auto: true,
      set: (k, m) => (k.costAura = (k.costAura || []).concat({ side: 'self', subj: m.groups.subj, n: -m.groups.n, once: true })), desc: '各ターンに1度、条件に合うカードのコストを下げる' },
    { name: 'シールド・トリガー・プラス', re: /^S・トリガー・プラス/, desc: 'S・トリガーで使った時に追加の効果' },
  ];

  function match(line, raw) {
    for (const e of K) {
      const m = line.match(e.re);
      if (m && (!e.test || e.test(line))) return { e, m, raw };
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
