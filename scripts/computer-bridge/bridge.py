"""Authenticated desktop bridge for Frameflow. Python 3.10+, one logged-in desktop."""

import argparse
import hmac
import io
import ipaddress
import json
import math
import os
import secrets
import socket
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


KEYS = {
    "enter", "tab", "escape", "backspace", "delete", "up", "down", "left",
    "right", "home", "end", "pageup", "pagedown", "space",
    "ctrl+a", "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+z",
    "meta+a", "meta+c", "meta+v", "meta+x", "meta+z", "alt+tab",
}
MAX_BODY = 32_768


class BridgeError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def validate_action(action):
    if not isinstance(action, dict):
        raise BridgeError(400, "An action object is required.")
    kind = action.get("type")
    if kind == "click":
        for coordinate in ("x", "y"):
            value = action.get(coordinate)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or not 0 <= value <= 1
            ):
                raise BridgeError(400, "Coordinates must be between 0 and 1.")
        if action.get("button", "left") not in ("left", "right", "double"):
            raise BridgeError(400, "Unsupported mouse button.")
    elif kind == "key":
        if not isinstance(action.get("key"), str) or action["key"] not in KEYS:
            raise BridgeError(400, "Unsupported key.")
    elif kind == "text":
        if not isinstance(action.get("text"), str) or not 1 <= len(action["text"]) <= 4000:
            raise BridgeError(400, "Text must contain 1 to 4000 characters.")
    elif kind == "scroll":
        value = action.get("delta")
        if isinstance(value, bool) or not isinstance(value, int) or not -10 <= value <= 10:
            raise BridgeError(400, "Scroll delta must be an integer from -10 to 10.")
    else:
        raise BridgeError(400, "Unsupported action.")
    return action


class Desktop:
    def __init__(self):
        if sys.platform.startswith("linux"):
            if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE") == "wayland":
                raise RuntimeError(
                    "Wayland is not supported. Log in to an X11/Xorg desktop session."
                )
            if not os.environ.get("DISPLAY"):
                raise RuntimeError("No desktop session. Start the bridge inside an X11 desktop.")
        if sys.platform == "win32":
            # Keep screen capture and input coordinates in the same physical space.
            import ctypes
            try:
                ctypes.windll.shcore.SetProcessDpiAwareness(2)
            except (AttributeError, OSError):
                ctypes.windll.user32.SetProcessDPIAware()
        import pyautogui
        import pyperclip
        self.gui = pyautogui
        self.clipboard = pyperclip
        self.gui.FAILSAFE = True
        self.gui.PAUSE = 0.1
        # Detect missing screen permission before accepting any clients.
        self.gui.screenshot()

    def health(self):
        width, height = self.gui.size()
        return {"width": width, "height": height, "platform": sys.platform}

    def screenshot(self):
        capture = self.gui.screenshot()
        capture.thumbnail((1920, 1920))
        output = io.BytesIO()
        capture.save(output, format="PNG")
        return output.getvalue()

    def action(self, action):
        kind = action["type"]
        if kind == "click":
            width, height = self.gui.size()
            x = round(action["x"] * (width - 1))
            y = round(action["y"] * (height - 1))
            button = action.get("button", "left")
            self.gui.click(
                x, y, clicks=2 if button == "double" else 1,
                interval=0.1 if button == "double" else 0,
                button="right" if button == "right" else "left",
            )
        elif kind == "key":
            aliases = {"escape": "esc", "meta": "command" if sys.platform == "darwin" else "win"}
            keys = [aliases.get(key, key) for key in action["key"].split("+")]
            self.gui.hotkey(*keys)
        elif kind == "scroll":
            self.gui.scroll(action["delta"])
        elif kind == "text":
            # Clipboard paste supports Chinese and other Unicode text on all three OSes.
            # This intentionally updates the remote clipboard, as documented in the UI.
            self.clipboard.copy(action["text"])
            self.gui.hotkey("command" if sys.platform == "darwin" else "ctrl", "v")


class Bridge:
    def __init__(self, token, desktop):
        self.token = token
        self.desktop = desktop
        self.lock = threading.Lock()
        self.mode = "paused"
        self.control_token = ""
        self.control_version = 0

    def authorize(self, authorization, origin):
        # Workbench proxies requests. A webpage must never drive this local service.
        if origin:
            raise BridgeError(403, "Browser origins are not accepted.")
        expected = f"Bearer {self.token}".encode()
        if not hmac.compare_digest((authorization or "").encode(), expected):
            raise BridgeError(401, "Authentication required.")

    def control(self, body):
        mode = body.get("mode")
        token = body.get("controlToken")
        version = body.get("controlVersion")
        if mode not in ("agent", "human"):
            raise BridgeError(400, "Unsupported control mode.")
        if not isinstance(token, str) or not 16 <= len(token) <= 200:
            raise BridgeError(400, "A control token is required.")
        if isinstance(version, bool) or not isinstance(version, int) or not 1 <= version <= 9_007_199_254_740_991:
            raise BridgeError(400, "A positive control version is required.")
        # The acknowledgement is sent only after every prior atomic input finishes.
        with self.lock:
            if version < self.control_version or (
                version == self.control_version
                and (token != self.control_token or mode != self.mode)
            ):
                raise BridgeError(409, "Control request has expired.")
            self.mode = mode
            self.control_token = token
            self.control_version = version
        return {"ok": True}

    def action(self, body):
        action = validate_action(body.get("action"))
        with self.lock:
            token = body.get("controlToken")
            if (
                self.mode == "paused"
                or body.get("actor") != self.mode
                or body.get("controlVersion") != self.control_version
                or isinstance(body.get("controlVersion"), bool)
                or not isinstance(token, str)
                or not hmac.compare_digest(token.encode(), self.control_token.encode())
            ):
                raise BridgeError(409, "Control changed. Acquire control before sending input.")
            try:
                self.desktop.action(action)
            except Exception as error:
                # An OS denial or emergency mouse-corner stop revokes input immediately.
                self.mode = "paused"
                raise BridgeError(
                    503, "Desktop input stopped. Check OS permissions and move the mouse away from a corner."
                ) from error
        return {"ok": True}


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, bridge):
        super().__init__(address, Handler)
        self.bridge = bridge
        self.slots = threading.BoundedSemaphore(16)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "FrameflowComputer/1"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, _format, *_args):
        # Do not persist desktop input, tokens, or request URLs.
        pass

    def reply(self, status, body, content_type="application/json"):
        data = json.dumps(body).encode() if content_type == "application/json" else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        if self.headers.get("Transfer-Encoding"):
            raise BridgeError(400, "Chunked requests are not accepted.")
        if self.headers.get_content_type() != "application/json":
            raise BridgeError(415, "Use application/json.")
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise BridgeError(400, "Invalid content length.") from error
        if not 0 < size <= MAX_BODY:
            raise BridgeError(413, "Invalid request size.")
        try:
            value = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeDecodeError) as error:
            raise BridgeError(400, "Invalid JSON.") from error
        if not isinstance(value, dict):
            raise BridgeError(400, "A JSON object is required.")
        return value

    def dispatch(self):
        bridge = self.server.bridge
        bridge.authorize(self.headers.get("Authorization"), self.headers.get("Origin"))
        if self.command == "GET" and self.path == "/health":
            with bridge.lock:
                return self.reply(200, {"ok": True, "version": 1, **bridge.desktop.health()})
        if self.command == "GET" and self.path == "/screenshot":
            with bridge.lock:
                capture = bridge.desktop.screenshot()
            return self.reply(200, capture, "image/png")
        if self.command == "POST" and self.path == "/control":
            return self.reply(200, bridge.control(self.body()))
        if self.command == "POST" and self.path == "/actions":
            return self.reply(200, bridge.action(self.body()))
        raise BridgeError(404, "Endpoint not found.")

    def handle_request(self):
        try:
            self.dispatch()
        except BridgeError as error:
            self.reply(error.status, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass
        except Exception:
            self.reply(503, {"error": "Desktop unavailable. Check the logged-in session and OS permissions."})

    do_GET = handle_request
    do_POST = handle_request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--cert", help="TLS certificate PEM, required for non-loopback binding")
    parser.add_argument("--key", help="TLS private key PEM")
    args = parser.parse_args()
    try:
        local = ipaddress.ip_address(args.host).is_loopback
    except ValueError:
        parser.error("--host must be an IP address (default: 127.0.0.1).")
    if bool(args.cert) != bool(args.key) or (not local and not args.cert):
        parser.error("Remote binding requires both --cert and --key. Use a tunnel for loopback HTTP.")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535.")
    supplied_token = os.environ.get("FRAMEFLOW_COMPUTER_TOKEN")
    token = supplied_token or secrets.token_urlsafe(32)
    if len(token) < 32 or any(character.isspace() for character in token):
        parser.error("FRAMEFLOW_COMPUTER_TOKEN must contain at least 32 characters and no whitespace.")
    try:
        desktop = Desktop()
    except Exception as error:
        parser.exit(1, f"Desktop startup failed: {error}\nSee docs/computers.zh-CN.md.\n")
    if ":" in args.host:
        BridgeServer.address_family = socket.AF_INET6
    server = BridgeServer((args.host, args.port), Bridge(token, desktop))
    if args.cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(args.cert, args.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    display_host = f"[{args.host}]" if ":" in args.host else args.host
    print(f"Computer bridge: {'https' if args.cert else 'http'}://{display_host}:{args.port}", flush=True)
    if not supplied_token:
        print(f"Connection token (paste into Frameflow): {token}", flush=True)
    print("Input starts paused. Keep this terminal open; Ctrl+C stops sharing.", flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
