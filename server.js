// server.js - IdleOn-like multiplayer server (accounts, save, items, crafting, trading, monsters, pvp)
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 10000;
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");

// load or init accounts
let accounts = {};
try { accounts = fs.existsSync(ACCOUNTS_FILE) ? JSON.parse(fs.readFileSync(ACCOUNTS_FILE)) : {}; } catch(e){ accounts = {}; }

// autosave accounts every 6s
setInterval(()=> {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2)); } catch(e){ console.error("save failed", e); }
}, 6000);

// server + ws
const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// map/zone sizes
const MAP_W = 900, MAP_H = 600, PVP_X = 420; // x >= PVP_X is PVE; x < PVP_X is PvP-safe/starting zone

// Rarity & base templates
const RARITY = { Common:{mult:1}, Uncommon:{mult:1.25}, Rare:{mult:1.6}, Epic:{mult:2} };

const BASE_ITEMS = [
  { key:"bronze_sword", name:"Bronze Sword", type:"weapon", base:{strength:2}, icon:"🗡️" },
  { key:"oak_staff", name:"Oak Staff", type:"weapon", base:{magic:3}, icon:"✨" },
  { key:"leather_armor", name:"Leather Armor", type:"armor", base:{defense:2}, icon:"🛡️" },
  { key:"hp_potion", name:"Health Potion", type:"potion", base:{heal:40}, icon:"🧪" },
  { key:"iron_ingot", name:"Iron Ingot", type:"material", base:{}, icon:"⛓️" },
  { key:"wood", name:"Wood", type:"material", base:{}, icon:"🪵" }
];

// Recipes
const RECIPES = {
  bronze_sword: { result:{ key:"bronze_sword", rarity:"Uncommon" }, ingredients:[ {key:"iron_ingot",count:2}, {key:"wood",count:1} ] },
  oak_staff: { result:{ key:"oak_staff", rarity:"Rare" }, ingredients:[ {key:"wood",count:3}, {key:"iron_ingot",count:1} ] }
};

// in-memory runtime state
let players = {};   // key: socket.playerId -> player object
let monsters = [];  // active monsters
let groundItems = []; // items on ground
let pendingTrades = {}; // trades

// helper: create item instance
function createItemInstanceFromTemplate(templateKey, rarityName="Common") {
  const tpl = BASE_ITEMS.find(b=>b.key===templateKey);
  if(!tpl) return null;
  const rarity = RARITY[rarityName] || RARITY.Common;
  const inst = {
    id: "it_"+Date.now()+"_"+Math.floor(Math.random()*9999),
    key: tpl.key,
    name: tpl.name,
    type: tpl.type,
    icon: tpl.icon,
    rarity: rarityName,
    meta: {}
  };
  for(const k in tpl.base) inst.meta[k] = Math.max(1, Math.round(tpl.base[k]*rarity.mult));
  return inst;
}

// random drop generator
function randomDrop(){
  const rarities = ["Common","Common","Uncommon","Rare","Epic"];
  const rarity = rarities[Math.floor(Math.random()*rarities.length)];
  const tpl = BASE_ITEMS[Math.floor(Math.random()*BASE_ITEMS.length)];
  return createItemInstanceFromTemplate(tpl.key, rarity);
}

// spawn a monster
function spawnMonster(type="monster"){
  return {
    id: "m_"+Date.now()+"_"+Math.floor(Math.random()*9999),
    x: PVP_X + 20 + Math.random()*(MAP_W - PVP_X - 40),
    y: 10 + Math.random()*(MAP_H - 20),
    type,
    maxHp: type==="boss"?250:60,
    hp: type==="boss"?250:60,
    attack: type==="boss"?9:3,
    speed: type==="boss"?1.1:0.9,
    xp: type==="boss"?120:25,
    gold: type==="boss"?50:12
  };
}

// initial monsters
for(let i=0;i<6;i++) monsters.push(spawnMonster());
monsters.push(spawnMonster("boss"));

// broadcast state to all clients (lightweight)
function broadcastState(){
  const payload = JSON.stringify({ type:"state", players, monsters, groundItems });
  wss.clients.forEach(c => { if(c.readyState===WebSocket.OPEN) c.send(payload); });
}

// pickup helper
function tryPickup(player){
  for(let i=groundItems.length-1;i>=0;i--){
    const it = groundItems[i];
    const d = Math.hypot(it.x - player.x, it.y - player.y);
    if(d <= 28){
      if(player.inventory.length < 5){
        player.inventory.push(it);
        groundItems.splice(i,1);
        return { ok:true, item:it };
      }
    }
  }
  return { ok:false };
}

// can craft check
function canCraft(player, recipeKey){
  const recipe = RECIPES[recipeKey];
  if(!recipe) return { ok:false, reason:"unknown" };
  const counts = {};
  player.inventory.forEach(it => counts[it.key] = (counts[it.key]||0)+1);
  for(const ing of recipe.ingredients) if((counts[ing.key]||0) < ing.count) return { ok:false, reason:"missing" };
  return { ok:true, recipe };
}

// trade helpers
function verifyOffer(player, offer){
  if(!offer) return { ok:false, reason:"no offer" };
  if((offer.gold||0) > (player.gold||0)) return { ok:false, reason:"not enough gold" };
  const invIds = player.inventory.map(i=>i.id);
  for(const iid of (offer.itemIds||[])) if(!invIds.includes(iid)) return { ok:false, reason:"item missing" };
  return { ok:true };
}
function performTradeSwap(a,b,offerA,offerB){
  const itemsA = []; for(const iid of (offerA.itemIds||[])){ const idx=a.inventory.findIndex(x=>x.id===iid); if(idx>=0) itemsA.push(...a.inventory.splice(idx,1)); }
  a.gold = Math.max(0, a.gold - (offerA.gold||0));
  const itemsB = []; for(const iid of (offerB.itemIds||[])){ const idx=b.inventory.findIndex(x=>x.id===iid); if(idx>=0) itemsB.push(...b.inventory.splice(idx,1)); }
  b.gold = Math.max(0, b.gold - (offerB.gold||0));
  a.inventory.push(...itemsB); b.inventory.push(...itemsA);
  a.gold += (offerB.gold||0); b.gold += (offerA.gold||0);
}

// monster AI: chase players in PVE region
function updateMonsters(){
  for(const m of monsters){
    let nearest=null, minD=Infinity;
    for(const pid in players){
      const p = players[pid];
      if(p.x < PVP_X) continue; // chase only PVE players
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if(d < minD){ minD = d; nearest = p; }
    }
    if(nearest){
      const dx = nearest.x - m.x, dy = nearest.y - m.y, dist = Math.hypot(dx,dy);
      if(dist > 1){ m.x += (dx/dist) * m.speed; m.y += (dy/dist) * m.speed; }
      if(dist < 26){
        nearest.stats.hp -= m.attack;
        if(nearest.stats.hp <= 0){
          // on death: respawn player, drop small gold & random item
          nearest.x = 50 + Math.random()* (PVP_X-100);
          nearest.y = 50 + Math.random()*(MAP_H-100);
          nearest.stats.hp = nearest.stats.maxHp;
          const dropChance = Math.random() < 0.5;
          if(dropChance){
            const d = randomDrop(); d.x = nearest.x+5; d.y = nearest.y+5;
            groundItems.push(d);
          }
        }
      }
    }
  }
  broadcastState();
}
setInterval(updateMonsters, 130);

// level up helper
function checkLevelUp(player){
  const required = 50 + (player.level-1)*30;
  while(player.xp >= required){
    player.xp -= required;
    player.level++;
    player.skillPoints++;
    player.stats.maxHp += 5;
    player.stats.hp = player.stats.maxHp;
  }
}

// WebSocket handling
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
      accounts[username] = {
        password: hash,
        stats: { strength:5, defense:5, magic:5, hp:30, maxHp:30, speed:3, meleeRange:30, range:60 },
        xp:0, level:1, skillPoints:0, gold:0, inventory:[], class:null, lastOnline: Date.now()
      };
      ws.send(JSON.stringify({ type:"registered" }));
      return;
    }

    // login
    if(data.type === "login"){
      const { username, password } = data;
      const acc = accounts[username];
      if(!acc || !bcrypt.compareSync(password, acc.password)){ ws.send(JSON.stringify({ type:"error", message:"invalid login" })); return; }
      // create session player
      const pid = "p_"+Date.now()+"_"+Math.floor(Math.random()*9999);
      players[pid] = {
        id: pid,
        username,
        x: Math.random()* (PVP_X-40),
        y: Math.random()* (MAP_H-40),
        stats: { ...acc.stats },
        xp: acc.xp||0,
        level: acc.level||1,
        skillPoints: acc.skillPoints||0,
        gold: acc.gold||0,
        inventory: (acc.inventory||[]).map(it=>({...it})),
        autoGather: false,
        class: acc.class || null
      };
      ws.playerId = pid; ws.username = username;
      // offline gains
      const now = Date.now();
      const secondsAway = Math.floor((now - (acc.lastOnline||now))/1000);
      if(secondsAway > 10){
        const idlePow = Math.max(1, Math.floor((players[pid].stats.strength||0)*0.4 + (players[pid].stats.magic||0)*0.2));
        players[pid].xp += Math.floor(secondsAway * idlePow * 0.01);
        players[pid].gold += Math.floor(secondsAway * idlePow * 0.002);
      }
      // send init
      ws.send(JSON.stringify({ type:"init", id: pid, players, monsters, groundItems }));
      broadcastState();
      return;
    }

    // must be logged in for all following messages
    if(!ws.playerId) return;
    const player = players[ws.playerId];
    if(!player) return;

    // movement / update
    if(data.type === "update"){
      player.x = Math.max(0, Math.min(MAP_W-20, Number(data.x) || player.x));
      player.y = Math.max(0, Math.min(MAP_H-20, Number(data.y) || player.y));
      tryPickup(player);
    }

    // toggle auto gather
    if(data.type === "toggleAuto"){ player.autoGather = !!data.on; }

    // craft
    if(data.type === "craft"){
      const recipeKey = data.recipe;
      const ok = canCraft(player, recipeKey);
      if(!ok.ok) ws.send(JSON.stringify({ type:"craftResult", ok:false, reason: ok.reason }));
      else {
        // remove ingredients
        for(const ing of ok.recipe.ingredients){
          let cnt = ing.count;
          for(let i=player.inventory.length-1; i>=0 && cnt>0; i--){
            if(player.inventory[i].key === ing.key){ player.inventory.splice(i,1); cnt--; }
          }
        }
        const inst = createItemInstanceFromTemplate(ok.recipe.result.key, ok.recipe.result.rarity || "Common");
        if(player.inventory.length < 5) player.inventory.push(inst);
        else { inst.x = player.x+10; inst.y = player.y+10; groundItems.push(inst); }
        ws.send(JSON.stringify({ type:"craftResult", ok:true, item:inst }));
      }
    }

    // trade request
    if(data.type === "tradeRequest"){
      const toId = data.toId;
      if(!players[toId]){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"player offline" })); return; }
      const offer = data.offer || { itemIds:[], gold:0 };
      const ok = verifyOffer(player, offer);
      if(!ok.ok){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message: ok.reason })); return; }
      const tradeId = "t_"+Date.now()+"_"+Math.floor(Math.random()*9999);
      pendingTrades[tradeId] = { id: tradeId, fromId: ws.playerId, toId, offer, state:"pending" };
      // notify target
      wss.clients.forEach(c => { if(c.playerId === toId && c.readyState===WebSocket.OPEN) c.send(JSON.stringify({ type:"tradeRequest", trade: pendingTrades[tradeId] })); });
      ws.send(JSON.stringify({ type:"tradeResponse", ok:true, trade: pendingTrades[tradeId] }));
    }

    // trade accept
    if(data.type === "tradeAccept"){
      const trade = pendingTrades[data.tradeId];
      if(!trade){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"not found" })); return; }
      if(trade.toId !== ws.playerId){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"not your trade" })); return; }
      trade.ask = data.ask || { itemIds:[], gold:0 };
      const a = players[trade.fromId], b = players[trade.toId];
      if(!a || !b){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"player left" })); delete pendingTrades[trade.id]; return; }
      if(!verifyOffer(a, trade.offer).ok || !verifyOffer(b, trade.ask).ok){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"invalid offer" })); delete pendingTrades[trade.id]; return; }
      performTradeSwap(a,b,trade.offer,trade.ask);
      // notify both
      wss.clients.forEach(c => { if((c.playerId===trade.fromId||c.playerId===trade.toId) && c.readyState===WebSocket.OPEN) c.send(JSON.stringify({ type:"tradeComplete", tradeId: trade.id })); });
      delete pendingTrades[trade.id];
      broadcastState();
    }

    // equip item
    if(data.type === "equipItem"){
      const itemId = data.itemId;
      const it = player.inventory.find(i=>i.id===itemId);
      if(it){
        if(it.type === "weapon"){
          player.inventory.forEach(i=>{ if(i.type==="weapon") i.equipped = false; });
          it.equipped = !it.equipped;
        } else if(it.type === "armor"){
          player.inventory.forEach(i=>{ if(i.type==="armor") i.equipped = false; });
          it.equipped = !it.equipped;
        }
      }
    }

    // use item (potions)
    if(data.type === "useItem"){
      const itemId = data.itemId;
      const idx = player.inventory.findIndex(i=>i.id===itemId);
      if(idx >= 0){
        const it = player.inventory[idx];
        if(it.type === "potion"){
          player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + (it.meta.heal||20));
          player.inventory.splice(idx,1);
        }
      }
    }

    // pickup explicit
    if(data.type === "pickup"){ tryPickup(player); }

    // attack monster
    if(data.type === "attackMonster"){
      const monster = monsters.find(m=>m.id===data.monsterId);
      if(monster){
        const dist = Math.hypot(player.x - monster.x, player.y - monster.y);
        if(dist <= (player.stats.meleeRange||30)){
          const wep = player.inventory.find(i=>i.type==="weapon" && i.equipped);
          const wbonus = wep ? (wep.meta.strength||wep.meta.magic||0) : 0;
          monster.hp -= Math.max(1, (player.stats.strength||0) + wbonus - 0);
          if(monster.hp <= 0){
            player.xp += monster.xp || 20;
            player.gold += monster.gold || 10;
            if(Math.random() < 0.45){
              const drop = randomDrop(); drop.x = monster.x; drop.y = monster.y; groundItems.push(drop);
            }
            // respawn
            const idx = monsters.indexOf(monster);
            monsters[idx] = spawnMonster(monster.type);
          }
        }
      }
    }

    // ranged attack on player (pvp)
    if(data.type === "rangedAttack"){
      const target = players[data.targetId];
      if(target){
        const dist = Math.hypot(player.x - target.x, player.y - target.y);
        if(dist <= (player.stats.range||60) && target.x < PVP_X){
          const dmg = Math.max(1, (player.stats.magic||0) - (target.stats.defense||0));
          target.stats.hp -= dmg;
          if(target.stats.hp <= 0){
            target.stats.hp = target.stats.maxHp;
            target.x = Math.random()*(PVP_X-60)+20;
            target.y = Math.random()*(MAP_H-60)+20;
          }
        }
      }
    }

    // buy skill node
    if(data.type === "buySkill"){
      // nodes server-side minimal definitions
      const NODES = {
        STR1:{cost:1, apply:p=>p.stats.strength+=1},
        DEF1:{cost:1, apply:p=>p.stats.defense+=1},
        MAG1:{cost:1, apply:p=>p.stats.magic+=1},
        HP1:{cost:1, apply:p=>{p.stats.maxHp+=5; p.stats.hp+=5}},
        SPD1:{cost:1, apply:p=>p.stats.speed+=0.5}
      };
      const node = NODES[data.node];
      if(node && player.skillPoints >= node.cost){
        node.apply(player);
        player.skillPoints -= node.cost;
      }
    }

    // save to account on demand
    if(data.type === "save"){ savePlayerToAccount(ws.playerId); }

    // level check
    checkLevelUp(player);

    // broadcast
    broadcastState();
  }); // end on message

  ws.on("close", ()=> {
    if(ws.playerId){
      savePlayerToAccount(ws.playerId);
      delete players[ws.playerId];
      broadcastState();
    }
  });
}); // end connection

// save player snapshot to account (persistence)
function savePlayerToAccount(pid){
  const p = players[pid];
  if(!p) return;
  const acc = accounts[p.username];
  if(!acc) return;
  acc.stats = {...p.stats};
  acc.xp = p.xp; acc.level = p.level; acc.skillPoints = p.skillPoints; acc.gold = p.gold;
  acc.inventory = p.inventory.map(it => ({ ...it }));
  acc.class = p.class;
  acc.lastOnline = Date.now();
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts,null,2)); } catch(e){ console.error("save err", e); }
}

// expose spawn function used above
function spawnMonster(type="monster"){ return spawnMonsterImpl(type); }
function spawnMonsterImpl(type="monster"){
  return {
    id: "m_"+Date.now()+"_"+Math.floor(Math.random()*9999),
    x: PVP_X + 20 + Math.random()*(MAP_W - PVP_X - 40),
    y: 10 + Math.random()*(MAP_H - 20),
    type,
    maxHp: type==="boss"?250:60,
    hp: type==="boss"?250:60,
    attack: type==="boss"?9:3,
    speed: type==="boss"?1.1:0.9,
    xp: type==="boss"?120:25,
    gold: type==="boss"?50:12
  };
}

// helper used earlier when creating drop
function dropRandomAt(x,y){
  const it = randomDrop(); it.x = x; it.y = y; groundItems.push(it); return it;
}

console.log("Server ready");
server.listen(PORT, "0.0.0.0");
