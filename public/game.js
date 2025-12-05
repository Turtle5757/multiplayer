const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ws = new WebSocket("wss://" + location.host);

let playerId = null;
let players = {};
let monsters = {};

const keys = { w: false, a: false, s: false, d: false };

// Movement
document.addEventListener("keydown", e => { if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = true; });
document.addEventListener("keyup", e => { if(e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = false; });

function movePlayer() {
    if (!playerId) return;
    const p = players[playerId];
    if (!p) return;
    let speed = p.stats.speed || 3;
    if (keys.w) p.y -= speed;
    if (keys.s) p.y += speed;
    if (keys.a) p.x -= speed;
    if (keys.d) p.x += speed;

    ws.send(JSON.stringify({ type: "update", x: p.x, y: p.y }));
}

setInterval(movePlayer, 50); // smooth movement

// Training
function train(stat) {
    ws.send(JSON.stringify({ type: "train", stat }));
}

// PvP
canvas.addEventListener("click", e => {
    if (!playerId) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    for (const id in players) {
        if (id === playerId) continue;
        const p = players[id];
        if (mouseX >= p.x && mouseX <= p.x+20 && mouseY >= p.y && mouseY <= p.y+20) {
            ws.send(JSON.stringify({ type: "attack", targetId: id }));
        }
    }
});

// WebSocket messages
ws.onmessage = msg => {
    const data = JSON.parse(msg.data);
    if (data.type === "init") {
        playerId = data.id;
        players = data.players;
        monsters = data.monsters;
    }
    if (data.type === "state") {
        players = data.players;
        monsters = data.monsters;
    }
    draw();
};

// Draw everything
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw monsters
    for (const m of monsters) {
        ctx.fillStyle = m.type === "boss" ? "purple" : "green";
        ctx.fillRect(m.x, m.y, 20, 20);
        ctx.fillStyle = "white";
        ctx.font = "10px sans-serif";
        ctx.fillText(`HP:${m.hp}`, m.x-5, m.y-5);
    }

    // Draw players
    for (const id in players) {
        const p = players[id];
        ctx.fillStyle = id === playerId ? "red" : "blue";
        ctx.fillRect(p.x, p.y, 20, 20);

        ctx.fillStyle = "white";
        ctx.font = "10px sans-serif";
        ctx.fillText(`STR:${p.stats.strength} DEF:${p.stats.defense} MAG:${p.stats.magic} HP:${p.stats.hp}`, p.x-10, p.y-5);
    }
}
