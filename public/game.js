const canvas=document.getElementById("game");
const ctx=canvas.getContext("2d");
const ws=new WebSocket("wss://"+location.host);

let playerId=null;
let players={}, monsters=[];
let keys={w:false,a:false,s:false,d:false};
const MAP_WIDTH=800, MAP_HEIGHT=600, PVP_ZONE=400;

let skillTreeVisible=false;

function toggleSkillTree(){
    skillTreeVisible=!skillTreeVisible;
    document.getElementById("skillTree").style.display=skillTreeVisible?"block":"none";
}

// --- Login/Register ---
document.getElementById("loginBtn").onclick=()=>{ login(); };
document.getElementById("registerBtn").onclick=()=>{ register(); };

function login(){
    ws.send(JSON.stringify({type:"login", username:document.getElementById("usernameInput").value, password:document.getElementById("passwordInput").value}));
}
function register(){
    ws.send(JSON.stringify({type:"register", username:document.getElementById("usernameInput").value, password:document.getElementById("passwordInput").value}));
}

// WASD movement
document.addEventListener("keydown", e=>{if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()]=true;});
document.addEventListener("keyup", e=>{if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()]=false;});

function movePlayer(){
    if(!playerId) return;
    const p=players[playerId];
    if(!p) return;
    const speed=p.stats.speed||3;
    if(keys.w) p.y-=speed;
    if(keys.s) p.y+=speed;
    if(keys.a) p.x-=speed;
    if(keys.d) p.x+=speed;

    p.x=Math.max(0,Math.min(MAP_WIDTH-20,p.x));
    p.y=Math.max(0,Math.min(MAP_HEIGHT-20,p.y));

    ws.send(JSON.stringify({type:"update", x:p.x, y:p.y}));
}
setInterval(movePlayer,50);

// Skill upgrade
function upgrade(stat){ ws.send(JSON.stringify({type:"upgrade", stat})); }

// Click to attack
canvas.addEventListener("click", e=>{
    if(!playerId) return;
    const rect=canvas.getBoundingClientRect();
    const mouseX=e.clientX-rect.left;
    const mouseY=e.clientY-rect.top;

    for(const id in players){
        if(id===playerId) continue;
        const p=players[id];
        if(mouseX>=p.x && mouseX<=p.x+20 && mouseY>=p.y && mouseY<=p.y+20){
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
ws.onmessage=msg=>{
    const data=JSON.parse(msg.data);
    if(data.type==="askLogin"){ document.getElementById("login").style.display="block"; }
    if(data.type==="error"){ document.getElementById("loginMsg").innerText=data.message; }
    if(data.type==="registered"){ document.getElementById("loginMsg").innerText="Registered! Login now."; }
    if(data.type==="init"){ playerId=data.id; players=data.players; monsters=data.monsters; document.getElementById("login").style.display="none"; updateHUD(); }
    if(data.type==="state"){ players=data.players; monsters=data.monsters; updateHUD(); draw(); }
};

// Update HUD
function updateHUD(){
    const p=players[playerId]; if(!p) return;
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
        ctx.fillStyle=m.type==="boss"?"purple":"green";
        ctx.fillRect(m.x,m.y,20,20);
        ctx.fillStyle="white"; ctx.font="10px sans-serif";
        ctx.fillText(`HP:${m.hp}`, m.x-5,m.y-5);
    }

    // Players
    for(const id in players){
        const p=players[id];
        ctx.fillStyle=id===playerId?"red":"blue";
        ctx.fillRect(p.x,p.y,20,20);
        ctx.fillStyle="white"; ctx.font="10px sans-serif";
        ctx.fillText(p.username, p.x-5,p.y-10);
        if(id===playerId){
            ctx.fillText(`STR:${p.stats.strength} DEF:${p.stats.defense} MAG:${p.stats.magic} HP:${p.stats.hp}/${p.stats.maxHp}`, p.x-40,p.y+30);
        }
    }
}
