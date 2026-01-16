const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

// 🔥 Twój serwer Render
const ws = new WebSocket("wss://agari-qfuc.onrender.com");

let myId = null;
let players = [];
const keys = {};

// Eventy klawiatury
window.addEventListener("keydown", e => keys[e.key] = true);
window.addEventListener("keyup", e => keys[e.key] = false);

// Logowanie połączenia
ws.onopen = () => console.log("✅ WebSocket połączony");
ws.onerror = (e) => console.error("❌ WebSocket error", e);
ws.onclose = () => console.warn("⚠️ WebSocket zamknięty");

// Odbiór wiadomości z serwera
ws.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === "init") myId = data.id;
  if (data.type === "state") players = data.players;
};

// Aktualizacja pozycji gracza i wysyłanie ruchów
function update() {
  if (!myId) return; 
  if (ws.readyState !== WebSocket.OPEN) return;

  let dx = 0, dy = 0;
  if (keys["w"] || keys["ArrowUp"]) dy -= 5;
  if (keys["s"] || keys["ArrowDown"]) dy += 5;
  if (keys["a"] || keys["ArrowLeft"]) dx -= 5;
  if (keys["d"] || keys["ArrowRight"]) dx += 5;

  // Wysyłamy ruch tylko dla naszej kulki
  ws.send(JSON.stringify({ type: "move", dx, dy }));
}

// Rysowanie graczy
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const me = players.find(p => p.id === myId);
  if (!me) return;

  players.forEach(p => {
    const x = canvas.width / 2 + (p.x - me.x);
    const y = canvas.height / 2 + (p.y - me.y);

    ctx.beginPath();
    ctx.arc(x, y, p.r, 0, Math.PI * 2);

    // Każdy widzi swoją kulkę na zielono, innych na niebiesko
    ctx.fillStyle = (p.id === myId) ? "green" : "blue";
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.stroke();
  });
}

// Główna pętla gry
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
