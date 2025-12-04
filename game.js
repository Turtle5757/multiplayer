// === BASIC SETUP ===
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Utilities
function rand(min, max) { return Math.random() * (max-min)+min; }
function distance(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }

// === PLAYER DATA ===
let myId;
let urlParams = new URLSearchParams(window.location.search);

// Host/room system
let roomHost = urlParams.get("host");
let isHost = false;

if (!roomHost) {
    isHost = true;
    roomHost = Math.random().toString(36).substr(2,6);
    window.history.replaceState({}, "", "?host="+roomHost);
}
myId = Math.random().toString(36).substr(2,6);

// HUD Elements
const skillsEl = document.getElementById("skills");
const inventoryEl = document.getElementById("inventory");
const roomInfoEl = document.getElementById("room-info");
const shareLinkEl = document.getElementById("share-link");

roomInfoEl.innerText = "Room ID: " + roomHost;
shareLinkEl.innerText = "Share link: " + window.location.href;

// Player Object
let players = {};
players[myId] = {
    id: myId, x: rand(50,750), y: rand(50,450),
    hp: 100, maxHp:100,
    str:1, def:1, mag:1,
    xp:0, lvl:1, coins:0,
    inventory:[]
};

// === MONSTERS ===
let monsters = [];
function spawnMonster() {
    monsters.push({id:Math.random().toString(36).substr(2,6),
                  x:rand(50,750), y:rand(50,450),
                  hp:40, maxHp:40});
}

// === TRAINING STATIONS ===
let stations = [
    {x:100, y:100, type:"STR"},
    {x:700, y:100, type:"DEF"},
    {x:400, y:400, type:"MAG"}
];

// === PEERJS SETUP ===
const peer = new Peer(myId, {host:"peerjs.com", secure:true, port:443});
let connections = [];

peer.on("connection", conn => {
    connections.push(conn);
    conn.on("data", data => handleNetwork(data));
});

function connectToHost(){
    if(!isHost){
        const conn = peer.connect(roomHost);
        conn.on("open", ()=>{ connections.push(conn); });
        conn.on("data", data=>handleNetwork(data));
    }
}
peer.on("open", ()=>{ if(!isHost) connectToHost(); });

// Broadcast helper
function broadcast(data){
    connections.forEach(c=>c.send(data));
}

// Handle network
function handleNetwork(data){
    if(data.type==="syncPlayer") players[data.player.id] = data.player;
    if(data.type==="playerUpdate") players[data.player.id] = data.player;
    if(data.type==="monsterSync") monsters = data.monsters;
}

// === MOVEMENT ===
document.addEventListener("keydown", e=>{
    const p = players[myId];
    const speed = 4;
    if(e.key==="w") p.y-=speed;
    if(e.key==="s") p.y+=speed;
    if(e.key==="a") p.x-=speed;
    if(e.key==="d") p.x+=speed;
    broadcast({type:"playerUpdate", player:p});
});

// === TRAINING STATIONS INTERACTION ===
document.addEventListener("keydown", e=>{
    if(e.key==="t"){ // press T to train if near station
        const p = players[myId];
        stations.forEach(st=>{
            if(distance(p,st)<30){
                if(st.type==="STR"){ p.str+=0.1; p.xp+=1; }
                if(st.type==="DEF"){ p.def+=0.1; p.xp+=1; }
                if(st.type==="MAG"){ p.mag+=0.1; p.xp+=1; }
            }
        });
        broadcast({type:"playerUpdate", player:players[myId]});
    }
});

// === COMBAT ===
document.addEventListener("mousedown", ()=>{
    const p = players[myId];
    monsters.forEach(m=>{
        if(distance(p,m)<50){
            m.hp -= 10*p.str;
            if(m.hp<=0){
                m.hp=0;
                p.xp+=10;
                p.coins+=5;
                p.inventory.push("Monster Tooth");
                m.x=rand(50,750);
                m.y=rand(50,450);
                m.hp=m.maxHp;
            }
        }
    });

    // FFA PVP
    for(let id in players){
        if(id!==myId){
            const other = players[id];
            if(distance(p,other)<30){
                other.hp-=5*p.str;
                if(other.hp<=0){
                    other.hp=other.maxHp;
                    p.coins+=10; // reward
                }
            }
        }
    }

    broadcast({type:"monsterSync", monsters});
    broadcast({type:"playerUpdate", player:p});
});

// === HOST: spawn monsters periodically ===
if(isHost) setInterval(()=>{ spawnMonster(); broadcast({type:"monsterSync", monsters}); }, 3000);

// === GAME LOOP ===
function updateHUD(){
    const p = players[myId];
    skillsEl.innerText = `STR:${p.str.toFixed(1)} | DEF:${p.def.toFixed(1)} | MAG:${p.mag.toFixed(1)} | Level:${p.lvl} | XP:${p.xp} | Coins:${p.coins}`;
    inventoryEl.innerText = "Inventory: " + p.inventory.join(", ");
}

function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // Draw stations
    stations.forEach(st=>{
        ctx.fillStyle = "yellow";
        ctx.beginPath();
        ctx.arc(st.x, st.y, 15,0,Math.PI*2);
        ctx.fill();
        ctx.fillStyle="white";
        ctx.fillText(st.type, st.x-10, st.y+5);
    });

    // Draw monsters
    monsters.forEach(m=>{
        ctx.fillStyle="red";
        ctx.beginPath();
        ctx.arc(m.x,m.y,15,0,Math.PI*2);
        ctx.fill();
        ctx.fillStyle="white";
        ctx.fillText("HP:"+Math.floor(m.hp), m.x-15, m.y-20);
    });

    // Draw players
    for(let id in players){
        const p = players[id];
        ctx.fillStyle=p.color || "#0f0";
        ctx.fillRect(p.x,p.y,20,20);
        ctx.fillStyle="white";
        ctx.fillText(p.id,p.x-5,p.y-10);
        ctx.fillText("HP:"+Math.floor(p.hp), p.x-5,p.y+35);
    }

    updateHUD();
    requestAnimationFrame(draw);
}
draw();
