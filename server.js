const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = {};
let monsters = [];

// --- Monster/Boss setup ---
function spawnMonster(type = "monster") {
    return {
        id: Date.now() + Math.random(),
        x: Math.random() * 760 + 20,
        y: Math.random() * 560 + 20,
        type,
        hp: type === "boss" ? 50 : 20,
        attack: type === "boss" ? 5 : 2,
        speed: type === "boss" ? 1.5 : 1
    };
}

// Spawn initial monsters
for (let i = 0; i < 5; i++) monsters.push(spawnMonster());
monsters.push(spawnMonster("boss")); // 1 boss

function broadcast() {
    const data = JSON.stringify({ type: "state", players, monsters });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

// Monster AI
function updateMonsters() {
    for (let m of monsters) {
        // Move towards nearest player
        let nearest = null;
        let minDist = Infinity;
        for (let id in players) {
            const p = players[id];
            const dist = Math.hypot(p.x - m.x, p.y - m.y);
            if (dist < minDist) { minDist = dist; nearest = p; }
        }
        if (nearest) {
            const dx = nearest.x - m.x;
            const dy = nearest.y - m.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
                m.x += (dx / dist) * m.speed;
                m.y += (dy / dist) * m.speed;
            }

            // Attack if close
            if (dist < 20) {
                nearest.stats.hp -= m.attack;
                if (nearest.stats.hp <= 0) {
                    nearest.x = Math.random() * 760 + 20;
                    nearest.y = Math.random() * 560 + 20;
                    nearest.stats.hp = nearest.stats.maxHp;
                }
            }
        }
    }
    broadcast();
}
setInterval(updateMonsters, 100);

// WebSocket handling
wss.on("connection", ws => {
    const id = Date.now().toString();
    players[id] = {
        x: Math.random() * 760 + 20,
        y: Math.random() * 560 + 20,
        stats: { 
            strength: 5, 
            defense: 5, 
            magic: 5, 
            hp: 20, 
            maxHp: 20, 
            speed: 3 
        },
        items: [],
        skills: []
    };

    ws.send(JSON.stringify({ type: "init", id, players, monsters }));

    ws.on("message", msg => {
        const data = JSON.parse(msg);
        const player = players[id];
        if (!player) return;

        // Movement
        if (data.type === "update") player.x = data.x || player.x, player.y = data.y || player.y;

        // Training stats
        if (data.type === "train") {
            if (data.stat === "hp") {
                player.stats.maxHp += 5;
                player.stats.hp = player.stats.maxHp;
            } else {
                player.stats[data.stat] += 1;
            }
        }

        // Attack another player
        if (data.type === "attack") {
            const target = players[data.targetId];
            if (target) {
                const dmg = Math.max(player.stats.strength - target.stats.defense, 1);
                target.stats.hp -= dmg;
                if (target.stats.hp <= 0) {
                    target.x = Math.random() * 760 + 20;
                    target.y = Math.random() * 560 + 20;
                    target.stats.hp = target.stats.maxHp;
                }
            }
        }

        // Skill use (example)
        if (data.type === "skill") {
            // Add your skill logic here
        }

        // Item pickup / logic can be added here

        broadcast();
    });

    ws.on("close", () => delete players[id]);
});

server.listen(process.env.PORT || 10000, "0.0.0.0", () => console.log("Server running"));
