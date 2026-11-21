// カードと画像は IndexedDB（容量が大きい）、デッキと設定は localStorage に保存（このPCの中だけ）
(function (G) {
  'use strict';
  const KEY_CARDS = 'dmsolo.cards.v1';
  const KEY_DECKS = 'dmsolo.decks.v1';
  const KEY_PREFS = 'dmsolo.prefs.v1';

  function load(key, fallback) {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, v) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
      return true;
    } catch (e) {
      alert('保存できませんでした（ブラウザの保存領域がいっぱいかもしれません）');
      return false;
    }
  }

  const Store = {
    cards: [],
    decks: [],
    prefs: {},
    imageUrls: {}, // cardId -> objectURL

    async init() {
      // カードは IndexedDB から。前の版で localStorage に入っていれば移す
      let cards = null;
      try {
        cards = await this.dataGet('cards');
      } catch (e) {
        cards = null;
      }
      if (!cards) {
        cards = load(KEY_CARDS, null);
        if (cards) {
          try {
            await this.dataSet('cards', cards);
            localStorage.removeItem(KEY_CARDS);
          } catch (e) {
            /* IndexedDBが使えなければ localStorage のまま */
          }
        }
      }
      this.cards = cards || G.Samples.cards.map((c) => ({ ...c }));
      this.decks = load(KEY_DECKS, null);
      if (!this.decks) this.decks = G.Samples.decks.map((d) => ({ ...d }));
      this.prefs = load(KEY_PREFS, {});
      return this.loadImages();
    },
    // 保存の完了を待てるよう Promise を返す（多くのカードを読み込んだ直後に閉じても消えないように）
    saveCards() {
      this._nameIdx = null;
      return this.dataSet('cards', this.cards)
        .then(() => true)
        .catch(() => save(KEY_CARDS, this.cards)); // IndexedDBに書けない時だけ localStorage を試す
    },
    dataGet(key) {
      return this.db().then(
        (db) =>
          new Promise((res, rej) => {
            const r = db.transaction('data', 'readonly').objectStore('data').get(key);
            r.onsuccess = () => res(r.result || null);
            r.onerror = () => rej(r.error);
          })
      );
    },
    dataSet(key, v) {
      return this.db().then(
        (db) =>
          new Promise((res, rej) => {
            const tx = db.transaction('data', 'readwrite');
            tx.objectStore('data').put(v, key);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
          })
      );
    },
    saveDecks() {
      return save(KEY_DECKS, this.decks);
    },
    savePrefs() {
      return save(KEY_PREFS, this.prefs);
    },
    byId(id) {
      return this.cards.find((c) => c.id === id);
    },
    byName(name) {
      // 名前の索引（カードが多い時の高速化）
      if (!this._nameIdx || this._nameIdxLen !== this.cards.length) {
        this._nameIdx = new Map();
        for (const c of this.cards) {
          const k = normName(c.name);
          if (!this._nameIdx.has(k)) this._nameIdx.set(k, c);
        }
        this._nameIdxLen = this.cards.length;
      }
      const hit = this._nameIdx.get(normName(name));
      if (hit) return hit;
      // ゆるい一致：記号・かっこの違いを無視。ツインパクトは「上の名前／下の名前」や下の名前だけでも探す
      if (!this._looseIdx || this._looseLen !== this.cards.length) {
        this._looseIdx = new Map();
        for (const c of this.cards) {
          const ks = [looseName(c.name)];
          if (c.twin && c.twin.name) ks.push(looseName(c.name + c.twin.name), looseName(c.twin.name));
          for (const k of ks) if (k && !this._looseIdx.has(k)) this._looseIdx.set(k, c);
        }
        this._looseLen = this.cards.length;
      }
      const lk = looseName(name);
      if (this._looseIdx.has(lk)) return this._looseIdx.get(lk);
      const parts = String(name).normalize('NFKC').split(/\s*[\/／]\s*/).filter(Boolean);
      if (parts.length > 1) for (const pt of parts) if (this._looseIdx.has(looseName(pt))) return this._looseIdx.get(looseName(pt));
      return null;
    },
    newId() {
      return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    },
    imageFor(def) {
      return this.imageUrls[def.id] || def.imageUrl || '';
    },

    // ===== 画像（IndexedDB） =====
    _db: null,
    db() {
      if (this._db) return this._db;
      this._db = new Promise((res, rej) => {
        const r = indexedDB.open('dmsolo-images', 2);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('img')) db.createObjectStore('img');
          if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return this._db;
    },
    async loadImages() {
      try {
        const db = await this.db();
        await new Promise((res) => {
          const tx = db.transaction('img', 'readonly');
          const st = tx.objectStore('img');
          const req = st.openCursor();
          req.onsuccess = () => {
            const cur = req.result;
            if (!cur) return res();
            this.imageUrls[cur.key] = URL.createObjectURL(cur.value);
            cur.continue();
          };
          req.onerror = () => res();
        });
      } catch (e) {
        console.warn('画像DBを開けません', e);
      }
    },
    async setImage(id, blob) {
      const db = await this.db();
      await new Promise((res, rej) => {
        const tx = db.transaction('img', 'readwrite');
        if (blob) tx.objectStore('img').put(blob, id);
        else tx.objectStore('img').delete(id);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      if (this.imageUrls[id]) URL.revokeObjectURL(this.imageUrls[id]);
      if (blob) this.imageUrls[id] = URL.createObjectURL(blob);
      else delete this.imageUrls[id];
    },
    async getImageBlob(id) {
      const db = await this.db();
      return new Promise((res) => {
        const r = db.transaction('img', 'readonly').objectStore('img').get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      });
    },
  };

  function normName(s) {
    return String(s || '')
      .normalize('NFKC')
      .replace(/[\s　]/g, '')
      .toLowerCase();
  }

  function looseName(s) {
    return normName(s).replace(/[・･\-‐－−〈〉<>＜＞《》『』「」()（）\[\]【】{}!！?？:：.。,、'"“”‘’~〜]/g, '');
  }
  // 1行を「枚数」と「カード名」に分ける
  //   「4 カード名」「4x カード名」「4枚 カード名」「カード名 x4」「カード名 ×4」「カード名 4枚」「カード名（4枚）」「カード名<TAB>4」
  function splitDeckLine(line) {
    let m;
    if ((m = line.match(/^(\d{1,2})\s*(?:[x×]|枚)?\s+(.+)$/i)) || (m = line.match(/^(\d{1,2})\s*[x×枚](.+)$/i))) return { n: +m[1], name: m[2].trim() };
    if ((m = line.match(/^(.+?)\s*[x×]\s*(\d{1,2})$/i)) || (m = line.match(/^(.+?)\s*[(（]?\s*(\d{1,2})\s*枚\s*[)）]?$/)) || (m = line.match(/^(.+?)\t+(\d{1,2})$/))) return { n: +m[2], name: m[1].trim() };
    return null;
  }
  // 枚数だけの行（前の行のカード名につく）
  const countOnly = (line) => {
    const m = line.match(/^(?:[x×]\s*(\d{1,2})|(\d{1,2})\s*枚|(\d{1,2}))$/i);
    return m ? +(m[1] || m[2] || m[3]) : null;
  };
  function parseDeckList(text) {
    const entries = [];
    const unknown = [];
    const lines = String(text || '')
      .split('\n')
      .map((l) => l.normalize('NFKC').trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      let n, name;
      const sp = splitDeckLine(line);
      if (sp) {
        n = sp.n;
        name = sp.name;
      } else {
        n = 1;
        name = line;
        // 次の行が枚数だけなら、それを使う
        const nx = lines[i + 1] != null ? countOnly(lines[i + 1]) : null;
        if (nx != null && Store.byName(name)) {
          n = nx;
          i++;
        }
      }
      const def = Store.byName(name);
      if (def) entries.push({ n, def });
      else if (countOnly(line) == null) unknown.push(name.trim());
    }
    const defs = entries.flatMap((e) => Array(e.n).fill(e.def));
    return { entries, defs, unknown, count: defs.length };
  }

  G.Store = Store;
  G.parseDeckList = parseDeckList;
  // よそのサイト（Deck Makerなど）からコピーした文章を、このツールのデッキリスト（「枚数 カード名」）に直す
  //   登録済みのカード名がある行だけを拾う（値段・ボタンなどの余計な行は捨てる）
  G.importDeckText = function (text) {
    const lines = String(text || '')
      .split('\n')
      .map((l) => l.normalize('NFKC').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const out = new Map();
    const unknown = [];
    let section = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(超次元|超GR|GR|ゼロ|メイン|ドルマゲドン|禁断)/.test(line) && !Store.byName(line)) {
        section = line;
        continue;
      }
      let n = null;
      let name = null;
      const sp = splitDeckLine(line);
      if (sp && Store.byName(sp.name)) ({ n, name } = sp);
      else if (Store.byName(line)) {
        name = line;
        // 枚数は同じ行のあと・次の行・前の行から
        const nx = lines[i + 1] != null ? countOnly(lines[i + 1]) : null;
        const pv = lines[i - 1] != null ? countOnly(lines[i - 1]) : null;
        if (nx != null) {
          n = nx;
          i++;
        } else if (pv != null) n = pv;
        else n = 1;
      } else if (sp && sp.n >= 1 && sp.n <= 40 && !/円|コスト|枚数|合計|価格/.test(line)) unknown.push(sp.name);
      if (name) {
        const def = Store.byName(name);
        out.set(def.name, (out.get(def.name) || 0) + n);
      }
    }
    const list = [...out].map(([nm, k]) => `${k} ${nm}`).join('\n');
    return { list, count: [...out.values()].reduce((a, b) => a + b, 0), unknown: [...new Set(unknown)] };
  };
  G.normName = normName;
})(window);
