from flask import Flask
from flask_socketio import SocketIO

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

clients = {}  # sid -> username

# When a client joins
@socketio.on("join")
def handle_join(username, sid=None):
    # Use the sid passed by Socket.IO
    sid = sid or request.sid
    clients[sid] = username
    print(f"{username} joined.")
    socketio.emit("message", f"🔵 {username} joined the chat.")

# When a client sends a message
@socketio.on("message")
def handle_message(msg, sid=None):
    sid = sid or request.sid
    username = clients.get(sid, "Unknown")
    print(f"{username}: {msg}")
    socketio.emit("message", f"{username}: {msg}", skip_sid=sid)

# When a client disconnects
@socketio.on("disconnect")
def handle_disconnect(sid=None):
    sid = sid or request.sid
    username = clients.pop(sid, "Unknown")
    print(f"{username} disconnected.")
    socketio.emit("message", f"🔴 {username} left the chat.")

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
