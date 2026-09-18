from http.server import ThreadingHTTPServer
from handlers.router import RouterHandler
from tls import create_ssl_context
import threading
import socket, ssl, struct, json
from conn import RobotConn, Gen4Conn
from utils import Generation
from gen4.handlers import handle_login
import threading


def start():
    # HTTP server on 80
    http_server = ThreadingHTTPServer(("0.0.0.0", 80), RouterHandler)
    
    http_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
    
    http_thread.start()
    
    print("Listening on http://0.0.0.0:80")


