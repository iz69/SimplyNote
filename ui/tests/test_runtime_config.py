import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("runtime_config", Path(__file__).resolve().parents[1] / "runtime/generate_config.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeConfigurationTests(unittest.TestCase):
    def test_paths_are_canonical_and_match_browser_encoding(self):
        for raw, expected in [
            (" / ", ""), ("/tools//notes///", "/tools/notes"),
            ("/v1.0+notes/", "/v1.0%2Bnotes"),
            ("/ノート 管理/", "/%E3%83%8E%E3%83%BC%E3%83%88%20%E7%AE%A1%E7%90%86"),
            ("/notes/$special/", "/notes/%24special"),
        ]:
            with self.subTest(raw=raw):
                self.assertEqual(runtime.public_path(raw)[1], expected)
                self.assertEqual(runtime.public_path(expected or "/")[1], expected)

    def test_invalid_paths_fail_before_starting_nginx(self):
        for value in ["relative", "//other", "/a?b", "/a#b", "/a/../b", "/a/%2e/b", "/a%2fb", "/a%5cb", "/bad%", "/bad%ff", "/bad\\path", "/bad\npath"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                runtime.public_path(value)

    def test_api_urls_support_root_paths_and_external_origins(self):
        self.assertEqual(runtime.api_base("/"), "")
        self.assertEqual(runtime.api_base(""), "")
        self.assertEqual(runtime.api_base(" /tools/api/// "), "/tools/api")
        self.assertEqual(runtime.api_base("https://api.example:8443/tools/api/"), "https://api.example:8443/tools/api")
        for value in ["//api.example", "ftp://api.example", "https://user:pass@api.example", "https://api.example/?key=a", "https://api.example/#a", "https://api.example:invalid"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                runtime.api_base(value)

    def test_reconfiguration_preserves_the_compiled_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dist, output, nginx = root / "dist", root / "html", root / "nginx.conf"
            (dist / "assets").mkdir(parents=True)
            original = '<base href="./"><script src="./runtime-config.js"></script><script type="module" src="./assets/app.js"></script>'
            (dist / "index.html").write_text(original)
            (dist / "assets/app.js").write_text("compiled")
            (dist / "favicon.png").write_bytes(b"icon")
            for ui, api in [("/", "/"), ("/tools/login/", "/tools/api"), ("/v1.0+notes/", "https://api.example/")]:
                runtime.generate(dist, output, nginx, ui, api)
                expected = runtime.public_path(ui)[1] + "/"
                self.assertIn('<base href="' + expected + '">', (output / "index.html").read_text())
                config = (output / "runtime-config.js").read_text().removeprefix("window.__SIMPLYNOTE_CONFIG__ = ").removesuffix(";\n")
                self.assertEqual(json.loads(config), {"uiBasePath": expected, "apiBasePath": runtime.api_base(api)})
                self.assertIn("no-store", nginx.read_text())
                self.assertNotIn("rewrite ", nginx.read_text())
                self.assertEqual((dist / "index.html").read_text(), original)
                self.assertEqual((dist / "assets/app.js").read_text(), "compiled")

    def test_missing_base_element_is_an_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text("<html></html>")
            with self.assertRaisesRegex(ValueError, "base element"):
                runtime.generate(root, root / "output", root / "nginx.conf", "/", "/")

    def test_feature_flags_and_existing_config_mounts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dist, output, nginx = root / "dist", root / "html", root / "nginx.conf"
            dist.mkdir()
            (dist / "index.html").write_text('<base href="./">')
            runtime.generate(dist, output, nginx, "/tools/notes/", "/api",
                             enable_api=True, enable_drive=False)
            self.assertEqual(json.loads((output / "config.json").read_text()),
                             {"enableApi": True, "enableDrive": False})
            mounted = root / "mounted.json"
            mounted.write_text('{"enableApi": false, "enableDrive": true}')
            runtime.generate(dist, output, nginx, "/login/", "/api", config_path=mounted)
            self.assertIn(str(mounted), nginx.read_text())
            self.assertIn('"/login/config.json"', nginx.read_text())
            self.assertNotIn('location = "/login" {\n    try_files', nginx.read_text())
            self.assertEqual(json.loads(mounted.read_text()),
                             {"enableApi": False, "enableDrive": True})
            for invalid in ['[]', '{"enableDrive": "false"}', 'invalid json']:
                mounted.write_text(invalid)
                with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                    runtime.generate(dist, output, nginx, "/", "/", config_path=mounted)

    def test_boolean_environment_values(self):
        for value in ["true", "TRUE", "1", "yes", "on"]:
            self.assertTrue(runtime.feature_flag(value))
        for value in ["false", "FALSE", "0", "no", "off"]:
            self.assertFalse(runtime.feature_flag(value))
        with self.assertRaises(ValueError):
            runtime.feature_flag("maybe")


if __name__ == "__main__":
    unittest.main()
