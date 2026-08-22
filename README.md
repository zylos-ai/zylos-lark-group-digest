# zylos-lark-group-digest

Lark group message digest component for [Zylos](https://github.com/zylos-ai) agents.

Periodically fetches messages from all Lark groups the bot belongs to, generates
structured Chinese-language summaries, publishes them as HTML pages, and notifies
the configured owner via Lark DM.

## Features

- **Scheduled digests** — configurable schedule (default: 3x daily at 08:00, 13:00, 19:00)
- **Full message coverage** — text, images (with content inspection), files, rich text, cards
- **Structured summaries** — one-line items per group, owner attention board, recruitment rules
- **Canonical HTML template** — collapsible panels, status pills, TL;DR cards, responsive design
- **Sensitive-info scanning** — configurable regex patterns to catch leaked IDs before publish
- **Config-driven** — no hardcoded IDs, tokens, or names; all runtime configuration

## Requirements

- Node.js 20+
- Zylos core with `lark`, `pages`, `comm-bridge`, and `scheduler` components installed

## Installation

```bash
zylos add lark-group-digest
```

## Configuration

After installation, configure via:

```bash
zylos configure lark-group-digest
```

Or edit `~/zylos/components/lark-group-digest/config.json` directly.

Key settings:
- `owner_chat_id` — Lark DM chat ID for notifications (required)
- `owner_display_name` — name used in attention-item rules
- `lark_skill_path` — path to lark component (auto-detected)
- `digest_schedule` — array of `{hour, suffix, label, window_hours}`
- `attention_rules.recruitment_groups` — group names where new resumes always flag as owner action items

## Usage

The component is driven by scheduled tasks. Set up via the zylos scheduler:

```bash
# Example: schedule 3x daily digests
zylos scheduler add --cron "0 0 * * *" --task "lark-group-digest morning"
zylos scheduler add --cron "0 5 * * *" --task "lark-group-digest midday"
zylos scheduler add --cron "0 11 * * *" --task "lark-group-digest evening"
```

Or use the SKILL.md execution model for AI-agent-driven scheduling.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/digest.mjs` | Fetch and format messages from Lark groups |
| `scripts/pagination.mjs` | Generic token-based API pagination |

## License

UNLICENSED — internal use only.
