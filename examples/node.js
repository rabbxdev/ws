// test.js
import { WebSocket } from '../src/index.js';
import { createServer } from 'node:http';
import { createServer as createWSS } from '../src/server.js'; 

const http = createServer();
const wss = createWSS(http, { path: '/ws' });

wss.addEventListener('connection', ({ detail: { socket } }) => {
  socket.addEventListener('message', (e) => {
    console.log('Server got:', e.data);
    socket.send('Echo: ' + e.data);
  });
  socket.send('Hello');
});

http.listen(3000, () => {
  setTimeout(()=>{
  const ws = new WebSocket('ws://localhost:3000/ws');
  ws.addEventListener('message', (e) => console.log('Client got:', e.data));
  ws.addEventListener('open', () => ws.send('Test'));},3000)
});