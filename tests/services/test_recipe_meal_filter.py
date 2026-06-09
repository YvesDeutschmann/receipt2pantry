"""Tests for recipe meal-type / dish-type filtering helpers."""

import pytest

from backend.services.recipe_meal_filter import (
    is_appropriate_for_meal,
    is_treat,
    spoonacular_type_for_meal,
)


@pytest.mark.parametrize(
    "meal_type,expected",
    [
        ("breakfast", "breakfast"),
        ("lunch", "main course,salad,soup,sandwich"),
        ("dinner", "main course"),
    ],
)
def test_spoonacular_type_for_meal(meal_type, expected):
    assert spoonacular_type_for_meal(meal_type) == expected


def test_is_treat_dessert():
    assert is_treat(["dessert"]) is True
    assert is_treat(["main course", "dinner"]) is False


def test_is_appropriate_pancakes_not_for_dinner():
    assert is_appropriate_for_meal(["breakfast", "brunch"], "dinner") is False


def test_is_appropriate_main_course_for_dinner():
    assert is_appropriate_for_meal(["main course", "dinner"], "dinner") is True


def test_is_appropriate_breakfast_for_breakfast():
    assert is_appropriate_for_meal(["breakfast"], "breakfast") is True
