from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from novel_archiver.config import (
    FilterConfig,
    book_matches_filter,
    effective_allowed_genres,
    format_size_for_config,
    genre_matches_filter,
    load_config,
    parse_genre_list,
    parse_size,
    save_user_settings,
)


class SettingsTests(unittest.TestCase):
    def test_parse_and_format_size(self) -> None:
        self.assertEqual(parse_size("50GB"), 50 * 1024**3)
        self.assertEqual(parse_size("1.5 GB"), int(1.5 * 1024**3))
        self.assertEqual(format_size_for_config(512 * 1024**2), "512MB")

    def test_category_presets_and_custom_genres(self) -> None:
        male_filter = FilterConfig(
            max_books_per_source=100,
            completed_statuses=["完本"],
            category_preset="male",
            allowed_genres=[],
        )
        custom_filter = FilterConfig(
            max_books_per_source=100,
            completed_statuses=["完本"],
            category_preset="custom",
            allowed_genres=["悬疑", "科幻"],
        )

        self.assertIn("玄幻", effective_allowed_genres(male_filter))
        self.assertTrue(genre_matches_filter("玄幻魔法", male_filter))
        self.assertFalse(genre_matches_filter("玄幻言情", male_filter))
        self.assertTrue(book_matches_filter("玄幻", "male", male_filter))
        self.assertFalse(book_matches_filter("玄幻", "female", male_filter))
        self.assertTrue(genre_matches_filter("科幻空间", custom_filter))
        self.assertEqual(parse_genre_list("玄幻，都市, 科幻"), ["玄幻", "都市", "科幻"])

    def test_save_user_settings_preserves_other_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.toml"
            config_path.write_text(
                """
[archive]
root = "E:\\\\old"
max_bytes = "50GB"
manifest_name = ".novel_manifest.json"

[filters]
max_books_per_source = 20
completed_statuses = ["完本"]
allowed_genres = []

[[ranking_sources]]
name = "example"
type = "json_catalog"
enabled = false
authorized = true
license_note = "test"
path = "catalog.json"
""".strip()
                + "\n",
                encoding="utf-8",
            )

            config = save_user_settings(
                config_path,
                archive_root=str(Path(temp_dir) / "books"),
                max_bytes="2GB",
                category_preset="custom",
                allowed_genres=["玄幻", "都市"],
            )
            text = config_path.read_text(encoding="utf-8")

            self.assertIn('category_preset = "custom"', text)
            self.assertIn('allowed_genres = ["玄幻", "都市"]', text)
            self.assertIn('[[ranking_sources]]', text)
            self.assertEqual(config.archive.max_bytes, 2 * 1024**3)
            self.assertEqual(config.filters.allowed_genres, ["玄幻", "都市"])
            self.assertEqual(load_config(config_path).filters.category_preset, "custom")


if __name__ == "__main__":
    unittest.main()
