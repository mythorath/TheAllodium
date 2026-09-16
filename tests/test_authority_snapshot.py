"""Offline integration tests for authority normalization and snapshot output."""

import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
NORMALIZER = ROOT / "scripts" / "normalize-authority-sources.py"
BUILDER = ROOT / "scripts" / "build-authority-snapshot.py"
MIGRATIONS = sorted((ROOT / "authority-migrations").glob("*.sql"))


class AuthoritySnapshotTest(unittest.TestCase):
    def test_offline_fixture_builds_complete_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            normalized = base / "normalized"
            snapshot = base / "snapshot"
            snapshot_again = base / "snapshot-again"
            subprocess.run(
                [
                    sys.executable,
                    str(NORMALIZER),
                    "--output-dir",
                    str(normalized),
                    "--fetched-at",
                    "2026-09-01T00:00:00Z",
                    "--smoke-fixture",
                ],
                check=True,
                cwd=ROOT,
            )
            subprocess.run(
                [
                    sys.executable,
                    str(BUILDER),
                    "--input-dir",
                    str(normalized),
                    "--output-dir",
                    str(snapshot_again),
                    "--snapshot-id",
                    "smoke-2026-09-01",
                    "--snapshot-at",
                    "2026-09-01T00:00:00Z",
                ],
                check=True,
                cwd=ROOT,
            )
            subprocess.run(
                [
                    sys.executable,
                    str(BUILDER),
                    "--input-dir",
                    str(normalized),
                    "--output-dir",
                    str(snapshot),
                    "--snapshot-id",
                    "smoke-2026-09-01",
                    "--snapshot-at",
                    "2026-09-01T00:00:00Z",
                ],
                check=True,
                cwd=ROOT,
            )

            expected = {
                "import.sql",
                "import.sql.sha256",
                "checksum.txt",
                "manifest.json",
                "licenses.json",
            }
            self.assertTrue(expected.issubset({path.name for path in snapshot.iterdir()}))
            for filename in expected:
                self.assertEqual(
                    (snapshot / filename).read_bytes(),
                    (snapshot_again / filename).read_bytes(),
                    f"{filename} must be deterministic",
                )
            sql = (snapshot / "import.sql").read_bytes()
            checksum = hashlib.sha256(sql).hexdigest()
            self.assertEqual((snapshot / "checksum.txt").read_text().strip(), checksum)
            self.assertEqual(
                (snapshot / "import.sql.sha256").read_text().strip(),
                f"{checksum}  import.sql",
            )

            licenses = json.loads((snapshot / "licenses.json").read_text())
            by_family = {item["family"]: item for item in licenses["families"]}
            self.assertEqual(by_family["retraction_watch"]["license_name"], "CC BY 4.0")
            self.assertEqual(by_family["doaj"]["license_name"], "CC0 1.0")

            connection = sqlite3.connect(":memory:")
            for migration in MIGRATIONS:
                connection.executescript(migration.read_text())
            connection.executescript(sql.decode("utf-8"))
            counts = dict(
                connection.execute(
                    "SELECT family, row_count FROM authority_manifest ORDER BY family"
                )
            )
            self.assertEqual(counts["openalex"], 7)
            self.assertEqual(counts["ror"], 1)
            self.assertEqual(counts["retraction_watch"], 1)
            self.assertEqual(counts["doaj"], 1)
            self.assertEqual(counts["nlm"], 1)
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM oa_topic_keywords").fetchone()[0],
                2,
            )
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM doaj_journal_subjects").fetchone()[0],
                1,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT keyword FROM oa_topic_keywords ORDER BY keyword"
                ).fetchall(),
                [("clinical",), ("therapy",)],
            )

            connection.execute(
                "INSERT INTO federated_work_overviews "
                "(doi, overview, model, generated_at, source_note) VALUES (?,?,?,?,?)",
                (
                    "10.1000/keep-me",
                    "A paraphrase that must survive snapshot promotion.",
                    "qwen3.6:35b",
                    "2026-09-03T00:00:00Z",
                    "test",
                ),
            )
            connection.execute(
                "INSERT INTO hub_work_records "
                "(doi, title, authors_json, publication_year, publication_date, "
                "container_title, work_type, is_open_access, cited_by_count, "
                "canonical_url, openalex_id, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "10.1000/keep-hub",
                    "A hub work that must survive snapshot promotion.",
                    "[]",
                    2020,
                    "2020-01-01",
                    "Example Journal",
                    "article",
                    1,
                    3,
                    "https://doi.org/10.1000/keep-hub",
                    "https://openalex.org/Wkeep",
                    "2026-09-03T00:00:00Z",
                ),
            )
            connection.execute(
                "INSERT INTO hub_works (hub_kind, hub_id, rank_kind, rank, doi) "
                "VALUES (?,?,?,?,?)",
                ("topic", "T-keep", "cited", 1, "10.1000/keep-hub"),
            )
            connection.executescript(sql.decode("utf-8"))
            self.assertEqual(
                connection.execute(
                    "SELECT overview FROM federated_work_overviews WHERE doi = ?",
                    ("10.1000/keep-me",),
                ).fetchone()[0],
                "A paraphrase that must survive snapshot promotion.",
            )
            self.assertEqual(
                connection.execute(
                    "SELECT title FROM hub_work_records WHERE doi = ?",
                    ("10.1000/keep-hub",),
                ).fetchone()[0],
                "A hub work that must survive snapshot promotion.",
            )
            self.assertEqual(
                connection.execute(
                    "SELECT doi FROM hub_works WHERE hub_kind = ? AND hub_id = ? "
                    "AND rank_kind = ? AND rank = ?",
                    ("topic", "T-keep", "cited", 1),
                ).fetchone()[0],
                "10.1000/keep-hub",
            )

    def test_delete_order_omits_federated_work_overviews(self) -> None:
        import importlib.util

        spec = importlib.util.spec_from_file_location("authority_snapshot", BUILDER)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        self.assertNotIn("federated_work_overviews", module.DELETE_ORDER)

    def test_delete_order_omits_hub_works_tables(self) -> None:
        import importlib.util

        spec = importlib.util.spec_from_file_location("authority_snapshot", BUILDER)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        self.assertNotIn("hub_works", module.DELETE_ORDER)
        self.assertNotIn("hub_work_records", module.DELETE_ORDER)


if __name__ == "__main__":
    unittest.main()
