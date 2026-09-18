"""Shared routing utilities for handler pattern matching"""

import re
from typing import Callable, Optional, Tuple, List

from gen4.app import delete_demote_floorplan, get_boundaries, get_test, post_boundaries, post_update_floorplan_in_unuse, post_update_floorplan_in_use
from handlers.setup import get_cert

from .app import get_robots, get_maps, get_map, get_run, post_map, post_robot, get_runs, connect_robot, post_robot_command
from .events import get_events
# gen3
from gen3.handlers.beehive import post_links, persistent_maps, upload_init, upload_finish
from gen3.handlers.nucleo import nucleo_init
from gen3.handlers.s3_upload import s3_upload

Handler = Callable[..., None]


# Route definitions: (method, pattern, handler)
NUCLEO_ROUTES: List[Tuple[str, str, Handler]] = [
    ("POST", "/vendors/neato/login", nucleo_init),
]

BEEHIVE_ROUTES: List[Tuple[str, str, Handler]] = [
    ("POST", "/links", post_links),
    ("POST", r"/(.+)/upload_jobs", upload_init),
    ("GET", "/persistent_maps", persistent_maps),
    ("PUT", r"/(.+)/upload_jobs/(.+)", upload_finish),
]

APP_ROUTES: List[Tuple[str, str, Handler]] = [
    ("GET", "/api/cert", get_cert),
    ("GET", "/api/robots", get_robots),
    ("GET", "/api/events", get_events),
    ("GET", r"/api/robot/(.+)/connect", connect_robot),
    ("GET", r"/api/robot/(.+)/maps", get_maps),
    ("GET", r"/api/robot/(.+)/run/(.+)", get_run),
    ("GET", r"/api/robot/(.+)/runs", get_runs),
    ("GET", r"/api/robot/(.+)/maps/(.+)/boundaries", get_boundaries),
    ("GET", r"/api/robot/(.+)/maps/(.+)/test", get_test),
    ("GET", r"/api/robot/(.+)/maps/(.+)", get_map),
    ("POST", r"/api/robot/(.+)/maps/(.+)/boundaries", post_boundaries),
    ("POST", r"/api/robot/(.+)/maps/(.+)/use", post_update_floorplan_in_use),
    ("POST", r"/api/robot/(.+)/maps/(.+)/unuse", post_update_floorplan_in_unuse),
    ("POST", r"/api/robot/(.+)/maps/(.+)", post_map),
    ("POST", r"/api/robot/(.+)/command", post_robot_command),
    ("POST", r"/api/robot/(.+)", post_robot),
    ("DELETE", r"/api/robot/(.+)/maps/(.+)", delete_demote_floorplan),
]

S3_ROUTES: List[Tuple[str, str, Handler]] = [
    ("POST", "/", s3_upload),
]


def find_route(
    routes: List[Tuple[str, str, Handler]],
    method: str,
    path: str
) -> Tuple[Optional[Handler], List[str]]:
    """Find matching route and extract path parameters.
    
    Args:
        routes: List of (method, pattern, handler) tuples
        method: HTTP method (GET, POST, PUT, DELETE, etc.)
        path: Request path
    
    Returns:
        (handler, [path_params]) or (None, []) if not found
    """
    # Strip query string from path
    path = path.split('?')[0]
    
    for route_method, pattern, handler in routes:
        if route_method != method:
            continue
        
        # Check for exact match first
        if pattern == path:
            return handler, []
        
        # Check for regex pattern match
        match = re.match(f"^{pattern}$", path)
        if match:
            path_params = list(match.groups())
            return handler, path_params
    
    return None, []


def BrainslugHandler(ROUTES, req) -> None:
    print("received request...")

    handler, path_params = find_route(ROUTES, req.command, req.path)
    
    if handler:
        if path_params:
            handler(req, *path_params)
        else:
            handler(req)
    else:
        print(f"No handler for {req.command} {req.path}")
        req.send_not_found()

