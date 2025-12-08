// client: game.js
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);

let myId = null;
let players = {}, monsters = [], groundItems = [];

const openInvBtn = document.getElementById("openInv");
const openSkillBtn = document.getElementById("openSkill");
const invPanel = document.getElementById("inventoryPanel");
const skillPanel = document.getElementById("skillPanel");
const invSlotsDiv = document.getElementById("invSlots");
const skillNodesDiv = document.getElementById("skillNodes");

openInvBtn.onclick = ()=> invPanel.style.display = invPanel.style.display === "none" ? "block" : "none";
document.getElementById("closeInv").onclick = ()=> invPanel.style.display = "none";
openSkillBtn.onclick = ()=> { renderSkillNodes(); skillPanel.style.display = skillPanel.style.display === "none" ? "block" : "none"; };
document.getElementById("closeSkill").onclick = ()=> skillPanel.style.display = "none";

// ask for name and join
ws.onopen = ()=> {
  const name = prompt("Enter username (or leave blank for random)");
  ws.send(JSON.stringify({ type:"join", name: name || "" }));
};

ws.onmessage = evt => {
  const data = JSON.parse(evt.data);
  if(data.type === "askName"){
    // server will prompt on open; ignore
    return;
  }
  if(data.type === "joined"){
    myId = data.id;
    return;
  }
  if(data.type === "state"){
    players = data.players;
    monsters = data.monsters;
    groundItems = data.groundItems || [];
    updateHUD();
    renderInventory();
    return;
  }
};

// controls
let keys = { w:false,a:false,s:false,d:false };
document.addEventListener("keydown", e => { if(keys[e.key] !== undefined) keys[e.key] = true; });
document.addEventListener("keyup", e => { if(keys[e.key] !== undefined) keys[e.key] = false; });

function sendMove(x,y){
  ws.send(JSON.stringify({ type:"move", x, y }));
}
function sendAttack(){ ws.send(JSON.stringify({ type:"attack" })); }
function sendPickup(){ ws.send(JSON.stringify({ type:"pickup" })); }
function sendEquip(itemId){ ws.send(JSON.stringify({ type:"equip", itemId })); }
function sendDrop(itemId){ ws.send(JSON.stringify({ type:"drop", itemId })); }
function buySkill(node){ ws.send(JSON.stringify({ type:"buySkill", node })); }

// main loop
setInterval(()=>{
  const me = players[myId];
  if(!me) return;
  const speed = me.stats.speed || 3;
  let moved = false;
  if(keys.w){ me.y -= speed; moved = true; }
  if(keys.s){ me.y += speed; moved = true; }
  if(keys.a){ me.x -= speed; moved = true; }
  if(keys.d){ me.x += speed; moved = true; }
  me.x = Math.max(0, Math.min(canvas.width-20, me.x));
  me.y = Math.max(0, Math.min(canvas.height-20, me.y));
  if(moved) ws.send(JSON.stringify({ type:"move", x: me.x, y: me.y }));
  // auto-pickup if near item
  for(const it of groundItems){
    const d = Math.hypot(it.x - me.x, it.y - me.y);
    if(d <= 20){ sendPickup(); break; }
  }
}, 60);

// click handler: attack monsters or pick up explicit
canvas.addEventListener("click", e=>{
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  // check ground items
  for(const it of groundItems){
    if(mx >= it.x && mx <= it.x+18 && my >= it.y && my <= it.y+18){
      sendPickup();
      return;
    }
  }
  // check monsters
  for(const m of monsters){
    if(mx >= m.x && mx <= m.x+20 && my >= m.y && my <= m.y+20){
      sendAttack();
      return;
    }
  }
  // clicking empty space does nothing
});

// HUD update
function updateHUD(){
  const me = players[myId];
  if(!me) return;
  document.getElementById("level").innerText = me.level;
  document.getElementById("xp").innerText = me.xp;
  document.getElementById("gold").innerText = me.gold;
  document.getElementById("skillPts").innerText = me.skillPoints;
}

// Inventory UI (5 slots)
function renderInventory(){
  invSlotsDiv.innerHTML = "";
  const me = players[myId];
  if(!me) {
    for(let i=0;i<5;i++){ const s=document.createElement("div"); s.className="slot"; invSlotsDiv.appendChild(s);} 
    return;
  }
  // show either current items or empty slots
  for(let i=0;i<5;i++){
    const slot = document.createElement("div");
    slot.className = "slot";
    const it = me.inventory[i];
    if(it){
      slot.innerHTML = `<div style="text-align:center">${it.icon||"?"}<div style="font-size:11px">${it.name}</div><div style="font-size:11px;color:#ccc">${it.rarity||"Common"}</div></div>`;
      slot.onclick = ()=> {
        // equip/use/drop options
        const action = prompt("Type: equip/use/drop (or cancel)");
        if(!action) return;
        if(action === "equip") sendEquip(it.id);
        else if(action === "use") sendEquip(it.id); // server treats potion via equip path as use
        else if(action === "drop") sendDrop(it.id);
      };
    } else {
      slot.innerText = "";
    }
    invSlotsDiv.appendChild(slot);
  }
}

// Skill tree UI
const SKILL_NODES = [
  { id:"STR1", label:"STR +1", desc:"+1 Strength", cost:1, req:0 },
  { id:"DEF1", label:"DEF +1", desc:"+1 Defense", cost:1, req:0 },
  { id:"MAG1", label:"MAG +1", desc:"+1 Magic", cost:1, req:0 },
  { id:"HP1",  label:"MaxHP +5", desc:"+5 Max HP", cost:1, req:1 },
  { id:"SPD1", label:"Speed +0.5", desc:"+0.5 Speed", cost:1, req:2 }
];

function renderSkillNodes(){
  skillNodesDiv.innerHTML = "";
  const me = players[myId];
  for(const n of SKILL_NODES){
    const d = document.createElement("div");
    d.className = "skillNode";
    d.innerHTML = `<strong>${n.label}</strong><div class="small">${n.desc}</div><div class="small">Cost:${n.cost}</div>`;
    const locked = (me && me.level < (n.req+1)) || (me && me.skillPoints < n.cost);
    if(locked) d.classList.add("locked");
    d.onclick = ()=> {
      if(!me){ alert("not ready"); return; }
      if(me.skillPoints < n.cost) { alert("Not enough skill points"); return; }
      ws.send(JSON.stringify({ type:"buySkill", node: n.id }));
    };
    skillNodesDiv.appendChild(d);
  }
}

// draw loop
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // zones
  ctx.fillStyle = "#102226"; ctx.fillRect(0,0,400,canvas.height); // safe/pvp left
  ctx.fillStyle = "#07323b"; ctx.fillRect(400,0,canvas.width-400,canvas.height);

  // ground items
  for(const it of groundItems){
    ctx.fillStyle = "#b57b2e";
    ctx.fillRect(it.x, it.y, 18, 18);
    ctx.fillStyle = "#fff"; ctx.font = "12px sans-serif";
    ctx.fillText(it.icon||"?", it.x+2, it.y+13);
  }

  // monsters
  for(const m of monsters){
    ctx.fillStyle = m.type === "boss" ? "#7b1fa2" : "#2e7d32";
    ctx.fillRect(m.x, m.y, 20, 20);
    // hp bar
    const hpRatio = Math.max(0,m.hp)/m.maxHp;
    ctx.fillStyle = "red";
    ctx.fillRect(m.x, m.y - 6, 20*hpRatio, 4);
    ctx.fillStyle = "#fff"; ctx.font = "10px sans-serif";
    if(m.type==="boss") ctx.fillText("BOSS", m.x-2, m.y-8);
  }

  // players
  for(const pid in players){
    const p = players[pid];
    ctx.fillStyle = pid === myId ? "#e65100" : "#0288d1";
    ctx.fillRect(p.x, p.y, 20, 20);
    ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif";
    ctx.fillText(p.name, p.x - 2, p.y - 8);
    // hp bar
    const hpRatio = Math.max(0,p.stats.hp)/p.stats.maxHp;
    ctx.fillStyle = "red";
    ctx.fillRect(p.x, p.y - 4, 20*hpRatio, 3);
    // show brief stats for yourself
    if(pid === myId){
      ctx.fillStyle = "#fff"; ctx.font = "10px sans-serif";
      ctx.fillText(`STR:${p.stats.strength} DEF:${p.stats.defense} MAG:${p.stats.magic} HP:${p.stats.hp}/${p.stats.maxHp}`, p.x - 60, p.y + 36);
    }
  }

  requestAnimationFrame(draw);
}
draw();
