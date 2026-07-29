from __future__ import annotations

import posixpath
import unittest


def export_okf_link_path(source_file: str, target_id: str) -> str:
    """Model wiki-export Step 3.5's required target-file relpath behavior."""
    source_dir = posixpath.dirname(source_file)
    target_file = f"{target_id}.md"
    return posixpath.relpath(target_file, source_dir)


def import_okf_link_target(source_file: str, markdown_target: str) -> str:
    """Model wiki-import Step 4-OKF's .md path -> page id reversal."""
    source_dir = posixpath.dirname(source_file)
    resolved = posixpath.normpath(posixpath.join(source_dir, markdown_target))
    if not resolved.endswith(".md"):
        raise ValueError(f"expected markdown file path, got: {markdown_target}")
    return resolved[:-3]


class OkfSameNameLinkRoundTripTest(unittest.TestCase):
    def test_child_to_parent_uses_target_file_path(self) -> None:
        source = "projects/social-twitter/concepts/mem0-memory-analysis.md"
        target_id = "projects/social-twitter"

        exported = export_okf_link_path(source, target_id)

        self.assertEqual(exported, "../../social-twitter.md")

    def test_child_to_parent_round_trips_back_to_parent_id(self) -> None:
        source = "projects/social-twitter/concepts/mem0-memory-analysis.md"
        markdown_target = "../../social-twitter.md"

        restored = import_okf_link_target(source, markdown_target)

        self.assertEqual(restored, "projects/social-twitter")

    def test_naive_id_relpath_is_the_buggy_case(self) -> None:
        source_dir = "projects/social-twitter/concepts"
        target_id = "projects/social-twitter"

        buggy = posixpath.relpath(target_id, source_dir) + ".md"

        self.assertEqual(buggy, "...md")


if __name__ == "__main__":
    unittest.main()
