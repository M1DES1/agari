const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// 🔴 ZMIEŃ NA SWÓJ ADRES Z RENDERA
const ws = new WebSocket("wss://TWOJA-NAZWA.onrender.com");

let myId = null;
let players = [];

ws.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === "init") myId = data.id;
  if (data.type === "state") players = data.players;
};

const keys = {};
window.addEventListener("keydown", e => keys[e.key] = true);
window.addEventListener("keyup", e => keys[e.key] = false);

function update() {
  let dx = 0, dy = 0;
  if (keys["w"]) dy -= 5;
  if (keys["s"]) dy += 5;
  if (keys["a"]) dx -= 5;
  if (keys["d"]) dx += 5;

  ws.send(JSON.stringify({ type: "move", dx, dy }));
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const me = players.find(p => p.id === myId);
  if (!me) return;

  players.forEach(p => {
    const x = canvas.width / 2 + (p.x - me.x) / 2;
    const y = canvas.height / 2 + (p.y - me.y) / 2;

    ctx.beginPath();
    ctx.arc(x, y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.id === myId ? "green" : "blue";
    ctx.fill();
  });
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
