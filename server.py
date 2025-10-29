import socket
import threading

HOST = "0.0.0.0"
PORT = 5555

clients = {}  # conn -> username

def broadcast(message, sender_conn=None):
    """Send message to all connected clients."""
    for conn in list(clients.keys()):
        if conn != sender_conn:
            try:
                conn.send(message.encode())
            except:
                conn.close()
                del clients[conn]

def handle_client(conn, addr):
    """Handle incoming messages from a client."""
    username = conn.recv(1024).decode()
    clients[conn] = username
    print(f"{username} connected from {addr}")
    broadcast(f"🔵 {username} joined the chat.")
    conn.send("Connected to the server!\n".encode())

    while True:
        try:
            msg = conn.recv(1024).decode()
            if not msg or msg.lower() == "/quit":
                break
            print(f"{username}: {msg}")
            broadcast(f"{username}: {msg}", conn)
        except:
            break

    print(f"{username} disconnected.")
    broadcast(f"🔴 {username} left the chat.")
    conn.close()
    del clients[conn]

# Start server
def start_server():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind((HOST, PORT))
    s.listen()
    print(f"💬 Server started on {HOST}:{PORT}")

    while True:
        conn, addr = s.accept()
        threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()

if __name__ == "__main__":
    start_server()
