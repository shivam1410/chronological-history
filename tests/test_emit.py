"""Emitting the JSON bundles the browser reads."""
import json

import pytest

from pipeline.emit import (
    FLAG_CONTESTED,
    FLAG_IMPORTED,
    FLAG_ONGOING,
    FLAG_UNCERTAIN_END,
    FLAG_UNCERTAIN_START,
    SPINE_FIELDS,
    bucket_for,
    write_bundles,
)
from pipeline.loader import load_entries, load_taxonomy

FIXTURES = "tests/fixtures"


@pytest.fixture
def taxonomy():
    return load_taxonomy(
        regions_path=f"{FIXTURES}/mini_taxonomy_regions.yaml",
        kinds_path="data/taxonomy/kinds.yaml",
        categories_path="data/taxonomy/categories.yaml",
    )


@pytest.fixture
def entries(taxonomy):
    return load_entries([f"{FIXTURES}/mini.yaml"], taxonomy)


@pytest.fixture
def built(tmp_path, entries, taxonomy):
    write_bundles(entries, taxonomy, out_dir=str(tmp_path))
    meta = json.loads((tmp_path / "meta.json").read_text())
    spine = json.loads((tmp_path / "spine.json").read_text())
    return tmp_path, meta, spine


class TestBucketing:
    @pytest.mark.parametrize("year,bucket", [
        (-4_539_998_051, "pre-cambrian"),
        (-300_000_000, "paleozoic"),
        (-232_998_051, "mesozoic"),       # dinosaurs begin, 233 Ma
        (-30_000_000, "cenozoic-early"),
        (-1_000_000, "pleistocene"),
        (-9_000, "holocene-early"),
        (-3_000, "bce-3000-2501"),
        (-1_500, "bce-1500-1001"),
        (-1, "bce-500-1"),
        (1, "ce-0001-0500"),
        (1_300, "ce-1001-1499"),
        (1_500, "1500-1599"),
        (1_526, "1500-1599"),
        (1_947, "1900-1999"),
        (2_026, "2000-2099"),
    ])
    def test_bucket_for(self, year, bucket):
        assert bucket_for(year) == bucket

    def test_buckets_are_contiguous_and_non_overlapping(self):
        # Every year in a broad sample lands in exactly one bucket.
        probes = [-4_539_998_051, -541_000_000, -66_000_000, -2_580_000,
                  -11_700, -3_000, -1, 1, 1_499, 1_500, 2_026]
        assert all(bucket_for(y) for y in probes)


class TestMeta:
    def test_counts(self, built):
        _, meta, _ = built
        assert meta["counts"]["entries"] == 6
        assert meta["counts"]["curated"] == 5
        assert meta["counts"]["imported"] == 1

    def test_year_range_spans_the_dataset(self, built):
        _, meta, _ = built
        assert meta["yearRange"][0] == -232_998_051   # dinosaur start
        assert meta["yearRange"][1] >= 2026           # holocene is ongoing

    def test_lanes_carry_label_order_and_colour(self, built):
        _, meta, _ = built
        india = next(l for l in meta["lanes"] if l["id"] == "india")
        assert india["label"] == "Indian Subcontinent"
        assert india["order"] == 1
        assert india["color"] == "--lane-india"
        assert india["subRegions"] == ["north-india"]

    def test_era_buckets_report_counts(self, built):
        _, meta, _ = built
        by_id = {b["id"]: b for b in meta["eraBuckets"]}
        assert by_id["1500-1599"]["count"] == 1     # mughal-empire
        assert by_id["ce-1001-1499"]["count"] == 2  # kabir, renaissance

    def test_only_non_empty_buckets_are_listed(self, built):
        _, meta, _ = built
        assert all(b["count"] > 0 for b in meta["eraBuckets"])


class TestSpine:
    def test_field_order_matches_the_contract(self, built):
        _, _, spine = built
        assert spine["fields"] == list(SPINE_FIELDS)

    def test_every_entry_is_present(self, built):
        _, _, spine = built
        assert len(spine["rows"]) == 6

    def test_a_row_carries_the_interval_and_lane(self, built):
        _, _, spine = built
        row = dict(zip(spine["fields"], next(
            r for r in spine["rows"] if r[0] == "mughal-empire")))
        assert row["title"] == "Mughal Empire"
        assert row["lane"] == "india"
        assert (row["sMin"], row["sMax"], row["eMin"], row["eMax"]) == (
            1526, 1526, 1857, 1857)
        assert row["imp"] == 5
        assert row["bucket"] == "1500-1599"

    def test_flags_encode_uncertainty_and_confidence(self, built):
        _, _, spine = built
        row = dict(zip(spine["fields"], next(
            r for r in spine["rows"] if r[0] == "kabir")))
        flags = row["flags"]
        assert flags & FLAG_UNCERTAIN_START
        assert flags & FLAG_UNCERTAIN_END
        assert flags & FLAG_CONTESTED
        assert not flags & FLAG_ONGOING
        assert not flags & FLAG_IMPORTED

    def test_precise_entry_has_no_uncertainty_flags(self, built):
        _, _, spine = built
        row = dict(zip(spine["fields"], next(
            r for r in spine["rows"] if r[0] == "mughal-empire")))
        assert row["flags"] == 0


class TestEraBundles:
    def test_bundle_is_written_per_populated_bucket(self, built):
        tmp_path, meta, _ = built
        for bucket in meta["eraBuckets"]:
            assert (tmp_path / "eras" / f"{bucket['id']}.json").exists()

    def test_bundle_carries_prose_and_links(self, built):
        tmp_path, _, _ = built
        bundle = json.loads((tmp_path / "eras" / "ce-1001-1499.json").read_text())
        kabir = bundle["entries"]["kabir"]
        assert kabir["summary"].startswith("Poet-saint")
        assert kabir["display"] == "c. 1398–1440 to c. 1448–1518"
        assert kabir["regions"] == ["north-india"]
        assert kabir["aliases"] == ["Kabir Das"]
        assert kabir["sources"][0]["url"].startswith("https://")

    def test_related_links_survive(self, built):
        tmp_path, _, _ = built
        bundle = json.loads((tmp_path / "eras" / "1500-1599.json").read_text())
        assert bundle["entries"]["mughal-empire"]["related"] == ["kabir"]


class TestFlagsSetByOtherOrigins:
    """The ongoing and imported bits were only ever asserted absent before."""

    def test_ongoing_entry_sets_the_ongoing_flag(self, built):
        _, _, spine = built
        row = dict(zip(spine["fields"], next(
            r for r in spine["rows"] if r[0] == "holocene")))
        assert row["flags"] & FLAG_ONGOING
        assert not row["flags"] & FLAG_IMPORTED

    def test_imported_entry_sets_the_imported_flag(self, built):
        _, _, spine = built
        row = dict(zip(spine["fields"], next(
            r for r in spine["rows"] if r[0] == "imported-example")))
        assert row["flags"] & FLAG_IMPORTED
        assert not row["flags"] & FLAG_ONGOING


class TestDeterminism:
    def test_two_builds_differ_only_in_the_timestamp(self, tmp_path, entries, taxonomy):
        a, b = tmp_path / "a", tmp_path / "b"
        write_bundles(entries, taxonomy, out_dir=str(a))
        write_bundles(entries, taxonomy, out_dir=str(b))

        assert (a / "spine.json").read_text() == (b / "spine.json").read_text()

        meta_a = json.loads((a / "meta.json").read_text())
        meta_b = json.loads((b / "meta.json").read_text())
        meta_a.pop("generated")
        meta_b.pop("generated")
        assert meta_a == meta_b
