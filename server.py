from flask import Flask
from flask_socketio import SocketIO, send
import eventlet

eventlet.monkey_patch()  # Required for async support on Render

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

clients = {}  # sid -> username

# Handle user joining
@socketio.on('join')
def handle_join(data):
    username = data.get('username', 'Unknown')
    clients[socketio.sid] = username
    send(f"🔵 {username} joined the chat.", broadcast=True)

# Handle incoming messages
@socketio.on('message')
def handle_message(data):
    sid = socketio.sid
    username = clients.get(sid, "Unknown")
    msg = data.get('msg', '')
    send(f"{username}: {msg}", broadcast=True)

# Handle disconnect
@socketio.on('disconnect')
def handle_disconnect():
    sid = socketio.sid
    username = clients.pop(sid, "Unknown")
    send(f"🔴 {username} left the chat.", broadcast=True)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000)
