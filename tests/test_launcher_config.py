from __future__ import annotations

import errno
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from launcher import build_httpd_with_port_fallback, ensure_config


class LauncherConfigTests(unittest.TestCase):
    def test_ensure_config_uses_bundled_template_when_local_template_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, tempfile.TemporaryDirectory() as bundle_dir:
            base = Path(temp_dir)
            bundled_example = Path(bundle_dir) / "config.example.toml"
            bundled_example.write_text(
                """
[archive]
root = "E:\\\\xiaoshuo"
max_bytes = "1GB"
manifest_name = ".novel_manifest.json"
""".strip()
                + "\n",
                encoding="utf-8",
            )

            with patch.object(sys, "_MEIPASS", bundle_dir, create=True):
                config_path = ensure_config(base)

            self.assertEqual(config_path, base / "config.toml")
            self.assertTrue(config_path.exists())
            self.assertIn("E:\\\\xiaoshuo", config_path.read_text(encoding="utf-8"))

    def test_server_start_falls_back_when_preferred_port_is_blocked(self) -> None:
        started_ports: list[int] = []
        fake_httpd = object()

        def fake_build_httpd(service: object, host: str, port: int) -> object:
            started_ports.append(port)
            if port == 8765:
                raise OSError(errno.EACCES, "Permission denied")
            return fake_httpd

        with patch("launcher.port_is_open", return_value=False), patch(
            "launcher.build_httpd", side_effect=fake_build_httpd
        ):
            httpd, port = build_httpd_with_port_fallback(object(), "127.0.0.1", 8765, attempts=3)

        self.assertIs(httpd, fake_httpd)
        self.assertEqual(port, 8766)
        self.assertEqual(started_ports, [8765, 8766])


if __name__ == "__main__":
    unittest.main()
