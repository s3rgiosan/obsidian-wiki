#!/bin/bash
#
# obsidian-wiki setup — configures skill discovery for all supported AI agents.
#
# Usage: bash setup.sh
#
# What it does:
#   1. Creates .env from .env.example (if not present)
#   2. Writes ~/.obsidian-wiki/config[.<profile>] so skills work from any project
#   3. Symlinks .skills/* into each agent's expected skills directory:
#      Project-local:
#        - .claude/skills/        (Claude Code)
#        - .cursor/skills/        (Cursor)
#        - .windsurf/skills/      (Windsurf)
#        - .agents/skills/        (AGENTS.md-aware agents, generic)
#        - .kiro/skills/          (Kiro IDE/CLI)
#      Global:
#        - <CLAUDE_HISTORY_PATH>/skills/    (Claude Code, portable skills only)
#        - ~/.gemini/skills/      (Gemini CLI)
#        - ~/.codex/skills/       (Codex)
#        - ~/.hermes/skills/      (Hermes)
#        - ~/.openclaw/skills/    (OpenClaw)
#        - ~/.copilot/skills/     (GitHub Copilot CLI)
#        - ~/.trae/skills/        (Trae)
#        - ~/.trae-cn/skills/     (Trae CN)
#        - ~/.kiro/skills/        (Kiro CLI)
#        - ~/.agents/skills/      (OpenCode, Aider, Factory Droid, generic)
#   4. Bootstraps AGENTS.md aliases (CLAUDE.md, GEMINI.md, .hermes.md)
#   5. Prints a summary of what's ready
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$SCRIPT_DIR/.skills"

# Symlink every skill in SKILLS_DIR into TARGET_DIR.
# Skips real directories to avoid data loss; updates stale symlinks.
install_skills() {
  local target_dir="$1"
  local label="$2"
  mkdir -p "$target_dir"
  for skill in "$SKILLS_DIR"/*/; do
    local skill_name link_path
    skill_name="$(basename "$skill")"
    link_path="$target_dir/$skill_name"
    if [ -L "$link_path" ]; then
      rm "$link_path"
    elif [ -d "$link_path" ]; then
      echo "⚠️   $link_path is a real directory, skipping symlink"
      continue
    fi
    ln -s "${skill%/}" "$link_path"
  done
  echo "✅  Installed global skills → $label"
}

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         obsidian-wiki — Agent Setup              ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Step 1: .env ──────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  echo "✅  Created .env from .env.example"
  echo "    → Edit .env and set OBSIDIAN_VAULT_PATH before using skills."
else
  echo "✅  .env already exists"
fi

# ── Step 1b: ~/.obsidian-wiki/config ─────────────────────────
GLOBAL_CONFIG_DIR="$HOME/.obsidian-wiki"
mkdir -p "$GLOBAL_CONFIG_DIR"

# Read vault path from .env if it's already set
VAULT_PATH=""
if [ -f "$SCRIPT_DIR/.env" ]; then
  # Strip quotes if present, but preserve the path (spaces or not)
  VAULT_PATH=$(grep -E '^OBSIDIAN_VAULT_PATH=' "$SCRIPT_DIR/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//')
fi

# If vault path is empty or placeholder, ask the user
if [ -z "$VAULT_PATH" ] || [ "$VAULT_PATH" = "/path/to/your/vault" ]; then
  echo ""
  read -p "  Where is your Obsidian vault? (absolute path): " VAULT_PATH
  if [ -n "$VAULT_PATH" ]; then
    # Escape the path for sed: replace '/' with '\/' and '"' with '\"'
    ESCAPED_PATH=$(printf '%s\n' "$VAULT_PATH" | sed -e 's/[\/&]/\\&/g' -e 's/"/\\"/g')
    # Update .env with quoted path to preserve spaces
    sed -i.bak "s|^OBSIDIAN_VAULT_PATH=.*|OBSIDIAN_VAULT_PATH=\"$ESCAPED_PATH\"|" "$SCRIPT_DIR/.env"
    rm -f "$SCRIPT_DIR/.env.bak"
  fi
fi

# Read CLAUDE_HISTORY_PATH from .env; default to ~/.claude.
# Everything else (history path, profile name) is derived from this single value.
CLAUDE_HISTORY_PATH=""
if [ -f "$SCRIPT_DIR/.env" ]; then
  CLAUDE_HISTORY_PATH=$(grep -E '^CLAUDE_HISTORY_PATH=' "$SCRIPT_DIR/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//')
  CLAUDE_HISTORY_PATH="${CLAUDE_HISTORY_PATH/#\~/$HOME}"   # expand ~ if stored literally
fi
CLAUDE_HISTORY_PATH="${CLAUDE_HISTORY_PATH:-$HOME/.claude}"

# Profile name from .env — if set, writes ~/.obsidian-wiki/config.<profile>;
# if empty, writes ~/.obsidian-wiki/config.
CLAUDE_PROFILE=""
if [ -f "$SCRIPT_DIR/.env" ]; then
  CLAUDE_PROFILE=$(grep -E '^CLAUDE_PROFILE=' "$SCRIPT_DIR/.env" | cut -d'=' -f2- | sed 's/^"//;s/"$//')
fi

if [ -n "$CLAUDE_PROFILE" ]; then
  GLOBAL_CONFIG="$GLOBAL_CONFIG_DIR/config.$CLAUDE_PROFILE"
  echo "✅  Profile config written to ~/.obsidian-wiki/config.$CLAUDE_PROFILE"
else
  GLOBAL_CONFIG="$GLOBAL_CONFIG_DIR/config"
  echo "✅  Global config written to ~/.obsidian-wiki/config"
fi

cat > "$GLOBAL_CONFIG" <<EOF
OBSIDIAN_VAULT_PATH="$VAULT_PATH"
OBSIDIAN_WIKI_REPO="$SCRIPT_DIR"
CLAUDE_HISTORY_PATH="$CLAUDE_HISTORY_PATH"
EOF

# ── Step 1c: Bootstrap symlinks ──────────────────────────────
# .hermes.md → AGENTS.md  (Hermes resolves .hermes.md before AGENTS.md;
# a symlink keeps a single source of truth)
HERMES_BOOTSTRAP="$SCRIPT_DIR/.hermes.md"
if [ -L "$HERMES_BOOTSTRAP" ]; then
  rm "$HERMES_BOOTSTRAP"
elif [ -f "$HERMES_BOOTSTRAP" ]; then
  echo "⚠️   .hermes.md is a regular file, replacing with symlink"
  rm "$HERMES_BOOTSTRAP"
fi
ln -s AGENTS.md "$HERMES_BOOTSTRAP"
echo "✅  .hermes.md → AGENTS.md"

# ── Step 2: Symlink skills into agent directories ─────────────
# Project-local skill dirs. Each of these is where the matching agent looks
# for skills scoped to this repo.
AGENT_DIRS=(
  ".claude/skills"
  ".cursor/skills"
  ".windsurf/skills"
  ".agents/skills"
  ".kiro/skills"        # Kiro IDE/CLI (paired with .kiro/steering/obsidian-wiki.md)
)

for agent_dir in "${AGENT_DIRS[@]}"; do
  install_skills "$SCRIPT_DIR/$agent_dir" "$agent_dir/"
done

# ── Step 3: Install global skills ────────────────────────────
# The Claude instance for this wiki gets wiki-update and wiki-query (portable,
# usable from any project). Determined by CLAUDE_HISTORY_PATH in .env.
GLOBAL_SKILL_DIR="$CLAUDE_HISTORY_PATH/skills"
mkdir -p "$GLOBAL_SKILL_DIR"
for skill_name in "wiki-update" "wiki-query"; do
  link_path="$GLOBAL_SKILL_DIR/$skill_name"
  if [ -L "$link_path" ]; then
    rm "$link_path"
  elif [ -d "$link_path" ]; then
    echo "⚠️   $link_path is a real directory, skipping symlink"
    continue
  fi
  ln -s "$SKILLS_DIR/$skill_name" "$link_path"
done
echo "✅  Installed global skills → $CLAUDE_HISTORY_PATH/skills/ (wiki-update, wiki-query)"

# Steps 3b–3j: Install all skills for every supported agent.
# OpenClaw discovers skills from ~/.agents/skills/ (per docs.openclaw.ai/skills);
# that path also covers OpenCode, Factory Droid, Aider, and any AGENTS.md-aware
# agent. Platforms that have a dedicated skills dir get their own symlink tree
# so discovery works regardless of whether the user relies on AGENTS.md.
install_skills "$HOME/.gemini/skills"             "~/.gemini/skills/ (Gemini CLI)"
install_skills "$HOME/.gemini/antigravity/skills" "~/.gemini/antigravity/skills/ (Antigravity, legacy)"
install_skills "$HOME/.codex/skills"              "~/.codex/skills/"
install_skills "$HOME/.hermes/skills"             "~/.hermes/skills/ (Hermes)"
install_skills "$HOME/.openclaw/skills"           "~/.openclaw/skills/ (OpenClaw managed)"
install_skills "$HOME/.copilot/skills"            "~/.copilot/skills/ (GitHub Copilot CLI)"
install_skills "$HOME/.trae/skills"               "~/.trae/skills/ (Trae)"
install_skills "$HOME/.trae-cn/skills"            "~/.trae-cn/skills/ (Trae CN)"
install_skills "$HOME/.kiro/skills"               "~/.kiro/skills/ (Kiro CLI)"
install_skills "$HOME/.agents/skills"             "~/.agents/skills/ (OpenCode, Aider, Droid, generic)"

# ── Step 4: Summary ──────────────────────────────────────────
SKILL_COUNT=$(echo "$SKILLS_DIR"/*/  | tr ' ' '\n' | grep -c /)

echo ""
echo "───────────────────────────────────────────────────"
echo " Setup complete!"
echo ""
echo " Skills found:    $SKILL_COUNT"
echo " Agents ready:    Claude Code, Cursor, Windsurf, Gemini CLI, Antigravity,"
echo "                  Codex, Hermes, OpenClaw, OpenCode, Aider, Factory Droid,"
echo "                  Trae, Trae CN, Kiro, GitHub Copilot (CLI + VS Code Chat)"
echo ""
echo " Bootstrap files:"
echo "   CLAUDE.md                            → Claude Code"
echo "   GEMINI.md                            → Gemini / Antigravity"
echo "   AGENTS.md                            → Codex, OpenClaw, OpenCode, Aider, Droid, Trae, Hermes"
echo "   .hermes.md                           → Hermes (symlink → AGENTS.md)"
echo "   .cursor/rules/obsidian-wiki.mdc      → Cursor (alwaysApply)"
echo "   .windsurf/rules/obsidian-wiki.md     → Windsurf (always-on)"
echo "   .kiro/steering/obsidian-wiki.md      → Kiro (inclusion: always)"
echo "   .agent/rules/obsidian-wiki.md        → Google Antigravity (alwaysApply)"
echo "   .agent/workflows/obsidian-wiki.md    → Google Antigravity (slash commands)"
echo "   .github/copilot-instructions.md      → GitHub Copilot (VS Code Chat)"
echo ""
echo " Next steps:"
echo "   1. Open this project in your agent"
echo "   2. Say: \"Set up my wiki\""
echo ""
echo " From any other project:"
echo "   /wiki-update    → sync knowledge into your vault"
echo "   /wiki-query    → ask questions against your wiki"
echo "───────────────────────────────────────────────────"
echo ""
