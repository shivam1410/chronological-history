"""Loading YAML sources into Entry objects with taxonomy resolved."""
import pytest

from pipeline.loader import Taxonomy, load_entries, load_taxonomy
from pipeline.model import Bound

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


class TestTaxonomy:
    def test_lanes_are_ordered(self, taxonomy):
        assert [lane.id for lane in taxonomy.lanes] == ["india", "europe"]

    def test_sub_regions_resolve_to_their_lane(self, taxonomy):
        assert taxonomy.lane_for("north-india") == "india"

    def test_a_lane_id_resolves_to_itself(self, taxonomy):
        assert taxonomy.lane_for("europe") == "europe"

    def test_unknown_region_has_no_lane(self, taxonomy):
        assert taxonomy.lane_for("atlantis") is None

    def test_kinds_and_categories_load(self, taxonomy):
        assert "polity" in taxonomy.kinds
        assert "empire" in taxonomy.categories


class TestLoadEntries:
    def test_every_entry_is_loaded(self, entries):
        assert len(entries) == 4

    def test_entries_are_returned_in_id_order(self, entries):
        assert [e.id for e in entries] == [
            "dinosaur-era", "kabir", "mughal-empire", "renaissance",
        ]

    def test_scalar_dates_become_precise_bounds(self, entries):
        mughal = next(e for e in entries if e.id == "mughal-empire")
        assert mughal.start == Bound(1526, 1526, "1526")
        assert mughal.end == Bound(1857, 1857, "1857")

    def test_bracketed_dates_are_preserved(self, entries):
        kabir = next(e for e in entries if e.id == "kabir")
        assert (kabir.start.min, kabir.start.max) == (1398, 1440)
        assert kabir.confidence == "contested"

    def test_deep_time_shorthand_is_parsed(self, entries):
        dino = next(e for e in entries if e.id == "dinosaur-era")
        assert dino.start.min == -232_998_051
        assert dino.start.display == "233 Ma"

    def test_optional_fields_default_cleanly(self, entries):
        ren = next(e for e in entries if e.id == "renaissance")
        assert ren.categories == ()
        assert ren.sources == ()
        assert ren.confidence == "high"
        assert ren.origin == "curated"

    def test_sources_become_records(self, entries):
        kabir = next(e for e in entries if e.id == "kabir")
        assert kabir.sources[0].title == "Britannica"
        assert kabir.sources[0].url.startswith("https://")

    def test_source_file_is_recorded_for_error_messages(self, entries):
        assert all(e.source_file.endswith("mini.yaml") for e in entries)

    def test_lane_is_resolved_from_the_first_region(self, entries, taxonomy):
        kabir = next(e for e in entries if e.id == "kabir")
        assert taxonomy.lane_for(kabir.regions[0]) == "india"


class TestLoadErrors:
    def test_unknown_field_is_rejected(self, tmp_path, taxonomy):
        bad = tmp_path / "bad.yaml"
        bad.write_text(
            "- id: x\n  title: X\n  kind: polity\n  regions: [europe]\n"
            "  start: 1\n  end: 2\n  importance: 1\n  summary: s\n  colour: blue\n"
        )
        with pytest.raises(ValueError, match="unknown field 'colour'"):
            load_entries([str(bad)], taxonomy)

    def test_missing_required_field_is_rejected(self, tmp_path, taxonomy):
        bad = tmp_path / "bad.yaml"
        bad.write_text("- id: x\n  title: X\n  kind: polity\n")
        with pytest.raises(ValueError, match="missing required field"):
            load_entries([str(bad)], taxonomy)

    def test_error_names_the_file_and_entry(self, tmp_path, taxonomy):
        bad = tmp_path / "broken.yaml"
        bad.write_text(
            "- id: kabir\n  title: K\n  kind: person\n  regions: [europe]\n"
            "  start: 1440\n  end: 1398\n  importance: 1\n  summary: s\n"
        )
        with pytest.raises(ValueError) as exc:
            load_entries([str(bad)], taxonomy)
        assert "broken.yaml" in str(exc.value)
        assert "kabir" in str(exc.value)
