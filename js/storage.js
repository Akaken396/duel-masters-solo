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
    saveCards() {
      this._nameIdx = null;
      this.dataSet('cards', this.cards).catch(() => {
        // IndexedDBに書けない時だけ localStorage を試す
        save(KEY_CARDS, this.cards);
      });
      return true;
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
      return this._nameIdx.get(normName(name)) || null;
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

  // 「4 カード名」「4x カード名」「カード名 x4」「カード名 ×4」に対応
  function parseDeckList(text) {
    const entries = [];
    const unknown = [];
    for (let line of String(text || '').split('\n')) {
      line = line.normalize('NFKC').trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      let m = line.match(/^(\d+)\s*[x×枚]?\s+(.+)$/i) || line.match(/^(\d+)[x×](.+)$/i);
      let n, name;
      if (m) {
        n = +m[1];
        name = m[2];
      } else if ((m = line.match(/^(.+?)\s*[x×]\s*(\d+)$/i))) {
        n = +m[2];
        name = m[1];
      } else {
        n = 1;
        name = line;
      }
      const def = Store.byName(name);
      if (def) entries.push({ n, def });
      else unknown.push(name.trim());
    }
    const defs = entries.flatMap((e) => Array(e.n).fill(e.def));
    return { entries, defs, unknown, count: defs.length };
  }

  G.Store = Store;
  G.parseDeckList = parseDeckList;
  G.normName = normName;
})(window);
