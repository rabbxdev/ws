import { createBunServer } from '@rabbx/ws/server';

// Fix: destructure both config and server
const { config, server: wss } = createBunServer({ path: '/ws',maxPayload:64*1024 });

Bun.serve({
  port: 3000,
  fetch: config.fetch,
  websocket: config.websocket
});

console.log(`Bun WebSocket: ws://localhost:3000/ws`);

// Fix: Use wss events, not websocket.open
wss.addEventListener('connection', ({ detail: { socket } }) => {
  console.log('Client connected');
  socket.send('Server: ready');

  socket.addEventListener('message', (e) => {
    //console.log('Got data:', e.data); // This fires now
    socket.send(`Echo: ${e.data}`);
  });

  socket.addEventListener('close', (e) => {
    console.log(`Closed: ${e.code} ${e.reason}`);
  });
});