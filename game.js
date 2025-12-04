// === BASIC CANVAS SETUP ===
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

// === PLAYER ===
let myId;
let urlParams = new URLSearchParams(window.location.search);

if (!urlParams.get("join")) {
    myId = Math.random().toString(36).substr(2, 6);
    window.history.replaceState({}, "", "?join=" + myId);
} else {
    myId = urlParams.get("join");
}

// Display the shareable link
const shareLinkEl = document.getElementById("share-link");
shareLinkEl.innerText = "Share this link for multiplayer:\n" + window.location.href;

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

// === PEERJS MULTIPLAYER ===
const peer = new Peer(myId, { host: "peerjs.com", secure: true, port: 443 });

peer.on("connection", conn => {
    conn.on("data", data => handleNetwork(data));
});

function connectTo(id) {
    const conn = peer.connect(id);
    conn.on("open", () => {
        conn.send({ type: "syncPlayer", player: players[myId] });
    });
    conn.on("data", data => handleNetwork(data));
}

peer.on("open", () => {
    // Try to connect to any join ID in the URL that isn't self
    let otherId = urlParams.get("join");
    if (otherId && otherId !== myId) {
        connectTo(otherId);
    }
});

// === HANDLE NETWORK EVENTS ===
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
        if (Math.hypot(p.x - m.x, p.y - m.y) < 50) {
            m.hp -= 10 * p.str;

            if (m.hp <= 0) {
                m.hp = 0;
                p.xp += 10;
                p.inventory.push("Monster Tooth");
                p.str += 0.1;

                // Respawn monster
                m.x = rand(50, 750);
                m.y = rand(50, 450);
                m.hp = m.maxHp;
            }
        }
    });

    broadcast({ type: "monsterSync", monsters });
    broadcast({ type: "playerUpdate", player: p });
});

// === BROADCAST FUNCTION ===
function broadcast(data) {
    for (let id in peer.connections) {
        peer.connections[id].forEach(conn => conn.send(data));
    }
}

// === GAME LOOP ===
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw monsters
    monsters.forEach(m => {
        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(m.x, m.y, 15, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.fillText("HP: " + Math.floor(m.hp), m.x - 15, m.y - 20);
    });

    // Draw players
    for (let id in players) {
        let p = players[id];
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 20, 20);

        ctx.fillStyle = "white";
        ctx.fillText(p.id, p.x - 5, p.y - 10);
        ctx.fillText("HP: " + Math.floor(p.hp), p.x - 5, p.y + 35);
    }

    requestAnimationFrame(draw);
}
draw();
