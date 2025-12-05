const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Player storage
let players = {};
let items = []; // dropped items

function broadcastPlayers() {
    const data = JSON.stringify({ type: "players", players, items });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

// Spawn some items
for (let i = 0; i < 10; i++) {
    items.push({ x: Math.random() * 780 + 10, y: Math.random() * 580 + 10 });
}

wss.on("connection", (ws) => {
    const id = Date.now().toString();
    players[id] = {
        x: Math.random() * 780 + 10,
        y: Math.random() * 580 + 10,
        stats: { strength: 5, defense: 5, magic: 5, hp: 20 },
        items: []
    };

    ws.send(JSON.stringify({ type: "init", id, players, items }));

    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

        if (data.type === "update") {
            players[id] = data.update;
        }

        if (data.type === "train") {
            players[id].stats[data.stat] += 1;
        }

        if (data.type === "attack") {
            const targetId = data.targetId;
            if (!players[targetId]) return;

            const attacker = players[id];
            const defender = players[targetId];
            const dmg = Math.max(attacker.stats.strength - defender.stats.defense, 1);
            defender.stats.hp -= dmg;

            if (defender.stats.hp <= 0) {
                defender.x = Math.random() * 780 + 10;
                defender.y = Math.random() * 580 + 10;
                defender.stats.hp = 20;
            }
        }

        if (data.type === "pickup") {
            const player = players[id];
            const idx = items.findIndex(
                it => Math.hypot(it.x - player.x, it.y - player.y) < 20
            );
            if (idx >= 0) {
                player.items.push(items[idx]);
                items.splice(idx, 1);
            }
        }

        broadcastPlayers();
    });

    ws.on("close", () => delete players[id]);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
