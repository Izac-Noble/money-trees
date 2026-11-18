import money_trees_engine


def test_engine_imports_with_version() -> None:
    assert money_trees_engine.__version__ == "0.1.0"
