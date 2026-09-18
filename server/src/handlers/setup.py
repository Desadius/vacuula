from zeroconf import Zeroconf, ServiceInfo
import socket
from pathlib import Path


from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from handlers.router import RouterHandler


def get_cert(req: RouterHandler) -> None:
    """GET /cert - return server certificate."""

    file = Path("ssl/cert.pem")

    try:
        data = file.read_text(encoding="utf-8")
    except OSError:
        req.send_internal_error("Failed to read certificate")
        return

    req.send_ok(data)


# mDNS stuff
SERVICE_TYPE = "_vacuula._tcp.local."
SERVICE_NAME = "Vacuula._vacuula._tcp.local."
MDNS_HOSTNAME = "vacuula.local."
PORT = 8080

def get_local_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Determines which local interface is used for outbound traffic.
        sock.connect(("9.9.9.9", 80))
        return sock.getsockname()[0]
    finally:
        sock.close()


class MDNSAdvertiser:
    def __init__(self) -> None:
        self._zeroconf = Zeroconf()

        ip = get_local_ip()

        self._info = ServiceInfo(
            SERVICE_TYPE,
            SERVICE_NAME,
            addresses=[socket.inet_aton(ip)],
            server=MDNS_HOSTNAME,
            port=PORT,
            properties={
                "version": "1",
                "cert-path": "/api/cert",
            },
        )

    def start(self) -> None:
        self._zeroconf.register_service(self._info)
        print(
            f"mDNS: advertising {SERVICE_NAME} "
            f"at {self._info.parsed_addresses()[0]}:{self._info.port}"
        )

    def stop(self) -> None:
        self._zeroconf.unregister_service(self._info)
        self._zeroconf.close()