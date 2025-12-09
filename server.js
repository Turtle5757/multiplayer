// server.js
// IdleOn-style multiplayer server (accounts, autosave, items, crafting, trading, zones, monsters, pvp)
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 10000;
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");

// load accounts safely
let accounts = {};
try {
  if (fs.existsSync(ACCOUNTS_FILE)) accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE));
} catch (e) { accounts = {}; }

function saveAccounts() {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2)); } catch (e) { console.error("save err", e); }
}
setInterval(saveAccounts, 8000);

// express + static
const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// world config
const MAP_W = 900, MAP_H = 600;
const ZONES = ["spawn", "forest", "cave", "dungeon"]; // left -> right
const PVP_ZONE_X = 380; // x < PVP_ZONE_X is safe area for training, x >= PVP_ZONE_X is PVE/pvp area

// rarities
const RARITY = { Common:1, Uncommon:1.25, Rare:1.6, Epic:2.2 };

// base item templates
const TEMPLATES = [
  { key:"bronze_sword", name:"Bronze Sword", type:"weapon", base:{strength:2}, icon:"🗡️" },
  { key:"oak_staff", name:"Oak Staff", type:"weapon", base:{magic:3}, icon:"✨" },
  { key:"leather_armor", name:"Leather Armor", type:"armor", base:{defense:2}, icon:"🛡️" },
  { key:"hp_potion", name:"Health Potion", type:"potion", base:{heal:40}, icon:"🧪" },
  { key:"iron_ingot", name:"Iron Ingot", type:"material", base:{}, icon:"⛓️" },
  { key:"wood", name:"Wood", type:"material", base:{}, icon:"🪵" }
];

// recipes
const RECIPES = {
  bronze_sword: { result:{key:"bronze_sword", rarity:"Uncommon"}, ingredients:[{key:"iron_ingot",count:2},{key:"wood",count:1}] },
  oak_staff: { result:{key:"oak_staff", rarity:"Rare"}, ingredients:[{key:"wood",count:3},{key:"iron_ingot",count:1}] }
};

// helper create item instances
function createItemInstance(templateKey, rarityName="Common"){
  const tpl = TEMPLATES.find(t=>t.key===templateKey);
  if(!tpl) return null;
  const meta = {};
  for(const k in tpl.base) meta[k] = Math.max(1, Math.round(tpl.base[k]* (RARITY[rarityName]||1) ));
  return { id: "it_"+Date.now()+"_"+Math.floor(Math.random()*9999), key: tpl.key, name: tpl.name, type: tpl.type, icon: tpl.icon, rarity: rarityName, meta };
}
function randomDrop(){
  const rarities = ["Common","Common","Uncommon","Rare","Epic"];
  const rarity = rarities[Math.floor(Math.random()*rarities.length)];
  const tpl = TEMPLATES[Math.floor(Math.random()*TEMPLATES.length)];
  return createItemInstance(tpl.key, rarity);
}

// classes
const CLASSES = {
  Warrior: { hp:120, strength:5, defense:3, magic:0, speed:3 },
  Mage: { hp:80, strength:1, defense:1, magic:6, speed:2.6 },
  Archer: { hp:100, strength:3, defense:2, magic:0, speed:3.2 }
};

// skill nodes (server truth)
const SKILL_NODES = {
  STR1: {cost:1, apply: p => p.stats.strength += 1},
  DEF1: {cost:1, apply: p => p.stats.defense += 1},
  MAG1: {cost:1, apply: p => p.stats.magic += 1},
  HP1: {cost:1, apply: p => { p.stats.maxHp += 5; p.stats.hp += 5; }},
  SPD1: {cost:1, apply: p => p.stats.speed += 0.3}
};

// runtime state
let players = {};     // session players keyed by pid
let monsters = [];    // active monsters
let groundItems = []; // items lying on the ground
let pendingTrades = {}; // trade flows

// spawn helper
function spawnMonster(zone="forest", isBoss=false){
  const id = "m_"+Date.now()+"_"+Math.floor(Math.random()*9999);
  const areaX = zone === "spawn" ? 10 : (zone === "forest" ? 120 : (zone === "cave" ? 350 : 600));
  const m = { id, zone, x: areaX + Math.random()*200, y: 20 + Math.random()*(MAP_H-40), hp: isBoss?240:60, maxHp: isBoss?240:60, attack:isBoss?8:3, speed:isBoss?1.1:0.8, xp: isBoss?120:25, gold: isBoss?50:10, type: isBoss?"boss":"monster" };
  monsters.push(m);
  return m;
}
// initial monsters
for(let i=0;i<6;i++) spawnMonster("forest");
spawnMonster("forest", true);

// monster AI loop
function updateMonsters(){
  for(const m of monsters){
    // find nearest PVE player in same zone
    let nearest=null, minD=Infinity;
    for(const pid in players){
      const p = players[pid];
      if(p.zone !== m.zone) continue;
      // if zone is pvp and pvp off, monsters shouldn't chase there, but we'll keep simple
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if(d < minD){ minD = d; nearest = p; }
    }
    if(nearest){
      const dx = nearest.x - m.x, dy = nearest.y - m.y;
      const dist = Math.hypot(dx,dy);
      if(dist > 1){ m.x += (dx/dist) * m.speed; m.y += (dy/dist) * m.speed; }
      if(dist < 28){
        nearest.stats.hp -= m.attack;
        if(nearest.stats.hp <= 0){
          // death handling: reset some stats, respawn
          nearest.x = 50; nearest.y = 50; nearest.stats.hp = nearest.stats.maxHp;
          // drop item
          if(Math.random() < 0.45){ const it = randomDrop(); it.x = nearest.x+8; it.y = nearest.y+8; groundItems.push(it); }
        }
      }
    }
  }
  broadcastState();
}
setInterval(updateMonsters, 140);

// helper: pickup near
function tryPickup(p){
  for(let i=groundItems.length-1;i>=0;i--){
    const it = groundItems[i];
    const d = Math.hypot(it.x - p.x, it.y - p.y);
    if(d <= 26){
      if(p.inventory.length < 5){ p.inventory.push(it); groundItems.splice(i,1); return {ok:true, item:it}; }
    }
  }
  return {ok:false};
}

// can craft check
function canCraft(player, recipeKey){
  const recipe = RECIPES[recipeKey];
  if(!recipe) return {ok:false, reason:"unknown"};
  const counts = {};
  for(const it of player.inventory) counts[it.key] = (counts[it.key]||0)+1;
  for(const ing of recipe.ingredients) if((counts[ing.key]||0) < ing.count) return {ok:false, reason:"missing"};
  return {ok:true, recipe};
}

// trade helpers (verify & swap)
function verifyOffer(player, offer){
  if(!offer) return {ok:false, reason:"no offer"};
  if((offer.gold||0) > (player.gold||0)) return {ok:false, reason:"not enough gold"};
  const invIds = player.inventory.map(i=>i.id);
  for(const iid of (offer.itemIds||[])) if(!invIds.includes(iid)) return {ok:false, reason:"item missing"};
  return {ok:true};
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
function checkLevel(p){
  const need = 50 + (p.level-1)*30;
  while(p.xp >= need){ p.xp -= need; p.level++; p.skillPoints++; p.stats.maxHp += 5; p.stats.hp = p.stats.maxHp; }
}

// broadcast state (lightweight)
function broadcastState(){
  const payload = JSON.stringify({ type:"state", players, monsters, groundItems });
  wss.clients.forEach(c => { if(c.readyState === WebSocket.OPEN) c.send(payload); });
}

// account save snapshot
function savePlayerToAccount(pid){
  const p = players[pid];
  if(!p) return;
  const acc = accounts[p.username];
  if(!acc) return;
  acc.stats = {...p.stats};
  acc.inventory = p.inventory.map(it => ({ ...it }));
  acc.xp = p.xp; acc.level = p.level; acc.skillPoints = p.skillPoints; acc.gold = p.gold; acc.class = p.class; acc.lastOnline = Date.now();
  saveAccounts();
}

// websocket handling
wss.on("connection", ws => {
  ws.send(JSON.stringify({ type:"askLogin" }));

  ws.on("message", async raw => {
    let data;
    try{ data = JSON.parse(raw); } catch(e){ return; }

    // register
    if(data.type === "register"){
      const { username, password } = data;
      if(!username || !password){ ws.send(JSON.stringify({ type:"error", message:"invalid" })); return; }
      if(accounts[username]){ ws.send(JSON.stringify({ type:"error", message:"exists" })); return; }
      const hash = bcrypt.hashSync(password, 10);
      accounts[username] = { password:hash, stats:{strength:5,defense:5,magic:5,hp:30,maxHp:30,speed:3,meleeRange:30,range:60}, xp:0, level:1, skillPoints:0, gold:0, inventory:[], class:"Warrior", lastOnline:Date.now() };
      saveAccounts();
      ws.send(JSON.stringify({ type:"registered" }));
      return;
    }

    // login
    if(data.type === "login"){
      const { username, password } = data;
      const acc = accounts[username];
      if(!acc || !bcrypt.compareSync(password, acc.password)){ ws.send(JSON.stringify({ type:"error", message:"invalid login" })); return; }
      const pid = "p_"+Date.now()+"_"+Math.floor(Math.random()*9999);
      players[pid] = {
        id: pid, username, class: acc.class || "Warrior",
        x: Math.random()* (PVP_ZONE_X-60) + 20, y: Math.random()*(MAP_H-60)+20,
        zone: "spawn",
        stats: {...acc.stats}, xp: acc.xp||0, level: acc.level||1, skillPoints: acc.skillPoints||0, gold: acc.gold||0,
        inventory: (acc.inventory||[]).map(it => ({ ...it })), autoGather:false
      };
      ws.playerId = pid; ws.username = username;
      // offline idle gains
      const now = Date.now();
      const away = Math.floor((now - (acc.lastOnline||now))/1000);
      if(away > 10){
        const idlePower = Math.max(1, Math.floor((players[pid].stats.strength||0)*0.4 + (players[pid].stats.magic||0)*0.2));
        players[pid].xp += Math.floor(away * idlePower * 0.01);
        players[pid].gold += Math.floor(away * idlePower * 0.002);
      }
      ws.send(JSON.stringify({ type:"init", id: pid, players, monsters, groundItems }));
      broadcastState();
      return;
    }

    // require logged in
    if(!ws.playerId) return;
    const p = players[ws.playerId];
    if(!p) return;

    // movement/update
    if(data.type === "update"){
      p.x = Math.max(0, Math.min(MAP_W-20, Number(data.x) || p.x));
      p.y = Math.max(0, Math.min(MAP_H-20, Number(data.y) || p.y));
      p.zone = data.zone || p.zone;
      tryPickup(p);
    }

    // toggle auto gather
    if(data.type === "toggleAuto"){ p.autoGather = !!data.on; }

    // training (station-based)
    if(data.type === "train"){
      const stat = data.stat;
      // must be in training zone (spawn or dedicated)
      if(p.zone === "spawn" || p.zone === "forest"){
        // small training increment
        p.stats[stat] = (p.stats[stat] || 0) + 0.12;
        p.xp += 1;
        p.stats.hp = Math.min(p.stats.maxHp, (p.stats.hp||p.stats.maxHp) + 0.08);
        checkLevel(p);
      }
    }

    // attack monster
    if(data.type === "attackMonster"){
      const m = monsters.find(x=>x.id===data.monsterId);
      if(m && m.zone === p.zone){
        const dist = Math.hypot(p.x - m.x, p.y - m.y);
        if(dist <= (p.stats.meleeRange || 30)){
          const wep = p.inventory.find(i=>i.type==="weapon" && i.equipped);
          const wbonus = wep ? (wep.meta.strength || wep.meta.magic || 0) : 0;
          const dmg = Math.max(1, Math.floor((p.stats.strength||0) + wbonus - 0));
          m.hp -= dmg;
          if(m.hp <= 0){
            p.xp += m.xp || 25; p.gold += m.gold || 10;
            if(Math.random() < 0.45){
              const d = randomDrop(); d.x = m.x; d.y = m.y; groundItems.push(d);
            }
            // replace monster
            const idx = monsters.indexOf(m);
            monsters[idx] = spawnMonster(m.zone, m.type==="boss");
          }
        }
      }
    }

    // ranged attack on player (pvp)
    if(data.type === "rangedAttack"){
      const target = players[data.targetId];
      if(target && target.zone === p.zone){
        // only allow PvP when in pvp zone or p.zone is pvp
        if(p.zone === "dungeon" || p.zone === "pvp") {
          const dist = Math.hypot(p.x - target.x, p.y - target.y);
          if(dist <= (p.stats.range || 60)){
            const dmg = Math.max(1, Math.floor((p.stats.magic||0) - (target.stats.defense||0)));
            target.stats.hp -= dmg;
            if(target.stats.hp <= 0){
              target.stats.hp = target.stats.maxHp;
              target.x = 20; target.y = 20;
            }
          }
        }
      }
    }

    // craft
    if(data.type === "craft"){
      const recipeKey = data.recipe;
      const ok = canCraft(p, recipeKey);
      if(!ok.ok) ws.send(JSON.stringify({ type:"craftResult", ok:false, reason: ok.reason }));
      else {
        for(const ing of ok.recipe.ingredients){
          let cnt = ing.count;
          for(let i=p.inventory.length-1;i>=0 && cnt>0;i--){
            if(p.inventory[i].key === ing.key){ p.inventory.splice(i,1); cnt--; }
          }
        }
        const inst = createItemInstance(ok.recipe.result.key, ok.recipe.result.rarity || "Common");
        if(p.inventory.length < 5) p.inventory.push(inst);
        else { inst.x = p.x+8; inst.y = p.y+8; groundItems.push(inst); }
        ws.send(JSON.stringify({ type:"craftResult", ok:true, item:inst }));
      }
    }

    // trade request
    if(data.type === "tradeRequest"){
      const toId = data.toId; if(!players[toId]){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"player offline" })); return; }
      const offer = data.offer || { itemIds:[], gold:0 };
      const ok = verifyOffer(p, offer);
      if(!ok.ok){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:ok.reason })); return; }
      const tradeId = "t_"+Date.now()+"_"+Math.floor(Math.random()*9999);
      pendingTrades[tradeId] = { id:tradeId, fromId: ws.playerId, toId, offer, state:"pending" };
      wss.clients.forEach(c=>{ if(c.playerId === toId && c.readyState === WebSocket.OPEN){ c.send(JSON.stringify({ type:"tradeRequest", trade: pendingTrades[tradeId] })); }});
      ws.send(JSON.stringify({ type:"tradeResponse", ok:true, trade: pendingTrades[tradeId] }));
    }

    if(data.type === "tradeAccept"){
      const trade = pendingTrades[data.tradeId];
      if(!trade){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"not found" })); return; }
      if(trade.toId !== ws.playerId){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"not your trade" })); return; }
      trade.ask = data.ask || { itemIds:[], gold:0 };
      const a = players[trade.fromId], b = players[trade.toId];
      if(!a || !b){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"player left" })); delete pendingTrades[trade.id]; return; }
      if(!verifyOffer(a, trade.offer).ok || !verifyOffer(b, trade.ask).ok){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"invalid offer" })); delete pendingTrades[trade.id]; return; }
      performTradeSwap(a,b,trade.offer,trade.ask);
      wss.clients.forEach(c => { if((c.playerId===trade.fromId||c.playerId===trade.toId) && c.readyState===WebSocket.OPEN){ c.send(JSON.stringify({ type:"tradeComplete", tradeId: trade.id })); }});
      delete pendingTrades[trade.id];
      broadcastState();
    }

    // equip item
    if(data.type === "equipItem"){
      const itemId = data.itemId; const it = p.inventory.find(i=>i.id===itemId);
      if(it){
        if(it.type === "weapon"){ p.inventory.forEach(i=>{ if(i.type==="weapon") i.equipped = false; }); it.equipped = !it.equipped; }
        if(it.type === "armor") { p.inventory.forEach(i=>{ if(i.type==="armor") i.equipped = false; }); it.equipped = !it.equipped; }
      }
    }

    // use item
    if(data.type === "useItem"){
      const itemId = data.itemId; const idx = p.inventory.findIndex(i=>i.id===itemId);
      if(idx>=0){ const it = p.inventory[idx]; if(it.type==="potion"){ p.stats.hp = Math.min(p.stats.maxHp, p.stats.hp + (it.meta.heal||20)); p.inventory.splice(idx,1); } }
    }

    // buy skill
    if(data.type === "buySkill"){
      const node = SKILL_NODES[data.node];
      if(node && p.skillPoints >= node.cost){ node.apply(p); p.skillPoints -= node.cost; }
    }

    // save snapshot
    if(data.type === "save"){ savePlayerToAccount(ws.playerId); }

    // level check
    checkLevel(p);

    // broadcast
    broadcastState();
  });

  ws.on("close", () => {
    if(ws.playerId){ savePlayerToAccount(ws.playerId); delete players[ws.playerId]; broadcastState(); }
  });
});

console.log("Server ready on port", PORT);
server.listen(PORT, "0.0.0.0");
