# zylos-lark-group-digest Design Document

**Version**: v0.1.0
**Date**: 2026-08-22
**Author**: Zylos Team
**Repository**: https://github.com/zylos-ai/zylos-lark-group-digest
**Status**: Draft

---

## 1. Overview

Automated Lark group message digest component for Zylos agents. Fetches messages from monitored Lark groups within a configurable time window, resolves sender identities, and outputs structured JSON for AI-driven summarization. The agent then generates a styled HTML digest page and delivers it to the configured owner.

## 2. Architecture

### 2.1 Component Structure

```
zylos-lark-group-digest/
  docs/
    DESIGN.md              — Architecture/design notes
  src/
    index.js               — Entry point (config validation)
    lib/
      config.js            — Config loader with hot-reload
  scripts/
    digest.mjs             — Message fetcher (main data pipeline)
    pagination.mjs         — Generic token-based pagination helper
    pagination.test.mjs    — Pagination unit tests
  references/
    digest-template.html   — Canonical HTML template for digest output
  hooks/
    post-install.js        — Creates data dirs and default config
    configure.js           — Accepts stdin JSON, merges into config
    pre-upgrade.js         — Backs up config before upgrade
    post-upgrade.js        — Migrates config schema after upgrade
  test/
    release-consistency.test.js — Version face consistency gate
  SKILL.md                 — Component specification for the Zylos agent
  ecosystem.config.cjs     — PM2 configuration (utility — not normally daemonized)
```

### 2.2 Data Flow

1. Scheduled task triggers the agent's digest workflow
2. Agent runs `scripts/digest.mjs` with time-window parameters
3. Script fetches all messages from Lark groups via the Lark component's SDK
4. Output: JSON array of `{ group, messageCount, formatted }` per group
5. Agent reads JSON, downloads/views images, generates Chinese summaries
6. Agent fills the HTML template and publishes via the pages system
7. Agent sends notification to the configured owner

## 3. Configuration

### 3.1 Config File

Located at `~/zylos/components/lark-group-digest/config.json`:

```json
{
  "enabled": true,
  "lark_skill_path": "~/zylos/.claude/skills/lark",
  "output_dir": "~/zylos/lark-group-digest/raw",
  "pages_dir": "~/zylos/http/public/pages/daily-digest",
  "owner_open_id": "",
  "owner_chat_id": "",
  "digest_schedule": [
    { "hour": 8, "suffix": "morning", "label": "morning", "window_hours": 13 },
    { "hour": 13, "suffix": "midday", "label": "midday", "window_hours": 5 },
    { "hour": 19, "suffix": "evening", "label": "evening", "window_hours": 6 }
  ],
  "sensitive_patterns": [
    "ou_[a-f0-9]{32}",
    "oc_[a-f0-9]{32}",
    "cli_[a-f0-9]{16}"
  ]
}
```

## 4. Integration with Zylos

### 4.1 Lifecycle

- **Install**: `zylos add lark-group-digest` runs `post-install.js`
- **Configure**: `zylos configure lark-group-digest` pipes collected values to `configure.js`
- **Run**: Agent executes digest workflow via scheduled tasks (not a daemon)

### 4.2 Dependencies

- Requires the `lark` component to be installed (provides Lark SDK libs)
- Requires `comm-bridge` for sending notifications
- Requires `pages` for publishing HTML digest pages
- Requires `scheduler` for automated execution

## 5. Security

- All group IDs, user IDs, and credentials are stored in runtime config only
- The component code contains zero hardcoded identifiers
- Output HTML passes a configurable sensitive-information scan before publication
- Digest pages are published behind authentication, not as public share links

## 6. Error Handling

- API failures for individual groups are logged but do not halt the digest
- Pagination includes safety limits and cycle detection
- Missing config falls back to defaults with warnings

## 7. Future Improvements

- Per-group attention rules (configurable per owner role)
- Multi-owner support (different digests for different team members)
- Incremental message tracking to avoid re-fetching
