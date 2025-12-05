const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = {};

function broadcastPlayers() {
    const data = JSON.stringify({ type: "players", players });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

wss.on("connection", (ws) => {
    const id = Date.now().toString();
    players[id] = {
        x: Math.random() * 700 + 50,
        y: Math.random() * 500 + 50,
        stats: { strength: 5, defense: 5, magic: 5 },
        items: []
    };

    ws.send(JSON.stringify({ type: "init", id, players }));

    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

        if (data.type === "update") {
            players[id] = data.update;
            broadcastPlayers();
        }

        if (data.type === "train") {
            // Training increases stats
            const stat = data.stat;
            players[id].stats[stat] += 1;
            broadcastPlayers();
        }

        if (data.type === "attack") {
            const targetId = data.targetId;
            if (!players[targetId]) return;

            // Simple combat calculation
            const attacker = players[id];
            const defender = players[targetId];

            const dmg = Math.max(attacker.stats.strength - defender.stats.defense, 1);
            defender.stats.defense -= dmg;

            if (defender.stats.defense <= 0) {
                defender.x = Math.random() * 700 + 50;
                defender.y = Math.random() * 500 + 50;
                defender.stats.defense = 5;
            }

            broadcastPlayers();
        }
    });

    ws.on("close", () => delete players[id]);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
