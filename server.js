// server.js (with sprites, rarities, crafting, trading)
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.static(path.join(__dirname,"public")));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const ACCOUNTS_FILE = path.join(__dirname,"accounts.json");
let accounts = fs.existsSync(ACCOUNTS_FILE) ? JSON.parse(fs.readFileSync(ACCOUNTS_FILE)) : {};

setInterval(()=>{ try{ fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts,null,2)); }catch(e){} },5000);

let players = {};     // connected players (in-memory)
let monsters = [];    // pve monsters
let groundItems = []; // dropped items on ground

const MAP_W = 900, MAP_H = 600, PVP_ZONE = 400;

// ---------- ITEM RARITY & TEMPLATES ----------
const RARITY = {
  Common: {mult:1, color:"#ddd"},
  Uncommon: {mult:1.25, color:"#4caf50"},
  Rare: {mult:1.5, color:"#2196F3"},
  Epic: {mult:2, color:"#9C27B0"}
};

// base item templates (id is generated when spawned)
const BASE_ITEMS = [
  { key:"bronze_sword", name:"Bronze Sword", type:"weapon", base:{strength:2}, icon:"🗡️" },
  { key:"staff", name:"Oak Staff", type:"weapon", base:{magic:2}, icon:"✨" },
  { key:"leather_armor", name:"Leather Armor", type:"armor", base:{defense:2}, icon:"🛡️" },
  { key:"hp_potion", name:"Health Potion", type:"potion", base:{heal:25}, icon:"🧪" },
  { key:"iron_ingot", name:"Iron Ingot", type:"material", base:{}, icon:"⛓️" },
  { key:"wood", name:"Wood", type:"material", base:{}, icon:"🪵" }
];

// function create item instance with rarity + id
function createItemInstance(templateKey, rarityName){
  const tpl = BASE_ITEMS.find(b=>b.key===templateKey);
  if(!tpl) return null;
  const rarity = RARITY[rarityName || "Common"] || RARITY.Common;
  // apply rarity multipliers to numeric base stats
  const inst = { id: Date.now()+Math.random(), key: tpl.key, name: tpl.name, type: tpl.type, icon: tpl.icon, rarity: rarityName || "Common", meta:{} };
  // copy numeric fields adjusted by rarity.mult
  for(const k in tpl.base){
    inst.meta[k] = Math.max(1, Math.round(tpl.base[k] * rarity.mult));
  }
  return inst;
}

// quick helper to random-drop an item (for monster drops)
function randomDrop(){
  // weight rarities slight toward common
  const rarities = ["Common","Common","Uncommon","Rare","Epic"];
  const rarity = rarities[Math.floor(Math.random()*rarities.length)];
  const template = BASE_ITEMS[Math.floor(Math.random()*BASE_ITEMS.length)];
  return createItemInstance(template.key, rarity);
}

// ---------- CRAFTING RECIPES ----------
/*
 Recipes structure:
  recipeKey: { result: { key, rarity? }, ingredients: [ { key, count }, ... ] }
*/
const RECIPES = {
  "bronze_sword": { result:{ key:"bronze_sword", rarity:"Uncommon" }, ingredients:[ {key:"iron_ingot",count:2}, {key:"wood",count:1} ] },
  "leather_armor": { result:{ key:"leather_armor", rarity:"Uncommon" }, ingredients:[ {key:"wood",count:2} ] },
  "staff": { result:{ key:"staff", rarity:"Rare" }, ingredients:[ {key:"wood",count:3}, {key:"iron_ingot",count:1} ] },
};

// ---------- MONSTERS ----------
function spawnMonster(type="monster"){
  const m = { id: Date.now()+Math.random(), x: 410 + Math.random()*(MAP_W-420), y: 10 + Math.random()*(MAP_H-20), type, maxHp: type==="boss"?200:60, hp:type==="boss"?200:60, attack:type==="boss"?8:3, speed:type==="boss"?1.2:0.9 };
  return m;
}
for(let i=0;i<6;i++) monsters.push(spawnMonster());
monsters.push(spawnMonster("boss"));

// ---------- HELPER: find account by username ----------
function getAccount(username){ return accounts[username]; }

// ---------- BROADCAST ----------
function broadcast(){
  const payload = JSON.stringify({ type:"state", players, monsters, groundItems });
  wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(payload));
}

// ---------- PICKUP ----------
function tryPickup(player){
  for(let i=0;i<groundItems.length;i++){
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

// ---------- CRAFTING CHECK ----------
function canCraft(player, recipeKey){
  const recipe = RECIPES[recipeKey];
  if(!recipe) return { ok:false, reason:"unknown recipe" };
  // count materials in inventory
  const counts = {};
  for(const it of player.inventory){ counts[it.key] = (counts[it.key]||0)+1; }
  for(const ing of recipe.ingredients){
    if((counts[ing.key]||0) < ing.count) return { ok:false, reason:"missing ingredients" };
  }
  return { ok:true, recipe };
}

// ---------- TRADING ----------
/*
  Trade flow (server-managed):
   - Player A sends tradeRequest to B (with offer items/gold)
   - Server stores pendingTrade for pair
   - B can accept or decline
   - On accept server verifies both parties still have items/gold, swaps them and clears pending
*/
let pendingTrades = {}; // key by tradeId -> {fromId,toId,offer:{items:[],gold},ask:{items:[],gold}, state:"pending"}

function startTrade(fromId, toId, offer){ // offer: { items:[itemId,...], gold: number }
  const tradeId = Date.now()+Math.random();
  pendingTrades[tradeId] = { id:tradeId, fromId, toId, offer, ask:null, state:"pending" };
  return pendingTrades[tradeId];
}
function cancelTrade(tradeId){ delete pendingTrades[tradeId]; }

// ---------- MONSTER AI (basic) ----------
function updateMonsters(){
  for(const m of monsters){
    // find nearest PvE player
    let nearest=null, minD=Infinity;
    for(const pid in players){
      const p = players[pid];
      if(p.x < PVP_ZONE) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if(d < minD){ minD=d; nearest=p; }
    }
    if(nearest){
      const dx = nearest.x - m.x, dy = nearest.y - m.y;
      const dist = Math.hypot(dx,dy);
      if(dist > 1){ m.x += (dx/dist) * m.speed; m.y += (dy/dist) * m.speed; }
      if(dist < 26){
        nearest.stats.hp -= m.attack;
        if(nearest.stats.hp <= 0){
          // on death reset & drop some gold and maybe an item
          nearest.x = Math.random()*PVP_ZONE;
          nearest.y = Math.random()*MAP_H;
          // reduce gold, drop coin to attacker? just reset for now
          nearest.stats = { strength:5, defense:5, magic:5, hp: nearest.stats.maxHp||20, maxHp:nearest.stats.maxHp||20, speed:3, meleeRange:30, range:60 };
          // drop a random item at player position
          if(Math.random() < 0.5){
            const drop = randomDrop();
            drop.x = nearest.x+10; drop.y = nearest.y+10;
            groundItems.push(drop);
          }
        }
      }
    }
  }
  broadcast();
}
setInterval(updateMonsters, 120);

// ---------- SOCKET HANDLING ----------
wss.on("connection", ws=>{
  ws.send(JSON.stringify({ type:"askLogin" }));

  ws.on("message", async msg=>{
    let data;
    try{ data = JSON.parse(msg); } catch(e){ return; }

    // registration
    if(data.type === "register"){
      const { username, password } = data;
      if(!username || !password){ ws.send(JSON.stringify({ type:"error", message:"invalid" })); return; }
      if(accounts[username]){ ws.send(JSON.stringify({ type:"error", message:"exists" })); return; }
      const hash = bcrypt.hashSync(password, 10);
      accounts[username] = {
        password: hash,
        stats: { strength:5, defense:5, magic:5, hp:20, maxHp:20, speed:3, meleeRange:30, range:60 },
        xp:0, level:1, skillPoints:0, gold:0, inventory:[], class:null, lastOnline:Date.now()
      };
      ws.send(JSON.stringify({ type:"registered" }));
      return;
    }

    // login
    if(data.type === "login"){
      const { username, password } = data;
      const acc = accounts[username];
      if(!acc || !bcrypt.compareSync(password, acc.password)){ ws.send(JSON.stringify({ type:"error", message:"invalid login" })); return; }
      // spawn player using account snapshot
      const id = Date.now()+Math.random();
      players[id] = {
        username,
        x: Math.random()*PVP_ZONE,
        y: Math.random()*MAP_H,
        stats: { ...acc.stats },
        xp: acc.xp||0, level: acc.level||1, skillPoints: acc.skillPoints||0, gold: acc.gold||0,
        inventory: (acc.inventory||[]).map(it => ({ ...it })), // copy
        autoGather:false
      };
      ws.playerId = id;
      ws.username = username;
      // compute offline gains (basic): get seconds away
      const now = Date.now();
      const secondsAway = Math.floor((now - (acc.lastOnline||now))/1000);
      if(secondsAway > 5){
        // simple offline gain (small)
        const idlePower = Math.max(1, Math.floor((players[id].stats.strength||0)*0.5 + (players[id].stats.magic||0)*0.3));
        const xpGain = Math.floor(secondsAway * idlePower * 0.01);
        const goldGain = Math.floor(secondsAway * idlePower * 0.005);
        players[id].xp += xpGain; players[id].gold += goldGain;
      }
      ws.send(JSON.stringify({ type:"init", id, players, monsters, groundItems }));
      broadcast();
      return;
    }

    // need logged in player for the rest
    if(!ws.playerId) return;
    const player = players[ws.playerId];
    if(!player) return;

    // movement update
    if(data.type === "update"){
      player.x = Math.max(0, Math.min(MAP_W-20, data.x ?? player.x));
      player.y = Math.max(0, Math.min(MAP_H-20, data.y ?? player.y));
      // auto-pickup on move
      tryPickup(player);
    }

    // toggle auto-gather (idle)
    if(data.type === "toggleAuto"){ player.autoGather = !!data.on; }

    // craft request
    if(data.type === "craft"){
      const recipeKey = data.recipe;
      const ok = canCraft(player, recipeKey);
      if(!ok.ok){ ws.send(JSON.stringify({ type:"craftResult", ok:false, reason: ok.reason })); }
      else{
        // consume ingredients (remove first matching items from inventory)
        for(const ing of ok.recipe.ingredients){
          let cnt = ing.count;
          for(let i=player.inventory.length-1;i>=0 && cnt>0;i--){
            if(player.inventory[i].key === ing.key){ player.inventory.splice(i,1); cnt--; }
          }
        }
        // create result instance and put in inventory if space (else place on ground)
        const inst = createItemInstance(ok.recipe.result.key, ok.recipe.result.rarity || "Common");
        if(player.inventory.length < 5) player.inventory.push(inst);
        else { inst.x = player.x+10; inst.y = player.y+10; groundItems.push(inst); }
        ws.send(JSON.stringify({ type:"craftResult", ok:true, item:inst }));
      }
    }

    // start trade
    if(data.type === "tradeRequest"){
      const toId = data.toId;
      if(!players[toId]){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"player offline" })); return; }
      // assemble offer: verify offering items are in inventory & gold enough
      const offer = data.offer || { itemIds:[], gold:0 };
      const offerOk = verifyOffer(player, offer);
      if(!offerOk.ok){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"invalid offer" })); return; }
      const trade = startTrade(ws.playerId, toId, offer);
      // notify target
      for(const c of wss.clients){ if(c.playerId === toId && c.readyState === WebSocket.OPEN){
        c.send(JSON.stringify({ type:"tradeRequest", trade }));
      }}
      ws.send(JSON.stringify({ type:"tradeResponse", ok:true, trade }));
    }

    // accept trade
    if(data.type === "tradeAccept"){
      const trade = pendingTrades[data.tradeId];
      if(!trade){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"trade not found" })); return; }
      if(trade.toId !== ws.playerId){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"not your trade" })); return; }
      // ask side should be present in data.ask
      trade.ask = data.ask; // { itemIds:[], gold:number }
      // validate both offers
      const from = players[trade.fromId]; const to = players[trade.toId];
      if(!from || !to){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"player disconnected" })); cancelTrade(trade.id); return; }
      if(!verifyOffer(from, trade.offer).ok || !verifyOffer(to, trade.ask).ok){ ws.send(JSON.stringify({ type:"tradeResponse", ok:false, message:"offer invalid" })); cancelTrade(trade.id); return; }
      // perform swap: remove items from each and transfer gold
      performTradeSwap(from, to, trade.offer, trade.ask);
      // notify both parties
      for(const c of wss.clients){
        if((c.playerId === trade.fromId || c.playerId === trade.toId) && c.readyState === WebSocket.OPEN){
          c.send(JSON.stringify({ type:"tradeComplete", tradeId: trade.id }));
        }
      }
      delete pendingTrades[trade.id];
      broadcast();
    }

    // decline trade
    if(data.type === "tradeDecline"){ delete pendingTrades[data.tradeId]; }

    // equip / use items
    if(data.type === "equipItem"){
      const itemId = data.itemId;
      const it = player.inventory.find(i=>i.id===itemId);
      if(it){
        if(it.type==="weapon"){ // unequip other
          player.inventory.forEach(i=>{ if(i.type==="weapon") i.equipped=false; });
          it.equipped = !it.equipped;
        } else if(it.type==="armor"){
          player.inventory.forEach(i=>{ if(i.type==="armor") i.equipped=false; });
          it.equipped = !it.equipped;
        }
      }
    }
    if(data.type === "useItem"){
      const itemId = data.itemId;
      const idx = player.inventory.findIndex(i=>i.id===itemId);
      if(idx>=0){
        const it = player.inventory[idx];
        if(it.type==="potion"){ player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + (it.meta.heal||20)); player.inventory.splice(idx,1); }
      }
    }

    // pickup explicit
    if(data.type === "pickup"){ tryPickup(player); }

    // attack monster (client already enforces range; server double-check)
    if(data.type === "attackMonster"){
      const mid = data.monsterId;
      const monster = monsters.find(m=>m.id===mid);
      if(monster){
        const dist = Math.hypot(player.x - monster.x, player.y - monster.y);
        if(dist <= (player.stats.meleeRange||30)){
          const wep = player.inventory.find(i=>i.type==="weapon" && i.equipped);
          const wbonus = wep ? (wep.meta.strength||wep.meta.magic||0) : 0;
          monster.hp -= (player.stats.strength||0) + wbonus;
          if(monster.hp <= 0){
            // reward and random drop
            player.xp += monster.type==="boss"? 60:20;
            player.gold += monster.type==="boss"? 30:10;
            // random item chance
            if(Math.random() < 0.4){
              const drop = randomDrop();
              drop.x = monster.x; drop.y = monster.y;
              groundItems.push(drop);
            }
            monsters[monsters.indexOf(monster)] = spawnMonster(monster.type);
          }
        }
      }
    }

    // ranged attack vs player (pvp)
    if(data.type === "rangedAttack"){
      const targetId = data.targetId;
      const target = players[targetId];
      if(target && target.x < PVP_ZONE){
        const dist = Math.hypot(player.x - target.x, player.y - target.y);
        if(dist <= (player.stats.range||60)){
          const dmg = Math.max((player.stats.magic||0) - (target.stats.defense||0), 1);
          target.stats.hp -= dmg;
          if(target.stats.hp <= 0){
            target.stats.hp = target.stats.maxHp;
          }
        }
      }
    }

    // save snapshot to accounts on demand or periodically
    if(data.type === "save"){ savePlayerToAccount(ws.playerId); }

    // broadcast state after handling
    broadcast();

  }); // end on message

  ws.on("close", ()=>{ if(ws.playerId) { savePlayerToAccount(ws.playerId); delete players[ws.playerId]; broadcast(); } });
}); // end connection

// ---------- VERIFY OFFER & TRADE HELPERS ----------
function verifyOffer(player, offer){
  if(!offer) return { ok:false, reason:"no offer" };
  // verify gold
  if((offer.gold||0) > (player.gold||0)) return { ok:false, reason:"not enough gold" };
  // verify items exist in inventory
  const invIds = player.inventory.map(i=>i.id);
  for(const iid of (offer.itemIds||[])){
    if(!invIds.includes(iid)) return { ok:false, reason:"item not present" };
  }
  return { ok:true };
}

function performTradeSwap(a, b, offerA, offerB){
  // remove A's offered items and gold
  const itemsA = [];
  for(const iid of (offerA.itemIds||[])){
    const idx = a.inventory.findIndex(x=>x.id===iid);
    if(idx>=0) itemsA.push(...a.inventory.splice(idx,1));
  }
  a.gold = Math.max(0, a.gold - (offerA.gold||0));
  // remove B's offered items and gold
  const itemsB = [];
  for(const iid of (offerB.itemIds||[])){
    const idx = b.inventory.findIndex(x=>x.id===iid);
    if(idx>=0) itemsB.push(...b.inventory.splice(idx,1));
  }
  b.gold = Math.max(0, b.gold - (offerB.gold||0));
  // give them
  a.inventory.push(...itemsB);
  b.inventory.push(...itemsA);
  a.gold += (offerB.gold||0);
  b.gold += (offerA.gold||0);
}

// ---------- SAVE PLAYER -> ACCOUNTS ----------
function savePlayerToAccount(pid){
  const p = players[pid];
  if(!p) return;
  const acc = accounts[p.username];
  if(!acc) return;
  acc.stats = {...p.stats};
  acc.xp = p.xp; acc.level = p.level; acc.skillPoints = p.skillPoints; acc.gold = p.gold;
  acc.inventory = p.inventory.map(it=>({ ...it }));
  acc.class = p.class;
  acc.lastOnline = Date.now();
}

// ---------- UTILS ----------
function createItemInstance(templateKey, rarityName){
  // find base
  const tpl = BASE_ITEMS.find(b=>b.key===templateKey);
  if(!tpl) return null;
  const rarity = RARITY[rarityName] || RARITY.Common;
  const inst = { id: Date.now()+Math.random(), key: tpl.key, name: tpl.name, icon: tpl.icon, type: tpl.type, rarity: rarityName || "Common", meta:{} };
  for(const k in tpl.base) inst.meta[k] = Math.max(1, Math.round(tpl.base[k] * rarity.mult));
  return inst;
}

// A simplified version (we had earlier createItemInstance, use randomDrop based on BASE_ITEMS)
function randomDrop(){
  const rarities = ["Common","Common","Uncommon","Rare","Epic"];
  const rarity = rarities[Math.floor(Math.random()*rarities.length)];
  const template = BASE_ITEMS[Math.floor(Math.random()*BASE_ITEMS.length)];
  const inst = { id: Date.now()+Math.random(), key: template.key, name: template.name, type: template.type, icon: template.icon, rarity, meta:{} };
  for(const k in template.base) inst.meta[k] = Math.max(1, Math.round(template.base[k] * (RARITY[rarity].mult||1)));
  return inst;
}

// small helper for canCraft used earlier
function canCraft(player, recipeKey){
  const recipe = RECIPES[recipeKey];
  if(!recipe) return { ok:false, reason:"unknown" };
  const counts = {};
  for(const it of player.inventory) counts[it.key] = (counts[it.key]||0)+1;
  for(const ing of recipe.ingredients) if((counts[ing.key]||0) < ing.count) return { ok:false, reason:"missing" };
  return { ok:true, recipe };
}

function spawnGroundItem(x,y,template){
  const it = { id: Date.now()+Math.random(), x, y, key: template.key, name: template.name, type: template.type, icon: template.icon, meta:{ ...template.base }, rarity:"Common" };
  groundItems.push(it);
  return it;
}

// (Because we used BASE_ITEMS earlier in earlier files; re-declare for compatibility)
const BASE_ITEMS = [
  { key:"bronze_sword", name:"Bronze Sword", type:"weapon", base:{ strength:2 }, icon:"🗡️" },
  { key:"staff", name:"Oak Staff", type:"weapon", base:{ magic:2 }, icon:"✨" },
  { key:"leather_armor", name:"Leather Armor", type:"armor", base:{ defense:2 }, icon:"🛡️" },
  { key:"hp_potion", name:"Health Potion", type:"potion", base:{ heal:25 }, icon:"🧪" },
  { key:"iron_ingot", name:"Iron Ingot", type:"material", base:{}, icon:"⛓️" },
  { key:"wood", name:"Wood", type:"material", base:{}, icon:"🪵" }
];

console.log("Server ready");
server.listen(process.env.PORT||10000,"0.0.0.0");
