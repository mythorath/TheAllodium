"""Unit tests for the hub-works OpenAlex fetch job."""

import json
import tempfile
import unittest
from pathlib import Path
import importlib.util


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "fetch-hub-works.py"
SECRET_ABSTRACT = {"I": [0], "must": [1], "not": [2], "leak": [3]}


def load_module():
    spec = importlib.util.spec_from_file_location("fetch_hub_works", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class HubWorksFetchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mod = load_module()

    def test_select_excludes_abstract_fields(self) -> None:
        self.assertNotIn("abstract_inverted_index", self.mod.SELECT_FIELDS)
        self.assertNotIn("abstract", self.mod.SELECT_FIELDS)
        for field in self.mod.SELECT_FIELDS:
            self.assertNotIn("abstract", field)

    def test_works_url_uses_polite_pool_filters_and_select(self) -> None:
        url = self.mod.build_works_url(
            hub_kind="subfield",
            hub_id="https://openalex.org/subfields/2713",
            rank_kind="cited",
            mailto="index@theallodium.org",
        )
        self.assertTrue(url.startswith("https://api.openalex.org/works?"))
        self.assertIn("mailto=index%40theallodium.org", url)
        self.assertIn("has_doi%3Atrue", url)
        self.assertIn("type%3Aarticle", url)
        self.assertIn("primary_topic.subfield.id%3A2713", url)
        self.assertIn("cited_by_count%3Adesc", url)
        self.assertIn("select=", url)
        self.assertNotIn("abstract_inverted_index", url)
        self.assertNotIn("abstract", url.split("select=")[-1])

        recent = self.mod.build_works_url(
            hub_kind="topic",
            hub_id="T1",
            rank_kind="recent",
            mailto="index@theallodium.org",
        )
        self.assertIn("primary_topic.id%3AT1", recent)
        self.assertIn("publication_date%3Adesc", recent)

    def test_map_work_drops_abstract_inverted_index(self) -> None:
        mapped = self.mod.map_work(
            {
                "id": "https://openalex.org/W1",
                "doi": "https://doi.org/10.1000/Example",
                "title": "Example paper",
                "abstract_inverted_index": SECRET_ABSTRACT,
                "abstract": "SECRET ABSTRACT TEXT",
                "authorships": [
                    {"author": {"display_name": "Ada Example", "orcid": None}},
                ],
                "publication_year": 2020,
                "publication_date": "2020-06-01",
                "primary_location": {
                    "landing_page_url": "https://doi.org/10.1000/example",
                    "source": {"display_name": "Example Journal"},
                },
                "type": "article",
                "open_access": {"is_oa": True},
                "cited_by_count": 4,
            },
            "2026-09-03T00:00:00Z",
        )
        assert mapped is not None
        self.assertEqual(mapped["doi"], "10.1000/example")
        self.assertEqual(mapped["authors_json"][0]["name"], "Ada Example")
        self.assertNotIn("abstract_inverted_index", mapped)
        self.assertNotIn("abstract", mapped)
        dumped = json.dumps(mapped)
        self.assertNotIn("SECRET ABSTRACT", dumped)
        self.assertNotIn("abstract_inverted_index", dumped)

        sql = self.mod.record_sql(mapped)
        self.assertIn("INSERT OR REPLACE INTO hub_work_records", sql)
        self.assertNotIn("abstract", sql.lower())
        self.assertNotIn("SECRET ABSTRACT", sql)

    def test_resume_skips_completed_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "hub-works.jsonl"
            path.write_text(
                json.dumps(
                    {
                        "hub_kind": "domain",
                        "hub_id": "D1",
                        "rank_kind": "cited",
                        "works": [],
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            completed = self.mod.load_completed_jobs(path)
            self.assertEqual(completed, {("domain", "D1", "cited")})
            remaining = [
                job for job in self.mod.expand_jobs([("domain", "D1")])
                if job not in completed
            ]
            self.assertEqual(remaining, [("domain", "D1", "recent")])

    def test_retry_sleep_caps_and_aborts_daily_budget(self) -> None:
        self.assertEqual(self.mod.retry_sleep_seconds(None, 0), 1)
        self.assertEqual(self.mod.retry_sleep_seconds("12", 0), 12)
        self.assertEqual(self.mod.retry_sleep_seconds("90", 0), 60)
        with self.assertRaises(self.mod.OpenAlexBudgetError):
            self.mod.retry_sleep_seconds("70823", 0)


if __name__ == "__main__":
    unittest.main()
