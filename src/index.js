/**
 * @rabbx/ws - Zero-dep WebSocket Client
 * Fixed: Works in Node, Bun, Deno, Workers, Browser
 */

const isBrowser = typeof window!== 'undefined' && typeof window.WebSocket!== 'undefined';
const isWorker = typeof WorkerGlobalScope!== 'undefined' && typeof WebSocketPair!== 'undefined';
const isDeno = typeof Deno!== 'undefined';
const isBun = typeof Bun!== 'undefined';
const isNode = typeof process!== 'undefined' && process.versions?.node &&!isBun &&!isDeno;

// Polyfills only for Node
if (isNode) {
  globalThis.MessageEvent??= class MessageEvent extends Event {
    constructor(type, init) { super(type); this.data = init?.data; }
  };
  globalThis.CloseEvent??= class CloseEvent extends Event {
    constructor(type, init) {
      super(type);
      this.code = init?.code?? 1005;
      this.reason = init?.reason?? '';
      this.wasClean = init?.wasClean?? false;
    }
  };
  globalThis.ErrorEvent??= class ErrorEvent extends Event {
    constructor(type, init) {
      super(type);
      this.error = init?.error;
      this.message = init?.message?? '';
    }
  };
}

// Lazy loader - NEVER runs in Bun/Deno/Worker
let NodeWebSocketClass;

async function createNodeWebSocket(url, protocols) {
  if (NodeWebSocketClass) return new NodeWebSocketClass(url, protocols);

  // Only import node:* here, inside function, only when called
  const [{ createHash }, { connect }, { connect: tlsConnect }] = await Promise.all([
    import('node:crypto'),
    import('node:net'),
    import('node:tls')
  ]);

  NodeWebSocketClass = class NodeWebSocket extends EventTarget {
    #socket = null;
    #url;
    #readyState = 0;
    #buffer = [];
    #fragments = [];
    #opcode = 0;
    #binaryType = 'arraybuffer';

    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url, protocols) {
      super();
      this.#url = new URL(url?? 'ws://localhost');
      this.#connect(createHash, connect, tlsConnect);
    }

    async #connect(createHash, connect, tlsConnect) {
      const isSecure = this.#url.protocol === 'wss:';
      const port = Number(this.#url.port) || (isSecure? 443 : 80);
      const key = createHash('sha1').update(Math.random().toString() + Date.now()).digest('base64');

      const conn = isSecure? tlsConnect : connect;
      const opts = isSecure? { servername: this.#url.hostname?? 'localhost' } : {};

      try {
        this.#socket = conn(port, this.#url.hostname?? 'localhost', opts, () => {
          const path = (this.#url.pathname?? '/') + (this.#url.search?? '');
          const req = [
            `GET ${path} HTTP/1.1`,
            `Host: ${this.#url.host?? 'localhost'}`,
            `Upgrade: websocket`,
            `Connection: Upgrade`,
            `Sec-WebSocket-Key: ${key}`,
            `Sec-WebSocket-Version: 13`,
            ``, ``
          ].join('\r\n');
          this.#socket?.write(req);
        });
      } catch (err) {
        this.#error(err);
        return;
      }

      let upgraded = false;
      let buf = Buffer.alloc(0);

      this.#socket?.on('data', (chunk) => {
        try {
          if (!upgraded) {
            buf = Buffer.concat([buf, chunk?? Buffer.alloc(0)]);
            const idx = buf.indexOf('\r\n\r\n');
            if (idx === -1) return;

            const headers = buf.slice(0, idx).toString();
            if (!headers.includes('101 Switching Protocols')) {
              this.#error(new Error('WebSocket upgrade failed'));
              return;
            }

            upgraded = true;
            this.#readyState = 1;
            this.#flush();
            this.dispatchEvent(new Event('open'));

            const body = buf.slice(idx + 4);
            if (body.length) this.#parseFrame(body);
            buf = Buffer.alloc(0);
            return;
          }
          buf = this.#parseFrame(buf.length? Buffer.concat([buf, chunk?? Buffer.alloc(0)]) : chunk?? Buffer.alloc(0));
        } catch (err) {
          this.#error(err);
        }
      });

      this.#socket?.on('close', () => {
        if (this.#readyState!== 3) {
          this.#readyState = 3;
          this.dispatchEvent(new CloseEvent('close', { code: 1006, wasClean: false }));
        }
      });

      this.#socket?.on('error', (err) => this.#error(err));
    }

    #parseFrame(data) {
      if (!data || data.length === 0) return Buffer.alloc(0);
      let offset = 0;

      while (offset < data.length) {
        if (offset + 2 > data.length) return data.slice(offset);

        const b1 = data[offset]?? 0;
        const b2 = data[offset + 1]?? 0;
        const fin = (b1 & 0x80)!== 0;
        const opcode = b1 & 0x0f;
        const masked = (b2 & 0x80)!== 0;
        let len = b2 & 0x7f;
        let headerSize = 2;

        if (len === 126) {
          if (offset + 4 > data.length) return data.slice(offset);
          len = data.readUInt16BE(offset + 2);
          headerSize = 4;
        } else if (len === 127) {
          if (offset + 10 > data.length) return data.slice(offset);
          const hi = data.readUInt32BE(offset + 2);
          const lo = data.readUInt32BE(offset + 6);
          if (hi!== 0) return Buffer.alloc(0);
          len = lo;
          headerSize = 10;
        }

        if (masked) headerSize += 4;
        if (offset + headerSize + len > data.length) return data.slice(offset);

        offset += headerSize - (masked? 4 : 0);

        let mask;
        if (masked) {
          mask = data.slice(offset, offset + 4);
          offset += 4;
        }

        let payload = data.slice(offset, offset + len);
        if (masked && mask) {
          for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4]?? 0;
        }
        offset += len;

        this.#handleFrame(opcode, fin, payload);
      }
      return Buffer.alloc(0);
    }

    #handleFrame(opcode = 0, fin = false, payload) {
      payload??= Buffer.alloc(0);

      if (opcode === 0x8) {
        const code = payload.length >= 2? payload.readUInt16BE(0) : 1005;
        const reason = payload.length > 2? payload.slice(2).toString('utf8') : '';
        this.close(code, reason);
        return;
      }
      if (opcode === 0x9) {
        this.#sendFrame(0xA, payload);
        return;
      }
      if (opcode === 0xA) return;

      if (opcode === 0x1 || opcode === 0x2) {
        this.#opcode = opcode;
        this.#fragments = [payload];
      } else if (opcode === 0x0) {
        if (!this.#fragments.length) return;
        this.#fragments.push(payload);
      } else {
        return;
      }

      if (fin) {
        const data = Buffer.concat(this.#fragments);
        const eventData = this.#opcode === 0x1
     ? data.toString('utf8')
          : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        this.dispatchEvent(new MessageEvent('message', { data: eventData }));
        this.#fragments = [];
      }
    }

    #sendFrame(opcode = 0, data) {
      if (this.#readyState!== 1 ||!this.#socket || this.#socket.destroyed) return;

      const buf = Buffer.isBuffer(data)? data : Buffer.from(data?? []);
      const len = buf.length;
      const header = [];

      header.push(0x80 | opcode);

      if (len < 126) {
        header.push(0x80 | len);
      } else if (len < 65536) {
        header.push(0x80 | 126);
        header.push(len >> 8, len & 0xff);
      } else {
        header.push(0x80 | 127);
        const big = BigInt(len);
        for (let i = 7; i >= 0; i--) header.push(Number((big >> BigInt(i * 8)) & 0xffn));
      }

      const mask = Buffer.from([
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256)
      ]);
      header.push(...mask);

      const maskedBuf = Buffer.from(buf);
      for (let i = 0; i < len; i++) maskedBuf[i] ^= mask[i % 4]?? 0;

      try {
        this.#socket.write(Buffer.concat([Buffer.from(header), maskedBuf]));
      } catch (err) {
        this.#error(err);
      }
    }

    #flush() {
      for (const data of this.#buffer) this.#sendNow(data);
      this.#buffer = [];
    }

    #sendNow(data) {
      if (data == null) return;
      if (typeof data === 'string') this.#sendFrame(0x1, data);
      else if (data instanceof ArrayBuffer) this.#sendFrame(0x2, Buffer.from(data));
      else if (ArrayBuffer.isView(data)) this.#sendFrame(0x2, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      else if (Buffer.isBuffer(data)) this.#sendFrame(0x2, data);
      else this.#sendFrame(0x2, Buffer.from(data));
    }

    #error(err) {
      this.dispatchEvent(new ErrorEvent('error', { error: err, message: err?.message?? 'Unknown error' }));
      if (this.#readyState!== 3) this.close(1006, err?.message?? '');
    }

    get url() { return this.#url.toString(); }
    get readyState() { return this.#readyState; }
    get bufferedAmount() { return 0; }
    get extensions() { return ''; }
    get protocol() { return ''; }
    get binaryType() { return this.#binaryType; }
    set binaryType(type) {
      if (type === 'arraybuffer' || type === 'blob') this.#binaryType = type;
    }

    send(data) {
      if (data == null) return;
      if (this.#readyState === 0) return this.#buffer.push(data);
      if (this.#readyState!== 1) throw new Error('WebSocket is not open');
      this.#sendNow(data);
    }

    close(code = 1000, reason = '') {
      if (this.#readyState === 2 || this.#readyState === 3) return;
      this.#readyState = 2;
      const reasonBuf = Buffer.from((reason?? '').slice(0, 123));
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code?? 1000, 0);
      reasonBuf.copy(payload, 2);
      this.#sendFrame(0x8, payload);
      this.#socket?.end();
      this.#readyState = 3;
      this.dispatchEvent(new CloseEvent('close', { code: code?? 1000, reason: reason?? '', wasClean: true }));
    }
  };

  return new NodeWebSocketClass(url, protocols);
}

export class WebSocket extends EventTarget {
  #impl;
  #ready;

  static get CONNECTING() { return 0; }
  static get OPEN() { return 1; }
  static get CLOSING() { return 2; }
  static get CLOSED() { return 3; }

  constructor(url, protocols) {
    super();
    const wsUrl = url?? 'ws://localhost';

    // Bun/Deno/Worker/Browser use native WebSocket
    if (!isNode) {
      this.#impl = new globalThis.WebSocket(wsUrl, protocols);
      this.#ready = Promise.resolve();
    } else {
      // Node only: lazy load
      this.#ready = createNodeWebSocket(wsUrl, protocols).then(ws => {
        this.#impl = ws;
      });
    }

    this.#ready.then(() => {
      this.#impl.addEventListener('open', (e) => this.dispatchEvent(new Event('open')));
      this.#impl.addEventListener('message', (e) => this.dispatchEvent(new MessageEvent('message', { data: e.data })));
      this.#impl.addEventListener('close', (e) => this.dispatchEvent(new CloseEvent('close', {
        code: e.code?? 1000,
        reason: e.reason?? '',
        wasClean: e.wasClean?? false
      })));
      this.#impl.addEventListener('error', (e) => this.dispatchEvent(new ErrorEvent('error', {
        error: e.error,
        message: e.message?? ''
      })));
    });
  }

  get url() { return this.#impl?.url?? ''; }
  get readyState() { return this.#impl?.readyState?? 0; }
  get bufferedAmount() { return this.#impl?.bufferedAmount?? 0; }
  get extensions() { return this.#impl?.extensions?? ''; }
  get protocol() { return this.#impl?.protocol?? ''; }
  get binaryType() { return this.#impl?.binaryType?? 'arraybuffer'; }
  set binaryType(type) {
    if (this.#impl && this.#impl.binaryType!== undefined) this.#impl.binaryType = type;
  }

  async send(data) {
    await this.#ready;
    this.#impl.send(data);
  }

  async close(code, reason) {
    await this.#ready;
    this.#impl.close(code, reason);
  }
}

export default WebSocket;