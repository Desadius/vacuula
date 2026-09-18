from gen3.commands import send_chunk, build_command, build_heartbeat # TODO
from state import robot_connections, client_connections, pending_requests, PendingRequest
from handlers.events import robots_snapshot, notify_robots_changed, CLIENT_QUEUE_MAX
from db import get_session, db_commit
from models.persistent_map import Boundary, FloorPlan, PersistentMap
from models.robot import Robot
from models.run import Gen4__Run, Run
from sqlalchemy import select, update
from utils import Generation, get_robot_by_serial
import json
import queue
import time

# Longest wait for a robot to answer a command before the HTTP request fails
COMMAND_TIMEOUT_S = 30
import os

from gen4.handlers import robot_send_request

from typing import TYPE_CHECKING, Sequence
if TYPE_CHECKING:
    from router import RouterHandler




def post_boundaries(req: RouterHandler, serial: str, map_id: str) -> None:
    """POST /robot/<serial>/maps/<map_id>/boundaries - update map data"""
    if not (data := req.read_json()):
        return

    keys_required = {
        "id",
        "name",
        "color",
        "type",
        "vertices",
        "enabled",
    }

    for boundary in data:
        boundary_keys = {x for x in boundary}
        if keys_required != boundary_keys:
            req.send_bad_request("not all required keys")
            return

    with get_session() as session:
        for boundary in data:
            existing = session.get(Boundary, boundary["id"])

            if existing:
                existing.floorplan = map_id
                existing.name = boundary["name"]
                existing.color = boundary["color"]
                existing.type = boundary["type"]
                existing.vertices = boundary["vertices"]
                existing.enabled = boundary["enabled"]
            else:
                session.add(Boundary(
                    id=boundary["id"],
                    floorplan=map_id,
                    name=boundary["name"],
                    color=boundary["color"],
                    type=boundary["type"],
                    vertices=boundary["vertices"],
                    enabled=boundary["enabled"],
                ))

        if not db_commit(session, req):
            # TODO: error
            return

    req.send_ok()


def get_boundaries(req: RouterHandler, serial: str, map_id: str) -> None:
    """GET /robot/<serial>/maps/<map_id>/boundaries - get boundaries"""

    with get_session() as session:
        boundaries: Sequence[Boundary] = session.execute(
            select(Boundary)
            .where(Boundary.floorplan == map_id)
        ).scalars().all()

    req.send_ok({ "boundaries": [{
        "id": b.id,
        "name": b.name,
        "enabled": b.enabled,
        "color": b.color,
        "vertices": b.vertices,
        "type": b.type,
    } for b in boundaries] })


def get_robots(req: RouterHandler) -> None:
    """GET /robots - list all robots with connection status (empty object when none)"""
    req.send_ok(robots_snapshot())


def get_maps(req: RouterHandler, serial: str) -> None:
    """GET /robot/<serial>/maps - list all maps to user"""
    with get_session() as session:
        maps: Sequence[FloorPlan] = session.execute(
            select(FloorPlan)
            .where(FloorPlan.robot == serial, FloorPlan.in_maps_list == True)

        ).scalars().all()

    data = [
        {
            column.name: getattr(x, column.name)
            for column in FloorPlan.__table__.columns
        }
        for x in maps
    ]

    req.send_ok(data)

    # req.send_ok([{
    #     "id": m.id,
    #     "name": m.name,
    #     "promoted": m.promoted,
    #     "base": { "x": m.baseX, "y": m.baseY }
    # } for m in maps])


def get_map(req: RouterHandler, serial: str, map_id: str) -> None:
    """GET /robot/<serial>/maps/<map_id> - return map data to user"""
    file = f"uploads/maps/{serial}/{map_id}/floormap.json"

    if not os.path.isfile(file):
        req.send_not_found("Map not found")
        return

    try:
        with open(file, 'r') as f:
            data = json.load(f)
    except Exception:
        req.send_internal_error("Failed to read map")
        return

    with get_session() as session:
        floorplan = session.get(FloorPlan, map_id)
    
    data["in_maps_list"] = floorplan.in_maps_list

    req.send_ok(data)

def post_map(req: RouterHandler, serial: str, map_id: str) -> None:
    """POST /robot/<serial>/maps/<map_id> - update map data"""
    if not (data := req.read_json()): return

    name = data.get("name")
    enabled = data.get("enabled")

    if name is None or enabled is None:
        return req.send_bad_request("name and enabled are required")

    with get_session() as session:
        session.execute(
            update(PersistentMap)
            .where(PersistentMap.id == map_id, PersistentMap.robot == serial)
            .values(name=name, enabled=enabled)
        )

        session.execute(
            update(FloorPlan)
            .where(FloorPlan.id == map_id, FloorPlan.robot == serial)
            .values(name=name)
        )
        session.commit()
    
    req.send_ok()

def post_robot(req: RouterHandler, serial: str) -> None:
    """POST /robot/<serial> - update robot"""
    if not (data := req.read_json()): return

    name = data.get("name")

    if name is None:
        return req.send_bad_request("name is required")

    with get_session() as session:
        session.execute(
            update(Robot)
            .where(Robot.serial == serial)
            .values(name=name)
        )
        session.commit()

    notify_robots_changed()
    req.send_ok()

def get_runs(req: RouterHandler, serial: str) -> None:
    """GET /robot/<serial>/runs - list all runs to user"""
    with get_session() as session:
        runs = session.execute(
            select(Gen4__Run)
            .where(Gen4__Run.robot == serial)
        ).scalars().all()

    data = [
        {
            column.name: getattr(run, column.name)
            for column in Gen4__Run.__table__.columns
        }
        for run in runs
    ]

    req.send_ok(data)

def get_run(req: RouterHandler, serial: str, run_id: str) -> None:
    """GET /robot/<serial>/run/<run_id> - list all runs to user"""
    file = f"uploads/maps/{serial}/{run_id}/runmap.json"

    if not os.path.isfile(file):
        req.send_not_found("Map not found")
        return

    try:
        with open(file, 'r') as f:
            data = json.load(f)
    except Exception:
        req.send_internal_error("Failed to read map")
        return

    req.send_ok(data)






def connect_robot(req: RouterHandler, serial: str) -> None:
    """GET /robots/{serial}/connect - SSE stream for client"""
    if get_robot_by_serial(serial) is None:
        req.send_not_found("Robot not found")
        return

    req.send_response(200)
    req.send_header("Content-Type", "text/event-stream")
    req.send_header("Cache-Control", "no-cache")
    req.send_header("Connection", "keep-alive")
    req.end_headers()

    q: queue.Queue = queue.Queue(maxsize=CLIENT_QUEUE_MAX)
    conn = {"client": "test", "serial": serial, "queue": q}
    client_connections.append(conn)

    try:
        while True:
            try:
                frame = q.get(timeout=15)
            except queue.Empty:
                frame = b": keepalive\n\n"
            req.wfile.write(frame)
            req.wfile.flush()

    except (BrokenPipeError, ConnectionResetError, OSError):
        print(f"Client disconnected: {serial}")

    finally:
        if conn in client_connections:
            client_connections.remove(conn)

    # # try:
    # msg = json.dumps({
    #     "serial": serial,
    # })

    # event_data = f"data: {msg}\n\n"
    # req.wfile.write(event_data.encode())
    # req.wfile.flush()
    # # except Exception as e:
    # #     print("ERROR", f"send failed: {e}")
    # # finally:
    # #     print('REMOVING!!')
    # #     if conn in client_connections:
    # #         client_connections.remove(conn)


def _send_quietly(write):
    # Run a client-socket write; swallow the error if the client already hung up.
    # A vanished browser shouldn't become a noisy traceback - and now that replies
    # are delivered from this handler thread, it can't affect anything else either.
    try:
        write()
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
        pass


def post_robot_command(req: RouterHandler, serial: str) -> None:
    """POST /robots/{serial}/command - send command to robot"""
    if not (data := req.read_json()): return

    if get_robot_by_serial(serial) is None:
        req.send_not_found("Robot not found")
        return

    if serial not in robot_connections:
        req.send_bad_request("Robot not connected")
        return

    conn = robot_connections[serial]
    slot = PendingRequest()
    if (conn.gen == Generation.GEN4):
        # robot_send_request registers the slot BEFORE it sends, so a fast reply
        # can't be dropped (see gen4/handlers.py).
        try:
            req_id = robot_send_request(conn, data, slot)
        except Exception:
            _send_quietly(lambda: req.send_error_response(502, "Failed to send command to robot"))
            return
    elif (conn.gen == Generation.GEN3):
        req_id, msg = build_command(serial, data)
        pending_requests[str(req_id)] = slot  # register before sending
        try:
            send_chunk(conn.conn.wfile, msg) # TODO
        except Exception:
            pending_requests.pop(str(req_id), None)
            _send_quietly(lambda: req.send_error_response(502, "Failed to send command to robot"))
            return
    else:
        req.send_bad_request("Unsupported robot generation")
        return

    # The robot's receive thread fills `slot` and sets its event - it never
    # touches this client socket. We wait here and do the write ourselves, so a
    # slow or vanished client can only ever affect this one request, never the
    # robot connection or other commands. (This also replaces the old busy-wait.)
    key = str(req_id)
    slot.event.wait(COMMAND_TIMEOUT_S)
    pending_requests.pop(key, None)
    if slot.event.is_set():
        _send_quietly(lambda: req.send_response_data(slot.content, True, slot.status))
    else:
        _send_quietly(lambda: req.send_error_response(504, "Robot did not answer in time"))
    