"""Vault resolution for a non-default Claude Code instance.

Each Claude instance has its own global config (``config`` or
``config.<profile>``) that records the instance as ``CLAUDE_HISTORY_PATH``.
When ``$CLAUDE_CONFIG_DIR`` is set, the CLI, the Python client and the
SessionStart hook must resolve the vault of that instance, the same as the
Config Resolution Protocol that the skills follow.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from obsidian_wiki import memory as mem

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / ".claude" / "hooks" / "wiki-session-recap.sh"


@pytest.fixture()
def home(tmp_path: Path) -> Path:
    home = tmp_path / "home"
    (home / ".config" / "obsidian-wiki").mkdir(parents=True)
    return home


@pytest.fixture()
def vaults(tmp_path: Path) -> dict[str, Path]:
    found = {}
    for name in ("default", "work", "trap", "project"):
        vault = tmp_path / f"vault-{name}"
        (vault / "_meta").mkdir(parents=True)
        found[name] = vault
    return found


def _write_config(home: Path, filename: str, vault: Path, instance: Path) -> None:
    (home / ".config" / "obsidian-wiki" / filename).write_text(
        f'OBSIDIAN_VAULT_PATH="{vault}"\nCLAUDE_HISTORY_PATH="{instance}"\n',
        encoding="utf-8",
    )


def _two_instances(home: Path, vaults: dict[str, Path]) -> None:
    _write_config(home, "config", vaults["default"], home / ".claude")
    _write_config(home, "config.work", vaults["work"], home / ".claude-work")


def _env(home: Path, instance: str | None) -> dict[str, str]:
    env = {
        **os.environ,
        "HOME": str(home),
        "PYTHONPATH": str(ROOT),
        "XDG_CONFIG_HOME": str(home / ".config"),
    }
    env.pop("CLAUDE_CONFIG_DIR", None)
    env.pop("OBSIDIAN_VAULT_PATH", None)
    if instance is not None:
        env["CLAUDE_CONFIG_DIR"] = instance
    return env


def _cli_vault(home: Path, cwd: Path, instance: str | None) -> str:
    proc = subprocess.run(
        [sys.executable, "-m", "obsidian_wiki.cli", "memory", "status", "--json"],
        capture_output=True,
        text=True,
        env=_env(home, instance),
        cwd=cwd,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)["vault"]


def _project(home: Path) -> Path:
    project = home / "project"
    project.mkdir()
    return project


def test_cli_resolves_the_vault_of_the_running_instance(home: Path, vaults: dict[str, Path]) -> None:
    _two_instances(home, vaults)

    vault = _cli_vault(home, _project(home), str(home / ".claude-work"))

    assert vault == str(vaults["work"].resolve())


def test_cli_without_an_instance_uses_the_global_config(home: Path, vaults: dict[str, Path]) -> None:
    _two_instances(home, vaults)

    vault = _cli_vault(home, _project(home), None)

    assert vault == str(vaults["default"].resolve())


def test_cli_matches_the_instance_path_exactly(home: Path, vaults: dict[str, Path]) -> None:
    _write_config(home, "config.a", vaults["trap"], home / ".claude-work-old")
    _write_config(home, "config.b", vaults["work"], home / ".claude-work")

    vault = _cli_vault(home, _project(home), str(home / ".claude-work"))

    assert vault == str(vaults["work"].resolve())


def test_cli_ignores_a_trailing_slash_on_the_instance(home: Path, vaults: dict[str, Path]) -> None:
    _two_instances(home, vaults)

    vault = _cli_vault(home, _project(home), f"{home / '.claude-work'}/")

    assert vault == str(vaults["work"].resolve())


def test_cli_instance_match_takes_precedence_over_a_project_env(
    home: Path, vaults: dict[str, Path]
) -> None:
    _two_instances(home, vaults)
    project = _project(home)
    (project / ".env").write_text(f"OBSIDIAN_VAULT_PATH={vaults['project']}\n", encoding="utf-8")

    vault = _cli_vault(home, project, str(home / ".claude-work"))

    assert vault == str(vaults["work"].resolve())


def test_cli_falls_back_when_no_config_matches_the_instance(home: Path, vaults: dict[str, Path]) -> None:
    _two_instances(home, vaults)

    vault = _cli_vault(home, _project(home), str(home / ".claude-unknown"))

    assert vault == str(vaults["default"].resolve())


def test_client_resolves_the_vault_of_the_running_instance(home: Path, vaults: dict[str, Path]) -> None:
    _two_instances(home, vaults)

    proc = subprocess.run(
        [sys.executable, "-c", "from obsidian_wiki.client import resolve_vault; print(resolve_vault())"],
        capture_output=True,
        text=True,
        env=_env(home, str(home / ".claude-work")),
        cwd=_project(home),
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == str(vaults["work"].resolve())


@pytest.mark.skipif(
    os.name == "nt" or shutil.which("bash") is None,
    reason="bash hooks are tested on POSIX; bash on Windows CI is the WSL stub, not Git Bash",
)
def test_hook_recaps_the_vault_of_the_running_instance(home: Path, vaults: dict[str, Path]) -> None:
    _two_instances(home, vaults)
    mem.set_fact(vaults["default"], "editor", "DEFAULT-VAULT-FACT")
    mem.set_fact(vaults["work"], "editor", "WORK-VAULT-FACT")

    proc = subprocess.run(
        ["bash", str(HOOK)],
        capture_output=True,
        text=True,
        env=_env(home, str(home / ".claude-work")),
        cwd=_project(home),
        timeout=60,
    )

    assert proc.returncode == 0, proc.stderr
    assert "WORK-VAULT-FACT" in proc.stdout
    assert "DEFAULT-VAULT-FACT" not in proc.stdout
