const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ws = new WebSocket("wss://" + location.host);

let playerId = null;
let players = {};

ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === "init") {
        playerId = data.id;
        players = data.players;
    }

    if (data.type === "players") {
        players = data.players;
    }

    draw();
};

function train(stat) {
    ws.send(JSON.stringify({ type: "train", stat }));
}

// Movement
document.addEventListener("keydown", (e) => {
    if (!playerId) return;
    const update = { ...players[playerId] };

    if (e.key === "ArrowUp") update.y -= 5;
    if (e.key === "ArrowDown") update.y += 5;
    if (e.key === "ArrowLeft") update.x -= 5;
    if (e.key === "ArrowRight") update.x += 5;

    ws.send(JSON.stringify({ type: "update", update }));
});

// Attack on click
canvas.addEventListener("click", (e) => {
    if (!playerId) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    for (const id in players) {
        if (id === playerId) continue;
        const p = players[id];
        if (mouseX >= p.x && mouseX <= p.x + 20 &&
            mouseY >= p.y && mouseY <= p.y + 20) {
            ws.send(JSON.stringify({ type: "attack", targetId: id }));
        }
    }
});

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const id in players) {
        const p = players[id];
        ctx.fillStyle = id === playerId ? "red" : "blue";
        ctx.fillRect(p.x, p.y, 20, 20);

        ctx.fillStyle = "white";
        ctx.font = "10px sans-serif";
        ctx.fillText(`STR:${p.stats.strength} DEF:${p.stats.defense} MAG:${p.stats.magic} HP:${p.stats.hp}`, p.x-10, p.y-5);
    }
}
