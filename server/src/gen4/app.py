from re import search
from gen3.commands import send_chunk, build_command, build_heartbeat # TODO
from state import robot_connections, client_connections, pending_requests, PendingRequest
from db import get_session, db_commit
from models.persistent_map import Boundary, FloorPlan
from models.robot import Robot
from models.run import Run
from sqlalchemy import select, update
from utils import Generation, get_robot_by_serial
import json
import time
import os

from gen4.handlers import robot_send_request, send_json

# Longest wait for the robot to acknowledge maps.promote_floorplan. The promote
# carries multi-megabyte map blobs and the robot has been observed taking a few
# seconds to reply, so this is deliberately generous but still bounded.
PROMOTE_TIMEOUT_S = 60

from typing import TYPE_CHECKING, Sequence
if TYPE_CHECKING:
    from router import RouterHandler


def post_update_floorplan_in_use(req: RouterHandler, serial: str, map_id: str) -> None:
    """POST /robot/<serial>/maps/<map_id>/use - update map data"""
    with get_session() as session:
        existing = session.get(FloorPlan, map_id)
        if existing:
            existing.in_maps_list = True
        # else:
        #     # TODO: error

        if not db_commit(session, req):
            # TODO: error
            return

    req.send_ok()

def post_update_floorplan_in_unuse(req: RouterHandler, serial: str, map_id: str) -> None:
    """POST /robot/<serial>/maps/<map_id>/unuse - update map data"""
    with get_session() as session:
        existing = session.get(FloorPlan, map_id)
        if existing:
            existing.in_maps_list = False
        # else:
        #     # TODO: error

        if not db_commit(session, req):
            # TODO: error
            return

    req.send_ok()



def post_boundaries(req: RouterHandler, serial: str, map_id: str) -> None:
    """POST /robot/<serial>/maps/<map_id>/boundaries - replace map boundaries."""
    data = req.read_json()
    if data is None:
        return

    keys_required = {
        "id",
        "name",
        "color",
        "type",
        "vertices",
        "enabled",
        "function",
    }

    # Merge/upsert semantics: required keys must all be present; "deleted" is the
    # only permitted extra key (marks a boundary for explicit removal). We do NOT
    # delete rows just because they are absent from the payload - a stale/partial
    # POST from one tab must never wipe boundaries another tab persisted.
    allowed_extra = {"deleted"}
    for boundary in data:
        missing = keys_required - set(boundary)
        extra = set(boundary) - keys_required - allowed_extra
        if missing or extra:
            req.send_bad_request("not all required keys")
            return

    with get_session() as session:
        existing = session.query(Boundary).filter(
            Boundary.floorplan == map_id
        ).all()

        existing_by_id = {boundary.id: boundary for boundary in existing}

        for boundary in data:
            current = existing_by_id.get(boundary["id"])

            # Explicit removal: only delete when the client says so.
            if boundary.get("deleted"):
                if current:
                    session.delete(current)
                continue

            if current:
                current.name = boundary["name"]
                current.color = boundary["color"]
                current.type = boundary["type"]
                current.vertices = boundary["vertices"]
                current.enabled = boundary["enabled"]
                current.function = boundary["function"]
            else:
                session.add(Boundary(
                    id=boundary["id"],
                    floorplan=map_id,
                    name=boundary["name"],
                    color=boundary["color"],
                    type=boundary["type"],
                    vertices=boundary["vertices"],
                    enabled=boundary["enabled"],
                    function=boundary["function"],
                ))

        if not db_commit(session, req):
            return

    req.send_ok()



def get_boundaries(req: RouterHandler, serial: str, map_id: str) -> None:
    """GET /robot/<serial>/maps/<map_id>/boundaries - get boundaries"""

    with get_session() as session:
        boundaries: Sequence[Boundary] = session.execute(
            select(Boundary)
            .where(Boundary.floorplan == map_id)
        ).scalars().all()

    req.send_ok([{
        "id": b.id,
        "name": b.name,
        "enabled": b.enabled,
        "color": b.color,
        "vertices": b.vertices,
        "function": b.function,
        "type": b.type,
    } for b in boundaries])


from PIL import Image, ImageDraw
# Default pixel values. If empirical test on the robot shows different,
# tweak these.
FG_PIXEL = 0xFF  # inside zone
BG_PIXEL = 0x00  # outside zone

# Width of the rasterized line for shape="line" no-go markers (in pgm pixels).
# Increased from 3 to 9: a Neato D10 chassis is ~32 cm wide, so a 12 cm
# nominal line (3 px @ 40 mm/px) was THINNER than the robot itself. The path
# planner treats narrow tracks as informational, not as a hard obstacle, so
# the robot drove right over them. 9 px @ 40 mm/px = 36 cm -- just wider
# than the robot, forcing the planner to route around.
LINE_WIDTH_PX = 9

def _build_pgm_bytes(img: Image.Image, floorplan: FloorPlan) -> bytes:
    """Encode a PIL "L" image as PGM P5 with the Neato metadata comment header."""
    w, h = img.size
    # The rank header observed in samples has the form:
    #   P5
    #   # Neato metadata: origin_x=-40000 origin_y=-40000 resolution=40 alignment=0.008727
    #   2000 2000
    #   255
    #   <binary pixels>
    comment = (
    f"# Neato metadata: origin_x={floorplan.origin[0]} "
    f"origin_y={floorplan.origin[1]} "
    f"resolution={floorplan.resolution} "
    f"alignment={floorplan.alignment:.6f}"        # <- 6 casas decimais
    )
    # IMPORTANT: tracks are loaded into MapLayer2D<unsigned short> (2 bytes per
    # cell, big-endian per PGM P5 spec). Firmware allocates w*h*2 bytes and
    # rejects the load (PM_LOAD_FAIL) if the payload size doesn't match.
    # Reverse-engineered from /usr/bin/robot in firmware 1.7.0-2933, function
    # sub_0x00086bf0: `add x22, x20, x20` (double w*h) then `strh wzr` (store
    # 16-bit halfwords) -> vtable 0x001748d0 -> typeinfo 0x00176c10 =
    # '10MapLayer2DItE' (Itanium ABI 't' = unsigned short).
    header = (
        b"P5\r\n"
        + comment.encode("ascii") + b"\r\n"
        + f"{w} {h}".encode("ascii") + b"\r\n"
        + b"65535\r"                        # <- 2 bytes/pixel, only CR no LF
    )
    # Expand each 8-bit drawn pixel (0x00 or FG_PIXEL=0xFF) to 2 bytes
    # big-endian (0x0000 or 0xFFFF). Slice assignment on bytearray is C-level
    # fast — for a 2000x2000 canvas this is microseconds, not seconds.
    pixels_8 = img.tobytes()
    pixels_16 = bytearray(len(pixels_8) * 2)
    pixels_16[0::2] = pixels_8   # high byte (MSB in big-endian)
    pixels_16[1::2] = pixels_8   # low byte
    return header + bytes(pixels_16)

def _mark_targets_inside_zones(real_blob, cleaning_zones, floorplan):
    # Set byte==6 cells inside each cleaning-zone polygon to byte==4 in the
    # real.pgm payload, so the firmware's target finder has valid targets
    # (byte 3/4) even over already-cleaned floor. One-time, applied only to the
    # bytes sent in this promote; the file on disk is untouched. Returns the
    # (re-compressed) blob, or the original on any failure / no-op.
    try:
        import zlib as _zlib
        import numpy as _np
        raw = _zlib.decompress(real_blob)
        if not raw.startswith(b"P5"):
            return real_blob
        W, H = floorplan.imgsize
        # PGM (P5) pixels are 1 byte/cell when maxval <= 255, else 2 bytes/cell
        # big-endian (the firmware's zone maps are 16-bit, maxval=65535). Parse
        # maxval from the header so both widths are handled. The header may
        # carry '#' comment lines (the robot's real.pgm has a '# metadata:' line),
        # so tokens are read with a real PGM tokenizer that skips comments, NOT a
        # naive whitespace split. The pixel block is still located from the END
        # of the buffer (len - W*H*bpp), which is robust to any header layout.
        def _pgm_tokens(buf, n):
            toks, i, L = [], 0, len(buf)
            while len(toks) < n and i < L:
                c = buf[i:i+1]
                if c in b" \t\r\n":
                    i += 1
                elif c == b"#":
                    j = buf.find(b"\n", i)
                    i = L if j < 0 else j + 1
                else:
                    j = i
                    while j < L and buf[j:j+1] not in b" \t\r\n#":
                        j += 1
                    toks.append(buf[i:j]); i = j
            return toks
        toks = _pgm_tokens(raw, 4)          # P5, width, height, maxval
        if len(toks) < 4:
            print("PROMOTE_PATCH: malformed PGM header %r; skipping" % toks)
            return real_blob
        try:
            maxval = int(toks[3])
        except ValueError:
            print("PROMOTE_PATCH: bad PGM maxval %r; skipping" % toks[3])
            return real_blob
        bpp = 2 if maxval > 255 else 1
        dtype = _np.dtype(">u2") if bpp == 2 else _np.uint8
        npix = W * H * bpp
        pixels_offset = len(raw) - npix
        if pixels_offset < 4 or pixels_offset > 1024:
            print("PROMOTE_PATCH: real.pgm size mismatch (offset=%d, bpp=%d); skipping" % (pixels_offset, bpp))
            return real_blob
        arr = _np.frombuffer(raw[pixels_offset:pixels_offset + npix], dtype=dtype).reshape(H, W).copy()
        changed = 0
        for boundary in cleaning_zones:
            if boundary.type != "polygon" or len(boundary.vertices) < 3:
                continue
            pts = [(p[0] * W, p[1] * H) for p in boundary.vertices]
            mimg = Image.new("L", (W, H), 0)
            ImageDraw.Draw(mimg).polygon(pts, fill=1, outline=1)
            mask = _np.array(mimg, dtype=bool)
            targets = mask & (arr == 6)
            n = int(targets.sum())
            if n:
                arr[targets] = 4
                changed += n
        if not changed:
            print("PROMOTE_PATCH: no byte=6 cells inside cleaning polygons; unchanged")
            return real_blob
        new_raw = raw[:pixels_offset] + arr.tobytes()
        print("PROMOTE_PATCH: marked %d cells (6->4) inside cleaning polygons" % changed)
        return _zlib.compress(new_raw, level=9)
    except Exception as _e:
        print("PROMOTE_PATCH failed (non-fatal): %s: %s" % (type(_e).__name__, _e))
        return real_blob


def get_test(req: RouterHandler, serial: str, map_id: str) -> None:
    """GET /robot/<serial>/maps/<map_id>/test - get boundaries"""

    with get_session() as session:
        floorplan: FloorPlan = session.execute(
            select(FloorPlan).where(FloorPlan.id == map_id)
        ).scalar_one_or_none()

        # Fetch ALL boundaries (enabled or not). The no-go track is one shared
        # object per floorplan, so its GEOMETRY must always be uploaded whole -
        # otherwise disabling no-go for one run (manual clean) would empty the
        # track and break every schedule that references it. Whether a given run
        # APPLIES the no-go is a per-run flag (nogo_enabled on cleaning.start),
        # not something encoded by dropping the geometry here.
        boundaries: Sequence[Boundary] = session.execute(
            select(Boundary)
            .where(Boundary.floorplan == map_id)
        ).scalars().all()

        promoted_map_id = session.scalar(
            select(FloorPlan.id)
            .where(
                FloorPlan.robot == serial,
                FloorPlan.promoted.is_(True),
            )
        )

    # NOTE: do NOT demote here. maps.demote_floorplan DELETES the floorplan on
    # the robot, and that also deletes any schedules bound to it (they come back
    # enabled=False, track_id=None after a manual clean). Instead we promote with
    # old_rank_uuid = the currently-promoted rank below, which the firmware treats
    # as an atomic in-place swap that preserves the floorplan and its schedules.
    # (Same approach as Vacuula 2's send_promote_floorplan atomic swap.)

    
    import base64, zlib, os

    # Debug rasteriser dumps: off by default so the repo isn't littered on every
    # promote. Set VACUULA_DEBUG_DUMP=1 to write the .pgm images to DEBUG_DUMP_DIR.
    DEBUG_DUMP = os.environ.get("VACUULA_DEBUG_DUMP") == "1"
    DEBUG_DUMP_DIR = os.environ.get("VACUULA_DEBUG_DIR", r"D:\Jairo\Neato\D10\GitHub\claude\pgm-scratch")
    if DEBUG_DUMP:
        os.makedirs(DEBUG_DUMP_DIR, exist_ok=True)

    # ALL cleaning-zone tracks are uploaded, regardless of `enabled`, so any zone
    # is a valid target for a schedule (each event picks its own subset via
    # track_id). `enabled` on a zone only means "included in the map's default
    # clean" (home Map+Start) - it is a selection, not existence on the robot.
    # Likewise the no-go geometry is ALWAYS built from every no-go line so the
    # shared track stays whole regardless of the per-run nogo_enabled flag.
    # Target-marking covers all zones for the same reason.
    cleaning_zones = [b for b in boundaries if b.function == "cleaning"]
    nogo_zones     = [b for b in boundaries if b.function == "nogo"]

    nogo_img = Image.new("L", floorplan.imgsize, BG_PIXEL)
    nogo_draw = ImageDraw.Draw(nogo_img)
    for boundary in nogo_zones:
        pts = [(p[0] * floorplan.imgsize[0], p[1] * floorplan.imgsize[1]) for p in boundary.vertices]
        if (boundary.type == "polyline"):
            nogo_draw.line(pts, fill=FG_PIXEL, width=LINE_WIDTH_PX, joint="curve")
        elif (boundary.type == "polygon"):
            nogo_draw.polygon(pts, fill=FG_PIXEL, outline=FG_PIXEL)
    nogo_raw = _build_pgm_bytes(nogo_img, floorplan)

    cleaning_tracks = []
    for boundary in cleaning_zones:
        clean_img = Image.new("L", floorplan.imgsize, BG_PIXEL)
        clean_draw = ImageDraw.Draw(clean_img)
        pts = [(p[0] * floorplan.imgsize[0], p[1] * floorplan.imgsize[1]) for p in boundary.vertices]
        if (boundary.type == "polyline"):
            clean_draw.line(pts, fill=FG_PIXEL, width=LINE_WIDTH_PX, joint="curve")
        elif (boundary.type == "polygon"):
            clean_draw.polygon(pts, fill=FG_PIXEL, outline=FG_PIXEL)
        clean_raw = _build_pgm_bytes(clean_img, floorplan)
        
        cleaning_tracks.append({
            "track_uuid": boundary.id,
            "binary":     base64.b64encode(zlib.compress(clean_raw, level=9)).decode("ascii"),
        })

        if DEBUG_DUMP:
            with open(os.path.join(DEBUG_DUMP_DIR, f'clean_raw_{boundary.id}.pgm'), 'wb') as f:
                f.write(clean_raw)


    if DEBUG_DUMP:
        with open(os.path.join(DEBUG_DUMP_DIR, 'nogo_raw.pgm'), 'wb') as f:
            f.write(nogo_raw)





    with open(f'uploads/maps/{serial}/{map_id}/rank_binary.pgm.nz', 'rb') as rank:
        with open(f'uploads/maps/{serial}/{map_id}/real_binary.pgm.nz', 'rb') as real:
            real_binary_patched = _mark_targets_inside_zones(real.read(), cleaning_zones, floorplan)
            payload = {
                "ability": "maps.promote_floorplan",
                "rank_uuid":     floorplan.id,
                "rank_binary":   base64.b64encode(rank.read()).decode("ascii"),
                "real_binary":   base64.b64encode(real_binary_patched).decode("ascii"),
                "old_rank_uuid": promoted_map_id, # atomic in-place swap (see note above) - preserves schedules
                "base": {
                    "x":   floorplan.base[0],
                    "y":   floorplan.base[1],
                    "dir": floorplan.base[2],
                },
                "date_created":    floorplan.created_at,
                "nogo_track":      {
                    "track_uuid": "a5730f32-3214-4fa8-bfc4-92ca4f83abcf",
                    "binary":     base64.b64encode(zlib.compress(nogo_raw, level=9)).decode("ascii"),
                },
                "cleaning_tracks": cleaning_tracks,
            }

            if DEBUG_DUMP:
                print(payload)

            # The promote uploads the rank, no-go and zone tracks that every
            # subsequent cleaning.start / scheduling.update references. Callers
            # (manual clean, home button, schedule save) must not proceed until
            # the robot has actually COMMITTED it, so this request blocks on the
            # robot's reply instead of returning as soon as the bytes are sent.
            # Same PendingRequest slot mechanism as post_robot_command.
            if serial not in robot_connections:
                req.send_bad_request("Robot not connected")
                return
            slot = PendingRequest()
            try:
                # registers the slot BEFORE sending so a fast reply can't be lost
                req_id = robot_send_request(robot_connections[serial], payload, slot)
            except Exception as _e:
                print("PROMOTE: failed to send to robot: %s: %s" % (type(_e).__name__, _e))
                req.send_error_response(502, "Failed to send promote to robot")
                return

            slot.event.wait(PROMOTE_TIMEOUT_S)
            pending_requests.pop(str(req_id), None)
            if not slot.event.is_set():
                print("PROMOTE: robot did not acknowledge within %ss" % PROMOTE_TIMEOUT_S)
                req.send_error_response(504, "Robot did not acknowledge promote in time")
                return
            if slot.status != 200:
                print("PROMOTE: robot rejected promote: status=%s body=%s" % (slot.status, slot.content))
                req.send_error_response(502, "Robot rejected promote (status %s)" % slot.status)
                return

            # Only now - after the robot has confirmed - do we record the
            # floorplan as promoted, so the local DB can never claim a promote
            # the robot doesn't actually hold.
            with get_session() as session:
                floor_plan = session.get(FloorPlan, map_id)

                if floor_plan is None:
                    req.send_not_found(f"Floor plan {map_id} not found")
                    return

                session.execute(
                    update(FloorPlan)
                    .where(
                        FloorPlan.robot == floor_plan.robot,
                        FloorPlan.id != map_id,
                    )
                    .values(promoted=False)
                )

                floor_plan.promoted = True

                session.commit()


    req.send_ok(payload)


def demote_floorplan(serial: str, map_id: str):
    payload = {
        "ability": "maps.demote_floorplan",
        "rank_uuid":     map_id,
    }

    print(payload)

    robot_send_request(robot_connections[serial], payload)

    with get_session() as session:
        session.execute(
            update(FloorPlan)
            .where(
                FloorPlan.robot == serial,
                FloorPlan.id == map_id,
            )
            .values(promoted=False)
        )

        session.commit()
    
def delete_demote_floorplan(req: RouterHandler, serial: str, map_id: str) -> None:
    """DELETE /robot/<serial>/maps/<map_id> - demote floorplan"""

    demote_floorplan(serial, map_id)

    req.send_ok()


