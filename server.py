import socket
import threading

HOST = "0.0.0.0"  # Render requires 0.0.0.0 to accept external connections
PORT = 5555

clients = {}  # conn -> username
clients_lock = threading.Lock()  # Thread-safe access to clients dict

def broadcast(message, sender_conn=None):
    """Send message to all connected clients."""
    with clients_lock:
        for conn in list(clients.keys()):
            if conn != sender_conn:
                try:
                    conn.send(message.encode())
                except:
                    conn.close()
                    del clients[conn]

def handle_client(conn, addr):
    """Handle a single client connection."""
    try:
        # Receive username
        username = conn.recv(1024).decode().strip()
        if not username:
            conn.close()
            return

        with clients_lock:
            clients[conn] = username

        print(f"{username} connected from {addr}")
        broadcast(f"🔵 {username} joined the chat.", conn)
        conn.send("✅ Connected to the server!\n".encode())

        while True:
            msg = conn.recv(1024).decode().strip()
            if not msg or msg.lower() == "/quit":
                break
            print(f"{username}: {msg}")
            broadcast(f"{username}: {msg}", conn)

    except Exception as e:
        print(f"Error with {addr}: {e}")

    finally:
        with clients_lock:
            if conn in clients:
                print(f"{clients[conn]} disconnected.")
                broadcast(f"🔴 {clients[conn]} left the chat.", conn)
                del clients[conn]
        conn.close()

def start_server():
    """Start the chat server."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind((HOST, PORT))
    s.listen()
    print(f"💬 Server started on {HOST}:{PORT}")

    while True:
        conn, addr = s.accept()
        threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()

if __name__ == "__main__":
    start_server()
