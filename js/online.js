// 友人対戦の通信（中継サーバーとのやりとり）
(function (G) {
  'use strict';
  class Net {
    constructor(base, room, me) {
      this.base = String(base || '').replace(/\/+$/, '');
      this.room = room;
      this.me = me;
      this.since = 0;
      this.inbox = [];
      this.ansWaiter = null;
      this.onMessage = null; // ゲーム外のメッセージ（hello / start / quit など）
      this.onStatus = null;
      this.stopped = false;
      this._sendChain = Promise.resolve();
      this.game = null;
    }
    static async createRoom(base) {
      const r = await fetch(String(base).replace(/\/+$/, '') + '/api/room', { method: 'POST' });
      if (!r.ok) throw new Error('部屋を作れませんでした');
      return (await r.json()).room;
    }
    // 送る順番を守る（失敗したら少し待って送り直す）
    send(obj) {
      this._sendChain = this._sendChain.then(async () => {
        for (let i = 0; i < 20 && !this.stopped; i++) {
          try {
            const r = await fetch(`${this.base}/api/send?room=${encodeURIComponent(this.room)}&from=${this.me}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
            if (r.ok) return;
            if (r.status === 404) throw new Error('部屋がありません');
          } catch (e) {
            this.onStatus && this.onStatus('送信に失敗、再送します…');
          }
          await new Promise((res) => setTimeout(res, Math.min(5000, 300 * (i + 1))));
        }
      });
      return this._sendChain;
    }
    async start() {
      while (!this.stopped) {
        try {
          const r = await fetch(`${this.base}/api/poll?room=${encodeURIComponent(this.room)}&me=${this.me}&since=${this.since}`, { cache: 'no-store' });
          if (r.status === 404) {
            this.onStatus && this.onStatus('部屋が見つかりません');
            await new Promise((res) => setTimeout(res, 3000));
            continue;
          }
          const j = await r.json();
          for (const m of j.msgs || []) {
            if (m.seq <= this.since) continue;
            this.since = m.seq;
            this.receive(m.data);
          }
          this.onStatus && this.onStatus('');
        } catch (e) {
          this.onStatus && this.onStatus('通信が切れています。再接続中…');
          await new Promise((res) => setTimeout(res, 1500));
        }
      }
    }
    stop() {
      this.stopped = true;
    }
    receive(m) {
      if (m.t === 'ans' || m.t === 'step' || m.t === 'end') {
        this.inbox.push(m);
        this.pump();
      } else if (this.onMessage) this.onMessage(m);
    }
    // 相手の選択を待つ
    recvAns() {
      return new Promise((resolve) => {
        this.ansWaiter = resolve;
        this.pump();
      });
    }
    // 届いたものを順番に処理する。操作は、こちらが同じ場面（待ち状態）になってから実行する
    pump() {
      const g = this.game;
      if (!g || this._pumping) return;
      this._pumping = true;
      try {
        while (this.inbox.length) {
          const m = this.inbox[0];
          if (m.t === 'ans') {
            if (!this.ansWaiter) break;
            this.inbox.shift();
            const w = this.ansWaiter;
            this.ansWaiter = null;
            w(m.ids);
            continue;
          }
          if (g.busy || !g._endTurnResolve || this.ansWaiter || g.winner != null) {
            clearTimeout(this._retry);
            this._retry = setTimeout(() => this.pump(), 40);
            break;
          }
          this.inbox.shift();
          const h = g.stateHash();
          if (m.h && m.h !== h && !this._warned) {
            this._warned = true;
            g.log('⚠ 相手と盤面がずれている可能性があります（同じカードデータ・同じ版の画面か確認してください）');
          }
          if (m.t === 'end') g.endTurn(true);
          else {
            const p = g.runRemoteStep(m.step, m.via);
            Promise.resolve(p).then(() => this.pump());
          }
          clearTimeout(this._retry);
          this._retry = setTimeout(() => this.pump(), 40);
          break;
        }
      } finally {
        this._pumping = false;
      }
    }
  }
  // 両者で同じ乱数にする
  function seededRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  G.Online = { Net, seededRng };
})(typeof window !== 'undefined' ? window : globalThis);
