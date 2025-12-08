// game.js
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ws = new WebSocket("wss://" + location.host);

let playerId = null;
let players = {}, monsters = [], groundItems = [];
let keys = { w:false,a:false,s:false,d:false };
const MAP_W = 800, MAP_H = 600, PVP_ZONE = 400;

const skillBtn = document.getElementById("skillBtn");
const invBtn = document.getElementById("invBtn");
const skillPanel = document.getElementById("skillTree");
const invPanel = document.getElementById("inventory");
const loginPanel = document.getElementById("login");
const loginMsg = document.getElementById("loginMsg");
const invList = document.getElementById("invList");
const skillNodesDiv = document.getElementById("skillNodes");

skillBtn.onclick = () => { skillPanel.style.display = skillPanel.style.display === "none" ? "block" : "none"; renderSkillNodes(); };
invBtn.onclick = () => { invPanel.style.display = invPanel.style.display === "none" ? "block" : "none"; renderInventory(); };
document.getElementById("closeSkill").onclick = () => skillPanel.style.display = "none";
document.getElementById("closeInv").onclick = () => invPanel.style.display = "none";

document.getElementById("loginBtn").onclick = () => login();
document.getElementById("registerBtn").onclick = () => register();

function login(){
  const u = document.getElementById("usernameInput").value;
  const p = document.getElementById("passwordInput").value;
  ws.send(JSON.stringify({ type:"login", username:u, password:p }));
}
function register(){
  const u = document.getElementById("usernameInput").value;
  const p = document.getElementById("passwordInput").value;
  ws.send(JSON.stringify({ type:"register", username:u, password:p }));
}

document.addEventListener("keydown", e => { if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = true; });
document.addEventListener("keyup", e => { if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = false; });

function moveLoop(){
  if(!playerId) return;
  const p = players[playerId];
  if(!p) return;
  const speed = p.stats.speed || 3;
  if(keys.w) p.y -= speed;
  if(keys.s) p.y += speed;
  if(keys.a) p.x -= speed;
  if(keys.d) p.x += speed;
  // boundaries
  p.x = Math.max(0, Math.min(MAP_W-20, p.x));
  p.y = Math.max(0, Math.min(MAP_H-20, p.y));
  ws.send(JSON.stringify({ type:"update", x:p.x, y:p.y }));
}
setInterval(moveLoop, 50);

// click to attack or pickup
canvas.addEventListener("click", e=>{
  if(!playerId) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  // check ground items first
  for(const it of groundItems){
    if(mx >= it.x && mx <= it.x+18 && my >= it.y && my <= it.y+18){
      ws.send(JSON.stringify({ type:"pickup" }));
      return;
    }
  }
  // players
  for(const id in players){
    if(id === playerId) continue;
    const p = players[id];
    if(mx >= p.x && mx <= p.x+20 && my >= p.y && my <= p.y+20){
      // if target in PvP zone attack
      ws.send(JSON.stringify({ type:"attack", targetId: id }));
      return;
    }
  }
  // monsters
  for(const m of monsters){
    if(mx >= m.x && mx <= m.x+20 && my >= m.y && my <= m.y+20){
      ws.send(JSON.stringify({ type:"attackMonster", monsterId: m.id }));
      return;
    }
  }
});

ws.onmessage = msg => {
  const data = JSON.parse(msg.data);
  if(data.type === "askLogin"){ loginPanel.style.display = "block"; return; }
  if(data.type === "error"){ loginMsg.innerText = data.message; return; }
  if(data.type === "registered"){ loginMsg.innerText = "Registered. Login now."; return; }
  if(data.type === "init"){ playerId = data.id; players = data.players; monsters = data.monsters; groundItems = data.groundItems || []; loginPanel.style.display = "none"; updateHUD(); renderInventory(); draw(); return; }
  if(data.type === "state"){ players = data.players; monsters = data.monsters; groundItems = data.groundItems || []; updateHUD(); draw(); return; }
};

function updateHUD(){
  const p = players[playerId]; if(!p) return;
  document.getElementById("level").innerText = p.level;
  document.getElementById("xp").innerText = p.xp;
  document.getElementById("gold").innerText = p.gold;
  document.getElementById("skillPts").innerText = p.skillPoints;
}

function renderInventory(){
  invList.innerHTML = "";
  const p = players[playerId]; if(!p) return;
  if(p.inventory.length === 0){ invList.innerText = "Empty"; return; }
  p.inventory.forEach(it => {
    const b = document.createElement("button");
    b.innerText = `${it.icon||""} ${it.name} ${it.equipped ? "[E]" : ""}`;
    b.onclick = () => {
      if(it.type === "potion") ws.send(JSON.stringify({ type:"useItem", itemId: it.id }));
      else ws.send(JSON.stringify({ type:"equipItem", itemId: it.id }));
    };
    invList.appendChild(b);
  });
}

const SKILL_NODES = [
  { id: "str1", label: "STR +1", stat: "strength", req:0 },
  { id: "def1", label: "DEF +1", stat: "defense", req:0 },
  { id: "mag1", label: "MAG +1", stat: "magic", req:0 },
  { id: "spd1", label: "SPD +0.5", stat: "speed", req:1 },
  { id: "mrange1", label: "M-RANGE +5", stat: "meleeRange", req:2 },
  { id: "rrange1", label: "R-RANGE +10", stat: "range", req:2 },
  { id: "hp1", label: "MaxHP +10", stat: "maxHp", req:3 }
];

function renderSkillNodes(){
  skillNodesDiv.innerHTML = "";
  const p = players[playerId]; if(!p) return;
  SKILL_NODES.forEach(node => {
    const div = document.createElement("div");
    div.className = "skillNode";
    div.innerHTML = `<strong>${node.label}</strong><div class="small">Cost: 1 SP</div>`;
    // simple unlock rule: req = required level
    const locked = (p.level < (node.req || 0) + 1) || p.skillPoints <= 0;
    if(locked) div.classList.add("locked");
    div.onclick = () => {
      if(p.skillPoints > 0 && p.level >= (node.req||0)+1){
        ws.send(JSON.stringify({ type:"upgrade", stat: node.stat }));
      }
    };
    skillNodesDiv.appendChild(div);
  });
}

function draw(){
  ctx.clearRect(0,0,MAP_W,MAP_H);
  // zones
  ctx.fillStyle = "#071216"; ctx.fillRect(0,0,PVP_ZONE,MAP_H);
  ctx.fillStyle = "#0b2628"; ctx.fillRect(PVP_ZONE,0,MAP_W-PVP_ZONE,MAP_H);

  // ground items
  for(const it of groundItems){
    ctx.fillStyle = "#b8860b";
    ctx.fillRect(it.x, it.y, 18, 18);
    ctx.fillStyle = "#fff"; ctx.font = "12px sans-serif";
    ctx.fillText(it.icon||"?", it.x+2, it.y+13);
  }

  // monsters
  for(const m of monsters){
    ctx.fillStyle = m.type === "boss" ? "#7b1fa2" : "#2e7d32";
    ctx.fillRect(m.x, m.y, 20, 20);
    // HP bar
    const hpRatio = Math.max(0, m.hp) / m.maxHp;
    ctx.fillStyle = "red";
    ctx.fillRect(m.x, m.y - 6, 20 * hpRatio, 4);
    ctx.fillStyle = "#fff"; ctx.font = "10px sans-serif";
    ctx.fillText(`${m.type==="boss"?"BOSS":""}`, m.x-2, m.y - 10);
  }

  // players
  for(const id in players){
    const p = players[id];
    ctx.fillStyle = id === playerId ? "#d84315" : "#0277bd";
    ctx.fillRect(p.x, p.y, 20, 20);
    // name above head
    ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif";
    ctx.fillText(p.username || "player", p.x - 2, p.y - 8);
    // HP bar shown above for everyone
    const hpRatio = Math.max(0, p.stats.hp) / (p.stats.maxHp || 20);
    ctx.fillStyle = "red";
    ctx.fillRect(p.x, p.y - 4, 20 * hpRatio, 3);
    // if this is you, show your stats in small text
    if(id === playerId){
      ctx.fillStyle = "#fff"; ctx.font = "10px sans-serif";
      ctx.fillText(`STR:${p.stats.strength} DEF:${p.stats.defense} MAG:${p.stats.magic}`, p.x - 30, p.y + 36);
      ctx.fillText(`HP:${p.stats.hp}/${p.stats.maxHp} SP:${p.skillPoints}`, p.x - 30, p.y + 48);
    }
  }
}

// initial draw loop
setInterval(()=>{ draw(); }, 1000/20);
