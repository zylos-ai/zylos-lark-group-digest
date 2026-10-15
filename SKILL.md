---
name: lark-group-digest
version: 0.4.0
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
    pre-uninstall: hooks/pre-uninstall.js
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

Periodically generates structured summaries of the authorized user’s Lark groups,
including groups the bot has not joined. Requires `lark-cli` from the Lark component.

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

### 2. Fetch Messages and Check Authorization

Every run verifies the current `lark-cli` user login and these permissions before
fetching: `im:chat:read`, `im:message.group_msg:get_as_user`, and
`im:message:readonly` (for message resources). Existing equivalent chat-read
permissions are accepted. No P2P message permission is needed. The CLI handles
refresh; the component never stores tokens or falls back to bot identity.
Transient verification/CLI failures are retried up to three attempts, waiting 1s
and then 2s. Confirmed missing/expired/revoked authorization, missing scopes,
and a missing CLI fail immediately. Exhausted retries remain fatal and produce
no new digest; only the authorization preflight is retried, not the whole run.

If the fetch exits with code **3**, read its JSON error (`scopes`,
`authorizationCommand`, `notifyOwner`). **Notify `owner_chat_id` through the C4
bridge that the digest is blocked on user authorization.** Load the Lark shared
authentication skill and run the supplied incremental authorization command;
send the fresh authorization URL and QR image to the owner. Ask the owner to
confirm when finished, then complete the device flow before retrying the original
time window with `--full-scan`. Do not publish an empty digest, mark the run successful, or silently
fall back to the bot. If the owner has not replied, keep the task pending.
For API-side permission errors, follow the Lark shared skill's app-scope guidance.

`lark-cli` must be configured for this component's owner. The operator must verify
the account on login; all discovered groups belong to the currently authorized user.


```bash
node <skill-dir>/scripts/digest.mjs --start <UNIX_SEC> --end <UNIX_SEC> \
  --out <output_dir>/YYYY-MM-DD-<suffix>.json \
  --config ~/zylos/components/lark-group-digest/config.json
```

Default runs list groups by descending activity time and stop fetching history
after three consecutive groups confirmed idle since the window start. Nonempty results and errors
reset the streak. A successful empty window query is followed by a latest-message
probe from the window start to now (one message, no window end); only an empty
probe counts. A message after the window end resets the streak but is not included
in the summary. Probe failures are visible in `activityCheckError` and reset the
streak; they do not invalidate successfully fetched window messages.
This heuristic saves calls but can miss messages; it does not
prove that every later group is inactive. For historical backfills, delayed
retries, or an explicit request for complete coverage, add `--full-scan` (stable
creation order, no early stop).

Raw JSON archives are permanent (not deleted after summarization).

### 3. Image Content Completion

Message history requests use `card_msg_content_type=user_card_content` to
retrieve original interactive card content instead of transformed placeholders.
The formatted output extracts full text from Schema 2.0 bodies, `user_dsl`,
and legacy card elements; the raw card JSON is retained for image/resource
inspection. Treat image-only or unrecognized cards as unavailable text, never
infer a card body from a placeholder image.

The JSON includes `chatId` and raw `messages` (message IDs, content/resource keys,
sender names, timestamps). For each image or post-embedded image, extract its key
from that message's content, download as the **user**, and inspect it:

```bash
lark-cli api GET /open-apis/im/v1/messages/<MESSAGE_ID>/resources/<IMAGE_KEY> \
  --as user --params '{"type":"image"}' --output ./digest-images/<IMAGE_KEY>.png
```

Use a directory under the current working directory. Do not use bot identity or
re-list the group with `+chat-messages-list`: some CLI versions unnecessarily
require P2P permission for that shortcut. Preserve the source message ID/key.
If download fails, mark the image unavailable; do not invent its contents.

### 4. Summarize

Check `status` and `error` first. A group with `status: "error"` is **unavailable or
partial**, never a no-message group even when `messageCount` is zero. Show failed
groups separately and disclose incomplete coverage in the owner notification.
Groups with `status: "skipped"` and `messageCount: null` were not queried because
of early stopping; show them as **not scanned**, never as no-message groups.
Report scanned/skipped counts in the page and owner notification. Do not describe
a run with skipped groups as full coverage.
A nonzero fatal exit means no new digest artifact; do not reuse an old output file.

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
5. Register via pages CLI as an Owner-login-protected private page, with no share links. User-identity collection may include groups the bot never joined; never publish the raw archive or create public access.

### 6. Notify Owner

Send the Owner notification as a native **Card 2.0** by default, including the
digest link, key highlights, scanned/unscanned/error counts, and image inspection
counts. Read `references/notification-card.md` for the input contract and the
executable C4 delivery recipe. Generate the payload with the existing builder,
then deliver through C4 using the existing Lark messaging library; no Lark
component upgrade or code change is required. The scheduled tasks already load
this skill, so this rule applies to all three daily runs.

Keep the payload and send receipt with this run's evidence. A generated JSON file
alone is not delivery: check the C4 exit status and Lark success/message ID. If
card delivery fails, report the failure and use a clearly labelled text fallback
when the card is confirmed unsent; do not claim the card was delivered or blindly
retry an ambiguous send. Do not send both card and duplicate text on success.

### 7. Check Todo

If the owner has a todo file, cross-reference new action items.
