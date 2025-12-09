// public/game.js - client for IdleOn-like multiplayer
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// UI refs
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const registerBtn = document.getElementById("register");
const loginBtn = document.getElementById("login");
const classSelect = document.getElementById("classSelect");
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
const sendTradeBtn = document.getElementById("sendTrade");
const closeTrade = document.getElementById("closeTrade");

const statsPanel = document.getElementById("statsPanel");

// socket
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);

let playerId = null;
let players = {}, monsters = [], groundItems = [];
let me = null;

ws.onopen = ()=> console.log("ws open");

ws.onmessage = e => {
  const d = JSON.parse(e.data);
  if(d.type === "askLogin"){ /* show login UI (already visible) */ }
  if(d.type === "registered"){ alert("Registered! Log in."); }
  if(d.type === "error"){ alert("Error: "+d.message); }
  if(d.type === "init"){ playerId = d.id; players = d.players; monsters = d.monsters; groundItems = d.groundItems || []; me = players[playerId]; renderInventory(); renderRecipes(); renderSkillNodes(); }
  if(d.type === "state"){ players = d.players; monsters = d.monsters; groundItems = d.groundItems || []; me = players[playerId] || me; renderInventory(); updateStats(); }
  if(d.type === "craftResult"){ if(d.ok) craftMsg.innerText = "Crafted: "+d.item.name; else craftMsg.innerText = "Craft failed: "+(d.reason||""); setTimeout(()=> craftMsg.innerText = "", 3000); if(d.ok) renderInventory(); }
  if(d.type === "tradeRequest"){ const t = d.trade; if(confirm(`${players[t.fromId].username} offers trade. Accept?`)){ ws.send(JSON.stringify({ type:"tradeAccept", tradeId: t.id, ask:{ itemIds:[], gold:0 } })); } else ws.send(JSON.stringify({ type:"tradeDecline", tradeId: t.id })); }
  if(d.type === "tradeComplete"){ alert("Trade completed"); }
};

// login & register
registerBtn.onclick = ()=> { ws.send(JSON.stringify({ type:"register", username: usernameInput.value, password: passwordInput.value })); };
loginBtn.onclick = ()=> { ws.send(JSON.stringify({ type:"login", username: usernameInput.value, password: passwordInput.value })); };

// UI toggle handlers
invBtn.onclick = ()=> toggle(invPanel);
closeInv.onclick = ()=> toggle(invPanel,false);
skillBtn.onclick = ()=> { toggle(skillPanel); renderSkillNodes(); };
closeSkill.onclick = ()=> toggle(skillPanel,false);
craftBtn.onclick = ()=> { toggle(craftPanel); renderRecipes(); };
closeCraft.onclick = ()=> toggle(craftPanel,false);
tradeBtn.onclick = ()=> { toggle(tradePanel); renderPlayersForTrade(); };
closeTrade.onclick = ()=> toggle(tradePanel,false);
sendTradeBtn.onclick = sendTradeRequest;
autoToggle.onchange = ()=> ws.send(JSON.stringify({ type:"toggleAuto", on: autoToggle.checked }));

function toggle(el,show=null){ el.style.display = (show===null ? (el.style.display==="none"||el.style.display==="" ? "block" : "none") : (show ? "block" : "none")); }

// movement with smoothing
const keys = { w:false,a:false,s:false,d:false };
document.addEventListener("keydown", e=>{ if(keys[e.key] !== undefined) keys[e.key] = true; });
document.addEventListener("keyup", e=>{ if(keys[e.key] !== undefined) keys[e.key] = false; });

setInterval(()=>{
  if(!playerId) return;
  me = players[playerId]; if(!me) return;
  const baseSpeed = me.stats.speed || 3;
  // inertia
  me.vx = (me.vx||0)*0.7; me.vy = (me.vy||0)*0.7;
  if(keys.w) me.vy -= baseSpeed*0.28;
  if(keys.s) me.vy += baseSpeed*0.28;
  if(keys.a) me.vx -= baseSpeed*0.28;
  if(keys.d) me.vx += baseSpeed*0.28;
  me.x = Math.max(0, Math.min(canvas.width-20, (me.x||50) + me.vx));
  me.y = Math.max(0, Math.min(canvas.height-20, (me.y||50) + me.vy));

  // zone transitions: walk off left/right edges to change zone
  // simple rule: if x < 2 -> move left zone; if x > canvas.width-22 -> move right zone
  let zone = me.zone || "spawn";
  const zones = ["spawn","forest","cave","dungeon"];
  const idx = zones.indexOf(zone);
  if(me.x < 6 && idx > 0){ zone = zones[idx-1]; me.x = canvas.width-30; }
  if(me.x > canvas.width-26 && idx < zones.length-1){ zone = zones[idx+1]; me.x = 20; }
  me.zone = zone;

  ws.send(JSON.stringify({ type:"update", x: Math.round(me.x), y: Math.round(me.y), zone: me.zone }));
}, 60);

// click interactions (attack/pickup)
canvas.addEventListener("click", e=>{
  if(!playerId) return;
  const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
  // check ground items -> pickup
  for(const it of groundItems){
    if(mx >= it.x && mx <= it.x+18 && my >= it.y && my <= it.y+18){ ws.send(JSON.stringify({ type:"pickup" })); return; }
  }
  // players (pvp ranged attack)
  for(const id in players){
    if(id === playerId) continue;
    const p = players[id];
    if(mx >= p.x && mx <= p.x+20 && my >= p.y && my <= p.y+20){ ws.send(JSON.stringify({ type:"rangedAttack", targetId: id })); return; }
  }
  // monsters -> attack
  for(const m of monsters){
    if(mx >= m.x && mx <= m.x+20 && my >= m.y && my <= m.y+20){ ws.send(JSON.stringify({ type:"attackMonster", monsterId: m.id })); return; }
  }
});

// rendering
let spriteFrame = 0; setInterval(()=> spriteFrame = (spriteFrame+1)%4, 160);
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // zone backgrounds (left-right)
  ctx.fillStyle = "#072026"; ctx.fillRect(0,0,canvas.width/2,canvas.height);
  ctx.fillStyle = "#07121a"; ctx.fillRect(canvas.width/2,0,canvas.width/2,canvas.height);

  // draw ground items
  groundItems.forEach(it => {
    ctx.fillStyle = "#b8860b"; ctx.fillRect(it.x, it.y, 18,18);
    ctx.fillStyle = "#fff"; ctx.font = "12px sans-serif"; ctx.fillText(it.icon||"?", it.x+2, it.y+13);
  });

  // monsters
  monsters.forEach(m => {
    const color = m.type === "boss" ? "#7b1fa2" : "#2e7d32";
    ctx.fillStyle = (spriteFrame%2===0) ? color : shadeColor(color, -10);
    ctx.fillRect(m.x, m.y, 20, 20);
    // hp bar
    ctx.fillStyle = "red"; ctx.fillRect(m.x, m.y-6, 20 * Math.max(0,m.hp)/m.maxHp, 4);
    ctx.fillStyle = "#fff"; ctx.font = "10px sans-serif"; if(m.type==="boss") ctx.fillText("BOSS", m.x-2, m.y-8);
  });

  // players
  for(const id in players){
    const p = players[id];
    const base = (id===playerId) ? "#ff8a65" : "#64b5f6";
    ctx.fillStyle = (spriteFrame%2===0) ? base : shadeColor(base, -12);
    ctx.fillRect(p.x, p.y, 20, 20);
    ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif"; ctx.fillText(p.username || "Player", p.x-2, p.y-8);
    const hpRatio = Math.max(0, p.stats.hp) / p.stats.maxHp;
    ctx.fillStyle = "red"; ctx.fillRect(p.x, p.y-4, 20*hpRatio, 3);
  }

  requestAnimationFrame(draw);
}
draw();

// inventory UI rendering
function renderInventory(){
  invList.innerHTML = "";
  me = players[playerId];
  if(!me) return;
  if(me.inventory.length === 0) invList.innerText = "Empty";
  me.inventory.forEach(it => {
    const b = document.createElement("button");
    b.innerHTML = `${it.icon||''} ${it.name} ${it.equipped ? '[E]' : ''} <small style="color:#ccc">(${it.rarity||'Common'})</small>`;
    b.onclick = () => {
      if(it.type === "potion") ws.send(JSON.stringify({ type:"useItem", itemId: it.id }));
      else ws.send(JSON.stringify({ type:"equipItem", itemId: it.id }));
    };
    invList.appendChild(b);
  });
}

// skill tree UI
const SKILL_CLIENT = [
  { id:"STR1", label:"+1 STR", node:"STR1" },
  { id:"DEF1", label:"+1 DEF", node:"DEF1" },
  { id:"MAG1", label:"+1 MAG", node:"MAG1" },
  { id:"HP1", label:"+5 HP", node:"HP1" },
  { id:"SPD1", label:"+0.3 SPD", node:"SPD1" }
];
function renderSkillNodes(){
  skillNodesDiv.innerHTML = "";
  me = players[playerId]; if(!me) return;
  SKILL_CLIENT.forEach(n => {
    const d = document.createElement("div"); d.className = "recipe";
    d.innerHTML = `<strong>${n.label}</strong><button>Buy</button>`;
    d.querySelector("button").onclick = () => {
      if(me.skillPoints <= 0) return alert("No skill points");
      ws.send(JSON.stringify({ type:"buySkill", node: n.node }));
    };
    skillNodesDiv.appendChild(d);
  });
}

// recipes UI
const RECIPES_CLIENT = {
  bronze_sword: { name:"Bronze Sword", require:[ {key:"iron_ingot",count:2},{key:"wood",count:1} ] },
  oak_staff: { name:"Oak Staff", require:[ {key:"wood",count:3},{key:"iron_ingot",count:1} ] }
};
function renderRecipes(){
  recipesDiv.innerHTML = "";
  for(const k in RECIPES_CLIENT){
    const r = RECIPES_CLIENT[k];
    const div = document.createElement("div"); div.className = "recipe";
    div.innerHTML = `<strong>${r.name}</strong><div class="small">Requires: ${r.require.map(x=>x.count+" "+x.key).join(", ")}</div><button>Craft</button>`;
    div.querySelector("button").onclick = ()=> ws.send(JSON.stringify({ type:"craft", recipe: k }));
    recipesDiv.appendChild(div);
  }
}

// trade UI (simple)
let selectedTradeTarget = null, offerItemIds = [];
function renderPlayersForTrade(){
  playersListDiv.innerHTML = "";
  for(const pid in players) if(pid !== playerId){
    const b = document.createElement("button"); b.innerText = players[pid].username; b.onclick = ()=> { selectedTradeTarget = pid; alert("Selected " + players[pid].username); };
    playersListDiv.appendChild(b);
  }
  renderOffer();
}
function renderOffer(){
  myOfferDiv.innerHTML = ""; me = players[playerId]; if(!me) return;
  me.inventory.forEach(it => {
    const b = document.createElement("button"); b.innerText = it.name; b.onclick = ()=> {
      const idx = offerItemIds.indexOf(it.id); if(idx>=0) offerItemIds.splice(idx,1); else offerItemIds.push(it.id); renderOffer();
    }; if(offerItemIds.includes(it.id)) b.style.background = "#356";
    myOfferDiv.appendChild(b);
  });
}
function sendTradeRequest(){
  if(!selectedTradeTarget) return alert("Choose a player");
  const goldInput = parseInt(document.getElementById("offerGold")?.value||"0");
  ws.send(JSON.stringify({ type:"tradeRequest", toId: selectedTradeTarget, offer:{ itemIds: offerItemIds, gold: goldInput } }));
}

// small helpers
function updateStats(){
  me = players[playerId]; if(!me) return;
  statsPanel.innerHTML = `Lvl:${me.level} XP:${Math.floor(me.xp)} Gold:${me.gold} SP:${me.skillPoints} Class:${me.class}<br>STR:${Math.floor(me.stats.strength)} DEF:${Math.floor(me.stats.defense)} MAG:${Math.floor(me.stats.magic)} HP:${Math.floor(me.stats.hp)}/${Math.floor(me.stats.maxHp)}`;
  renderInventory();
}
function shadeColor(color, percent){ const f=parseInt(color.slice(1),16), t=percent<0?0:255, p=Math.abs(percent)/100; const R=Math.round((t-(f>>16))*p)+(f>>16); const G=Math.round((t-((f>>8)&0x00FF))*p)+((f>>8)&0x00FF); const B=Math.round((t-(f&0x0000FF))*p)+(f&0x0000FF); return "#"+(0x1000000+(R<<16)+(G<<8)+B).toString(16).slice(1); }
