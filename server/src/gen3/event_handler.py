import state
import json
import queue
import time
from state import pending_requests
import typing

if typing.TYPE_CHECKING:
    from handlers.router import RouterHandler

# per-robot temporary buffers
# serial --> size
robot_buffers = {}

def robot_data(serial: str, data: bytes):
    """Handle incoming data from robot"""

    # create robot state if missing
    if serial not in robot_buffers:
        robot_buffers[serial] = int(data, 16)  # hex to int
        return

    msg_size = robot_buffers[serial]

    # remove last two bytes (\r\n)
    data = data[:-2]

    if (chr(data[0]) != '{' and msg_size == 1):
        print(f">> heartbeat received from {serial}")
        return


    try:
        decoded: dict = json.loads(data.decode())
    except Exception as e:
        print(f">> failed to parse JSON from {serial}: {e}")
        return

    eventId = decoded.get("eventId")
    reqId = decoded.get("reqId")

    if reqId in pending_requests:
        # Fill the waiting slot; the HTTP handler thread writes to its own client
        # socket (this is the robot's receive thread - it must not write there).
        slot = pending_requests.get(reqId)
        result = decoded.get("result")
        if slot is not None:
            slot.fulfill(data, 200 if result == "ok" else 400)
    elif eventId:
        print(f">> event {eventId} from {serial}")
        # broadcast to all clients subscribed to this robot
        clients_subscribed = [
            c for c in state.client_connections
            if c["serial"] == serial
        ]

        for client in clients_subscribed:
            try:
                msg = json.dumps({
                    "serial": serial,
                    "event": eventId,
                    "data": data,
                    "ts": time.time()
                }) + "\n"

                event_data = f"data: {msg}\n\n"
                frame = event_data.encode()

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

            except Exception as e:
                print(
                    f">> failed to send event to client "
                    f"{client['client']}: {e}"
                )
    else:
        print(f">> no eventId or reqId in data from {serial}")

    del robot_buffers[serial]
