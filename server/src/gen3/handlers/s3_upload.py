import re
import os
import tarfile
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from router import RouterHandler


def parse_multipart_form_data(body: bytes, boundary: str) -> tuple[dict, bytes | None, str | None]:
    boundary_bytes = boundary.encode()
    parts = body.split(b'--' + boundary_bytes)
    form_data = {}
    file_data = None
    filename = None

    for part in parts[1:-1]:
        if not part.strip():
            continue
        try:
            header_end = part.find(b'\r\n\r\n')
            if header_end == -1:
                header_end = part.find(b'\n\n')
                headers_section = part[:header_end].decode('utf-8', errors='ignore')
                content = part[header_end+2:]
            else:
                headers_section = part[:header_end].decode('utf-8', errors='ignore')
                content = part[header_end+4:]
        except Exception:
            continue

        if content.endswith(b'\r\n'):
            content = content[:-2]
        elif content.endswith(b'\n'):
            content = content[:-1]

        disposition_match = re.search(r'name="([^"]+)"', headers_section)
        filename_match = re.search(r'filename="([^"]+)"', headers_section)

        if disposition_match:
            field_name = disposition_match.group(1)
            if filename_match:
                filename = filename_match.group(1)
                file_data = content
                form_data[field_name] = filename
            else:
                try:
                    form_data[field_name] = content.decode('utf-8')
                except Exception:
                    form_data[field_name] = content

    return form_data, file_data, filename


def s3_upload(req: RouterHandler) -> None:
    """POST / - S3 upload endpoint"""
    body = req.read_data()
    if body is None:
        return

    content_type = req.headers.get('Content-Type', '')
    boundary_match = re.search(r'boundary=([^\s;]+)', content_type)
    if not boundary_match:
        print("boundary in Content")
        req.send_bad_request("No boundary in Content-Type")
        return

    form_data, file_data, filename = parse_multipart_form_data(body, boundary_match.group(1))

    robot_serial = form_data.get('key')           # we store robot serial in key
    upload_type = form_data.get('AWSAccessKeyId') # we store upload type in AWSAccessKeyId
    upload_id = form_data.get('signature')        # we store upload id in signature


    if not robot_serial or not upload_id or upload_type not in ('maps', 'logs'):
        print("Missing or bad")
        req.send_bad_request("Missing or bad robot_serial, upload type or id")
        return

    if not file_data or not filename:
        print("Missing file")
        req.send_bad_request("Missing file")
        return

    folder = os.path.join('uploads', upload_type, robot_serial, upload_id)
    upload_file = os.path.join(folder, filename)

    try:
        os.makedirs(folder, exist_ok=True)
        with open(upload_file, 'wb') as f:
            f.write(file_data)
    except Exception:
        req.send_internal_error("Failed to save file")
        return

    # Extract maps only
    if upload_type == "maps":
        try:
            with tarfile.open(upload_file, 'r:gz') as tar:
                tar.extractall(path=folder)
            os.remove(upload_file)
        except Exception:
            req.send_internal_error("Failed to extract file")
            return

    req.send_created()