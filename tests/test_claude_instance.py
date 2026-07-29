"""Tests for multi-instance Claude Code support in the installer CLI.

Claude Code sets ``$CLAUDE_CONFIG_DIR`` for non-default instances. Skills must
be installed into that instance's directory (not a hardcoded ``~/.claude``), and
the path must be recorded as ``CLAUDE_HISTORY_PATH`` so the skills' Config
Resolution Protocol can match the config back to the instance at runtime.
"""

from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]


def _run(home: Path, *args: str, config_dir: Path | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["PYTHONPATH"] = str(ROOT)
    env.pop("CLAUDE_CONFIG_DIR", None)
    if config_dir is not None:
        env["CLAUDE_CONFIG_DIR"] = str(config_dir)
    return subprocess.run(
        [sys.executable, "-m", "obsidian_wiki.cli", *args],
        capture_output=True,
        text=True,
        env=env,
        cwd=home,
    )


class ClaudeInstanceTest(unittest.TestCase):
    def test_setup_installs_into_the_instance_from_claude_config_dir(self) -> None:
        with TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            vault = Path(tmp) / "vault"
            instance = home / ".claude-work"
            home.mkdir()
            vault.mkdir()

            proc = _run(home, "setup", "--vault", str(vault), config_dir=instance)
            self.assertEqual(proc.returncode, 0, proc.stderr)

            self.assertTrue((instance / "skills" / "wiki-query").exists())
            self.assertFalse((home / ".claude" / "skills").exists())

    def test_setup_records_the_instance_as_claude_history_path(self) -> None:
        with TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            vault = Path(tmp) / "vault"
            instance = home / ".claude-work"
            home.mkdir()
            vault.mkdir()

            _run(home, "setup", "--vault", str(vault), config_dir=instance)

            config = (home / ".obsidian-wiki" / "config").read_text(encoding="utf-8")
            self.assertIn(f'CLAUDE_HISTORY_PATH="{instance}"', config)

    def test_config_pins_the_instance_when_the_env_var_is_absent(self) -> None:
        """A later run without $CLAUDE_CONFIG_DIR still targets the same instance."""
        with TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            vault = Path(tmp) / "vault"
            instance = home / ".claude-work"
            home.mkdir()
            vault.mkdir()

            _run(home, "setup", "--vault", str(vault), config_dir=instance)
            (instance / "skills" / "wiki-query").unlink()

            proc = _run(home, "setup", "--vault", str(vault))

            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue((instance / "skills" / "wiki-query").exists())
            self.assertFalse((home / ".claude" / "skills").exists())

    def test_default_instance_still_installs_into_dot_claude(self) -> None:
        with TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            vault = Path(tmp) / "vault"
            home.mkdir()
            vault.mkdir()

            proc = _run(home, "setup", "--vault", str(vault))

            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue((home / ".claude" / "skills" / "wiki-query").exists())


if __name__ == "__main__":
    unittest.main()
