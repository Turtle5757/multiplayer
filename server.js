const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");
let accounts = {};
if (fs.existsSync(ACCOUNTS_FILE)) accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE));

setInterval(() => fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2)), 5000);

let players = {};
let monsters = [];
const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const PVP_ZONE = 400;

function spawnMonster(type="monster"){
    return {
        id: Date.now() + Math.random(),
        x: 410 + Math.random()*(MAP_WIDTH-410),
        y: 10 + Math.random()*(MAP_HEIGHT-10),
        type,
        hp: type==="boss"?50:20,
        maxHp: type==="boss"?50:20,
        attack: type==="boss"?5:2,
        speed: type==="boss"?1.5:1,
        xpReward: type==="boss"?20:10,
        goldReward: type==="boss"?20:5
    };
}

// Spawn monsters
for(let i=0;i<5;i++) monsters.push(spawnMonster());
monsters.push(spawnMonster("boss"));

// Broadcast state
function broadcast(){
    const data = JSON.stringify({ type:"state", players, monsters });
    wss.clients.forEach(c=>c.readyState===WebSocket.OPEN && c.send(data));
}

// Monster AI
function updateMonsters(){
    for(let m of monsters){
        let nearest=null,minDist=Infinity;
        for(let id in players){
            const p=players[id];
            if(p.x<PVP_ZONE) continue; // PvE only
            const dist=Math.hypot(p.x-m.x,p.y-m.y);
            if(dist<minDist){ nearest=p; minDist=dist; }
        }
        if(nearest){
            const dx=nearest.x-m.x, dy=nearest.y-m.y;
            const dist=Math.hypot(dx,dy);
            if(dist>0){ m.x += dx/dist*m.speed; m.y += dy/dist*m.speed; }
            if(dist<20){
                nearest.stats.hp -= m.attack;
                if(nearest.stats.hp<=0) resetPlayer(nearest);
            }
        }
    }
    broadcast();
}
setInterval(updateMonsters,100);

// Reset player on death
function resetPlayer(p){
    p.x=Math.random()*PVP_ZONE;
    p.y=Math.random()*MAP_HEIGHT;
    p.stats={strength:5,defense:5,magic:5,hp:20,maxHp:20,speed:3,meleeRange:30,range:50};
    p.level=1; p.xp=0; p.skillPoints=0; p.gold=0; p.inventory=[];
}

// Level up
function checkLevelUp(p){
    if(p.xp>=20){ p.level+=1; p.skillPoints+=1; p.xp=0; }
}

// Save player to account
function savePlayer(id){
    const p=players[id]; if(!p) return;
    const acc=accounts[p.username];
    if(acc){
        acc.stats={...p.stats};
        acc.level=p.level; acc.xp=p.xp; acc.skillPoints=p.skillPoints;
        acc.gold=p.gold; acc.inventory=[...p.inventory];
    }
}

// WebSocket connections
wss.on("connection", ws=>{
    ws.send(JSON.stringify({type:"askLogin"}));

    ws.on("message", msg=>{
        const data=JSON.parse(msg);
        if(data.type==="register"){
            if(accounts[data.username]){ ws.send(JSON.stringify({type:"error", message:"Username exists"})); return; }
            const hash=bcrypt.hashSync(data.password,10);
            accounts[data.username]={password:hash, stats:{strength:5,defense:5,magic:5,hp:20,maxHp:20,speed:3,meleeRange:30,range:50},xp:0,level:1,skillPoints:0,gold:0,inventory:[]};
            ws.send(JSON.stringify({type:"registered"}));
            return;
        }

        if(data.type==="login"){
            const acc=accounts[data.username];
            if(!acc || !bcrypt.compareSync(data.password,acc.password)){
                ws.send(JSON.stringify({type:"error", message:"Invalid login"}));
                return;
            }
            const id=Date.now()+Math.random();
            players[id]={username:data.username, x:Math.random()*PVP_ZONE, y:Math.random()*MAP_HEIGHT, stats:{...acc.stats}, xp:acc.xp, level:acc.level, skillPoints:acc.skillPoints, gold:acc.gold, inventory:[...acc.inventory]};
            ws.playerId=id; ws.username=data.username;
            ws.send(JSON.stringify({type:"init", id, players, monsters}));
            broadcast(); return;
        }

        if(ws.playerId && data.type){
            const player=players[ws.playerId]; if(!player) return;

            // Movement
            if(data.type==="update"){
                player.x=Math.max(0,Math.min(MAP_WIDTH-20,data.x??player.x));
                player.y=Math.max(0,Math.min(MAP_HEIGHT-20,data.y??player.y));
            }

            // Training
            if(data.type==="train"){
                if(data.stat==="hp"){ player.stats.maxHp+=2; player.stats.hp=Math.min(player.stats.hp+5,player.stats.maxHp);}
                else{ player.stats[data.stat]+=1; }
                player.xp+=5; checkLevelUp(player);
            }

            // Skill upgrades
            if(data.type==="upgrade" && data.stat && player.skillPoints>0){
                player.stats[data.stat]+=1; player.skillPoints-=1;
            }

            // Equip/Use Item
            if(data.type==="equipItem"){
                const item=player.inventory.find(it=>it.name===data.name);
                if(item){
                    if(item.type==="weapon") player.inventory.forEach(it=>{if(it.type==="weapon") it.equipped=false;}); // unequip others
                    if(item.type==="armor") player.inventory.forEach(it=>{if(it.type==="armor") it.equipped=false;});
                    item.equipped=true;
                }
            }
            if(data.type==="useItem"){
                const item=player.inventory.find(it=>it.name===data.name);
                if(item && item.type==="potion"){ player.stats.hp=Math.min(player.stats.hp+item.heal,player.stats.maxHp); player.inventory=player.inventory.filter(it=>it!==item); }
            }

            // PvP attack
            if(data.type==="attack"){
                const target=players[data.targetId];
                if(target && target.x<PVP_ZONE){
                    const dx=player.x-target.x, dy=player.y-target.y;
                    const dist=Math.hypot(dx,dy);
                    if(dist<=player.stats.meleeRange){
                        let weaponBonus=0;
                        const w=player.inventory.find(it=>it.type==="weapon" && it.equipped); if(w) weaponBonus=w.strength||0;
                        const dmg=Math.max(player.stats.strength+weaponBonus-target.stats.defense,1);
                        target.stats.hp-=dmg;
                        if(target.stats.hp<=0) resetPlayer(target);
                    }
                }
            }

            // Attack monsters
            if(data.type==="attackMonster"){
                const monster=monsters.find(m=>m.id===data.monsterId);
                if(monster){
                    const dx=player.x-monster.x, dy=player.y-monster.y;
                    const dist=Math.hypot(dx,dy);
                    if(dist<=player.stats.meleeRange){
                        let weaponBonus=0;
                        const w=player.inventory.find(it=>it.type==="weapon" && it.equipped); if(w) weaponBonus=w.strength||0;
                        monster.hp-=player.stats.strength+weaponBonus;
                        if(monster.hp<=0){
                            player.xp+=monster.xpReward; player.gold+=monster.goldReward; checkLevelUp(player);
                            monsters[monsters.indexOf(monster)]=spawnMonster(monster.type);
                        }
                    }
                }
            }

            broadcast();
        }
    });

    ws.on("close", ()=>{
        if(ws.playerId){
            savePlayer(ws.playerId);
            delete players[ws.playerId];
            broadcast();
        }
    });
});

server.listen(process.env.PORT||10000,"0.0.0.0",()=>console.log("Server running"));
