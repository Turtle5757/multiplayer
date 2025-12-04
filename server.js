const express = require("express");
const app = express();
const http = require("http").createServer(app);
const WebSocket = require("ws");
const wss = new WebSocket.Server({ server: http });

app.use(express.static("public")); // serve frontend

let players = {};
let monsters = [];

// spawn some monsters for demo
function spawnMonsters() {
  monsters = [
    { id: "m1", x: 100, y: 100, hp: 20 },
    { id: "m2", x: 400, y: 200, hp: 30 },
  ];
}
spawnMonsters();

wss.on("connection", (ws) => {
  console.log("Player connected");

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    switch (data.type) {
      case "join":
        players[data.id] = data.player;
        ws.id = data.id;
        broadcast({ type: "syncPlayers", players, monsters });
        break;

      case "update":
        if (ws.id) players[ws.id] = data.player;
        broadcast({ type: "syncPlayers", players, monsters });
        break;

      case "attack":
        const target = monsters.find((m) => m.id === data.targetId);
        if (target) {
          target.hp -= data.damage;
          if (target.hp <= 0) {
            // reward player
            players[ws.id].coins += 10;
            // respawn monster
            target.hp = Math.floor(Math.random() * 20) + 10;
          }
          broadcast({ type: "syncPlayers", players, monsters });
        }
        break;
    }
  });

  ws.on("close", () => {
    if (ws.id) delete players[ws.id];
    broadcast({ type: "syncPlayers", players, monsters });
  });

  ws.send(JSON.stringify({ type: "syncPlayers", players, monsters }));
});

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
  });
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
