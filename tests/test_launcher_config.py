from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from launcher import ensure_config


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


if __name__ == "__main__":
    unittest.main()
