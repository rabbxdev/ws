import { createServer as createWSS } from '@rabbx/ws/server';

export default {
  async fetch(req) {
    const wss = createWSS(null, { path: '/ws' });
    wss.addEventListener('connection', ({ detail: { socket } }) => {
      socket.send('Hello from Workers');
    });
    return wss.handleRequest(req);
  }
}