// public/game.js - client side full game (IdleOn-style with bosses)
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);

// UI refs
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const classSelect = document.getElementById("classSelect");
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const autoToggle = document.getElementById("autoToggle");

const invBtn = document.getElementById("invBtn");
const skillBtn = document.getElementById("skillBtn");
const craftBtn = document.getElementById("craftBtn");
const tradeBtn = document.getElementById("tradeBtn");

const invPanel = document.getElementById("inventory");
const invList = document.getElementById("invList");
const closeInv = document.getElementById("closeInv");

const skillPanel = document.getElementById("skillTree");
const skillNodesDiv = document.getElementById("skillNodes");
const closeSkill = document.getElementById("closeSkill");

const craftPanel = document.getElementById("crafting");
const recipesDiv = document.getElementById("recipes");
const craftMsg = document.getElementById("craftMsg");
const closeCraft = document.getElementById("closeCraft");

const tradePanel = document.getElementById("trade");
const playersListDiv = document.getElementById("playersList");
const myOfferDiv = document.getElementById("myOffer");
const offerGoldInput = document.getElementById("offerGold");
const sendTradeBtn = document.getElementById("sendTradeBtn");
const closeTrade = document.getElementById("closeTrade");

const statsPanel = document.getElementById("statsPanel");

// Local runtime
let playerId = null;
let players = {}, monsters = [], groundItems = [];
let me = null;
let spriteFrame = 0; setInterval(()=> spriteFrame = (spriteFrame+1)%4, 160);
let selectedTradeTarget = null;
let myOfferItemIds = [];

// event hookups
registerBtn.onclick = ()=> { ws.send(JSON.stringify({ type:"register", username: usernameInput.value, password: passwordInput.value, classChoice: classSelect.value })); };
loginBtn.onclick = ()=> { ws.send(JSON.stringify({ type:"login", username: usernameInput.value, password: passwordInput.value })); };
invBtn.onclick = ()=> toggle(invPanel);
closeInv.onclick = ()=> toggle(invPanel,false);
skillBtn.onclick = ()=> toggle(skillPanel);
closeSkill.onclick = ()=> toggle(skillPanel,false);
craftBtn.onclick = ()=> { toggle(craftPanel); renderRecipes(); };
closeCraft.onclick = ()=> toggle(craftPanel,false);
tradeBtn.onclick = ()=> { toggle(tradePanel); renderPlayersForTrade(); renderOffer(); };
closeTrade.onclick = ()=> toggle(tradePanel,false);
sendTradeBtn.onclick = sendTradeRequest;
autoToggle.onchange = ()=> ws.send(JSON.stringify({ type:"toggleAuto", on: autoToggle.checked }));

function toggle(el, show=null){ el.style.display = (show===null ? (el.style.display==="none" || el.style.display==="" ? "block" : "none") : (show ? "block" : "none")); }

// socket
ws.onopen = ()=> console.log("ws open");
ws.onmessage = e => {
  const d = JSON.parse(e.data);
  if(d.type === "askLogin"){ /* show login fields (already visible) */ }
  if(d.type === "registered"){ alert("Registered! Now log in."); }
  if(d.type === "error"){ alert("Error: "+d.message); }
  if(d.type === "init"){
    playerId = d.id;
    players = d.players; monsters = d.monsters; groundItems = d.groundItems || [];
    me = players[playerId];
    // hide login fields after login
    document.getElementById("username").style.display = "none";
    document.getElementById("password").style.display = "none";
    registerBtn.style.display = "none";
    loginBtn.style.display = "none";
    classSelect.style.display = "none";
    updateHUD();
    renderInventory(); renderRecipes(); renderSkillNodes();
  }
  if(d.type === "state"){
    players = d.players; monsters = d.monsters; groundItems = d.groundItems || [];
    me = players[playerId] || me;
    updateHUD();
    renderInventory();
  }
  if(d.type === "craftResult"){
    if(d.ok){ craftMsg.innerText = "Crafted: " + d.item.name; renderInventory(); }
    else craftMsg.innerText = "Craft failed: " + (d.reason||"");
    setTimeout(()=> craftMsg.innerText = "", 2500);
  }
  if(d.type === "tradeRequest"){
    const t = d.trade;
    if(confirm(`${players[t.fromId].username} wants to trade. Accept?`)){
      ws.send(JSON.stringify({ type:"tradeAccept", tradeId: t.id, ask:{ itemIds:[], gold:0 } }));
    } else ws.send(JSON.stringify({ type:"tradeDecline", tradeId: t.id }));
  }
  if(d.type === "tradeComplete"){ alert("Trade completed"); }
};

// movement (side-view gravity)
const keys = { a:false, d:false, w:false, " ":false };
document.addEventListener("keydown", e=> { if(keys[e.key] !== undefined) keys[e.key]=true; });
document.addEventListener("keyup", e=> { if(keys[e.key] !== undefined) keys[e.key]=false; });

// movement tick
setInterval(()=>{
  if(!playerId) return;
  me = players[playerId]; if(!me) return;
  // inertia
  me.vx = me.vx || 0; me.vy = me.vy || 0;
  const gravity = 0.5;
  const base = me.stats.speed || 3;
  me.vx *= 0.75; me.vy *= 0.99;
  if(keys.a) me.vx -= base*0.26;
  if(keys.d) me.vx += base*0.26;
  if((keys.w || keys[" "]) && Math.abs(me.vy) < 1 && me.y >= 300) me.vy = -8;
  me.vy += gravity;
  me.x = Math.max(0, Math.min(canvas.width-22, me.x + me.vx));
  me.y = Math.max(120, Math.min(420, me.y + me.vy));
  // zones: walk off edges to change zone (side-view)
  const zones = ["town","fields","forest","cave","dungeon"];
  let idx = zones.indexOf(me.zone || "town");
  if(me.x < 6 && idx > 0){ idx--; me.x = canvas.width - 30; }
  if(me.x > canvas.width - 26 && idx < zones.length-1){ idx++; me.x = 20; }
  me.zone = zones[idx];
  ws.send(JSON.stringify({ type:"update", x: Math.round(me.x), y: Math.round(me.y), vx: Math.round(me.vx), vy: Math.round(me.vy), zone: me.zone }));
}, 60);

// auto-attack when near monster (idle-combat)
setInterval(()=>{
  if(!playerId) return;
  me = players[playerId]; if(!me) return;
  for(const m of monsters){
    if(m.zone !== me.zone) continue;
    const d = Math.hypot(me.x - m.x, me.y - m.y);
    if(d < 44){
      ws.send(JSON.stringify({ type:"attackMonster", monsterId: m.id }));
      break;
    }
  }
}, 450);

// click interactions -> pickup / pvp ranged attack / targeted attack
canvas.addEventListener("click", e=>{
  if(!playerId) return;
  const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
  // pick up ground items
  for(const it of groundItems){
    if(mx >= it.x && mx <= it.x+18 && my >= it.y && my <= it.y+18){ ws.send(JSON.stringify({ type:"pickup" })); return; }
  }
  // pvp: click other player (ranged)
  for(const pid in players){
    if(pid === playerId) continue;
    const p = players[pid];
    if(mx >= p.x && mx <= p.x+20 && my >= p.y && my <= p.y+20){
      ws.send(JSON.stringify({ type:"rangedAttack", targetId: pid }));
      return;
    }
  }
  // click monsters to attack
  for(const m of monsters){
    if(mx >= m.x && mx <= m.x+20 && my >= m.y && my <= m.y+20){ ws.send(JSON.stringify({ type:"attackMonster", monsterId: m.id })); return; }
  }
});

// inventory UI
function renderInventory(){
  invList.innerHTML = "";
  me = players[playerId]; if(!me) return;
  if(me.inventory.length === 0) invList.innerText = "Empty";
  me.inventory.forEach(it => {
    const b = document.createElement("button");
    b.innerHTML = `${it.icon||''} ${it.name} ${it.equipped ? '[E]' : ''} <small style="color:#ccc">(${it.rarity||'Common'})</small>`;
    b.onclick = ()=> {
      if(it.type === "potion") ws.send(JSON.stringify({ type:"useItem", itemId: it.id }));
      else ws.send(JSON.stringify({ type:"equipItem", itemId: it.id }));
    };
    invList.appendChild(b);
  });
}

// skill tree UI
const SKILL_LIST = [ {id:"STR1",label:"+1 STR"},{id:"DEF1",label:"+1 DEF"},{id:"MAG1",label:"+1 MAG"},{id:"HP1",label:"+5 HP"},{id:"SPD1",label:"+SPD"} ];
function renderSkillNodes(){
  skillNodesDiv.innerHTML = "";
  me = players[playerId]; if(!me) return;
  SKILL_LIST.forEach(n => {
    const div = document.createElement("div"); div.className = "recipe";
    div.innerHTML = `<strong>${n.label}</strong> <button>Buy</button>`;
    div.querySelector("button").onclick = ()=> {
      if(me.skillPoints <= 0) return alert("No skill points");
      ws.send(JSON.stringify({ type:"buySkill", node: n.id }));
    };
    skillNodesDiv.appendChild(div);
  });
}

// recipes UI
const RECIPES_CLIENT = {
  bronze_sword: { name:"Bronze Sword", ingredients:[ {key:"iron_ingot",count:2},{key:"wood",count:1} ] },
  oak_staff:    { name:"Oak Staff", ingredients:[ {key:"wood",count:3},{key:"iron_ingot",count:1} ] }
};
function renderRecipes(){
  recipesDiv.innerHTML = "";
  for(const k in RECIPES_CLIENT){
    const r = RECIPES_CLIENT[k];
    const div = document.createElement("div"); div.className = "recipe";
    div.innerHTML = `<strong>${r.name}</strong><div class="small">Requires: ${r.ingredients.map(x=>x.count+" "+x.key).join(", ")}</div><button>Craft</button>`;
    div.querySelector("button").onclick = ()=> ws.send(JSON.stringify({ type:"craft", recipe: k }));
    recipesDiv.appendChild(div);
  }
}

// trade UI
function renderPlayersForTrade(){
  playersListDiv.innerHTML = "";
  for(const pid in players){
    if(pid === playerId) continue;
    const b = document.createElement("button"); b.innerText = players[pid].username || "Player";
    b.onclick = ()=> { selectedTradeTarget = pid; alert("Selected " + players[pid].username); };
    playersListDiv.appendChild(b);
  }
  renderOffer();
}
function renderOffer(){
  myOfferDiv.innerHTML = "";
  me = players[playerId]; if(!me) return;
  me.inventory.forEach(it => {
    const b = document.createElement("button");
    b.innerText = it.name;
    b.onclick = ()=> {
      const idx = myOfferItemIds.indexOf(it.id);
      if(idx >= 0) myOfferItemIds.splice(idx,1); else myOfferItemIds.push(it.id);
      renderOffer();
    };
    if(myOfferItemIds.includes(it.id)) b.style.background = "#356";
    myOfferDiv.appendChild(b);
  });
}
function sendTradeRequest(){
  if(!selectedTradeTarget) return alert("Pick a player");
  const gold = parseInt(offerGoldInput.value||"0");
  ws.send(JSON.stringify({ type:"tradeRequest", toId: selectedTradeTarget, offer:{ itemIds: myOfferItemIds, gold } }));
}

// HUD update
function updateHUD(){
  me = players[playerId]; if(!me) return;
  statsPanel.innerHTML = `User: ${me.username || ""} | Class: ${me.class} | Lvl:${me.level} XP:${Math.floor(me.xp)} Gold:${me.gold} SP:${me.skillPoints}<br>STR:${Math.floor(me.stats.strength)} DEF:${Math.floor(me.stats.defense)} MAG:${Math.floor(me.stats.magic)} HP:${Math.floor(me.stats.hp)}/${Math.floor(me.stats.maxHp)} Zone:${me.zone}`;
}

// draw loop
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // left background / right background (zones visually)
  ctx.fillStyle = "#07121a"; ctx.fillRect(0,0,canvas.width,canvas.height);
  // ground & horizon
  ctx.fillStyle = "#0b2b2f"; ctx.fillRect(0,360,canvas.width,240);

  // draw ground items
  for(const it of groundItems){
    ctx.fillStyle = "#b8860b"; ctx.fillRect(it.x, it.y, 18, 18);
    ctx.fillStyle = "#fff"; ctx.font = "12px sans-serif"; ctx.fillText(it.icon||"?", it.x+2, it.y+13);
  }

  // monsters
  for(const m of monsters){
    const color = m.type === "boss" ? "#9c27b0" : "#2e7d32";
    ctx.fillStyle = (spriteFrame%2===0) ? color : shadeColor(color, -8);
    ctx.fillRect(m.x, m.y, 24, 24);
    const hpRatio = Math.max(0, m.hp) / m.maxHp;
    ctx.fillStyle = "red"; ctx.fillRect(m.x, m.y-8, 24*hpRatio, 5);
    ctx.fillStyle = "#fff"; ctx.font = "10px sans-serif";
    if(m.type === "boss"){ ctx.fillText("BOSS", m.x-2, m.y-10); }
  }

  // players
  for(const pid in players){
    const p = players[pid];
    const base = (pid === playerId) ? "#ff8a65" : "#64b5f6";
    ctx.fillStyle = (spriteFrame%2===0) ? base : shadeColor(base, -12);
    ctx.fillRect(p.x, p.y, 22, 28);
    ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif"; ctx.fillText(p.username || "Player", p.x-2, p.y-6);
    const hpRatio = Math.max(0, p.stats.hp) / p.stats.maxHp;
    ctx.fillStyle = "red"; ctx.fillRect(p.x, p.y-6, 22*hpRatio, 3);
    if(pid === playerId){
      ctx.fillStyle = "#fff"; ctx.font = "10px sans-serif";
      ctx.fillText(`STR:${Math.floor(p.stats.strength)} DEF:${Math.floor(p.stats.defense)} MAG:${Math.floor(p.stats.magic)} HP:${Math.floor(p.stats.hp)}/${Math.floor(p.stats.maxHp)}`, p.x-100, p.y+40);
    }
  }

  updateHUD();
  requestAnimationFrame(draw);
}
draw();

function shadeColor(color, percent){
  const f = parseInt(color.slice(1),16), t = percent<0?0:255, p = Math.abs(percent)/100;
  const R = Math.round((t - (f>>16)) * p) + (f>>16);
  const G = Math.round((t - ((f>>8)&0x00FF)) * p) + ((f>>8)&0x00FF);
  const B = Math.round((t - (f & 0x0000FF)) * p) + (f & 0x0000FF);
  return "#" + (0x1000000 + (R<<16) + (G<<8) + B).toString(16).slice(1);
}
