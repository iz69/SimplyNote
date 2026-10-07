"""Generate public configuration without modifying the compiled application."""
from __future__ import annotations

import html
import json
import os
from pathlib import Path
import re
from urllib.parse import quote, unquote, urlsplit, urlunsplit


def public_path(value: str) -> tuple[str, str]:
    value = value.strip()
    if not value.startswith("/") or value.startswith("//"):
        raise ValueError("public paths must start with a single /")
    if "?" in value or "#" in value:
        raise ValueError("public paths cannot contain a query or fragment")
    if re.search(r"%(?![0-9a-fA-F]{2})|%2f|%5c", value, re.IGNORECASE):
        raise ValueError("public paths cannot contain malformed escapes or encoded slashes")
    decoded = unquote(value, errors="strict")
    if "\\" in decoded or any(ord(character) < 32 or ord(character) == 127 for character in decoded):
        raise ValueError("public paths cannot contain backslashes or control characters")
    parts = [part for part in decoded.split("/") if part]
    if any(part in {".", ".."} for part in parts):
        raise ValueError("public paths cannot contain . or .. segments")
    decoded = "/" + "/".join(parts)
    # Match encodeURIComponent for path segments in the browser.
    encoded = quote(decoded, safe="/-._~!()*'")
    return decoded.rstrip("/"), encoded.rstrip("/")


def api_base(value: str) -> str:
    value = value.strip()
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("API_BASE_PATH must be a public path or an HTTP(S) URL without credentials")
        if parsed.query or parsed.fragment:
            raise ValueError("API_BASE_PATH cannot contain a query or fragment")
        parsed.port  # Validate the port when present.
        _, encoded = public_path(parsed.path or "/")
        return urlunsplit((parsed.scheme, parsed.netloc, encoded, "", ""))
    _, encoded = public_path(value or "/")
    return encoded


def nginx_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def feature_flag(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"true", "1", "yes", "on"}:
        return True
    if normalized in {"false", "0", "no", "off"}:
        return False
    raise ValueError("ENABLE_API and ENABLE_DRIVE must be boolean values")


def generate(dist: Path, output: Path, nginx_config: Path, ui_path: str, api_path: str,
             *, enable_api: bool = True, enable_drive: bool = True,
             config_path: Path | None = None) -> None:
    decoded_base, encoded_base = public_path(ui_path)
    ui_base = encoded_base + "/"
    configuration = {"uiBasePath": ui_base, "apiBasePath": api_base(api_path)}
    document, replacements = re.subn(
        r'<base\s+href="[^"]*"\s*/?>',
        lambda _: '<base href="' + html.escape(ui_base, quote=True) + '">',
        (dist / "index.html").read_text(),
        count=1,
    )
    if replacements != 1:
        raise ValueError("the compiled entry document must contain a base element")
    output.mkdir(parents=True, exist_ok=True)
    (output / "index.html").write_text(document)
    (output / "runtime-config.js").write_text(
        "window.__SIMPLYNOTE_CONFIG__ = " + json.dumps(configuration) + ";\n"
    )
    settings = {"enableApi": enable_api, "enableDrive": enable_drive}
    settings_file = output / "config.json"
    if config_path is not None and config_path.exists():
        if not config_path.is_file():
            raise ValueError("the mounted UI config.json must be a file")
        mounted = json.loads(config_path.read_text())
        if not isinstance(mounted, dict) or any(
            key in mounted and not isinstance(mounted[key], bool) for key in settings
        ):
            raise ValueError("UI config.json must be an object with boolean feature flags")
        settings_file = config_path
    else:
        settings_file.write_text(json.dumps(settings) + "\n")

    # Serve both complete public paths and paths stripped by an existing proxy.
    # Exact aliases avoid embedding public paths in rewrite regular expressions.
    locations: dict[str, tuple[Path, str]] = {}
    for prefix in {"", decoded_base}:
        for route in {"/", "/index.html", "/login", "/login/"}:
            locations[prefix + route] = (output / "index.html", "no-store, max-age=0")
        locations[prefix + "/runtime-config.js"] = (output / "runtime-config.js", "no-store, max-age=0")
        locations[prefix + "/config.json"] = (settings_file, "no-store, max-age=0")
        for asset in dist.iterdir():
            if asset.is_file() and asset.name not in {"index.html", "runtime-config.js", "config.json"}:
                locations[prefix + "/" + asset.name] = (asset, "public, max-age=3600")

    lines = [
        "server {",
        "  listen 5173;",
        "  server_name _;",
        "  absolute_redirect off;",
        "  root " + nginx_string(str(output)) + ";",
        "  index index.html;",
    ]
    if decoded_base:
        # Prefer the configured home route when it coincides with a stripped login route.
        locations.pop(decoded_base, None)
        lines += [
            "  location = " + nginx_string(decoded_base) + " {",
            "    return 308 " + nginx_string(ui_base + "$is_args$args") + ";",
            "  }",
        ]
    for route, (file, cache) in sorted(locations.items()):
        lines += [
            "  location = " + nginx_string(route) + " {",
            "    try_files /index.html =404;" if file == output / "index.html" else "    alias " + nginx_string(str(file)) + ";",
            '    add_header Cache-Control "' + cache + '" always;',
            "  }",
        ]
    for prefix in sorted({"", decoded_base}):
        lines += [
            "  location ^~ " + nginx_string(prefix + "/assets/") + " {",
            "    alias " + nginx_string(str(dist / "assets") + "/") + ";",
            '    add_header Cache-Control "public, max-age=31536000, immutable" always;',
            "  }",
        ]
    lines += [
        "  location / { try_files $uri @app; }",
        "  location @app {",
        '    add_header Cache-Control "no-store, max-age=0" always;',
        "    try_files /index.html =404;",
        "  }",
        "}",
        "",
    ]
    nginx_config.parent.mkdir(parents=True, exist_ok=True)
    nginx_config.write_text("\n".join(lines))
    print("SimplyNote UI configured at " + ui_base + "; API at " + (configuration["apiBasePath"] or "/"))


if __name__ == "__main__":
    try:
        generate(
            Path("/opt/simplynote/dist"),
            Path("/var/cache/simplynote/html"),
            Path("/etc/nginx/conf.d/default.conf"),
            os.getenv("UI_BASE_PATH", "/simplynote/"),
            os.getenv("API_BASE_PATH", "/simplynote-api"),
            enable_api=feature_flag(os.getenv("ENABLE_API", "true")),
            enable_drive=feature_flag(os.getenv("ENABLE_DRIVE", "true")),
            config_path=Path("/usr/share/nginx/html/config.json"),
        )
    except (ValueError, OSError) as error:
        raise SystemExit("SimplyNote UI configuration error: " + str(error))
