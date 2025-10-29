import tkinter as tk
from tkinter import simpledialog, scrolledtext
import socketio

# Replace with your Render deployment URL
SERVER_URL = "https://your-app.onrender.com"

# Initialize SocketIO client
sio = socketio.Client()

# Create main GUI window
root = tk.Tk()
root.title("Chat Client")

# Chat messages display
chat_display = scrolledtext.ScrolledText(root, state='disabled', width=50, height=20)
chat_display.pack(padx=10, pady=10)

# Message entry
msg_entry = tk.Entry(root, width=50)
msg_entry.pack(padx=10, pady=(0, 10))

# Ask for username
username = simpledialog.askstring("Username", "Enter your username:", parent=root)

# Functions
def send_message(event=None):
    msg = msg_entry.get()
    if msg.strip():
        sio.emit('message', {'msg': msg})
        msg_entry.delete(0, tk.END)

def display_message(msg):
    chat_display.config(state='normal')
    chat_display.insert(tk.END, msg + "\n")
    chat_display.yview(tk.END)
    chat_display.config(state='disabled')

# SocketIO event handlers
@sio.event
def connect():
    display_message("Connected to server.")
    sio.emit('join', {'username': username})

@sio.event
def message(data):
    display_message(data)

@sio.event
def disconnect():
    display_message("Disconnected from server.")

# Bind enter key to send messages
msg_entry.bind("<Return>", send_message)

# Connect to server
sio.connect(SERVER_URL)

# Run GUI loop
root.mainloop()
sio.disconnect()
