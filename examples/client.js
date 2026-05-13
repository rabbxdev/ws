import { WebSocket } from '@rabbx/ws';

const ws = new WebSocket('ws://localhost:3000/ws');

ws.addEventListener('open', () => {
  console.log('Connected');
  ///mitigates dos when data exceed limits
  ws.send('hello bun'.repeat(100000));
  ws.send(new Uint8Array([1,2,3,4]).buffer);
});

ws.addEventListener('message', (e) => {
  if (typeof e.data === 'string') {
    //console.log('Text:', e.data);
  } else {
    console.log('Binary:', new Uint8Array(e.data));
  }
});

ws.addEventListener('close', (e) => {
  console.log(`Closed: ${e.code}`);
});

setTimeout(() => ws.close(1000, 'done'), 2000);