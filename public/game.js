const canvas=document.getElementById("game");
const ctx=canvas.getContext("2d");

const ws = new WebSocket("wss://"+location.host);

let playerId=null;
let players={}, monsters=[];
const keys={w:false,a:false,s:false,d:false};
const MAP_WIDTH=800, MAP_HEIGHT=600, PVP_ZONE=400;

// --- Username ---
document.getElementById("startBtn").onclick = () => {
    const username = document.getElementById("usernameInput").value || "Player";
    ws.send(JSON.stringify({type:"setName", username}));
    document.getElementById("usernamePrompt").style.display="none";
};

// WASD movement
document.addEventListener("keydown", e=>{if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()]=true;});
document.addEventListener("keyup", e=>{if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()]=false;});

function movePlayer(){
    if(!playerId) return;
    const p = players[playerId];
    if(!p) return;
    const speed = p.stats.speed || 3;
    if(keys.w) p.y -= speed;
    if(keys.s) p.y += speed;
    if(keys.a) p.x -= speed;
    if(keys.d) p.x += speed;

    // Map boundaries
    p.x = Math.max(0, Math.min(MAP_WIDTH-20,p.x));
    p.y = Math.max(0, Math.min(MAP_HEIGHT-20,p.y));

    ws.send(JSON.stringify({type:"update", x:p.x, y:p.y}));

    // Training stations
    if(p.x > PVP_ZONE){
        if(p.y>50 && p.y<100) train('strength');
        if(p.y>150 && p.y<200) train('defense');
        if(p.y>250 && p.y<300) train('magic');
        if(p.y>350 && p.y<400) train('hp');
    }
}
setInterval(movePlayer,50);

// Training
function train(stat){ ws.send(JSON.stringify({type:"train", stat})); }

// Skill tree upgrade
function upgrade(stat){ ws.send(JSON.stringify({type:"upgrade", stat})); }

// Click to attack
canvas.addEventListener("click", e=>{
    if(!playerId) return;
    const rect=canvas.getBoundingClientRect();
    const mouseX=e.clientX-rect.left;
    const mouseY=e.clientY-rect.top;

    for(const id in players){
        if(id===playerId) continue;
        const p = players[id];
        if(p.x<PVP_ZONE && mouseX>=p.x && mouseX<=p.x+20 && mouseY>=p.y && mouseY<=p.y+20){
            ws.send(JSON.stringify({type:"attack", targetId:id}));
        }
    }

    for(const m of monsters){
        if(mouseX>=m.x && mouseX<=m.x+20 && mouseY>=m.y && mouseY<=m.y+20){
            ws.send(JSON.stringify({type:"attackMonster", monsterId:m.id}));
        }
    }
});

// WebSocket messages
ws.onmessage = msg=>{
    const data = JSON.parse(msg.data);
    if(data.type==="askName"){ return; }
    if(data.type==="init"){ playerId=data.id; players=data.players; monsters=data.monsters; updateHUD(); }
    if(data.type==="state"){ players=data.players; monsters=data.monsters; updateHUD(); }
    draw();
};

// Update HUD
function updateHUD(){
    const p = players[playerId];
    if(!p) return;
    document.getElementById("level").innerText=p.level;
    document.getElementById("xp").innerText=p.xp;
    document.getElementById("gold").innerText=p.gold;
    document.getElementById("skillPts").innerText=p.skillPoints;
}

// Draw
function draw(){
    ctx.clearRect(0,0,MAP_WIDTH,MAP_HEIGHT);

    // Zones
    ctx.fillStyle="#222"; ctx.fillRect(0,0,PVP_ZONE,MAP_HEIGHT);
    ctx.fillStyle="#333"; ctx.fillRect(PVP_ZONE,0,MAP_WIDTH-PVP_ZONE,MAP_HEIGHT);

    // Monsters
    for(const m of monsters){
        ctx.fillStyle = m.type==="boss"?"purple":"green";
        ctx.fillRect(m.x,m.y,20,20);
        ctx.fillStyle="white"; ctx.font="10px sans-serif";
        ctx.fillText(`HP:${m.hp}`, m.x-5,m.y-5);
    }

    // Players
    for(const id in players){
        const p = players[id];
        ctx.fillStyle = id===playerId?"red":"blue";
        ctx.fillRect(p.x,p.y,20,20);
        ctx.fillStyle="white"; ctx.font="10px sans-serif";
        ctx.fillText(p.username, p.x-5, p.y-10);
        ctx.fillText(`STR:${p.stats.strength} DEF:${p.stats.defense} MAG:${p.stats.magic} HP:${p.stats.hp}`, p.x-10, p.y+30);
    }
}
