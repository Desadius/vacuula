
from conn import RobotConn
from db import get_session, db_commit2
from gen4.map_utils import parse_session
from models.robot import Robot
from models.persistent_map import FloorPlan
import queue
import threading
from models.run import Gen4__Run
from state import robot_connections
from handlers.events import notify_robots_changed, CLIENT_QUEUE_MAX
from utils import Generation

from state import pending_requests, client_connections

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from handlers.router import RouterHandler

# init
# {
#     'vendor': 'N',
#     'datetime': '2026-06-11T09:12:53.548396Z',
#     'serial': '2215LB04B13401976',
#     'signature': <string signature>
#     'firmware': '1.7.0-2933'
# }
import uuid
def handle_login(rc: RobotConn, msg):
    serial = msg.get("serial", "<unknown>")
    
    if serial == "<unknown>" or rc.gen != Generation.GEN4:
        # fail and show error
        return
    

    rc.serial = serial
    robot_connections[serial] = rc

    with get_session() as session:
        exists = session.get(Robot, serial)

        if not exists:
            session.add(Robot(serial=serial, name="Gen4 robot"))
            session.commit()

    notify_robots_changed()

    response = {
        "code": 200,
        "session": str(uuid.uuid4()),
        "datetime": now_iso(),
        "body": {
            "ip_address": "192.168.205.113",
            "timezone": "Europe/Stockholm",
            "robot_id": serial,
            "user_id": "local-user",
        },
    }
    send_json(rc.conn.socket, response) # TODO

    try:
        robot_send_request(rc, { "ability": "info.robot" })
    except Exception as e:
        print("WARN", f"could not request info.robot after login: {e}")

from datetime import datetime, timezone
def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")



_send_locks = {}
_send_locks_lock = threading.Lock()


def get_send_lock(conn):
    with _send_locks_lock:
        key = id(conn)
        if key not in _send_locks:
            _send_locks[key] = threading.Lock()
        return _send_locks[key]

import struct, json
def send_packet(sock, body_bytes):
    if not isinstance(body_bytes, (bytes, bytearray)):
        raise TypeError("send_packet expects bytes")
    with get_send_lock(sock):
        sock.sendall(struct.pack(">I", len(body_bytes)) + bytes(body_bytes))


def send_json(sock, obj):
    body = json.dumps(obj).encode("utf-8")
    send_packet(sock, body)

def heartbeat_thread(rc: RobotConn):
    while not rc.stop_event.is_set():
        if rc.stop_event.wait(30):
            return
        try:
            send_heartbeat(rc.conn.socket)
        except Exception as e:
            print("ERROR", f"heartbeat send failed for {rc.serial}: {e}")
            # Dead/half-open link: recv_packet retries on timeout forever, so it
            # won't notice on its own. Stop and close the socket to unblock the
            # receive loop -> handle_robot's finally removes the robot and
            # broadcasts offline (liveness within ~one heartbeat interval).
            rc.stop_event.set()
            try:
                rc.conn.socket.close()
            except Exception:
                pass
            return


def send_heartbeat(sock):
    send_packet(sock, b"\x06")



import uuid
def robot_send_request(rc: RobotConn, body: dict, slot=None):
    request_id = str(uuid.uuid4())

    msg = {
        "type": "request",
        "id": request_id,
        "to": {"service": "robot"},
        "body": body,
    }

    print("msg to send", msg)

    print(
        "CMD",
        f"sent to {rc.serial} id={request_id} body={json.dumps(body)}",
    )
    if slot is not None:
        pending_requests[request_id] = slot
    try:
        send_json(rc.conn.socket, msg)
    except Exception as e:
        print("ERROR", f"send failed: {e}")
        if slot is not None:
            pending_requests.pop(request_id, None)
        raise
    

    return request_id

def robot_response(rc: RobotConn, data: dict):
    reqId = data.get("id")
    # Only fill the waiting slot and signal it - the HTTP handler thread does the
    # actual client write, on its own socket. This thread (the robot's receive
    # loop) must never touch a client socket, or one dead browser would kill it.
    slot = pending_requests.get(reqId)
    if slot is not None:
        slot.fulfill(data, data["code"])

import time
def robot_event(rc: RobotConn, data: dict):
    # broadcast to all clients subscribed to this robot
    clients_subscribed = [
        c for c in client_connections
        if c["serial"] == rc.serial
    ]

    print("clients! ", len(clients_subscribed))

    msg = json.dumps({
        "serial": rc.serial,
        "type": "neato.gen4",
        "data": data,
        "ts": time.time()
    }) + "\n"
    frame = f"data: {msg}\n\n".encode()

    for client in clients_subscribed:
        # Non-blocking hand-off: connect_robot drains this queue and does the
        # (blocking) socket write, so a stuck client only fills its own queue.
        q = client["queue"]
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


import os

import base64
import zlib
import json
from pathlib import Path

import io
from PIL import Image

def get_image_size(decoded: bytes):
    im = Image.open(io.BytesIO(decoded))
    im.load()
    return im.size  # (width, height) -> (2000, 2000)

def maps_create(rc: RobotConn, data: dict):
    print("add new map!")
    body = data["body"]

    compressed = base64.b64decode(body["map"]["rank_binary"])

    folder = os.path.join('uploads', 'maps', rc.serial, body['rank_uuid'])
    upload_file = os.path.join(folder, 'rank_binary.pgm.nz')

    try:
        os.makedirs(folder, exist_ok=True)
        with open(upload_file, 'wb') as f:
            f.write(compressed)
    except Exception:
        # req.send_internal_error("Failed to save file")
        return

    compressed = base64.b64decode(body["map"]["real_binary"])

    folder = os.path.join('uploads', 'maps', rc.serial, body['rank_uuid'])
    upload_file = os.path.join(folder, 'real_binary.pgm.nz')

    try:
        os.makedirs(folder, exist_ok=True)
        with open(upload_file, 'wb') as f:
            f.write(compressed)

        with open(os.path.join(folder, 'msg.json'), 'w') as f:
            json.dump(data, f)
    except Exception:
        # req.send_internal_error("Failed to save file")
        return


    job_folder = f"uploads/maps/{rc.serial}/{body['rank_uuid']}"
    floor_map_path = f"{job_folder}/rank_binary.pgm.nz"
    run_map_path = f"{job_folder}/real_binary.pgm.nz"
    # manifest_path = f"{job_folder}/manifest.json"
    floormap_meta, run_meta = parse_session(floor_map_path, run_map_path, job_folder)

    with get_session() as session:
        # if valid_as_persistent_map:
            session.add(FloorPlan(
                id=body['rank_uuid'],
                robot=rc.serial,
                name="???",
                promoted=False,
                base=(body["robot"]["base"]["x"], body["robot"]["base"]["y"], body["robot"]["base"]["dir"]),
                origin=(body["map"]["origin"]["x"], body["map"]["origin"]["y"]),
                resolution=floormap_meta["metadata"]["resolution"],
                alignment=floormap_meta["metadata"]["alignment"],
                imgsize=floormap_meta["img_size"],
                created_at=body["timing"]["end"],
                in_maps_list=False
            ))

            session.add(Gen4__Run(
                id=body['rank_uuid'],
                robot=rc.serial,
                floorplan=body["rank_uuid"],
                started_by=body["started_by"],
                battery_consumed=body["battery_consumed"],
                runs=body["runs"],
                timing=body["timing"],
                cleaning_complete=body["cleaning_complete"]
            ))

            session.commit()
    
    return { "floorplan": False }, 201



request_map = {
    "maps.create": maps_create,
}


def roboot_request(rc: RobotConn, msg_id: str, data: dict):
    response_body, response_code = request_map[data["to"]["service"]](rc, data)
    response = {
        "type": "response",
        "id": msg_id,
        "code": response_code,
        "body": response_body,
    }
    send_json(rc.conn.socket, response) # TODO

