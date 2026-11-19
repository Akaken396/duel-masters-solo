// カード・デッキはブラウザの localStorage、画像は IndexedDB に保存（このPCの中だけ）
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

    init() {
      this.cards = load(KEY_CARDS, null);
      this.decks = load(KEY_DECKS, null);
      if (!this.cards) this.cards = G.Samples.cards.map((c) => ({ ...c }));
      if (!this.decks) this.decks = G.Samples.decks.map((d) => ({ ...d }));
      this.prefs = load(KEY_PREFS, {});
      return this.loadImages();
    },
    saveCards() {
      return save(KEY_CARDS, this.cards);
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
      const n = normName(name);
      return this.cards.find((c) => normName(c.name) === n);
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
        const r = indexedDB.open('dmsolo-images', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('img');
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
