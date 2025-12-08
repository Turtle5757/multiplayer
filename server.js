// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");
let accounts = {};
if (fs.existsSync(ACCOUNTS_FILE)) {
  try { accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE)); } catch(e){ accounts = {}; }
}

// auto-save accounts every 5s
setInterval(() => {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2)); } catch(e){}
}, 5000);

let players = {};
let monsters = [];
let groundItems = []; // items dropped on ground

const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const PVP_ZONE = 400;

// item templates
const ITEM_TEMPLATES = [
  { name: "Bronze Sword", type: "weapon", strength: 2, icon: "🗡️" },
  { name: "Staff", type: "weapon", magic: 2, icon: "✨" },
  { name: "Leather Armor", type: "armor", defense: 2, icon: "🛡️" },
  { name: "Health Potion", type: "potion", heal: 20, icon: "🧪" }
];

function spawnMonster(type="monster"){
  return {
    id: Date.now() + Math.random(),
    x: 410 + Math.random()*(MAP_WIDTH-420),
    y: 10 + Math.random()*(MAP_HEIGHT-20),
    type,
    hp: type==="boss"?120:40,
    maxHp: type==="boss"?120:40,
    attack: type==="boss"?6:2,
    speed: type==="boss"?1.4:1,
    xpReward: type==="boss"?60:20,
    goldReward: type==="boss"?40:10,
    specialCooldown: 0 // for bosses
  };
}

// initial monsters
for(let i=0;i<6;i++) monsters.push(spawnMonster());
monsters.push(spawnMonster("boss"));

// spawn ground item
function spawnGroundItem(x,y,template){
  const it = {
    id: Date.now()+Math.random(),
    x, y,
    name: template.name,
    type: template.type,
    strength: template.strength||0,
    magic: template.magic||0,
    defense: template.defense||0,
    heal: template.heal||0,
    icon: template.icon||"❓"
  };
  groundItems.push(it);
}

// broadcast game state
function broadcast(){
  const payload = JSON.stringify({ type: "state", players, monsters, groundItems });
  wss.clients.forEach(c => c.readyState===WebSocket.OPEN && c.send(payload));
}

// Monster AI & boss special
function updateMonsters(){
  for(const m of monsters){
    // boss special: every 7s telegraph then heavy attack near closest player
    if(m.type==="boss"){
      if(m.specialCooldown <= 0){
        // telegraph: we mark specialCooldown negative as countdown for execute next tick
        m.specialCooldown = -30; // 30 ticks until execute (3s if ticks 100ms)
      } else if(m.specialCooldown < 0){
        m.specialCooldown++;
        if(m.specialCooldown === 0){
          // execute: damage players within radius
          const radius = 80;
          for(const id in players){
            const p = players[id];
            const dx = p.x - m.x, dy = p.y - m.y;
            const d = Math.hypot(dx,dy);
            if(d <= radius){
              p.stats.hp -= 20; // heavy damage
              if(p.stats.hp <= 0) resetPlayer(p);
            }
          }
          m.specialCooldown = 700; // cooldown ticks (~70s) before next telegraph (long)
        }
      } else {
        m.specialCooldown -= 1;
      }
    }

    // move toward nearest PvE player
    let nearest=null, minDist=Infinity;
    for(const id in players){
      const p=players[id];
      if(p.x < PVP_ZONE) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if(d < minDist){ minDist = d; nearest = p; }
    }
    if(nearest){
      const dx = nearest.x - m.x, dy = nearest.y - m.y;
      const dist = Math.hypot(dx,dy);
      if(dist > 0){
        m.x += (dx/dist)*m.speed;
        m.y += (dy/dist)*m.speed;
      }
      if(dist < 24){
        // attack
        nearest.stats.hp -= m.attack;
        if(nearest.stats.hp <= 0) resetPlayer(nearest);
      }
    }
  }
  broadcast();
}
setInterval(updateMonsters, 100);

// helper: reset player stats on death (keeps inventory)
function resetPlayer(p){
  p.x = Math.random()*PVP_ZONE;
  p.y = Math.random()*MAP_HEIGHT;
  p.stats = { strength:5, defense:5, magic:5, hp: p.stats.maxHp || 20, maxHp:p.stats.maxHp||20, speed:3, meleeRange:30, range:60 };
  p.level = 1;
  p.xp = 0;
  p.skillPoints = 0;
  p.gold = Math.max(0, Math.floor(p.gold/2)); // drop half gold on death
  // optionally drop one random item to ground
  if(p.inventory && p.inventory.length){
    const drop = p.inventory.pop();
    spawnGroundItem(p.x + 10, p.y + 10, drop);
  }
}

// account save
function savePlayer(id){
  const p = players[id]; if(!p) return;
  const acc = accounts[p.username]; if(acc){
    acc.stats = {...p.stats};
    acc.level = p.level; acc.xp = p.xp; acc.skillPoints = p.skillPoints;
    acc.gold = p.gold; acc.inventory = p.inventory.map(it=>({ ...it })); // copy
  }
}

// handle pickups (server-side)
function tryPickup(player){
  // pick up first item within radius if slot available
  for(let i=0;i<groundItems.length;i++){
    const it = groundItems[i];
    const d = Math.hypot(it.x - player.x, it.y - player.y);
    if(d <= 24){
      if(player.inventory.length < 5){
        player.inventory.push(it);
        groundItems.splice(i,1);
        return true;
      }
    }
  }
  return false;
}

// WebSocket connection handling
wss.on("connection", ws=>{
  ws.send(JSON.stringify({ type:"askLogin" }));

  ws.on("message", msg=>{
    let data;
    try { data = JSON.parse(msg); } catch(e){ return; }

    // register
    if(data.type === "register"){
      if(!data.username || !data.password){ ws.send(JSON.stringify({type:"error", message:"Invalid"})); return; }
      if(accounts[data.username]){ ws.send(JSON.stringify({type:"error", message:"Username exists"})); return; }
      const hash = bcrypt.hashSync(data.password, 10);
      accounts[data.username] = {
        password: hash,
        stats: { strength:5, defense:5, magic:5, hp:20, maxHp:20, speed:3, meleeRange:30, range:60 },
        xp:0, level:1, skillPoints:0, gold:0, inventory: []
      };
      ws.send(JSON.stringify({ type:"registered" }));
      return;
    }

    // login
    if(data.type === "login"){
      const acc = accounts[data.username];
      if(!acc || !bcrypt.compareSync(data.password, acc.password)){
        ws.send(JSON.stringify({ type:"error", message:"Invalid login" }));
        return;
      }
      // spawn player object from account
      const id = Date.now() + Math.random();
      players[id] = {
        username: data.username,
        x: Math.random()*PVP_ZONE,
        y: Math.random()*MAP_HEIGHT,
        stats: { ...acc.stats },
        xp: acc.xp || 0,
        level: acc.level || 1,
        skillPoints: acc.skillPoints || 0,
        gold: acc.gold || 0,
        inventory: (acc.inventory || []).map(it => ({ ...it })) // copy
      };
      ws.playerId = id;
      ws.username = data.username;
      ws.send(JSON.stringify({ type:"init", id, players, monsters, groundItems }));
      broadcast();
      return;
    }

    // all other messages require logged in player
    if(!ws.playerId) return;
    const player = players[ws.playerId];
    if(!player) return;

    if(data.type === "update"){
      player.x = Math.max(0, Math.min(MAP_WIDTH-20, data.x ?? player.x));
      player.y = Math.max(0, Math.min(MAP_HEIGHT-20, data.y ?? player.y));
      // try pickup automatically on move
      tryPickup(player);
    }

    if(data.type === "train"){
      if(data.stat === "hp"){ player.stats.maxHp += 2; player.stats.hp = Math.min(player.stats.hp + 5, player.stats.maxHp); }
      else player.stats[data.stat] += 1;
      player.xp += 5; checkLevelUp(player);
    }

    if(data.type === "upgrade" && data.stat && player.skillPoints > 0){
      player.stats[data.stat] = (player.stats[data.stat] || 0) + 1;
      player.skillPoints -= 1;
    }

    if(data.type === "equipItem"){
      // equip by name
      const it = player.inventory.find(x => x.id === data.itemId || x.name === data.name);
      if(it){
        if(it.type === "weapon") player.inventory.forEach(i => { if(i.type === "weapon") i.equipped = false; });
        if(it.type === "armor") player.inventory.forEach(i => { if(i.type === "armor") i.equipped = false; });
        it.equipped = !it.equipped;
      }
    }

    if(data.type === "useItem"){
      const itIndex = player.inventory.findIndex(x => x.id === data.itemId || x.name === data.name);
      if(itIndex >= 0){
        const it = player.inventory[itIndex];
        if(it.type === "potion"){
          player.stats.hp = Math.min(player.stats.hp + (it.heal||20), player.stats.maxHp);
          player.inventory.splice(itIndex,1);
        }
      }
    }

    // PvP melee
    if(data.type === "attack"){
      const target = players[data.targetId];
      if(target && target.x < PVP_ZONE){
        const dx = player.x - target.x, dy = player.y - target.y;
        const dist = Math.hypot(dx,dy);
        if(dist <= (player.stats.meleeRange || 30)){
          const weapon = player.inventory.find(x=>x.type==="weapon" && x.equipped);
          const weaponBonus = weapon ? (weapon.strength||weapon.magic||0) : 0;
          const dmg = Math.max((player.stats.strength||0) + weaponBonus - (target.stats.defense||0), 1);
          target.stats.hp -= dmg;
          if(target.stats.hp <= 0){
            // drop gold & maybe item
            const dropGold = Math.floor(target.gold * 0.3);
            target.gold = Math.max(0, target.gold - dropGold);
            player.gold += dropGold;
            resetPlayer(target);
          }
        }
      }
    }

    // Ranged: uses magic stat & range
    if(data.type === "rangedAttack"){
      const target = players[data.targetId];
      if(target && target.x < PVP_ZONE){
        const dx = player.x - target.x, dy = player.y - target.y;
        const dist = Math.hypot(dx,dy);
        if(dist <= (player.stats.range || 60)){
          const dmg = Math.max((player.stats.magic||0) - (target.stats.defense||0), 1);
          target.stats.hp -= dmg;
          if(target.stats.hp <= 0) resetPlayer(target);
        }
      }
    }

    // Attack monster
    if(data.type === "attackMonster"){
      const monster = monsters.find(m=>m.id === data.monsterId);
      if(monster){
        const dx = player.x - monster.x, dy = player.y - monster.y;
        const dist = Math.hypot(dx,dy);
        if(dist <= (player.stats.meleeRange || 30)){
          const weapon = player.inventory.find(x=>x.type==="weapon" && x.equipped);
          const weaponBonus = weapon ? (weapon.strength||0) : 0;
          monster.hp -= (player.stats.strength||0) + weaponBonus;
          if(monster.hp <= 0){
            // give xp/gold and maybe item drop
            player.xp += monster.xpReward;
            player.gold += monster.goldReward;
            checkLevelUp(player);
            // chance to drop item
            if(Math.random() < 0.35){ // 35% chance
              const tmpl = ITEM_TEMPLATES[Math.floor(Math.random()*ITEM_TEMPLATES.length)];
              spawnGroundItem(monster.x, monster.y, tmpl);
            }
            // respawn monster
            const idx = monsters.indexOf(monster);
            monsters[idx] = spawnMonster(monster.type);
          }
        }
      }
    }

    // pickup request (explicit)
    if(data.type === "pickup"){
      tryPickup(player);
    }

    broadcast();
  });

  ws.on("close", ()=>{
    if(ws.playerId){
      savePlayer(ws.playerId);
      delete players[ws.playerId];
      broadcast();
    }
  });
});

function checkLevelUp(p){
  if(p.xp >= 20){
    p.level += 1; p.skillPoints += 1; p.xp = 0;
  }
}

server.listen(process.env.PORT || 10000, "0.0.0.0", ()=>console.log("Server running"));
