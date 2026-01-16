const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const players = {};

function randomPos() {
  return Math.random() * 2000;
}

wss.on('connection', ws => {
  const id = Math.random().toString(36).substr(2, 9);
  players[id] = { id, x: randomPos(), y: randomPos(), r: 20 };

  ws.on('message', msg => {
    const data = JSON.parse(msg);
    if (data.type === 'move') {
      players[id].x += data.dx;
      players[id].y += data.dy;
    }
  });

  ws.on('close', () => {
    delete players[id];
  });

  ws.send(JSON.stringify({ type: 'init', id }));
});

setInterval(() => {
  const snapshot = JSON.stringify({
    type: 'state',
    players: Object.values(players)
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(snapshot);
    }
  });
}, 50);

console.log(`Server started on port ${PORT}`);
