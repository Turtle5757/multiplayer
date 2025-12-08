// server.js
const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Server running on port", PORT));

// In-memory state
let players = {};
let monsters = [];
let groundItems = []; // items lying on ground

const MAP_W = 800, MAP_H = 600;
const PVP_ZONE = 400;

// item factory helpers
let nextItemId = 1;
function createItem(name, type, props = {}, icon = "❓", rarity = "Common"){
  return { id: "it"+(nextItemId++), name, key: name.toLowerCase().replace(/\s+/g,"_"), type, props, icon, rarity };
}

// Base items to drop/create
const BASE_ITEMS = [
  createItem("Bronze Sword","weapon",{strength:2},"🗡️","Common"),
  createItem("Iron Sword","weapon",{strength:4},"⚔️","Uncommon"),
  createItem("Wood Armor","armor",{defense:2},"🛡️","Common"),
  createItem("Health Potion","potion",{heal:40},"🧪","Common"),
  createItem("Magic Staff","weapon",{magic:4},"✨","Rare"),
  createItem("Gold Nugget","material",{value:10},"🔶","Common")
];

// spawn a monster
function spawnMonster(type="monster"){
  const m = {
    id: "m"+Date.now()+Math.random().toString(36).slice(2,8),
    x: 410 + Math.random() * (MAP_W-420),
    y: 10 + Math.random() * (MAP_H-20),
    type,
    hp: type==="boss"?200:60,
    maxHp: type==="boss"?200:60,
    attack: type==="boss"?8:3,
    speed: type==="boss"?1.2:0.9,
    xp: type==="boss"?150:30,
    gold: type==="boss"?75:15
  };
  return m;
}

// initial monsters
for(let i=0;i<6;i++) monsters.push(spawnMonster());
monsters.push(spawnMonster("boss"));

// helper: drop random item at position
function dropRandomItem(x,y){
  const tpl = BASE_ITEMS[Math.floor(Math.random()*BASE_ITEMS.length)];
  const inst = { ...tpl, id: "it"+(nextItemId++), x, y };
  groundItems.push(inst);
  return inst;
}

// broadcast state to all
function broadcast(){
  const data = { type:"state", players, monsters, groundItems };
  const s = JSON.stringify(data);
  wss.clients.forEach(c => { if(c.readyState === WebSocket.OPEN) c.send(s); });
}

// monster AI (move toward nearest PvE player)
function stepMonsters(){
  for(const m of monsters){
    let nearest=null, minD=Infinity;
    for(const pid in players){
      const p = players[pid];
      if(p.x < PVP_ZONE) continue; // only chase PvE players
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if(d < minD){ minD = d; nearest = p; }
    }
    if(nearest){
      const dx = nearest.x - m.x, dy = nearest.y - m.y;
      const dist = Math.hypot(dx,dy);
      if(dist > 0){
        m.x += (dx/dist) * m.speed;
        m.y += (dy/dist) * m.speed;
      }
      if(dist < 24){
        nearest.stats.hp -= m.attack;
        if(nearest.stats.hp <= 0){
          // death reset (keeps items), half gold lost dropped
          const dropGold = Math.floor(nearest.gold * 0.4);
          nearest.gold = Math.max(0, nearest.gold - dropGold);
          if(Math.random() < 0.5 && nearest.inventory.length){
            const dropped = nearest.inventory.pop();
            dropped.x = nearest.x+8; dropped.y = nearest.y+8;
            groundItems.push(dropped);
          }
          nearest.x = Math.random() * PVP_ZONE;
          nearest.y = Math.random() * MAP_H;
          nearest.stats.hp = nearest.stats.maxHp;
        }
      }
    }
  }
  broadcast();
}
setInterval(stepMonsters, 120);

// helper: level up if xp threshold
function checkLevel(p){
  const req = 20 + (p.level-1)*20;
  while(p.xp >= req){
    p.xp -= req;
    p.level += 1;
    p.skillPoints += 1;
    p.stats.maxHp += 5;
    p.stats.hp = p.stats.maxHp;
  }
}

// WS connections
wss.on("connection", ws=>{
  ws.send(JSON.stringify({ type:"askName" }));

  ws.on("message", msg=>{
    let data;
    try{ data = JSON.parse(msg); } catch { return; }

    // initial join with name
    if(data.type === "join"){
      const id = "p"+Date.now()+Math.random().toString(36).slice(2,8);
      ws.playerId = id;
      // default player
      players[id] = {
        id,
        name: data.name || "Player",
        x: Math.random()*PVP_ZONE,
        y: Math.random()*MAP_H,
        level: 1,
        xp: 0,
        gold: 0,
        skillPoints: 0,
        stats: { strength:5, defense:3, magic:3, hp:30, maxHp:30, speed:3, meleeRange:30, range:60 },
        inventory: [], // up to 5 items
        equipped: { weapon: null, armor: null }
      };
      ws.send(JSON.stringify({ type:"joined", id }));
      broadcast();
      return;
    }

    // require logged player for rest
    const me = players[ws.playerId];
    if(!me) return;

    // movement update (client sends x,y or dx/dy)
    if(data.type === "move"){
      if(typeof data.x === "number") me.x = Math.max(0, Math.min(MAP_W-20, data.x));
      if(typeof data.y === "number") me.y = Math.max(0, Math.min(MAP_H-20, data.y));
    }

    // attack (melee) - check monsters and PvP
    if(data.type === "attack"){
      // melee monsters
      for(const m of monsters){
        if(m.hp <= 0) continue;
        const d = Math.hypot(m.x - me.x, m.y - me.y);
        if(d <= me.stats.meleeRange){
          // compute weapon bonus
          const weapon = me.inventory.find(it => it.id === me.equipped.weapon);
          const wBonus = weapon && weapon.props && (weapon.props.strength||weapon.props.magic) ? (weapon.props.strength||weapon.props.magic) : 0;
          const dmg = Math.max(1, me.stats.strength + wBonus - (m.attack?0:0));
          m.hp -= dmg;
          if(m.hp <= 0){
            // reward
            me.xp += m.xp;
            me.gold += m.gold;
            checkLevel(me);
            // drop chance
            if(Math.random() < 0.45){
              const dItem = dropRandomItem(m.x, m.y);
              groundItems.push(dItem);
            }
            // respawn
            const idx = monsters.indexOf(m);
            monsters[idx] = spawnMonster(m.type || "monster");
          }
        }
      }

      // PvP
      for(const pid in players){
        if(pid === me.id) continue;
        const other = players[pid];
        const d = Math.hypot(other.x - me.x, other.y - me.y);
        if(d <= me.stats.meleeRange && other){
          const weapon = me.inventory.find(it => it.id === me.equipped.weapon);
          const wBonus = weapon && weapon.props && (weapon.props.strength||weapon.props.magic) ? (weapon.props.strength||weapon.props.magic) : 0;
          const dmg = Math.max(1, me.stats.strength + wBonus - other.stats.defense);
          other.stats.hp -= dmg;
          if(other.stats.hp <= 0){
            // drop some gold on death
            const dropGold = Math.floor(other.gold * 0.25);
            other.gold = Math.max(0, other.gold - dropGold);
            me.gold += dropGold;
            other.x = Math.random() * PVP_ZONE;
            other.y = Math.random() * MAP_H;
            other.stats.hp = other.stats.maxHp;
          }
        }
      }
    }

    // pickup explicit (or server will try pickup on move)
    if(data.type === "pickup"){
      for(let i=groundItems.length-1;i>=0;i--){
        const it = groundItems[i];
        const d = Math.hypot(it.x - me.x, it.y - me.y);
        if(d <= 28){
          if(me.inventory.length < 5){
            me.inventory.push(it);
            groundItems.splice(i,1);
            break;
          }
        }
      }
    }

    // equip item (by id)
    if(data.type === "equip"){
      const itemId = data.itemId;
      const idx = me.inventory.findIndex(it => it.id === itemId);
      if(idx >= 0){
        const it = me.inventory[idx];
        if(it.type === "weapon"){
          // unequip previous
          if(me.equipped.weapon === it.id) me.equipped.weapon = null;
          else me.equipped.weapon = it.id;
        } else if(it.type === "armor"){
          if(me.equipped.armor === it.id) me.equipped.armor = null;
          else me.equipped.armor = it.id;
        } else if(it.type === "potion"){
          // use potion
          me.stats.hp = Math.min(me.stats.maxHp, me.stats.hp + (it.props.heal || 20));
          me.inventory.splice(idx,1);
        }
      }
    }

    // drop item (by id)
    if(data.type === "drop"){
      const itemId = data.itemId;
      const idx = me.inventory.findIndex(it => it.id === itemId);
      if(idx >= 0){
        const it = me.inventory.splice(idx,1)[0];
        it.x = me.x + 8; it.y = me.y + 8;
        groundItems.push(it);
      }
    }

    // skill tree purchase (simple nodes)
    if(data.type === "buySkill"){
      const node = data.node;
      // define nodes server-side (must match client)
      const NODES = {
        "STR1": { cost:1, apply: p => p.stats.strength += 1 },
        "DEF1": { cost:1, apply: p => p.stats.defense += 1 },
        "MAG1": { cost:1, apply: p => p.stats.magic += 1 },
        "HP1":  { cost:1, apply: p => { p.stats.maxHp += 5; p.stats.hp += 5; } },
        "SPD1": { cost:1, apply: p => p.stats.speed += 0.5 }
      };
      const def = NODES[node];
      if(def && me.skillPoints >= def.cost){
        def.apply(me);
        me.skillPoints -= def.cost;
      }
    }

    // auto pickup on move - small convenience
    if(data.type === "move" || data.type === "updatePos"){
      for(let i=groundItems.length-1;i>=0;i--){
        const it = groundItems[i];
        const d = Math.hypot(it.x - me.x, it.y - me.y);
        if(d <= 22 && me.inventory.length < 5){
          me.inventory.push(it);
          groundItems.splice(i,1);
        }
      }
    }

    // periodically check level
    checkLevel(me);

    // broadcast updates
    broadcast();
  }); // end on message

  ws.on("close", ()=>{
    if(ws.playerId && players[ws.playerId]) delete players[ws.playerId];
    broadcast();
  });
}); // end connection

// helper: spawn and return monster
function spawnMonster(type="monster"){
  return spawnMonsterImpl(type);
}
function spawnMonsterImpl(type="monster"){
  return { id: "m"+Date.now()+Math.random().toString(36).slice(2,8), x: 420 + Math.random()*(MAP_W-440), y: 10 + Math.random()*(MAP_H-20), type, hp: type==="boss"?180:60, maxHp:type==="boss"?180:60, attack:type==="boss"?8:3, speed:type==="boss"?1.2:0.9, xp:type==="boss"?140:30, gold:type==="boss"?60:12 };
}

// drop random base item
function dropRandomItem(x,y){
  const tpl = BASE_ITEMS[Math.floor(Math.random()*BASE_ITEMS.length)];
  const inst = { ...tpl, id: "it"+(nextItemId++), x, y };
  return inst;
}

// shorter alias used earlier
function dropRandomItem(x,y){ return dropRandomItemImpl(x,y); }
function dropRandomItemImpl(x,y){
  const tpl = BASE_ITEMS[Math.floor(Math.random()*BASE_ITEMS.length)];
  const inst = { ...tpl, id: "it"+(nextItemId++), x, y };
  return inst;
}

// spawn on monster death helper (called in attack logic above)
function maybeDropAt(x,y){
  if(Math.random() < 0.45){
    const di = dropRandomItemImpl(x,y);
    groundItems.push(di);
  }
}

console.log("Server ready");
