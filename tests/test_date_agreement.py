"""How our brackets are compared against Wikidata's dates."""
import pytest

from pipeline.wikidata import dates_agree


class TestContainment:
    """Wikidata usually gives a point where we give a range."""

    def test_a_point_inside_our_bracket_agrees(self):
        # Control of fire: ours 1.5 Ma - 400 ka, theirs 1.0 Ma.
        assert dates_agree((-1_498_051, -398_051), [-1_001_950])

    def test_a_point_on_the_edge_agrees(self):
        assert dates_agree((1526, 1857), [1526])
        assert dates_agree((1526, 1857), [1857])

    def test_a_point_outside_disagrees(self):
        assert not dates_agree((1526, 1857), [1200])

    def test_a_range_overlapping_ours_agrees(self):
        assert dates_agree((1428, 1521), [1400, 1450])


class TestTolerance:
    def test_one_year_out_agrees_in_recorded_history(self):
        assert dates_agree((1526, 1857), [1858])

    def test_two_hundred_years_out_disagrees_in_recorded_history(self):
        assert not dates_agree((1526, 1857), [1650 + 500])

    def test_tolerance_scales_for_deep_time(self):
        # 3.9 Ma with a 1950 offset vs a round figure - the same thing.
        assert dates_agree((-3_898_051, -2_898_051), [-3_900_000])

    def test_a_genuinely_different_deep_time_date_disagrees(self):
        # Eukaryotes: ours 2.1-1.6 Ga, theirs 2.7 Ga is a real difference.
        assert not dates_agree((-2_099_998_051, -1_599_998_051), [-2_700_000_000])


class TestEdges:
    def test_no_wikidata_dates_is_not_agreement(self):
        assert not dates_agree((1526, 1857), [])

    def test_any_one_matching_date_is_enough(self):
        assert dates_agree((1526, 1857), [1200, 1700, 1990])

    @pytest.mark.parametrize("ours", [(1857, 1526), (1526, 1857)])
    def test_bracket_order_does_not_matter(self, ours):
        assert dates_agree(ours, [1700])
