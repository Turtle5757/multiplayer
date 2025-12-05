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

// --- PvE Monsters/Bosses ---
function spawnMonster(type = "monster") {
    return {
        id: Date.now() + Math.random(),
        x: 410 + Math.random() * 380, // Right side = PvE
        y: 10 + Math.random() * 580,
        type,
        hp: type === "boss" ? 50 : 20,
        attack: type === "boss" ? 5 : 2,
        speed: type === "boss" ? 1.5 : 1
    };
}

// Spawn monsters
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
        let nearest = null;
        let minDist = Infinity;
        for (let id in players) {
            const p = players[id];
            // Only chase players in PvE zone
            if (p.x < 400) continue;
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

            if (dist < 20) {
                nearest.stats.hp -= m.attack;
                if (nearest.stats.hp <= 0) {
                    nearest.x = Math.random() * 380; // respawn PvP side
                    nearest.y = Math.random() * 580;
                    nearest.stats = { strength:5, defense:5, magic:5, hp:20, maxHp:20, speed:3 };
                    nearest.xp = 0;
                    nearest.skillPoints = 0;
                }
            }
        }
    }
    broadcast();
}
setInterval(updateMonsters, 100);

// WebSocket
wss.on("connection", ws => {
    const id = Date.now().toString();
    players[id] = {
        x: Math.random() * 380, // PvP zone
        y: Math.random() * 580,
        stats: { strength:5, defense:5, magic:5, hp:20, maxHp:20, speed:3 },
        xp:0,
        skillPoints:0,
        skills:[]
    };

    ws.send(JSON.stringify({ type:"init", id, players, monsters }));

    ws.on("message", msg => {
        const data = JSON.parse(msg);
        const player = players[id];
        if (!player) return;

        // Movement
        if (data.type === "update") {
            player.x = data.x ?? player.x;
            player.y = data.y ?? player.y;
        }

        // Training at station
        if (data.type === "train") {
            if (data.stat === "hp") {
                player.stats.maxHp += 2; // partial HP gain
                player.stats.hp = Math.min(player.stats.hp + 5, player.stats.maxHp);
            } else {
                player.stats[data.stat] += 1;
            }
            player.xp += 5;
            if (player.xp >= 20) { player.skillPoints++; player.xp = 0; }
        }

        // Attack PvP
        if (data.type === "attack") {
            const target = players[data.targetId];
            if (target && target.x < 400) { // only in PvP zone
                const dmg = Math.max(player.stats.strength - target.stats.defense,1);
                target.stats.hp -= dmg;
                if (target.stats.hp <= 0) {
                    target.x = Math.random()*380;
                    target.y = Math.random()*580;
                    target.stats = { strength:5, defense:5, magic:5, hp:20, maxHp:20, speed:3 };
                    target.xp = 0;
                    target.skillPoints = 0;
                }
            }
        }

        // Attack monsters
        if (data.type === "attackMonster") {
            const monster = monsters.find(m=>m.id===data.monsterId);
            if (monster) {
                monster.hp -= player.stats.strength;
                if (monster.hp <= 0) {
                    player.xp += 10;
                    if (player.xp >= 20) { player.skillPoints++; player.xp=0; }
                    // respawn monster
                    const idx = monsters.indexOf(monster);
                    monsters[idx] = spawnMonster(monster.type);
                }
            }
        }

        broadcast();
    });

    ws.on("close", ()=>delete players[id]);
});

server.listen(process.env.PORT||10000,"0.0.0.0",()=>console.log("Server running"));
