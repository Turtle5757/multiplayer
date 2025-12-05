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

const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const PVP_ZONE = 400; // left side PvP

// --- Monsters ---
function spawnMonster(type = "monster") {
    return {
        id: Date.now() + Math.random(),
        x: 410 + Math.random() * (MAP_WIDTH - 410),
        y: 10 + Math.random() * (MAP_HEIGHT - 10),
        type,
        hp: type === "boss" ? 50 : 20,
        attack: type === "boss" ? 5 : 2,
        speed: type === "boss" ? 1.5 : 1,
        xpReward: type === "boss" ? 20 : 10,
        goldReward: type === "boss" ? 20 : 5
    };
}

// Spawn monsters
for (let i = 0; i < 5; i++) monsters.push(spawnMonster());
monsters.push(spawnMonster("boss"));

// Broadcast game state
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
            if (p.x < PVP_ZONE) continue; // only chase players in PvE
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
                    // reset stats on death
                    nearest.x = Math.random() * PVP_ZONE;
                    nearest.y = Math.random() * MAP_HEIGHT;
                    nearest.stats = { strength:5, defense:5, magic:5, hp:20, maxHp:20, speed:3 };
                    nearest.level = 1;
                    nearest.xp = 0;
                    nearest.skillPoints = 0;
                    nearest.gold = 0;
                }
            }
        }
    }
    broadcast();
}
setInterval(updateMonsters, 100);

// WebSocket
wss.on("connection", ws => {
    // Ask for username
    ws.send(JSON.stringify({ type: "askName" }));

    ws.on("message", msg => {
        const data = JSON.parse(msg);
        if (data.type === "setName") {
            const id = Date.now().toString();
            players[id] = {
                username: data.username || "Player" + id.slice(-4),
                x: Math.random() * PVP_ZONE,
                y: Math.random() * MAP_HEIGHT,
                stats: { strength:5, defense:5, magic:5, hp:20, maxHp:20, speed:3 },
                xp:0,
                skillPoints:0,
                gold:0,
                level:1,
                skills:[]
            };
            ws.playerId = id;
            ws.send(JSON.stringify({ type:"init", id, players, monsters }));
            broadcast();
        } else if (data.type && ws.playerId) {
            const player = players[ws.playerId];
            if (!player) return;

            // Movement (with map boundaries)
            if (data.type === "update") {
                player.x = Math.max(0, Math.min(MAP_WIDTH-20, data.x ?? player.x));
                player.y = Math.max(0, Math.min(MAP_HEIGHT-20, data.y ?? player.y));
            }

            // Training
            if (data.type === "train") {
                if (data.stat === "hp") {
                    player.stats.maxHp += 2;
                    player.stats.hp = Math.min(player.stats.hp + 5, player.stats.maxHp);
                } else {
                    player.stats[data.stat] += 1;
                }
                player.xp += 5;
                checkLevelUp(player);
            }

            // PvP attack
            if (data.type === "attack") {
                const target = players[data.targetId];
                if (target && target.x < PVP_ZONE) {
                    const dmg = Math.max(player.stats.strength - target.stats.defense, 1);
                    target.stats.hp -= dmg;
                    if (target.stats.hp <= 0) {
                        target.x = Math.random() * PVP_ZONE;
                        target.y = Math.random() * MAP_HEIGHT;
                        target.stats = { strength:5, defense:5, magic:5, hp:20, maxHp:20, speed:3 };
                        target.level = 1;
                        target.xp = 0;
                        target.skillPoints = 0;
                        target.gold = 0;
                    }
                }
            }

            // Attack monsters
            if (data.type === "attackMonster") {
                const monster = monsters.find(m=>m.id===data.monsterId);
                if (monster) {
                    monster.hp -= player.stats.strength;
                    if (monster.hp <= 0) {
                        player.xp += monster.xpReward;
                        player.gold += monster.goldReward;
                        checkLevelUp(player);
                        // respawn monster
                        const idx = monsters.indexOf(monster);
                        monsters[idx] = spawnMonster(monster.type);
                    }
                }
            }

            // Spend skill points in skill tree
            if (data.type === "upgrade" && data.stat && player.skillPoints>0) {
                player.stats[data.stat] += 1;
                player.skillPoints -=1;
            }

            broadcast();
        }
    });

    ws.on("close", ()=> {
        if(ws.playerId) delete players[ws.playerId];
        broadcast();
    });
});

function checkLevelUp(player){
    if(player.xp >= 20){
        player.level +=1;
        player.skillPoints +=1;
        player.xp = 0;
    }
}

server.listen(process.env.PORT||10000,"0.0.0.0",()=>console.log("Server running"));
