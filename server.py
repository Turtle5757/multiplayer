import socket
import threading

HOST = "0.0.0.0"
PORT = 5555

clients = {}  # socket -> username

def broadcast(message, sender_socket=None):
    for client in clients:
        if client != sender_socket:
            try:
                client.send(message.encode())
            except:
                client.close()
                del clients[client]

def handle_client(conn, addr):
    try:
        conn.send("USERNAME".encode())  # ask client for username
        username = conn.recv(1024).decode().strip()
        clients[conn] = username
        broadcast(f"[{username}] joined the chat.")
        print(f"[NEW CONNECTION] {username} ({addr}) connected.")
    except:
        conn.close()
        return

    while True:
        try:
            msg = conn.recv(1024)
            if not msg:
                break
            decoded = msg.decode().strip()
            if decoded.lower() == "quit":
                conn.send("Goodbye!".encode())
                break
            broadcast(f"[{username}] {decoded}", conn)
            print(f"[{username}] {decoded}")
        except:
            break

    print(f"[DISCONNECTED] {username} ({addr})")
    broadcast(f"[{username}] left the chat.")
    del clients[conn]
    conn.close()

def start_server():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind((HOST, PORT))
    s.listen()
    print(f"[SERVER STARTED] Listening on {HOST}:{PORT}")
    while True:
        conn, addr = s.accept()
        thread = threading.Thread(target=handle_client, args=(conn, addr))
        thread.start()

if __name__ == "__main__":
    start_server()
