from flask import Flask
from flask_socketio import SocketIO, send, emit
import eventlet

eventlet.monkey_patch()  # Required for async support

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

clients = {}  # sid -> username

# Handle user joining
@socketio.on('join')
def handle_join(data):
    username = data.get('username', 'Unknown')
    sid = socketio.sid if hasattr(socketio, 'sid') else None
    # Flask-SocketIO automatically provides sid via request.sid
    from flask import request
    sid = request.sid
    clients[sid] = username
    send(f"🔵 {username} joined the chat.", broadcast=True)

# Handle incoming messages
@socketio.on('message')
def handle_message(data):
    from flask import request
    sid = request.sid
    username = clients.get(sid, "Unknown")
    msg = data.get('msg', '')
    send(f"{username}: {msg}", broadcast=True)

# Handle disconnect
@socketio.on('disconnect')
def handle_disconnect():
    from flask import request
    sid = request.sid
    username = clients.pop(sid, "Unknown")
    send(f"🔴 {username} left the chat.", broadcast=True)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000)
