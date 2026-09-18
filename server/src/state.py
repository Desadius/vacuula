from conn import RobotConn
from typing import Dict
import threading

# robot_connections: List[RobotConn]  = []
robot_connections: Dict[str, RobotConn] = {}


# client_connection:
# - client id
# - connection itself
client_connections = []


class PendingRequest:
    # A slot the HTTP handler thread waits on for a robot's reply. The robot
    # receive thread only fills this and sets the event - it never writes to a
    # client socket; the waiting HTTP handler thread does that write on its own
    # socket, so a dead/slow client can't stall the receive loop or drop the robot.
    __slots__ = ("event", "content", "status")

    def __init__(self):
        self.event = threading.Event()
        self.content = None
        self.status = None

    def fulfill(self, content, status):
        self.content = content
        self.status = status
        self.event.set()


# pending_requests:
# - req_id --> PendingRequest slot (filled by the robot thread, awaited by the
#   HTTP handler thread)
pending_requests = {}