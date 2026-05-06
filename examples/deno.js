import { createServer as createWSS } from '@rabbx/ws/server';

Deno.serve({ port: 3000 }, (req) => {
  const wss = createWSS(null, { path: '/ws' });
  wss.addEventListener('connection', ({ detail: { socket } }) => {
    socket.send('Hello from Deno');
  });
  return wss.handleDeno(req);
});