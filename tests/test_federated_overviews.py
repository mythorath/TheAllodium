"""Tests for federated overview generation: queue filtering, SQL upsert, no abstract leak."""

import json
import tempfile
import unittest
from pathlib import Path
import importlib.util


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "generate_federated_overviews.py"
SECRET_ABSTRACT = "SECRET_ABSTRACT_TEXT_MUST_NEVER_BE_STORED_OR_LOGGED"


def load_module():
    spec = importlib.util.spec_from_file_location("generate_federated_overviews", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FederatedOverviewJobTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mod = load_module()

    def test_queue_keeps_resolved_only(self) -> None:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".jsonl") as handle:
            handle.write(
                json.dumps(
                    {
                        "doi": "10.1000/ok",
                        "http_status": 200,
                        "title": "Resolved",
                        "resolved_at": "2026-09-03T00:00:00Z",
                    }
                )
                + "\n"
            )
            handle.write(
                json.dumps(
                    {
                        "doi": "10.1000/miss",
                        "http_status": 404,
                        "resolved_at": "2026-09-03T00:00:00Z",
                    }
                )
                + "\n"
            )
            handle.flush()
            rows = self.mod.parse_doi_queue(Path(handle.name))
        self.assertEqual([row["doi"] for row in rows], ["10.1000/ok"])

    def test_upsert_sql_never_contains_abstract(self) -> None:
        sql = self.mod.upsert_sql(
            "10.1000/ok",
            "A short public paraphrase.",
            "qwen3.6:35b",
            "2026-09-03T00:00:00Z",
            "metadata-only",
        )
        self.assertIn("INSERT OR REPLACE INTO federated_work_overviews", sql)
        self.assertIn("10.1000/ok", sql)
        self.assertNotIn("abstract", sql.lower())
        self.assertNotIn(SECRET_ABSTRACT, sql)

    def test_metadata_only_prompt_forbids_inventing_findings(self) -> None:
        note, prompt = self.mod.build_user_prompt(
            title="Example paper",
            authors="Ada Lovelace",
            container="Example Journal",
            abstract=None,
        )
        self.assertEqual(note, "metadata-only")
        self.assertIn("Do not invent findings", prompt)
        self.assertNotIn("abstract:", prompt)

    def test_prompt_may_include_abstract_but_upsert_does_not(self) -> None:
        note, prompt = self.mod.build_user_prompt(
            title="Example paper",
            authors="Ada Lovelace",
            container="Example Journal",
            abstract=SECRET_ABSTRACT + " " + ("more detail " * 20),
        )
        self.assertEqual(note, "crossref-or-pubmed-abstract")
        self.assertIn(SECRET_ABSTRACT, prompt)
        sql = self.mod.upsert_sql(
            "10.1000/ok",
            "A short public paraphrase.",
            "qwen3.6:35b",
            "2026-09-03T00:00:00Z",
            note,
        )
        self.assertNotIn(SECRET_ABSTRACT, sql)

    def test_skip_existing_unless_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            queue = base / "doi-queue.jsonl"
            queue.write_text(
                json.dumps(
                    {
                        "doi": "10.1000/ok",
                        "http_status": 200,
                        "title": "Resolved",
                        "resolved_at": "2026-09-03T00:00:00Z",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            existing = base / "existing.txt"
            existing.write_text("10.1000/ok\n", encoding="utf-8")
            sql_out = base / "out.sql"
            code = self.mod.main(
                [
                    "--doi-queue",
                    str(queue),
                    "--existing-dois-file",
                    str(existing),
                    "--dry-run",
                    "--sql-out",
                    str(sql_out),
                    "--env",
                    "local",
                ]
            )
            self.assertEqual(code, 0)
            self.assertEqual(sql_out.read_text(encoding="utf-8"), "")

    def test_generate_overview_uses_mock_ollama_and_drops_abstract(self) -> None:
        captured: dict[str, object] = {}

        def fake_http_json(url, *, data=None, headers=None, timeout=30):
            captured["url"] = url
            payload = json.loads(data.decode("utf-8"))
            captured["user"] = payload["messages"][1]["content"]
            return {
                "message": {
                    "content": json.dumps(
                        {"overview": "This indexed record is a metadata-only example paper."}
                    )
                }
            }

        overview = self.mod.generate_overview(
            title="Example paper",
            authors="Ada Lovelace",
            container="Example Journal",
            abstract=SECRET_ABSTRACT + " " + ("findings " * 20),
            ollama_url="http://10.10.10.2:11435",
            model="qwen3.6:35b",
            http_json=fake_http_json,
        )
        self.assertIn("metadata-only example paper", overview)
        self.assertIn(SECRET_ABSTRACT, str(captured["user"]))
        self.assertTrue(str(captured["url"]).endswith("/api/chat"))


if __name__ == "__main__":
    unittest.main()
