"""Protocol tests use a fake desktop and never capture or control this computer."""

import json
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from bridge import Bridge, BridgeError, BridgeServer, validate_action


TOKEN = "test-only-connection-token-with-32-characters"
FIRST = "first-control-token-with-32-characters"
SECOND = "second-control-token-with-32-characters"


class FakeDesktop:
    def __init__(self):
        self.actions = []
        self.started = threading.Event()
        self.finish = threading.Event()
        self.wait = False

    def health(self):
        return {"width": 1920, "height": 1080, "platform": "test"}

    def screenshot(self):
        return b"\x89PNG\r\n\x1a\nfake-image"

    def action(self, action):
        self.started.set()
        if self.wait and not self.finish.wait(3):
            raise RuntimeError("test action timeout")
        self.actions.append(action)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.desktop = FakeDesktop()
        self.bridge = Bridge(TOKEN, self.desktop)

    def invoke(self, actor="agent", token=FIRST, version=1):
        return self.bridge.action({
            "actor": actor, "controlToken": token, "controlVersion": version,
            "action": {"type": "click", "x": 0.5, "y": 0.5},
        })

    def test_starts_paused_and_rejects_reused_token_after_restart(self):
        with self.assertRaises(BridgeError) as blocked:
            self.invoke()
        self.assertEqual(blocked.exception.status, 409)
        self.assertEqual(self.desktop.actions, [])

    def test_view_does_not_change_control_and_takeover_fences_old_actions(self):
        self.bridge.control({"mode": "agent", "controlToken": FIRST, "controlVersion": 1})
        self.bridge.desktop.screenshot()
        self.invoke()
        self.bridge.control({"mode": "human", "controlToken": SECOND, "controlVersion": 2})
        for actor, token in (("agent", FIRST), ("agent", SECOND), ("human", FIRST)):
            with self.assertRaises(BridgeError):
                self.invoke(actor, token)
        self.invoke("human", SECOND, 2)
        self.assertEqual(len(self.desktop.actions), 2)

    def test_takeover_acknowledges_only_after_inflight_input_finishes(self):
        self.bridge.control({"mode": "agent", "controlToken": FIRST, "controlVersion": 1})
        self.desktop.wait = True
        with ThreadPoolExecutor(2) as pool:
            action = pool.submit(self.invoke)
            self.assertTrue(self.desktop.started.wait(1))
            takeover = pool.submit(self.bridge.control, {"mode": "human", "controlToken": SECOND, "controlVersion": 2})
            self.assertFalse(takeover.done())
            self.desktop.finish.set()
            self.assertEqual(action.result(1), {"ok": True})
            self.assertEqual(takeover.result(1), {"ok": True})
        with self.assertRaises(BridgeError):
            self.invoke()

    def test_input_failure_revokes_control(self):
        self.bridge.control({"mode": "human", "controlToken": FIRST, "controlVersion": 1})

        def fail(_action):
            raise RuntimeError("permission denied")

        self.desktop.action = fail
        with self.assertRaises(BridgeError) as failure:
            self.invoke("human")
        self.assertEqual(failure.exception.status, 503)
        self.assertEqual(self.bridge.mode, "paused")
        with self.assertRaises(BridgeError):
            self.bridge.control({"mode": "human", "controlToken": FIRST, "controlVersion": 1})

    def test_late_control_request_cannot_restore_old_agent_lease(self):
        self.bridge.control({"mode": "agent", "controlToken": FIRST, "controlVersion": 1})
        self.bridge.control({"mode": "human", "controlToken": SECOND, "controlVersion": 2})
        for body in (
            {"mode": "agent", "controlToken": FIRST, "controlVersion": 1},
            {"mode": "agent", "controlToken": FIRST, "controlVersion": 2},
        ):
            with self.assertRaises(BridgeError) as blocked:
                self.bridge.control(body)
            self.assertEqual(blocked.exception.status, 409)
        with self.assertRaises(BridgeError):
            self.invoke()
        self.invoke("human", SECOND, 2)

    def test_invalid_actions_never_reach_desktop(self):
        invalid = [
            None, {"type": "shell", "command": "anything"},
            {"type": "click", "x": True, "y": 0.5},
            {"type": "click", "x": float("nan"), "y": 0.5},
            {"type": "click", "x": 1.1, "y": 0.5},
            {"type": "key", "key": ["enter"]},
            {"type": "key", "key": "unknown"},
            {"type": "text", "text": "a" * 4001},
            {"type": "scroll", "delta": True},
            {"type": "scroll", "delta": 11},
        ]
        for action in invalid:
            with self.subTest(action=action), self.assertRaises(BridgeError):
                validate_action(action)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.desktop = FakeDesktop()
        self.server = BridgeServer(("127.0.0.1", 0), Bridge(TOKEN, self.desktop))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, path, body=None, token=TOKEN, origin=None):
        headers = {"Authorization": f"Bearer {token}"}
        if origin:
            headers["Origin"] = origin
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base + path, headers=headers,
            data=None if body is None else json.dumps(body).encode(),
        )
        try:
            response = urllib.request.urlopen(request, timeout=2)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def test_screenshot_requires_authentication_and_blocks_browser_origins(self):
        self.assertEqual(self.request("/screenshot", token="wrong")[0], 401)
        self.assertEqual(self.request("/screenshot", origin="https://example.com")[0], 403)
        status, headers, image = self.request("/screenshot")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertTrue(image.startswith(b"\x89PNG"))
        self.assertEqual(self.desktop.actions, [])

    def test_remote_protocol_roundtrip_and_input_fencing(self):
        status, _, health = self.request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(health)["width"], 1920)
        self.assertEqual(self.request("/control", {"mode": "human", "controlToken": FIRST, "controlVersion": 1})[0], 200)
        body = {"actor": "agent", "controlToken": FIRST, "controlVersion": 1, "action": {"type": "key", "key": "enter"}}
        self.assertEqual(self.request("/actions", body)[0], 409)
        body["actor"] = "human"
        self.assertEqual(self.request("/actions", body)[0], 200)
        self.assertEqual(self.desktop.actions, [{"type": "key", "key": "enter"}])
        self.assertEqual(self.request("/actions", [])[0], 400)


if __name__ == "__main__":
    unittest.main()
