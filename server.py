from flask import Flask, render_template
from flask_socketio import SocketIO, send

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
# Use threading mode instead of eventlet or gevent
socketio = SocketIO(app, async_mode='threading')

@app.route('/')
def index():
    return "Server is running!"

@socketio.on('message')
def handle_message(msg):
    print(f"Message: {msg}")
    send(msg, broadcast=True)

if __name__ == '__main__':
    # Render sets PORT in env variables
    import os
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)
