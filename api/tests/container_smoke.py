"""Exercise a distribution image using only its disposable /data directory."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


origin = "http://127.0.0.1:18000"
server = subprocess.Popen([
    sys.executable, "-m", "uvicorn", "api.main:app",
    "--host", "127.0.0.1", "--port", "18000",
])


def request(path, *, method="GET", data=None, headers=None, raw=False):
    with urlopen(Request(origin + path, data=data, headers=headers or {}, method=method), timeout=5) as response:
        body = response.read()
        return body if raw else json.loads(body)


try:
    for attempt in range(100):
        if server.poll() is not None:
            raise RuntimeError("API exited before becoming ready")
        try:
            request("/ping", method="HEAD", raw=True)
            break
        except URLError:
            time.sleep(0.1)
    else:
        raise RuntimeError("API startup timed out")
    schema = request("/openapi.json")
    assert schema["servers"] == [{"url": os.environ["BASE_PATH"].rstrip("/")}]
    token = request("/auth/token", method="POST", data=urlencode({
        "username": os.environ["ADMIN_USER"], "password": os.environ["ADMIN_PASS"],
    }).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
    headers = {"Authorization": "Bearer " + token["access_token"], "Content-Type": "application/json"}
    note = request("/notes", method="POST", data=json.dumps({
        "title": "Distribution smoke test", "content": "temporary test data",
    }).encode(), headers=headers)
    assert request("/notes/" + str(note["id"]), headers=headers)["content"] == "temporary test data"
    assert len(request("/notes", headers=headers)) == 1
    updated = request("/notes/" + str(note["id"]), method="PUT",
                      data=b'{"title":"Distribution smoke test","content":"updated test data"}', headers=headers)
    assert updated["content"] == "updated test data"
    boundary = "simplynote-smoke-boundary"
    body = ("--" + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="test.txt"'
            "\r\nContent-Type: text/plain\r\n\r\ntemporary attachment\r\n--" + boundary + "--\r\n").encode()
    attachment = request("/notes/" + str(note["id"]) + "/attachments", method="POST", data=body,
                         headers={"Authorization": headers["Authorization"],
                                  "Content-Type": "multipart/form-data; boundary=" + boundary})
    assert attachment["url"].startswith("/files/")
    assert request(attachment["url"], raw=True) == b"temporary attachment"
    assert Path("/data/simplynote.db").is_file()
    assert Path("/data/config.json").is_file()
    print("PASS API image: startup, public path, login, note create/read/update, attachment and /data")
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()
