// === BASIC CANVAS SETUP ===
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

// === PLAYER ===
let myId = Math.random().toString(36).substr(2, 5);
let players = {};

players[myId] = {
    id: myId,
    x: rand(50, 750),
    y: rand(50, 450),
    hp: 100,
    maxHp: 100,
    str: 1,
    def: 1,
    xp: 0,
    lvl: 1,
    color: "#" + Math.floor(Math.random() * 16777215).toString(16),
    inventory: []
};

// === MONSTERS ===
let monsters = [];

function spawnMonster() {
    monsters.push({
        id: Math.random().toString(36).substr(2, 6),
        x: rand(50, 750),
        y: rand(50, 450),
        hp: 40,
        maxHp: 40
    });
}

setInterval(spawnMonster, 3000);

// === PeerJS Multiplayer ===
const peer = new Peer(myId, { host: "peerjs.com", secure: true, port: 443 });

peer.on("connection", conn => {
    conn.on("data", data => handleNetwork(data));
});

function connectTo(id) {
    const c = peer.connect(id);
    c.on("open", () => c.send({ type: "syncPlayer", player: players[myId] }));
    c.on("data", data => handleNetwork(data));
}

peer.on("open", () => {
    if (location.search.includes("?join=")) {
        let other = location.search.replace("?join=", "");
        connectTo(other);
    }
    history.replaceState({}, "", "?join=" + myId);
});

// === Send state to others ===
function broadcast(data) {
    for (let id in peer.connections) {
        peer.connections[id].forEach(conn => conn.send(data));
    }
}

// === HANDLE MULTIPLAYER EVENTS ===
function handleNetwork(data) {
    if (data.type === "syncPlayer") {
        players[data.player.id] = data.player;
    }
    if (data.type === "playerUpdate") {
        players[data.player.id] = data.player;
    }
    if (data.type === "monsterSync") {
        monsters = data.monsters;
    }
}

// === MOVEMENT ===
document.addEventListener("keydown", e => {
    let p = players[myId];
    const speed = 4;

    if (e.key === "w") p.y -= speed;
    if (e.key === "s") p.y += speed;
    if (e.key === "a") p.x -= speed;
    if (e.key === "d") p.x += speed;

    broadcast({ type: "playerUpdate", player: p });
});

// === COMBAT ===
document.addEventListener("mousedown", () => {
    let p = players[myId];

    monsters.forEach(m => {
        let dist = Math.hypot(p.x - m.x, p.y - m.y);
        if (dist < 50) {
            m.hp -= rand(5, 10) * p.str;

            // Monster dies
            if (m.hp <= 0) {
                p.xp += 10;
                m.hp = 0;

                // Item drop
                p.inventory.push("Monster Tooth");
                p.str += 0.1;

                // Respawn
                m.x = rand(50, 750);
                m.y = rand(50, 450);
                m.hp = m.maxHp;
            }
        }
    });

    broadcast({ type: "monsterSync", monsters });
    broadcast({ type: "playerUpdate", player: p });
});

// === DRAW GAME ===
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw monsters
    monsters.forEach(m => {
        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(m.x, m.y, 15, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.fillText("HP: " + m.hp, m.x - 15, m.y - 20);
    });

    // Draw players
    for (let id in players) {
        let p = players[id];

        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 20, 20);

        ctx.fillStyle = "white";
        ctx.fillText(id, p.x - 5, p.y - 10);
        ctx.fillText("HP " + p.hp, p.x - 5, p.y + 35);
    }

    requestAnimationFrame(draw);
}
draw();
