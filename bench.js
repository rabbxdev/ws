import { WebSocket as RabbitWS } from '@rabbx/ws';
import { WebSocketServer as RabbitWSServer } from '@rabbx/ws/server';
import { WebSocket as WS, WebSocketServer as WSServer } from 'ws';

const isBun = typeof Bun!== 'undefined';
const NativeWS = isBun? WebSocket : WS;

const PORT = 3000;
const MESSAGES = 100000;
const PAYLOAD = 'x'.repeat(1024); // 1KB

async function bench(name, createServer, createClient) {
  console.log(`\n=== ${name} ===`);
  
  let server, http;
  const start = performance.now();
  let received = 0;
  let latencies = [];

  await new Promise((resolve) => {
    server = createServer();
    
    server.addEventListener?.('connection', ({ detail: { socket } }) => {
      socket.addEventListener('message', (e) => {
        if (e.data === 'ping') {
          socket.send('pong');
        } else {
          received++;
          if (received === MESSAGES) resolve();
        }
      });
    });

    // For ws package
    if (server.on) {
      server.on('connection', (socket) => {
        socket.on('message', (data) => {
          if (data.toString() === 'ping') {
            socket.send('pong');
          } else {
            received++;
            if (received === MESSAGES) resolve();
          }
        });
      });
    }

    if (isBun && server.bunConfig) {
      const { config } = server.bunConfig();
      http = Bun.serve({ port: PORT, ...config });
    } else if (!isBun) {
      http = server.httpServer;
      http.listen(PORT, () => {});
    }
  });

  // Latency test: 1000 ping-pongs
  const client = createClient();
  const pingStart = performance.now();
  
  for (let i = 0; i < 1000; i++) {
    const t0 = performance.now();
    await new Promise((r) => {
      client.addEventListener?.('message', () => r(), { once: true });
      client.on?.('message', () => r());
      client.send('ping');
    });
    latencies.push(performance.now() - t0);
  }
  
  const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
  
  // Throughput test: blast MESSAGES
  const tputStart = performance.now();
  for (let i = 0; i < MESSAGES; i++) {
    client.send(PAYLOAD);
  }
  
  await new Promise((r) => {
    const check = setInterval(() => {
      if (received === MESSAGES) {
        clearInterval(check);
        r();
      }
    }, 10);
  });
  
  const tputTime = performance.now() - tputStart;
  const mbps = (MESSAGES * PAYLOAD.length / 1024 / 1024) / (tputTime / 1000);
  const msgPerSec = MESSAGES / (tputTime / 1000);
  
  console.log(`Latency: ${avgLatency.toFixed(3)}ms avg`);
  console.log(`Throughput: ${msgPerSec.toFixed(0)} msg/s, ${mbps.toFixed(2)} MB/s`);
  console.log(`Time: ${tputTime.toFixed(0)}ms for ${MESSAGES} msgs`);
  
  client.close();
  server.close?.();
  http?.stop?.();
  http?.close?.();
  
  await new Promise(r => setTimeout(r, 100)); // Cool down
}

// 1. @rabbx/ws
await bench('@rabbx/ws', () => {
  const server = new RabbitWSServer({ path: '/ws' });
  if (!isBun) {
    const { createServer } = require('http');
    server.httpServer = createServer();
  }
  return server;
}, () => new RabbitWS(`ws://localhost:${PORT}/ws`));

// 2. ws package
await bench('ws', () => {
  const { createServer } = require('http');
  const httpServer = createServer();
  const server = new WSServer({ server: httpServer, path: '/ws' });
  server.httpServer = httpServer;
  return server;
}, () => new WS(`ws://localhost:${PORT}/ws`));

// 3. Native Bun
if (isBun) {
  await bench('Bun Native', () => {
    let clients = new Set();
    const server = Bun.serve({
      port: PORT,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response('404');
      },
      websocket: {
        message(ws, msg) {
          if (msg === 'ping') {
            ws.send('pong');
          } else {
            // Count handled by bench
          }
        }
      }
    });
    // Hack to match API
    server.addEventListener = () => {};
    server.close = () => server.stop();
    return server;
  }, () => new WebSocket(`ws://localhost:${PORT}`));
}

console.log('\nDone');