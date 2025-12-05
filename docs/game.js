// WebSocket connection to your Render backend
const ws = new WebSocket("wss://multiplayer-qetn.onrender.com");

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

// Movement controls
document.addEventListener("keydown", (e) => {
    if (!playerId) return;

    let update = { ...players[playerId] };

    if (e.key === "ArrowUp") update.y -= 5;
    if (e.key === "ArrowDown") update.y += 5;
    if (e.key === "ArrowLeft") update.x -= 5;
    if (e.key === "ArrowRight") update.x += 5;

    ws.send(JSON.stringify({
        type: "update",
        update
    }));
});

function draw() {
    const c = document.getElementById("game").getContext("2d");
    c.clearRect(0, 0, 800, 600);

    for (let id in players) {
        const p = players[id];
        c.fillStyle = id === playerId ? "red" : "blue";
        c.fillRect(p.x, p.y, 20, 20);
    }
}
