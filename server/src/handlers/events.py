"""Server-sent events that are not about a single robot.

GET /app/events streams `robots` events: the full robot list (same shape as
GET /app/robots) whenever a robot logs in, drops its connection or is renamed,
plus one snapshot right after connecting. Clients keep their list in sync from
this stream instead of polling.
"""
import json
import queue
import threading
import time

from sqlalchemy import select

from db import get_session
from models.robot import Robot
from state import robot_connections

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from handlers.router import RouterHandler

KEEPALIVE_S = 15
CLIENT_QUEUE_MAX = 100       # frames buffered per client before the oldest is dropped

_clients: list = []          # one bounded Queue per connected event-stream client
_lock = threading.Lock()


def robots_snapshot() -> dict:
    """Robot list with connection status, keyed by serial (also used by GET /app/robots)."""
    with get_session() as session:
        robots = session.execute(select(Robot)).scalars().all()
    return {
        robot.serial: {
            "type": "neato.gen4" if not robot.password else "neato.gen3",
            "connected": robot.serial in robot_connections,
            "name": robot.name,
        }
        for robot in robots
    }


def _frame(event: str, data) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")


def broadcast(event: str, data) -> None:
    frame = _frame(event, data)
    with _lock:
        clients = list(_clients)
    for q in clients:
        # Never block the caller (a robot login/disconnect/rename thread): just
        # enqueue. If the client is too slow and its queue is full, drop the
        # oldest frame - the newest snapshot supersedes it anyway.
        try:
            q.put_nowait(frame)
        except queue.Full:
            try:
                q.get_nowait()
            except queue.Empty:
                pass
            try:
                q.put_nowait(frame)
            except queue.Full:
                pass


def notify_robots_changed() -> None:
    """Call after a robot connects, disconnects or is renamed."""
    try:
        broadcast("robots", robots_snapshot())
    except Exception as e:  # never let a notification break the caller
        print("WARN", f"robots event not sent: {type(e).__name__}: {e}")


def get_events(req: "RouterHandler") -> None:
    """GET /app/events - SSE stream of server-wide events."""
    req.send_response(200)
    req.send_header("Content-Type", "text/event-stream")
    req.send_header("Cache-Control", "no-cache")
    req.send_header("Connection", "keep-alive")
    req.end_headers()

    q: queue.Queue = queue.Queue(maxsize=CLIENT_QUEUE_MAX)
    with _lock:
        _clients.append(q)
    try:
        req.wfile.write(_frame("robots", robots_snapshot()))
        req.wfile.flush()
        while True:
            try:
                frame = q.get(timeout=KEEPALIVE_S)
            except queue.Empty:
                frame = b": keepalive\n\n"
            req.wfile.write(frame)
            req.wfile.flush()
    except OSError:
        pass  # client went away (reload, tab closed, phone in background)
    finally:
        with _lock:
            if q in _clients:
                _clients.remove(q)
