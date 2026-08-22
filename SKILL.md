---
name: lark-group-digest
version: 0.1.0
description: |
  Generate Lark group message digest (configurable schedule, default 3x daily).
  Fetches messages via digest.mjs, summarizes in Chinese, writes to pages, notifies
  the configured owner via Lark DM.
  Use when receiving a lark-group-digest scheduled task.
type: utility

lifecycle:
  npm: true
  data_dir: ~/zylos/components/lark-group-digest
  hooks:
    configure: hooks/configure.js
    post-install: hooks/post-install.js
    pre-upgrade: hooks/pre-upgrade.js
    post-upgrade: hooks/post-upgrade.js
  preserve:
    - config.json
    - logs/

upgrade:
  repo: zylos-ai/zylos-lark-group-digest
  branch: main

config:
  required:
    - name: OWNER_CHAT_ID
      description: Lark DM chat ID for sending digest notifications to the owner
      sensitive: false
  optional:
    - name: LARK_SKILL_PATH
      description: Path to the lark component's skill directory
      default: "~/zylos/.claude/skills/lark"
    - name: OUTPUT_DIR
      description: Directory for raw JSON message archives
      default: "~/zylos/lark-group-digest/raw"
    - name: PAGES_DIR
      description: Directory for generated HTML digest pages
      default: "~/zylos/http/public/pages/daily-digest"
    - name: OWNER_DISPLAY_NAME
      description: Display name of the digest owner (used in attention-item rules)
      default: ""

dependencies:
  - lark
  - pages
  - comm-bridge
  - scheduler
---

# Lark Group Digest

Periodically generates structured summaries of all Lark group conversations.

## Execution Model

The digest workflow runs in a **background subagent** (model: sonnet). The main
session launches the subagent and returns immediately. The subagent executes
the full flow: fetch, image inspection, summarize, build HTML, publish, notify.

## Configuration

All configuration lives in `~/zylos/components/lark-group-digest/config.json`:

```json
{
  "lark_skill_path": "~/zylos/.claude/skills/lark",
  "output_dir": "~/zylos/lark-group-digest/raw",
  "pages_dir": "~/zylos/http/public/pages/daily-digest",
  "owner_chat_id": "<lark-dm-chat-id>",
  "owner_display_name": "<name>",
  "digest_schedule": [
    { "hour": 8, "suffix": "morning", "label": "上午", "window_hours": 13 },
    { "hour": 13, "suffix": "midday", "label": "午间", "window_hours": 5 },
    { "hour": 19, "suffix": "evening", "label": "晚间", "window_hours": 6 }
  ],
  "sensitive_patterns": [
    "ou_[a-f0-9]{32}",
    "oc_[a-f0-9]{32}",
    "cli_[a-f0-9]{16}"
  ],
  "attention_rules": {
    "always_flag_groups": [],
    "recruitment_groups": []
  }
}
```

## Workflow

### 1. Determine Time Window

Based on current time and `digest_schedule`, select the matching window.

### 2. Fetch Messages

```bash
node <skill-dir>/scripts/digest.mjs --start <UNIX_SEC> --end <UNIX_SEC> \
  --out <output_dir>/YYYY-MM-DD-<suffix>.json \
  --config ~/zylos/components/lark-group-digest/config.json
```

Raw JSON archives are permanent (not deleted after summarization).

### 3. Image Content Completion

For groups containing `[图片]`, download and view images using `lark-cli`:

```bash
lark-cli im +chat-messages-list --as bot --chat-id <CHAT_ID> \
  --start "<ISO_START>" --end "<ISO_END>" --download-resources
```

View each image with the Read tool, replace placeholders with descriptions.

### 4. Summarize

Generate Chinese summaries per group:
- **整体内容归纳**: one-line items, no multi-sentence paragraphs
- **Owner 需要关注的**: action items awaiting owner response
- Recruitment groups: new resumes always count as owner action items

### 5. Build and Publish HTML

Use the canonical template (`references/digest-template.html`):
1. Copy template, fill `<!-- FILL: ... -->` placeholders
2. Delete instruction comment block before `<html>`
3. Structure: TL;DR + cards → attention board → group grid → details → no-message list
4. Scan for sensitive info before publishing
5. Register via pages CLI (no share links by default)

### 6. Notify Owner

Send Lark DM with the digest link and key highlights.

### 7. Check Todo

If the owner has a todo file, cross-reference new action items.
