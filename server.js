// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 10000;
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");
const SAVE_INTERVAL_MS = 8000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

// load accounts
let accounts = {};
try {
  if (fs.existsSync(ACCOUNTS_FILE)) accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE));
} catch (e) { accounts = {}; }

function persistAccounts() {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2)); } catch (e) { console.error("save err", e); }
}
setInterval(persistAccounts, SAVE_INTERVAL_MS);

// --- World config ---
const MAP_W = 900, MAP_H = 600;
const ZONE_ORDER = ["town", "fields", "forest", "cave", "dungeon"]; // left->right
const PVP_ZONES = new Set(["dungeon"]); // PvP allowed here

// rarities & templates
const RARITY = { Common:1, Uncommon:1.25, Rare:1.6, Epic:2.2 };
const TEMPLATES = [
  { key:"bronze_sword", name:"Bronze Sword", type:"weapon", base:{strength:2}, icon:"🗡️" },
  { key:"oak_staff", name:"Oak Staff", type:"weapon", base:{magic:3}, icon:"✨" },
  { key:"short_bow", name:"Short Bow", type:"weapon", base:{strength:2}, icon:"🏹" },
  { key:"leather_armor", name:"Leather Armor", type:"armor", base:{defense:2}, icon:"🛡️" },
  { key:"hp_potion", name:"Health Potion", type:"potion", base:{heal:40}, icon:"🧪" },
  { key:"iron_ingot", name:"Iron Ingot", type:"material", base:{}, icon:"⛓️" },
  { key:"wood", name:"Wood", type:"material", base:{}, icon:"🪵" }
];

function createItemInstance(templateKey, rarityName="Common"){
  const tpl = TEMPLATES.find(t=>t.key===templateKey);
  if(!tpl) return null;
  const meta = {};
  for(const k in tpl.base) meta[k] = Math.max(1, Math.round(tpl.base[k] * (RARITY[rarityName]||1)));
  return { id: "it_"+Date.now()+"_"+Math.floor(Math.random()*9999), key: tpl.key, name: tpl.name, type: tpl.type, icon: tpl.icon, rarity: rarityName, meta };
}
function randomDrop(){
  const rarities = ["Common","Common","Uncommon","Rare","Epic"];
  const rarity = rarities[Math.floor(Math.random()*rarities.length)];
  const tpl = TEMPLATES[Math.floor(Math.random()*TEMPLATES.length)];
  return createItemInstance(tpl.key, rarity);
}

// --- Recipes (basic) ---
const RECIPES = {
  bronze_sword: { result:{key:"bronze_sword", rarity:"Uncommon"}, ingredients:[ {key:"iron_ingot",count:2}, {key:"wood",count:1} ] },
  oak_staff:    { result:{key:"oak_staff", rarity:"Rare"}, ingredients:[ {key:"wood",count:3}, {key:"iron_ingot",count:1} ] }
};

// --- Classes & SKILL NODES ---
const CLASSES = {
  Warrior: { maxHp:140, strength:5, defense:3, magic:0, speed:3.0 },
  Mage:    { maxHp:90,  strength:1, defense:1, magic:6, speed:2.6 },
  Archer:  { maxHp:110, strength:3, defense:2, magic:1, speed:3.2 }
};
const SKILL_NODES = {
  STR1:{cost:1, apply:p=>p.stats.strength+=1},
  DEF1:{cost:1, apply:p=>p.stats.defense+=1},
  MAG1:{cost:1, apply:p=>p.stats.magic+=1},
  HP1: {cost:1, apply:p=>{ p.stats.maxHp+=5; p.stats.hp+=5 } },
  SPD1:{cost:1, apply:p=>p.stats.speed+=0.3}
};

// --- Runtime state ---
let players = {};     // pid -> player object
let monsters = [];    // monster array (pve + bosses)
let groundItems = []; // dropped items
let pendingTrades = {}; // trade flows

// spawn helper
function spawnMonster(zone="fields", isBoss=false){
  const id = "m_"+Date.now()+"_"+Math.floor(Math.random()*9999);
  // area x placement based on zone index
  const zoneIdx = Math.max(0, Math.min(ZONE_ORDER.length-1, ZONE_ORDER.indexOf(zone)));
  const areaX = 20 + zoneIdx * Math.floor((MAP_W-40) / (ZONE_ORDER.length-1));
  const m = {
    id,
    zone,
    x: areaX + Math.random()*140,
    y: 320 + Math.random()*100,
    type: isBoss ? "boss" : "monster",
    maxHp: isBoss ? 450 : 80,
    hp: isBoss ? 450 : 80,
    attack: isBoss ? 10 : 3,
    speed: isBoss ? 1.1 : 0.9,
    xp: isBoss ? 300 : 40,
    gold: isBoss ? 120 : 15
  };
  monsters.push(m);
  return m;
}

// initial monsters and one boss per mid-map zone
for(let i=0;i<5;i++) spawnMonster("fields");
for(let i=0;i<4;i++) spawnMonster(ZONE_ORDER[Math.min(i+1, ZONE_ORDER.length-1)]);
spawnMonster("cave", true); // a boss

// monster AI loop
function updateMonsters(){
  for(const m of monsters){
    // find nearest player in same zone
    let nearest=null, mind=Infinity;
    for(const pid in players){
      const p = players[pid];
      if(p.zone !== m.zone) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if(d < mind){ mind = d; nearest = p; }
    }
    if(nearest){
      const dx = nearest.x - m.x, dy = nearest.y - m.y;
      const dist = Math.hypot(dx, dy);
      if(dist > 1){ m.x += (dx/dist) * m.speed; m.y += (dy/dist) * m.speed; }
      if(dist < 36){
        nearest.stats.hp -= m.attack;
        if(nearest.stats.hp <= 0){
          // death: reset to spawn area, lose some gold, drop
          nearest.x = 50 + Math.random()*80; nearest.y = 300;
          nearest.stats.hp = Math.max(1, nearest.stats.maxHp);
          nearest.gold = Math.max(0, nearest.gold - Math.floor(nearest.level*2));
          // drop item sometimes
          if(Math.random() < 0.45){
            const d = randomDrop(); d.x = nearest.x + 8; d.y = nearest.y + 8; groundItems.push(d);
          }
        }
      }
    }
  }
}
setInterval(()=>{ updateMonsters(); broadcastState(); }, 140);

// helpers: pickup/craft/trade
function tryPickup(player){
  for(let i=groundItems.length-1;i>=0;i--){
    const it = groundItems[i];
    const d = Math.hypot(it.x - player.x, it.y - player.y);
    if(d <= 28){
      if(player.inventory.length < 5){
        player.inventory.push(it);
        groundItems.splice(i,1);
        return { ok:true, item: it };
      }
    }
  }
  return { ok:false };
}
function canCraft(player, recipeKey){
  const recipe = RECIPES[recipeKey];
  if(!recipe) return { ok:false, reason:"unknown" };
  const counts = {};
  for(const it of player.inventory) counts[it.key] = (counts[it.key]||0)+1;
  for(const ing of recipe.ingredients) if((counts[ing.key]||0) < ing.count) return { ok:false, reason:"missing" };
  return { ok:true, recipe };
}
function verifyOffer(player, offer){
  if(!offer) return { ok:false, reason:"no offer" };
  if((offer.gold||0) > (player.gold||0)) return { ok:false, reason:"not enough gold" };
  const invIds = player.inventory.map(i=>i.id);
  for(const iid of (offer.itemIds||[])) if(!invIds.includes(iid)) return { ok:false, reason:"item missing" };
  return { ok:true };
}
function performTradeSwap(a,b,offerA,offerB){
  const itemsA=[]; for(const iid of (offerA.itemIds||[])){ const idx=a.inventory.findIndex(x=>x.id===iid); if(idx>=0) itemsA.push(...a.inventory.splice(idx,1)); }
  a.gold = Math.max(0, a.gold - (offerA.gold||0));
  const itemsB=[]; for(const iid of (offerB.itemIds||[])){ const idx=b.inventory.findIndex(x=>x.id===iid); if(idx>=0) itemsB.push(...b.inventory.splice(idx,1)); }
  b.gold = Math.max(0, b.gold - (offerB.gold||0));
  a.inventory.push(...itemsB); b.inventory.push(...itemsA);
  a.gold += (offerB.gold||0); b.gold += (offerA.gold||0);
}

// level up helper
function checkLevelUp(player){
  const required = 60 + (player.level-1)*40;
  while(player.xp >= required){
    player.xp -= required;
    player.level++;
    player.skillPoints++;
    player.stats.maxHp += 6;
    player.stats.hp = player.stats.maxHp;
  }
}

// broadcast
function broadcastState(){
  const payload = JSON.stringify({ type:"state", players, monsters, groundItems });
  wss.clients.forEach(c => { if(c.readyState === WebSocket.OPEN) c.send(payload); });
}

// save snapshot
function savePlayerToAccount(pid){
  const p = players[pid];
  if(!p) return;
  const acc = accounts[p.username];
  if(!acc) return;
  acc.stats = {...p.stats};
  acc.inventory = p.inventory.map(it => ({ ...it }));
  acc.xp = p.xp; acc.level = p.level; acc.skillPoints = p.skillPoints; acc.gold = p.gold; acc.class = p.class;
  acc.lastOnline = Date.now();
  persistAccounts();
}

// --- WebSocket handling ---
wss.on("connection", ws => {
  ws.send(JSON.stringify({ type:"askLogin" }));

  ws.on("message", async raw => {
    let msg;
    try{ msg = JSON.parse(raw); } catch(e){ return; }

    // register
    if(msg.type === "register"){
      const { username, password, classChoice } = msg;
      if(!username || !password){ ws.send(JSON.stringify({ type:"error", message:"invalid" })); return; }
      if(accounts[username]){ ws.send(JSON.stringify({ type:"error", message:"exists" })); return; }
      const hash = bcrypt.hashSync(password, 10);
      accounts[username] = {
        password: hash,
        stats: { strength:5, defense:5, magic:5, hp:30, maxHp:30, speed:3, meleeRange:30, range:60 },
        xp:0, level:1, skillPoints:0, gold:0, inventory:[], class: classChoice || "Warrior", lastOnline: Date.now()
      };
      persistAccounts();
      ws.send(JSON.stringify({ type:"registered" }));
      return;
    }

    // login
    if(msg.type === "login"){
      const { username, password } = msg;
      const acc = accounts[username];
      if(!acc || !bcrypt.compareSync(password, acc.password)){ ws.send(JSON.stringify({ type:"error", message:"invalid login" })); return; }
      const pid = "p_"+Date.now()+"_"+Math.floor(Math.random()*9999);
      players[pid] = {
        id: pid,
        username,
        class: acc.class || "Warrior",
        x: 50 + Math.random()*80, y: 300,
        vx:0, vy:0,
        zone: "town",
        stats: {...acc.stats},
        xp: acc.xp||0, level: acc.level||1, skillPoints: acc.skillPoints||0, gold: acc.gold||0,
        inventory: (acc.inventory||[]).map(it=>({...it})),
        autoGather: false
      };
      ws.playerId = pid; ws.username = username;
      // offline gains (simple)
      const now = Date.now();
      const away = Math.floor((now - (acc.lastOnline||now))/1000);
      if(away > 10){
        const idlePow = Math.max(1, Math.floor((players[pid].stats.strength||0)*0.4 + (players[pid].stats.magic||0)*0.2));
        players[pid].xp += Math.floor(away * idlePow * 0.01);
        players[pid].gold += Math.floor(away * idlePow * 0.002);
      }
      ws.send(JSON.stringify({ type:"init", id: pid, players, monsters, groundItems }));
      broadcastState();
      return;
    }

    // require session
    if(!ws.playerId) return;
    const player = players[ws.playerId];
    if(!player) return;

    // movement/update
    if(msg.type === "update"){
      player.x = Math.max(0, Math.min(MAP_W-20, Number(msg.x) || player.x));
      player.y = Math.max(0, Math.min(MAP_H-20, Number(msg.y) || player.y));
      player.vx = Number(msg.vx) || 0;
      player.vy = Number(msg.vy) || 0;
      player.zone = msg.zone || player.zone;
      tryPickup(player);
    }

    // training
    if(msg.type === "train"){
      const stat = msg.stat;
      if(player.zone === "town" || player.zone === "fields"){
        player.stats[stat] = (player.stats[stat]||0) + 0.12;
        player.xp += 1;
        player.stats.hp = Math.min(player.stats.maxHp, (player.stats.hp||player.stats.maxHp) + 0.08);
        checkLevelUp(player);
      }
    }

    // attack monster (melee)
    if(msg.type === "attackMonster"){
      const m = monsters.find(mm => mm.id === msg.monsterId);
      if(m && m.zone === player.zone){
        const dist = Math.hypot(player.x - m.x, player.y - m.y);
        if(dist <= (player.stats.meleeRange || 30)){
          const wep = player.inventory.find(it => it.type==="weapon" && it.equipped);
          const wbonus = wep ? (wep.meta.strength || wep.meta.magic || 0) : 0;
          const dmg = Math.max(1, Math.floor((player.stats.strength||0) + wbonus - 0));
          m.hp -= dmg;
          if(m.hp <= 0){
            player.xp += m.xp || 40;
            player.gold += m.gold || 12;
            // drop chance and boss special loot
            if(Math.random() < (m.type==="boss" ? 0.85 : 0.45)){
              const d = randomDrop();
              d.x = m.x; d.y = m.y; groundItems.push(d);
            }
            // spawn replacement (boss respawn with delay)
            const idx = monsters.indexOf(m);
            if(idx >= 0){
              monsters.splice(idx,1);
              setTimeout(()=> spawnMonster(m.zone, m.type==="boss"), m.type==="boss"? 20000 : 1200);
            }
            checkLevelUp(player);
          }
        }
      }
    }

    // ranged attack on player (pvp)
    if(msg.type === "rangedAttack"){
      const target = players[msg.targetId];
      if(target && target.zone === player.zone && (PVP_ZONES.has(player.zone) || player.zone === "dungeon")){
        const dist = Math.hypot(player.x - target.x, player.y - target.y);
        if(dist <= (player.stats.range || 60)){
          const dmg = Math.max(1, Math.floor((player.stats.magic||0) - (target.stats.defense||0)));
          target.stats.hp -= dmg;
          if(target.stats.hp <= 0){
            target.stats.hp = target.stats.maxHp;
            target.x = 40; target.y = 300;
          }
        }
      }
    }

    // buy skill node
    if(msg.type === "buySkill"){
      const node = SKILL_NODES[msg.node];
      if(node && player.skillPoints >= node.cost){
        node.apply(player);
        player.skillPoints -= node.cost;
      }
    }

    // craft
    if(msg.type === "craft"){
      const recipeKey = msg.recipe;
      const ok = canCraft(player, recipeKey);
      if(!ok.ok) ws.send(JSON.stringify({ type:"craftResult", ok:false, reason: ok.reason }));
      else {
        // consume
        for(const ing of ok.recipe.ingredients){
          let cnt = ing.count;
          for(let i=player.inventory.length-1;i>=0 && cnt>0;i--){
            if(player.inventory[i].key === ing.key){ player.inventory.splice(i,1); cnt--; }
          }
        }
        const inst = createItemInstance(ok.recipe.result.key, ok.recipe.result.rarity || "Common");
        if(player.inventory.length < 5) player.inventory.push(inst);
        else { inst.x = player.x+8; inst.y = player.y+8; groundItems.push(inst); }
        ws.send(JSON.stringify({ type:"craftResult", ok:true, item:inst }));
      }
    }

    // trade request
    if(msg.type === "tradeRequest"){
      const toId = msg.toId;
      if(!players[toId]){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"player offline" })); return; }
      const offer = msg.offer || { itemIds:[], gold:0 };
      const ok = verifyOffer(player, offer);
      if(!ok.ok){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message: ok.reason })); return; }
      const tradeId = "t_"+Date.now()+"_"+Math.floor(Math.random()*9999);
      pendingTrades[tradeId] = { id: tradeId, fromId: ws.playerId, toId, offer, state:"pending" };
      // notify target
      wss.clients.forEach(c => { if(c.playerId === toId && c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type:"tradeRequest", trade: pendingTrades[tradeId] })); });
      ws.send(JSON.stringify({ type:"tradeResponse", ok:true, trade: pendingTrades[tradeId] }));
    }

    // accept trade
    if(msg.type === "tradeAccept"){
      const trade = pendingTrades[msg.tradeId];
      if(!trade){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"not found" })); return; }
      if(trade.toId !== ws.playerId){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"not your trade" })); return; }
      trade.ask = msg.ask || { itemIds:[], gold:0 };
      const a = players[trade.fromId], b = players[trade.toId];
      if(!a || !b){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"player left" })); delete pendingTrades[trade.id]; return; }
      if(!verifyOffer(a, trade.offer).ok || !verifyOffer(b, trade.ask).ok){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"invalid offer" })); delete pendingTrades[trade.id]; return; }
      performTradeSwap(a,b,trade.offer,trade.ask);
      wss.clients.forEach(c => { if((c.playerId===trade.fromId||c.playerId===trade.toId) && c.readyState===WebSocket.OPEN){ c.send(JSON.stringify({ type:"tradeComplete", tradeId: trade.id })); }});
      delete pendingTrades[trade.id];
      broadcastState();
    }

    // equip item
    if(msg.type === "equipItem"){
      const itemId = msg.itemId;
      const it = player.inventory.find(i=>i.id===itemId);
      if(it){
        if(it.type === "weapon"){ player.inventory.forEach(i=>{ if(i.type==="weapon") i.equipped=false; }); it.equipped = !it.equipped; }
        else if(it.type === "armor"){ player.inventory.forEach(i=>{ if(i.type==="armor") i.equipped=false; }); it.equipped = !it.equipped; }
      }
    }

    // use item
    if(msg.type === "useItem"){
      const itemId = msg.itemId;
      const idx = player.inventory.findIndex(i=>i.id===itemId);
      if(idx >= 0){
        const it = player.inventory[idx];
        if(it.type === "potion"){ player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + (it.meta.heal||20)); player.inventory.splice(idx,1); }
      }
    }

    // save snapshot
    if(msg.type === "save"){ savePlayerToAccount(ws.playerId); }

    // broadcast after message handling
    broadcastState();
  });

  ws.on("close", () => {
    if(ws.playerId){ savePlayerToAccount(ws.playerId); delete players[ws.playerId]; broadcastState(); }
  });
});

console.log("Server ready on port", PORT);
server.listen(PORT, "0.0.0.0");
