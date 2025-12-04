const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let myId = "player_" + Math.floor(Math.random() * 10000);
let players = {};
let monsters = [];

let myPlayer = {
  x: Math.random() * 500 + 50,
  y: Math.random() * 300 + 50,
  str: 1,
  def: 1,
  mag: 1,
  coins: 0,
  color: "#" + Math.floor(Math.random()*16777215).toString(16)
};

const ws = new WebSocket(`https://multiplayer-qetn.onrender.com`);

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "join", id: myId, player: myPlayer }));
};

ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (data.type === "syncPlayers") {
    players = data.players;
    monsters = data.monsters;
    updateStats();
  }
};

// Controls
document.addEventListener("keydown", (e) => {
  const step = 5;
  if (e.key === "ArrowUp") myPlayer.y -= step;
  if (e.key === "ArrowDown") myPlayer.y += step;
  if (e.key === "ArrowLeft") myPlayer.x -= step;
  if (e.key === "ArrowRight") myPlayer.x += step;
  sendUpdate();
});

// Training buttons
document.getElementById("trainStr").onclick = () => { myPlayer.str += 1; sendUpdate(); updateStats(); };
document.getElementById("trainDef").onclick = () => { myPlayer.def += 1; sendUpdate(); updateStats(); };
document.getElementById("trainMag").onclick = () => { myPlayer.mag += 1; sendUpdate(); updateStats(); };

function sendUpdate() {
  ws.send(JSON.stringify({ type: "update", id: myId, player: myPlayer }));
}

function updateStats() {
  document.getElementById("str").textContent = myPlayer.str;
  document.getElementById("def").textContent = myPlayer.def;
  document.getElementById("mag").textContent = myPlayer.mag;
  document.getElementById("coins").textContent = myPlayer.coins;
}

// Game loop
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw monsters
  monsters.forEach(m => {
    ctx.fillStyle = "red";
    ctx.fillRect(m.x, m.y, 20, 20);
  });

  // Draw players
  Object.values(players).forEach(p => {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 20, 20);
  });

  requestAnimationFrame(draw);
}

draw();
