from flask import Flask, render_template
from flask_socketio import SocketIO, send, emit, join_room, leave_room

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

clients = {}  # sid -> username

@app.route('/')
def index():
    return "Chat server is running!"

@socketio.on('join')
def handle_join(data):
    username = data.get('username')
    clients[request.sid] = username
    emit('message', f"🔵 {username} joined the chat.", broadcast=True)

@socketio.on('message')
def handle_message(msg):
    username = clients.get(request.sid, "Unknown")
    emit('message', f"{username}: {msg}", broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    username = clients.get(request.sid, "Unknown")
    emit('message', f"🔴 {username} left the chat.", broadcast=True)
    if request.sid in clients:
        del clients[request.sid]

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5555)
