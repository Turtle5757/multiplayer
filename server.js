const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = {};

function broadcast() {
    const data = JSON.stringify({ type: "players", players });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

wss.on("connection", ws => {
    const id = Date.now().toString();
    players[id] = {
        x: Math.random() * 780 + 10,
        y: Math.random() * 580 + 10,
        stats: { strength: 5, defense: 5, magic: 5, hp: 20 }
    };

    ws.send(JSON.stringify({ type: "init", id, players }));

    ws.on("message", msg => {
        const data = JSON.parse(msg);

        if (data.type === "update") players[id] = data.update;

        if (data.type === "train") {
            players[id].stats[data.stat] += 1;
        }

        if (data.type === "attack") {
            const target = players[data.targetId];
            if (target) {
                const dmg = Math.max(players[id].stats.strength - target.stats.defense, 1);
                target.stats.hp -= dmg;
                if (target.stats.hp <= 0) target.stats.hp = 20; // respawn
            }
        }

        broadcast();
    });

    ws.on("close", () => delete players[id]);
});

server.listen(process.env.PORT || 10000, "0.0.0.0", () => console.log("Server running"));
