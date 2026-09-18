from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime
from handlers.route_matcher import BrainslugHandler, BEEHIVE_ROUTES, NUCLEO_ROUTES, APP_ROUTES, S3_ROUTES
from socketserver import ThreadingMixIn
import json
import socket
import uuid

from pathlib import Path
import mimetypes
WEB_ROOT = Path("web")
WEB_ROOT_RESOLVED = WEB_ROOT.resolve()

# Generated once, when the module is imported (i.e. once per server run).
# It's folded into every ETag below, so any response a browser cached
# becomes stale the instant the server restarts (e.g. after a deploy),
# even if max-age hasn't expired yet.
SERVER_BOOT_ID = uuid.uuid4().hex[:12]


def _is_within_web_root(path: Path) -> bool:
    """True if `path` resolves to something inside WEB_ROOT."""
    try:
        path.relative_to(WEB_ROOT_RESOLVED)
        return True
    except ValueError:
        return False


class RouterHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        """Override to add CORS headers to app responses"""
        if (self.path.startswith("/api/")):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_ok()

    # TODO - add better logging ?
    # def log_message(self, format, *args):
    #     print(self.path)
    #     # Silence default logging
    #     return

    def read_data(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_bad_request("Invalid Content-Length header")
            return None
        if content_length == 0:
            return b""
        return self.rfile.read(content_length)

    def read_json(self) -> dict | None:
        data = self.read_data()
        if data is None:
            return None
        try:
            return json.loads(data)
        except json.JSONDecodeError:
            self.send_bad_request("Invalid JSON body")
            return None

    def serve_web(self):
        print("got req web!")
        print(self.path)

        # Strip /web from the URL
        relative = self.path.removeprefix("/web")
        # Ignore query string
        relative = relative.split("?", 1)[0]
        # Resolve the requested file safely
        requested = (WEB_ROOT / relative.lstrip("/")).resolve()

        # Prevent access outside server/web
        if not _is_within_web_root(requested):
            self.send_not_found()
            return

        # SPA fallback, react router takes over:
        if not requested.is_file():
            if Path(relative).suffix == "":
                requested = WEB_ROOT_RESOLVED / "index.html"
            else:
                self.send_not_found()
                return

        # cache
        cache_control = "public, max-age=3600, must-revalidate"
        inm = self.headers.get("If-None-Match")

        if inm and SERVER_BOOT_ID in (tag.strip() for tag in inm.split(",")):
            self.send_response(304)
            self.send_header("ETag", SERVER_BOOT_ID)
            self.send_header("Cache-Control", cache_control)
            self.send_header("Connection", "close")
            self.end_headers()
            return

        print("loading!")
        print(requested.absolute())
        try:
            content = requested.read_bytes()
        except OSError:
            self.send_internal_error("Could not read file")
            return

        content_type, _ = mimetypes.guess_type(str(requested))
        if content_type is None:
            content_type = "application/octet-stream"

        # Re-verify immediately before writing to the socket.
        if not _is_within_web_root(requested):
            self.send_not_found()
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("ETag", SERVER_BOOT_ID)
        self.send_header("Cache-Control", cache_control)
        self.send_header("Connection", "close")
        self.end_headers()

        self.wfile.write(content)
        self.wfile.flush()



    # Routing logic
    def route(self):
        print(self.path)
        if self.path == "/web" or self.path.startswith("/web/"):
            return self.serve_web()
        accept = self.headers.get("Accept", "")
        
        if self.path.startswith("/api/"):
            return BrainslugHandler(APP_ROUTES, self)
        elif accept == "application/vnd.neato.beehive.v1+json":
            return BrainslugHandler(BEEHIVE_ROUTES, self)
        elif accept == "application/vnd.neato.cometa.v1":
            return BrainslugHandler(NUCLEO_ROUTES, self)
        elif self.path == "/" and self.command == "GET":
            self.send_response(301)
            self.send_header("Location", "/web")
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            return BrainslugHandler(S3_ROUTES, self)

    def do_POST(self):
        self.route()

    def do_GET(self):
        self.route()

    def do_PUT(self):
        self.route()

    def do_DELETE(self):
        self.route()

    def send_response_data(self, content, close=True, status=200, content_type="application/json"):
        if isinstance(content, (dict, list)):
            content = json.dumps(content).encode("utf-8")
        elif isinstance(content, str):
            content = content.encode("utf-8")

        self.send_response(status)

        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        if close:
            self.send_header("Connection", "close")
        self.end_headers()

        self.wfile.write(content)
        self.wfile.flush()

        if not close:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)


    def send_error_response(self, status, message):
        self.send_response_data({"error": message}, True, status=status)

    # Success helpers
    def send_ok(self, data=None, close=True):
        self.send_response_data(data if data is not None else "OK", close, status=200)

    def send_created(self, data=None, close=True):
        self.send_response_data(data if data is not None else "Created",close, status=201)

    # Error helpers
    def send_bad_request(self, message="Bad Request"):
        self.send_error_response(400, message)

    def send_unauthorized(self, message="Unauthorized"):
        self.send_error_response(401, message)

    def send_not_found(self, message="Not Found"):
        self.send_error_response(404, message)

    def send_internal_error(self, message="Internal Server Error"):
        self.send_error_response(500, message)