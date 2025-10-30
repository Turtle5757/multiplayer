from flask import Flask, request
from flask_socketio import SocketIO, send

# IMPORTANT: Do not monkey patch on Render — use gevent instead of eventlet
# eventlet.monkey_patch()

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'

# Use gevent instead of eventlet for better compatibility on Render
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="gevent")

clients = {}  # sid -> username


@socketio.on('join')
def handle_join(data):
    username = data.get('username', 'Unknown')
    sid = request.sid
    clients[sid] = username
    send(f"🔵 {username} joined the chat.", broadcast=True)


@socketio.on('message')
def handle_message(data):
    sid = request.sid
    username = clients.get(sid, "Unknown")
    msg = data.get('msg', '')
    send(f"{username}: {msg}", broadcast=True)


@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    username = clients.pop(sid, "Unknown")
    send(f"🔴 {username} left the chat.", broadcast=True)


if __name__ == '__main__':
    # Render sets PORT as an environment variable
    import os
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host='0.0.0.0', port=port)
