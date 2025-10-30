import socket
import threading
import tkinter as tk
from tkinter import scrolledtext
from tkinter import simpledialog, messagebox

# --- Connect to server ---
SERVER_IP = input("Enter server IP: ")
PORT = 5555

client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    client_socket.connect((SERVER_IP, PORT))
except Exception as e:
    print("Connection failed:", e)
    exit(1)

# --- GUI setup ---
root = tk.Tk()
root.title("Chat Client")

chat_display = scrolledtext.ScrolledText(root, state='disabled', width=50, height=20)
chat_display.pack(padx=10, pady=10)

msg_entry = tk.Entry(root, width=40)
msg_entry.pack(side=tk.LEFT, padx=(10,0), pady=(0,10))

# Send message function
def send_message():
    msg = msg_entry.get()
    if msg:
        try:
            client_socket.send(msg.encode())
            msg_entry.delete(0, tk.END)
        except:
            messagebox.showerror("Error", "Failed to send message")
            client_socket.close()
            root.destroy()

send_button = tk.Button(root, text="Send", command=send_message)
send_button.pack(side=tk.LEFT, padx=(5,0), pady=(0,10))

# Leave chat function
def leave_chat():
    try:
        client_socket.send("quit".encode())
    except:
        pass
    client_socket.close()
    root.destroy()

leave_button = tk.Button(root, text="Leave", command=leave_chat)
leave_button.pack(side=tk.LEFT, padx=(5,10), pady=(0,10))

# --- Ask for username ---
def ask_username():
    return simpledialog.askstring("Username", "Enter your username:", parent=root)

username = ask_username()
if not username:
    messagebox.showinfo("No username", "You must enter a username")
    client_socket.close()
    root.destroy()
else:
    # Send username to server
    client_socket.recv(1024)  # wait for "USERNAME" prompt
    client_socket.send(username.encode())

# --- Receiving messages ---
def receive_messages():
    while True:
        try:
            msg = client_socket.recv(1024)
            if not msg:
                break
            chat_display.config(state='normal')
            chat_display.insert(tk.END, msg.decode() + '\n')
            chat_display.yview(tk.END)
            chat_display.config(state='disabled')
        except:
            break
    client_socket.close()
    root.quit()

recv_thread = threading.Thread(target=receive_messages, daemon=True)
recv_thread.start()

root.mainloop()
