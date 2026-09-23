"""Tests for non-grocery deny-list."""

import pytest

from backend.utils.non_grocery import is_non_grocery_line, is_non_grocery_normalized


class TestIsNonGroceryLineFuel:
    @pytest.mark.parametrize(
        "name",
        [
            "UNLEADED GASOLINE",
            "PREMIUM GAS",
            "REG UNL",
            "DIESEL FUEL",
            "CAR WASH",
        ],
    )
    def test_fuel_positive(self, name):
        assert is_non_grocery_line(name, "") is True


class TestIsNonGroceryLineBags:
    @pytest.mark.parametrize(
        "name",
        ["BAG FEE", "BAG CHARGE", "CARRYOUT BAG", "PAPER BAG", "REUSABLE BAG", "BAG", "BAGS"],
    )
    def test_bag_positive(self, name):
        assert is_non_grocery_line(name, "") is True

    @pytest.mark.parametrize(
        "name",
        ["BAGEL", "BAGGED SALAD", "SPINACH BAG", "EVERYTHING BAGEL"],
    )
    def test_bag_negative(self, name):
        assert is_non_grocery_line(name, "") is False


class TestIsNonGroceryLinePersonalCare:
    def test_colgate(self):
        assert is_non_grocery_line("COLGATE TP", "") is True


class TestIsNonGroceryLineCleaning:
    def test_tide(self):
        assert is_non_grocery_line("TIDE PODS", "") is True

    def test_tidbits_not_tide(self):
        assert is_non_grocery_line("TIDBITS SNACK", "") is False


class TestIsNonGroceryLinePaper:
    def test_foil(self):
        assert is_non_grocery_line("REYNOLDS ALUMINUM FOIL", "") is True


class TestIsNonGroceryLinePet:
    def test_dog_food(self):
        assert is_non_grocery_line("DOG FOOD 40LB", "") is True

    def test_petite_peas(self):
        assert is_non_grocery_line("PETITE PEAS", "") is False

    def test_catfish(self):
        assert is_non_grocery_line("FRESH CATFISH", "") is False


class TestIsNonGroceryLinePharmacy:
    def test_ibuprofen(self):
        assert is_non_grocery_line("IBUPROFEN 200MG", "") is True

    def test_vitamin_d_milk(self):
        assert is_non_grocery_line("VITAMIN D MILK", "") is False

    def test_vitamin_supplement(self):
        assert is_non_grocery_line("VITAMIN C 500MG", "") is True


class TestIsNonGroceryLineDepartment:
    def test_household_department(self):
        assert is_non_grocery_line("SOME ITEM", "Household") is True

    def test_grocery_department(self):
        assert is_non_grocery_line("WHOLE MILK", "Dairy") is False

    def test_health_beauty(self):
        assert is_non_grocery_line("SHAMPOO", "Health/Beauty") is True


class TestIsNonGroceryNormalized:
    @pytest.mark.parametrize(
        "category",
        ["household", "personal_care", "pet", "pharmacy", "non_food"],
    )
    def test_non_food_categories(self, category):
        assert is_non_grocery_normalized({"category": category}) is True

    def test_grocery_category(self):
        assert is_non_grocery_normalized({"category": "dairy"}) is False

    def test_none_mapping(self):
        assert is_non_grocery_normalized(None) is False
