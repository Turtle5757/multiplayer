// public/game.js - client side for IdleRPG
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const ws = new WebSocket((location.protocol==="https:"?"wss://":"ws://") + location.host);

let playerId = null;
let players = {}, monsters = [], groundItems = [];
const PVP_X = 420, SPRITE = 20;
let spriteFrame = 0;
setInterval(()=> spriteFrame = (spriteFrame+1)%4, 160);

// UI refs
const loginPanel = document.getElementById("login");
const loginMsg = document.getElementById("loginMsg");
const invPanel = document.getElementById("inventory");
const invList = document.getElementById("invList");
const craftPanel = document.getElementById("crafting");
const recipesDiv = document.getElementById("recipes");
const craftMsg = document.getElementById("craftMsg");
const tradePanel = document.getElementById("trade");
const playersListDiv = document.getElementById("playersList");
const myOfferList = document.getElementById("myOfferList");

document.getElementById("loginBtn").onclick = ()=> sendLogin();
document.getElementById("registerBtn").onclick = ()=> sendRegister();
document.getElementById("invBtn").onclick = ()=> toggle(invPanel);
document.getElementById("closeInv").onclick = ()=> toggle(invPanel,false);
document.getElementById("craftBtn").onclick = ()=> { toggle(craftPanel); renderRecipes(); };
document.getElementById("closeCraft").onclick = ()=> toggle(craftPanel,false);
document.getElementById("tradeBtn").onclick = ()=> { toggle(tradePanel); renderPlayersForTrade(); renderOffer(); };
document.getElementById("closeTrade").onclick = ()=> toggle(tradePanel,false);
document.getElementById("sendTradeBtn").onclick = sendTradeRequest;
document.getElementById("autoToggle").onchange = ()=> ws.send(JSON.stringify({ type:"toggleAuto", on: document.getElementById("autoToggle").checked }));

function toggle(el, show=null){ el.style.display = (show===null ? (el.style.display==="none" || el.style.display==="" ? "block" : "none") : (show ? "block" : "none")); }

// movement
let keys = { w:false, a:false, s:false, d:false };
document.addEventListener("keydown", e=>{ if(keys[e.key]!==undefined) keys[e.key]=true;});
document.addEventListener("keyup", e=>{ if(keys[e.key]!==undefined) keys[e.key]=false;});

// auto move loop and send updates at 60ms
setInterval(()=>{
  if(!playerId) return;
  const me = players[playerId]; if(!me) return;
  const speed = me.stats.speed || 3;
  let moved=false;
  if(keys.w){ me.y -= speed; moved=true; }
  if(keys.s){ me.y += speed; moved=true; }
  if(keys.a){ me.x -= speed; moved=true; }
  if(keys.d){ me.x += speed; moved=true; }
  me.x = Math.max(0, Math.min(canvas.width - SPRITE, me.x));
  me.y = Math.max(0, Math.min(canvas.height - SPRITE, me.y));
  if(moved) ws.send(JSON.stringify({ type:"update", x: Math.round(me.x), y: Math.round(me.y) }));
}, 60);

// click for attack/pickup/trade target
canvas.addEventListener("click", e=>{
  if(!playerId) return;
  const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  // ground items
  for(const it of groundItems) if(mx>=it.x && mx<=it.x+18 && my>=it.y && my<=it.y+18){ ws.send(JSON.stringify({ type:"pickup" })); return; }
  // players (pvp)
  for(const id in players) if(id !== playerId){
    const p = players[id];
    if(mx>=p.x && mx<=p.x+SPRITE && my>=p.y && my<=p.y+SPRITE){ ws.send(JSON.stringify({ type:"rangedAttack", targetId: id })); return; }
  }
  // monsters
  for(const m of monsters) if(mx>=m.x && mx<=m.x+SPRITE && my>=m.y && my<=m.y+SPRITE){ ws.send(JSON.stringify({ type:"attackMonster", monsterId: m.id })); return; }
});

// socket messages
ws.onmessage = e => {
  const d = JSON.parse(e.data);
  if(d.type === "askLogin"){ loginPanel.style.display = "block"; return; }
  if(d.type === "error"){ loginMsg.innerText = d.message; return; }
  if(d.type === "registered"){ loginMsg.innerText = "Registered! Now login."; return; }
  if(d.type === "init"){ playerId = d.id; players = d.players; monsters = d.monsters; groundItems = d.groundItems || []; loginPanel.style.display = "none"; renderInventory(); renderRecipes(); draw(); return; }
  if(d.type === "state"){ players = d.players; monsters = d.monsters; groundItems = d.groundItems || []; renderInventory(); return; }
  if(d.type === "craftResult"){ craftMsg.innerText = d.ok?("Crafted: "+d.item.name):("Failed: "+d.reason); if(d.ok) renderInventory(); }
  if(d.type === "tradeRequest"){ if(confirm(`${players[d.trade.fromId].username} wants to trade. Accept?`)){ ws.send(JSON.stringify({ type:"tradeAccept", tradeId: d.trade.id, ask:{ itemIds:[], gold:0 } })); } else ws.send(JSON.stringify({ type:"tradeDecline", tradeId: d.trade.id })); }
  if(d.type === "tradeComplete"){ alert("Trade completed"); }
};

// login/register
function sendRegister(){ const u = document.getElementById("usernameInput").value, p = document.getElementById("passwordInput").value; ws.send(JSON.stringify({ type:"register", username:u, password:p })); }
function sendLogin(){ const u=document.getElementById("usernameInput").value, p=document.getElementById("passwordInput").value; ws.send(JSON.stringify({ type:"login", username:u, password:p })); }

// inventory UI
function renderInventory(){
  invList.innerHTML = "";
  const me = players[playerId]; if(!me) return;
  if(me.inventory.length === 0) invList.innerText = "Empty";
  me.inventory.forEach(it => {
    const b = document.createElement("button");
    b.innerHTML = `${it.icon||"?"} ${it.name} ${it.equipped?"[E]":""} <small style="color:#ccc">(${it.rarity||"Common"})</small>`;
    b.onclick = ()=> {
      if(it.type === "potion") ws.send(JSON.stringify({ type:"useItem", itemId: it.id }));
      else ws.send(JSON.stringify({ type:"equipItem", itemId: it.id }));
    };
    invList.appendChild(b);
  });
}

// recipes UI
const RECIPES_CLIENT = {
  bronze_sword: { name:"Bronze Sword", ingredients:[ {key:"iron_ingot",count:2},{key:"wood",count:1} ] },
  oak_staff: { name:"Oak Staff", ingredients:[ {key:"wood",count:3},{key:"iron_ingot",count:1} ] }
};
function renderRecipes(){
  recipesDiv.innerHTML = "";
  for(const k in RECIPES_CLIENT){
    const r = RECIPES_CLIENT[k];
    const div = document.createElement("div"); div.className = "recipe";
    div.innerHTML = `<strong>${r.name}</strong><div class="small">Requires: ${r.ingredients.map(x=>x.count+"x "+x.key).join(", ")}</div><button>Craft</button>`;
    div.querySelector("button").onclick = ()=> ws.send(JSON.stringify({ type:"craft", recipe: k }));
    recipesDiv.appendChild(div);
  }
}

// trading UI
let selectedTradeTarget = null, myOfferItemIds = [];
function renderPlayersForTrade(){
  playersListDiv.innerHTML = "";
  for(const pid in players) if(pid !== playerId){
    const btn = document.createElement("button");
    btn.innerText = players[pid].username;
    btn.onclick = ()=> { selectedTradeTarget = pid; alert("Selected " + players[pid].username); };
    playersListDiv.appendChild(btn);
  }
}
function renderOffer(){
  myOfferList.innerHTML = "";
  const me = players[playerId]; if(!me) return;
  me.inventory.forEach(it => {
    const b = document.createElement("button");
    b.innerText = `${it.icon||""} ${it.name}`;
    b.onclick = ()=> {
      const idx = myOfferItemIds.indexOf(it.id);
      if(idx>=0) myOfferItemIds.splice(idx,1); else myOfferItemIds.push(it.id);
      renderOffer();
    };
    if(myOfferItemIds.includes(it.id)) b.style.background = "#356";
    myOfferList.appendChild(b);
  });
}
function sendTradeRequest(){
  if(!selectedTradeTarget) return alert("Pick player");
  const gold = parseInt(document.getElementById("offerGold").value||"0");
  ws.send(JSON.stringify({ type:"tradeRequest", toId: selectedTradeTarget, offer:{ itemIds: myOfferItemIds, gold } }));
}

// client draw loop
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // zones
  ctx.fillStyle = "#071216"; ctx.fillRect(0,0,PVP_X,canvas.height);
  ctx.fillStyle = "#0b2628"; ctx.fillRect(PVP_X,0,canvas.width-PVP_X,canvas.height);
  // ground items
  for(const it of groundItems){
    ctx.fillStyle = "#b8860b"; ctx.fillRect(it.x, it.y, 18,18);
    ctx.fillStyle = "#fff"; ctx.font="12px sans-serif"; ctx.fillText(it.icon||"?", it.x+2, it.y+13);
  }
  // monsters
  for(const m of monsters){
    const color = m.type==="boss" ? "#7b1fa2" : "#2e7d32";
    ctx.fillStyle = (spriteFrame%2===0) ? color : shadeColor(color, -8);
    ctx.fillRect(m.x, m.y, SPRITE, SPRITE);
    const hpRatio = Math.max(0, m.hp)/m.maxHp;
    ctx.fillStyle = "red"; ctx.fillRect(m.x, m.y-6, SPRITE*hpRatio, 4);
    ctx.fillStyle = "#fff"; ctx.font="10px sans-serif"; if(m.type==="boss") ctx.fillText("BOSS", m.x-2, m.y-8);
  }
  // players
  for(const id in players){
    const p = players[id];
    const base = (id===playerId) ? "#ff8a65" : "#64b5f6";
    ctx.fillStyle = (spriteFrame%2===0) ? base : shadeColor(base, -12);
    ctx.fillRect(p.x, p.y, SPRITE, SPRITE);
    ctx.fillStyle = "#fff"; ctx.font="11px sans-serif"; ctx.fillText(p.username || "Player", p.x-2, p.y-8);
    const hpRatio = Math.max(0, p.stats.hp)/p.stats.maxHp;
    ctx.fillStyle="red"; ctx.fillRect(p.x, p.y-4, SPRITE*hpRatio, 3);
    if(id===playerId){
      ctx.fillStyle="#fff"; ctx.font="10px sans-serif";
      ctx.fillText(`STR:${Math.floor(p.stats.strength)} DEF:${Math.floor(p.stats.defense)} MAG:${Math.floor(p.stats.magic)} HP:${Math.floor(p.stats.hp)}/${Math.floor(p.stats.maxHp)}`, p.x-80, p.y+36);
    }
  }
  requestAnimationFrame(draw);
}
draw();

function shadeColor(color, percent){
  const f = parseInt(color.slice(1),16), t = percent<0?0:255, p = Math.abs(percent)/100;
  const R = Math.round((t - (f>>16)) * p) + (f>>16);
  const G = Math.round((t - (f>>8 & 0x00FF)) * p) + (f>>8 & 0x00FF);
  const B = Math.round((t - (f & 0x0000FF)) * p) + (f & 0x0000FF);
  return "#" + (0x1000000 + (R<<16) + (G<<8) + B).toString(16).slice(1);
}
