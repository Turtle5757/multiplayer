// public/game.js
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const ws = new WebSocket("wss://" + location.host);

let playerId = null;
let players = {}, monsters = [], groundItems = [];

const PVP_ZONE = 400;
const SPRITE_SIZE = 20; // sprite square size
// For animated sprites: simple 4-frame walk animation using colored rectangles or external sheet later.
let spriteFrame = 0;
setInterval(()=>{ spriteFrame = (spriteFrame+1)%4; }, 200);

// UI elements
const loginPanel = document.getElementById("login");
const loginMsg = document.getElementById("loginMsg");
const inventoryPanel = document.getElementById("inventory");
const invList = document.getElementById("invList");
const craftingPanel = document.getElementById("crafting");
const recipesDiv = document.getElementById("recipes");
const craftMsg = document.getElementById("craftMsg");
const tradePanel = document.getElementById("trade");
const playersListDiv = document.getElementById("playersList");
const myOfferList = document.getElementById("myOfferList");
const offlineNotice = document.getElementById("offlineNotice");

document.getElementById("loginBtn").onclick = () => { ws.send(JSON.stringify({ type:"login", username: document.getElementById("usernameInput").value, password: document.getElementById("passwordInput").value })); };
document.getElementById("registerBtn").onclick = () => { ws.send(JSON.stringify({ type:"register", username: document.getElementById("usernameInput").value, password: document.getElementById("passwordInput").value })); };
document.getElementById("invBtn").onclick = ()=> toggle(inventoryPanel);
document.getElementById("closeInv").onclick = ()=> toggle(inventoryPanel,false);
document.getElementById("craftBtn").onclick = ()=> { toggle(craftingPanel); renderRecipes(); };
document.getElementById("closeCraft").onclick = ()=> toggle(craftingPanel,false);
document.getElementById("tradeBtn").onclick = ()=> { toggle(tradePanel); renderPlayersForTrade(); renderOffer(); };
document.getElementById("closeTrade").onclick = ()=> toggle(tradePanel,false);
document.getElementById("sendTradeBtn").onclick = sendTradeRequest;
document.getElementById("autoToggle").onchange = ()=> { ws.send(JSON.stringify({ type:"toggleAuto", on: document.getElementById("autoToggle").checked })); };

function toggle(el, show=null){ if(show===null) el.style.display = (el.style.display === "none" || el.style.display==="") ? "block" : "none"; else el.style.display = show ? "block" : "none"; }

// movement
let keys = { w:false,a:false,s:false,d:false };
document.addEventListener("keydown", e=>{ if(keys[e.key] !== undefined) keys[e.key]=true;});
document.addEventListener("keyup", e=>{ if(keys[e.key] !== undefined) keys[e.key]=false;});

// move loop
setInterval(()=>{
  if(!playerId) return;
  const me = players[playerId]; if(!me) return;
  const speed = me.stats.speed || 3;
  if(keys.w) me.y -= speed; if(keys.s) me.y += speed; if(keys.a) me.x -= speed; if(keys.d) me.x += speed;
  me.x = Math.max(0, Math.min(canvas.width - SPRITE_SIZE, me.x));
  me.y = Math.max(0, Math.min(canvas.height - SPRITE_SIZE, me.y));
  ws.send(JSON.stringify({ type:"update", x: me.x, y: me.y }));
}, 60);

// click handling (pickup, attack, select for trade)
canvas.addEventListener("click", e=>{
  if(!playerId) return;
  const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;

  // check ground items first (pickup)
  for(const it of groundItems){
    if(mx >= it.x && mx <= it.x+18 && my >= it.y && my <= it.y+18){ ws.send(JSON.stringify({ type:"pickup" })); return; }
  }
  // players (pvp)
  for(const id in players){
    if(id === playerId) continue;
    const p = players[id];
    if(mx >= p.x && mx <= p.x+SPRITE_SIZE && my >= p.y && my <= p.y+SPRITE_SIZE){
      ws.send(JSON.stringify({ type:"attack", targetId: id }));
      return;
    }
  }
  // monsters
  for(const m of monsters){
    if(mx >= m.x && mx <= m.x+SPRITE_SIZE && my >= m.y && my <= m.y+SPRITE_SIZE){
      ws.send(JSON.stringify({ type:"attackMonster", monsterId: m.id }));
      return;
    }
  }
});

// socket
ws.onmessage = msg => {
  const data = JSON.parse(msg.data);
  if(data.type === "askLogin"){ loginPanel.style.display = "block"; return; }
  if(data.type === "error"){ loginMsg.innerText = data.message; return; }
  if(data.type === "registered"){ loginMsg.innerText = "Registered! log in."; return; }
  if(data.type === "init"){ playerId = data.id; players = data.players; monsters = data.monsters; groundItems = data.groundItems || []; loginPanel.style.display = "none"; updateHUD(); renderInventory(); renderRecipes(); draw(); if(data.offlineSummary){ offlineNotice.style.display="block"; offlineNotice.innerText = `Offline: +${data.offlineSummary.xpGain} XP, +${data.offlineSummary.goldGain} gold`; } return; }
  if(data.type === "state"){ players = data.players; monsters = data.monsters; groundItems = data.groundItems || []; updateHUD(); renderInventory(); draw(); return; }

  if(data.type === "craftResult"){
    if(data.ok) { craftMsg.innerText = "Crafted: " + data.item.name; renderInventory(); }
    else craftMsg.innerText = "Craft failed: " + (data.reason||"unknown");
  }

  if(data.type === "tradeRequest"){
    // incoming trade request; display prompt to accept/decline. Keep simple: auto-accept for now? We'll show two buttons.
    const t = data.trade;
    if(confirm(`${players[t.fromId].username} offers trade. Accept?`)){
      // craft a reply ask = empty for simplicity; accept perform trade with same offer? For full flow client should show UI — keep minimal and accept
      ws.send(JSON.stringify({ type:"tradeAccept", tradeId: t.id, ask:{ itemIds:[], gold:0 } }));
    } else {
      ws.send(JSON.stringify({ type:"tradeDecline", tradeId: t.id }));
    }
  }

};

// HUD update
function updateHUD(){
  const me = players[playerId]; if(!me) return;
  document.getElementById("autoToggle").checked = !!me.autoGather;
  // update small HUDs (left)
  // (we have small HUD built in earlier pages, reuse if present)
}

// inventory UI
function renderInventory(){
  invList.innerHTML = "";
  const me = players[playerId]; if(!me) return;
  if(me.inventory.length === 0) invList.innerText = "Empty";
  me.inventory.forEach(it=>{
    const b = document.createElement("button");
    // show rarity color
    const color = rarityColor(it.rarity || "Common");
    b.innerHTML = `<span style="color:${color}">${it.icon||"?"}</span> ${it.name} ${it.equipped?"[E]":""} <small style="color:#ccc">(${it.rarity||"Common"})</small>`;
    b.onclick = ()=> {
      if(it.type === "potion") ws.send(JSON.stringify({ type:"useItem", itemId: it.id }));
      else ws.send(JSON.stringify({ type:"equipItem", itemId: it.id }));
    };
    invList.appendChild(b);
  });
}

function rarityColor(r){
  if(!r) return "#ddd";
  if(r==="Uncommon") return "#4caf50";
  if(r==="Rare") return "#2196F3";
  if(r==="Epic") return "#9C27B0";
  return "#ddd";
}

// crafting UI
const RECIPES = {
  "bronze_sword": { name:"Bronze Sword", resultKey:"bronze_sword", ingredients:[ { key:"iron_ingot", count:2 }, { key:"wood", count:1 } ] },
  "leather_armor": { name:"Leather Armor", resultKey:"leather_armor", ingredients:[ { key:"wood", count:2 } ] },
  "staff": { name:"Oak Staff", resultKey:"staff", ingredients:[ { key:"wood", count:3 }, { key:"iron_ingot", count:1 } ] }
};

function renderRecipes(){
  recipesDiv.innerHTML = "";
  for(const k in RECIPES){
    const r = RECIPES[k];
    const div = document.createElement("div");
    div.className = "recipe";
    div.innerHTML = `<strong>${r.name}</strong><div class="small">Requires: ${r.ingredients.map(i=>i.count+"x "+i.key).join(", ")}</div><button>Craft</button>`;
    div.querySelector("button").onclick = () => {
      ws.send(JSON.stringify({ type:"craft", recipe: k }));
    };
    recipesDiv.appendChild(div);
  }
}

// trading UI
let selectedTradeTarget = null;
let myOfferItemIds = []; // hold ids of items currently offered for trade
function renderPlayersForTrade(){
  playersListDiv.innerHTML = "";
  for(const pid in players){
    if(pid===playerId) continue;
    const btn = document.createElement("button");
    btn.innerText = players[pid].username;
    btn.onclick = ()=> { selectedTradeTarget = pid; alert("Selected " + players[pid].username + " as trade partner"); };
    playersListDiv.appendChild(btn);
  }
}
function renderOffer(){
  myOfferList.innerHTML = "";
  const me = players[playerId]; if(!me) return;
  me.inventory.forEach(it=>{
    const b = document.createElement("button");
    b.innerText = `${it.icon||""} ${it.name}`;
    b.onclick = ()=> {
      // toggle add/remove from myOfferItemIds
      const idx = myOfferItemIds.indexOf(it.id);
      if(idx>=0) myOfferItemIds.splice(idx,1);
      else myOfferItemIds.push(it.id);
      renderOffer();
    };
    if(myOfferItemIds.includes(it.id)) b.style.background = "#356";
    myOfferList.appendChild(b);
  });
}
function sendTradeRequest(){
  if(!selectedTradeTarget){ alert("Pick a player first"); return; }
  const gold = parseInt(document.getElementById("offerGold").value || "0");
  ws.send(JSON.stringify({ type:"tradeRequest", toId: selectedTradeTarget, offer:{ itemIds: myOfferItemIds, gold } }));
}

// draw loop with simple animated sprite effect
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // zones
  ctx.fillStyle = "#071216"; ctx.fillRect(0,0,PVP_ZONE,canvas.height);
  ctx.fillStyle = "#0b2628"; ctx.fillRect(PVP_ZONE,0,canvas.width-PVP_ZONE,canvas.height);

  // ground items
  for(const it of groundItems){
    ctx.fillStyle = "#b8860b";
    ctx.fillRect(it.x, it.y, 18, 18);
    ctx.fillStyle = "#fff"; ctx.font = "12px sans-serif";
    ctx.fillText(it.icon||"?", it.x+2, it.y+13);
  }

  // monsters (animated)
  monsters.forEach(m=>{
    const color = m.type==="boss" ? "#7b1fa2" : "#2e7d32";
    // alternate fill to simulate animation frames
    ctx.fillStyle = (spriteFrame%2===0) ? color : shadeColor(color, -8);
    ctx.fillRect(m.x, m.y, SPRITE_SIZE, SPRITE_SIZE);
    // HP bar
    const hpRatio = Math.max(0,m.hp)/m.maxHp;
    ctx.fillStyle = "red";
    ctx.fillRect(m.x, m.y-6, SPRITE_SIZE*hpRatio, 4);
    ctx.fillStyle = "#fff"; ctx.font="10px sans-serif";
    ctx.fillText(m.type==="boss"?"BOSS":"", m.x-2, m.y-8);
  });

  // players (animated)
  for(const id in players){
    const p = players[id];
    const base = (id === playerId) ? "#d84315" : "#0277bd";
    ctx.fillStyle = (spriteFrame%2===0) ? base : shadeColor(base, -12);
    ctx.fillRect(p.x, p.y, SPRITE_SIZE, SPRITE_SIZE);
    // name + hp
    ctx.fillStyle = "#fff";
    ctx.font = "11px sans-serif";
    ctx.fillText(p.username || "player", p.x - 2, p.y - 8);
    const hpRatio = Math.max(0,p.stats.hp) / (p.stats.maxHp || 20);
    ctx.fillStyle = "red";
    ctx.fillRect(p.x, p.y - 4, SPRITE_SIZE*hpRatio, 3);
    if(id === playerId){
      ctx.fillStyle = "#fff"; ctx.font="10px sans-serif";
      ctx.fillText(`STR:${p.stats.strength} DEF:${p.stats.defense} MAG:${p.stats.magic} HP:${p.stats.hp}/${p.stats.maxHp}`, p.x-60, p.y+36);
    }
  }

  requestAnimationFrame(draw);
}
draw();

// small utility to darken/brighten hex color
function shadeColor(color, percent) {
  // input color like "#rrggbb"
  const f = parseInt(color.slice(1),16), t = percent<0?0:255, p = Math.abs(percent)/100;
  const R = Math.round((t - (f>>16)) * p) + (f>>16);
  const G = Math.round((t - (f>>8 & 0x00FF)) * p) + (f>>8 & 0x00FF);
  const B = Math.round((t - (f & 0x0000FF)) * p) + (f & 0x0000FF);
  return "#" + (0x1000000 + (R<<16) + (G<<8) + B).toString(16).slice(1);
}
