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


if __name__ == "__main__":
    unittest.main()
