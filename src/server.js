/**
 * @rabbx/ws/server - Zero-dep WebSocket Server
 * RFC 6455 compliant: Node, Bun, Deno, Cloudflare Workers
 */

const isBun = typeof Bun!== 'undefined';
const isDeno = typeof Deno!== 'undefined';
const isWorker = typeof WorkerGlobalScope!== 'undefined' && typeof WebSocketPair!== 'undefined';
const isNode = typeof process!== 'undefined' && process.versions?.node &&!isBun &&!isDeno;

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

class RabbitWSServer extends EventTarget {
  #opts;
  #clients = new Set();

  constructor(opts = {}) {
    super();
    this.#opts = {
      path: '/',
      verifyClient: null,
      maxPayload: 64 * 1024, // 64KB default. Prevents DoS
      maxHeaderSize: 8 * 1024, // 8KB header limit
      backpressureLimit: 1024 * 1024, // 1MB backpressure limit for Node
     ...opts
    };
  }

  get clients() { return this.#clients; }

  bunConfig() {
    if (!isBun) return null;
    const server = this;

    return {
      config: {
        websocket: {
          maxPayloadLength: server.#opts.maxPayload, // Bun native limit
          open(ws) {
            const socket = new RabbitSocket(ws, ws.data?.req, server, 'bun');
            server.#clients.add(socket);
            ws.rabbitSocket = socket;
            server.dispatchEvent(new CustomEvent('connection', { detail: { socket, req: ws.data?.req } }));
          },
          message(ws, msg) {
            ws.rabbitSocket?._onMessage(msg);
          },
          close(ws, code, reason) {
            if (ws.rabbitSocket) {
              server.#clients.delete(ws.rabbitSocket);
              ws.rabbitSocket._onClose(code, reason);
            }
          }
        },
        fetch(req, serverInstance) {
          const url = new URL(req?.url?? '');
          if (url.pathname!== server.#opts.path) {
            return new Response('Not found', { status: 404 });
          }
          // Header size check
          if (req.headers.get('upgrade')?.length > 256) {
            return new Response('Bad request', { status: 400 });
          }
          if (req?.headers?.get('upgrade')?.toLowerCase()!== 'websocket') {
            return new Response('Expected WebSocket', { status: 426 });
          }
          const upgraded = serverInstance.upgrade(req, { data: { req } });
          if (!upgraded) {
            return new Response('Upgrade failed', { status: 400 });
          }
          return;
        }
      },
      server: server
    };
  }

  handleDeno(req) {
    if (!isDeno ||!req) return new Response('Bad request', { status: 400 });
    const url = new URL(req.url?? '');
    if (url.pathname!== this.#opts.path) return new Response('Not found', { status: 404 });

    // Deno has no built-in maxPayload, enforce in wrapper
    const { socket, response } = Deno.upgradeWebSocket(req);
    const rabbitSocket = new RabbitSocket(socket, req, this, 'deno', this.#opts.maxPayload);
    this.#clients.add(rabbitSocket);

    socket.onopen = () => this.dispatchEvent(new CustomEvent('connection', { detail: { socket: rabbitSocket, req } }));
    socket.onmessage = (e) => rabbitSocket._onMessage(e.data);
    socket.onclose = (e) => {
      this.#clients.delete(rabbitSocket);
      rabbitSocket._onClose(e.code, e.reason);
    };
    socket.onerror = (e) => rabbitSocket._onError(e);

    return response;
  }

  async handleRequest(req) {
    if (!isWorker ||!req) return new Response('Bad request', { status: 400 });
    const url = new URL(req.url?? '');
    if (url.pathname!== this.#opts.path) return new Response('Not found', { status: 404 });

    // Header size check
    const upgrade = req.headers?.get('Upgrade');
    if (!upgrade || upgrade.length > 256) return new Response('Bad request', { status: 400 });
    if (upgrade!== 'websocket') return new Response('Expected websocket', { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    const socket = new RabbitSocket(server, req, this, 'worker', this.#opts.maxPayload);
    this.#clients.add(socket);

    server.addEventListener('message', (e) => socket._onMessage(e.data));
    server.addEventListener('close', (e) => {
      this.#clients.delete(socket);
      socket._onClose(e.code, e.reason);
    });
    server.addEventListener('error', (e) => socket._onError(e));

    this.dispatchEvent(new CustomEvent('connection', { detail: { socket, req } }));

    return new Response(null, { status: 101, webSocket: client });
  }

  handleNodeUpgrade(req, socket, head) {
    if (!isNode ||!req ||!socket) return;

    // Header size limit
    const headerSize = JSON.stringify(req.headers).length + (req.url?.length?? 0);
    if (headerSize > this.#opts.maxHeaderSize) {
      socket.destroy();
      return;
    }

    const url = new URL(req.url?? '', `http://${req.headers?.host?? 'localhost'}`);
    if (url.pathname!== this.#opts.path) {
      socket.destroy();
      return;
    }
    this.#acceptNode(req, socket, head);
  }

  async #acceptNode(req, socket, head) {
    const { createHash } = await import('node:crypto');
    const key = req.headers?.['sec-websocket-key'];

    if (!key || key.length > 256) {
      socket.destroy();
      return;
    }

    if (this.#opts.verifyClient) {
      let called = false;
      const origin = req.headers?.origin?? '';
      const secure = req.socket?.encrypted?? false;

      this.#opts.verifyClient({ origin, req, secure }, (res, code, msg) => {
        if (called) return;
        called = true;
        if (!res) {
          socket.write(`HTTP/1.1 ${code?? 401} ${msg?? 'Unauthorized'}\r\n\r\n`);
          socket.destroy();
          return;
        }
        this.#doNodeUpgrade(req, socket, head, key, createHash);
      });
    } else {
      this.#doNodeUpgrade(req, socket, head, key, createHash);
    }
  }

  #doNodeUpgrade(req, socket, head, key, createHash) {
    const accept = createHash('sha1')
     .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
     .digest('base64');

    const res = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', ''
    ].join('\r\n');

    socket.write(res);

    const rabbitSocket = new RabbitSocket(socket, req, this, 'node', this.#opts.maxPayload, this.#opts.backpressureLimit);
    this.#clients.add(rabbitSocket);
    this.dispatchEvent(new CustomEvent('connection', { detail: { socket: rabbitSocket, req } }));

    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      if (!chunk) return;
      buf = Buffer.concat([buf, chunk]);

      // Header size check for initial handshake
      if (buf.length > this.#opts.maxHeaderSize) {
        socket.destroy();
        return;
      }

      buf = rabbitSocket._parseFrame(buf);
    });

    socket.on('close', () => {
      this.#clients.delete(rabbitSocket);
      rabbitSocket._onClose(1006, '');
    });

    socket.on('error', (err) => rabbitSocket._onError(err));
  }

  close(cb) {
    for (const client of this.#clients) client.close(1001, 'Server shutdown');
    this.#clients.clear();
    if (cb) cb();
  }
}

class RabbitSocket extends EventTarget {
  #ws;
  #req;
  #server;
  #runtime;
  #maxPayload;
  #backpressureLimit;
  readyState = 1;
  #fragments = [];
  #opcode = 0;
  #bufferedAmount = 0;

  constructor(ws, req, server, runtime, maxPayload = 64 * 1024, backpressureLimit = 1024 * 1024) {
    super();
    this.#ws = ws;
    this.#req = req?? {};
    this.#server = server;
    this.#runtime = runtime?? 'node';
    this.#maxPayload = maxPayload;
    this.#backpressureLimit = backpressureLimit;
    if (ws) ws.rabbitSocket = this;
  }

  get url() { return this.#req.url?? ''; }
  get bufferedAmount() { return this.#bufferedAmount; }

  send(data) {
    if (this.readyState!== 1 ||!this.#ws) return;
    if (data == null) return;

    const len = typeof data === 'string'? Buffer.byteLength(data) : data.byteLength?? data.length;
    if (len > this.#maxPayload) {
      this.close(1009, 'Message too big');
      return;
    }

    if (this.#runtime!== 'node') {
      this.#ws.send(data);
      return;
    }

    // Backpressure check for Node
    if (this.#bufferedAmount > this.#backpressureLimit) {
      this.close(1001, 'Backpressure limit exceeded');
      return;
    }

    const opcode = typeof data === 'string'? 0x1 : 0x2;
    const buf = Buffer.isBuffer(data)? data : Buffer.from(data?? []);
    const len2 = buf.length;
    const header = [0x80 | opcode];

    if (len2 < 126) {
      header.push(len2);
    } else if (len2 < 65536) {
      header.push(126, len2 >> 8, len2 & 0xff);
    } else {
      header.push(127);
      const big = BigInt(len2);
      for (let i = 7; i >= 0; i--) header.push(Number((big >> BigInt(i * 8)) & 0xffn));
    }

    const frame = Buffer.concat([Buffer.from(header), buf]);
    this.#bufferedAmount += frame.length;
    this.#ws.write(frame);

    // Reset bufferedAmount when drained
    this.#ws.once('drain', () => {
      this.#bufferedAmount = 0;
    });
  }

  close(code = 1000, reason = '') {
    if (this.readyState!== 1) return;
    this.readyState = 2;

    if (this.#runtime!== 'node') {
      this.#ws.close(code?? 1000, reason?? '');
    } else if (this.#ws) {
      const buf = Buffer.from((reason?? '').slice(0, 123));
      const payload = Buffer.alloc(2 + buf.length);
      payload.writeUInt16BE(code?? 1000, 0);
      buf.copy(payload, 2);
      const header = [0x88, payload.length];
      this.#ws.write(Buffer.concat([Buffer.from(header), payload]));
      this.#ws.end();
    }

    this.readyState = 3;
  }

  _onMessage(data) {
    const len = typeof data === 'string'? Buffer.byteLength(data) : data.byteLength?? data.length;
    if (len > this.#maxPayload) {
      this.close(1009, 'Message too big');
      return;
    }
    this.dispatchEvent(new MessageEvent('message', { data: data?? '' }));
  }

  _onClose(code, reason) {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code: code?? 1000, reason: reason?? '' }));
  }

  _onError(error) {
    this.dispatchEvent(new ErrorEvent('error', { error, message: error?.message?? '' }));
  }

  _parseFrame(buf) {
    if (!buf || buf.length < 2) return buf?? Buffer.alloc(0);
    let offset = 0;

    while (offset < buf.length) {
      if (offset + 2 > buf.length) return buf.slice(offset);

      const b1 = buf[offset]?? 0;
      const b2 = buf[offset + 1]?? 0;
      const fin = (b1 & 0x80)!== 0;
      const opcode = b1 & 0x0f;
      const masked = (b2 & 0x80)!== 0;
      let len = b2 & 0x7f;
      let headerSize = 2;

      if (len === 126) {
        if (offset + 4 > buf.length) return buf.slice(offset);
        len = buf.readUInt16BE(offset + 2);
        headerSize = 4;
      } else if (len === 127) {
        if (offset + 10 > buf.length) return buf.slice(offset);
        const hi = buf.readUInt32BE(offset + 2);
        const lo = buf.readUInt32BE(offset + 6);
        if (hi!== 0) return Buffer.alloc(0); // >4GB not supported
        len = lo;
        headerSize = 10;
      }

      // Payload size check
      if (len > this.#maxPayload) {
        this.close(1009, 'Message too big');
        return Buffer.alloc(0);
      }

      if (masked) headerSize += 4;
      if (offset + headerSize + len > buf.length) return buf.slice(offset);

      offset += headerSize - (masked? 4 : 0);

      let mask;
      if (masked) {
        mask = buf.slice(offset, offset + 4);
        offset += 4;
      }

      let payload = buf.slice(offset, offset + len);
      if (masked && mask) {
        for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4]?? 0;
      }
      offset += len;

      if (opcode === 0x8) {
        const code = payload.length >= 2? payload.readUInt16BE(0) : 1005;
        const reason = payload.length > 2? payload.slice(2).toString('utf8') : '';
        this.close(code, reason);
        return Buffer.alloc(0);
      }
      if (opcode === 0x9) {
        const pong = Buffer.concat([Buffer.from([0x8A, payload.length]), payload]);
        this.#ws.write(pong);
        continue;
      }
      if (opcode === 0xA) continue;

      if (opcode === 0x1 || opcode === 0x2) {
        this.#opcode = opcode;
        this.#fragments = [payload];
      } else if (opcode === 0x0) {
        if (!this.#fragments.length) continue;
        this.#fragments.push(payload);
      }

      if (fin) {
        const data = Buffer.concat(this.#fragments);
        const eventData = this.#opcode === 0x1? data.toString('utf8') : data;
        this.dispatchEvent(new MessageEvent('message', { data: eventData }));
        this.#fragments = [];
      }
    }
    return Buffer.alloc(0);
  }
}

// Node
export function createServer(httpServer, opts = {}) {
  const server = new RabbitWSServer(opts);
  if (isNode && httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      server.handleNodeUpgrade(req, socket, head);
    });
  }
  return server;
}

// Bun: returns { config, server }
export function createBunServer(opts = {}) {
  const server = new RabbitWSServer(opts);
  return server.bunConfig();
}

export { RabbitWSServer as WebSocketServer };
export default createServer;