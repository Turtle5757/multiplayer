const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = {};

function broadcastPlayers() {
    const data = JSON.stringify({ type: "players", players });
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(data);
    });
}

wss.on("connection", ws => {
    const id = Date.now().toString();
    players[id] = { x: 400, y: 300, stats: { str:5, def:5, mag:5, hp:20 }, items: [] };

    ws.send(JSON.stringify({ type: "init", id, players }));

    ws.on("message", msg => {
        const data = JSON.parse(msg);
        if (data.type === "update") players[id] = data.update;
        if (data.type === "train") players[id].stats[data.stat] += 1;
        if (data.type === "attack") {
            const target = players[data.targetId];
            if (target) {
                const dmg = Math.max(players[id].stats.str - target.stats.def, 1);
                target.stats.hp -= dmg;
                if (target.stats.hp <= 0) target.stats.hp = 20;
            }
        }
        broadcastPlayers();
    });

    ws.on("close", () => delete players[id]);
});

server.listen(process.env.PORT || 10000, "0.0.0.0", () => console.log("Server running"));
