<p align="center">
  <img src="./assets/logo.png" alt="Zylos" height="120">
</p>

<h1 align="center">zylos-lark-group-digest</h1>

<p align="center">
  Automated Lark group message digest for Zylos agents
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://discord.gg/GS2J39EGff"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://x.com/ZylosAI"><img src="https://img.shields.io/badge/X-follow-000000?logo=x&logoColor=white" alt="X"></a>
  <a href="https://zylos.ai"><img src="https://img.shields.io/badge/website-zylos.ai-blue" alt="Website"></a>
  <a href="https://openmax.com"><img src="https://img.shields.io/badge/Built%20by-OpenMax-orange" alt="Built by OpenMax"></a>
</p>

---

- **Scheduled digests** — configurable schedule (default: 3x daily at 08:00, 13:00, 19:00 local time)
- **Full message coverage** — text, images (with content inspection), files, rich text, cards
- **Auto-discovery** — dynamically fetches all groups the authorized user belongs to via Lark API; no manual group list needed
- **Structured summaries** — one-line items per group, owner attention board, configurable attention rules
- **Canonical HTML template** — collapsible panels, status pills, TL;DR cards, responsive design
- **Sensitive-info scanning** — configurable regex patterns to catch leaked IDs before publish
- **Config-driven** — no hardcoded IDs, tokens, or names; all runtime configuration
- **Auto-scheduling** — registers scheduler tasks automatically on install

## Install

```bash
zylos add lark-group-digest
```

Or manually:

```bash
cd ~/zylos/.claude/skills
git clone https://github.com/zylos-ai/zylos-lark-group-digest.git lark-group-digest
cd lark-group-digest && npm install
```

## User authorization

Before the first digest, authorize the intended owner in `lark-cli`:

```bash
lark-cli auth login --scope "im:chat:read im:message.group_msg:get_as_user im:message:readonly" --no-wait --json
```

The agent sends the returned authorization URL and QR code to the owner, then
completes the device flow after confirmation. Every run verifies user login and
scopes. Missing or expired authorization exits with code 3 and an incremental
login command; the scheduled agent must notify the owner instead of generating
an empty digest. No private-message access is requested. No bot fallback occurs.
`lark-cli` manages refresh tokens; the component does not read or store secrets.

## Configuration

Edit `~/zylos/components/lark-group-digest/config.json`:

```json
{
  "owner_chat_id": "<lark-dm-chat-id>",
  "owner_display_name": "<name>",
  "lark_skill_path": "~/zylos/.claude/skills/lark",
  "output_dir": "~/zylos/lark-group-digest/raw",
  "pages_dir": "~/zylos/http/public/pages/daily-digest"
}
```

Key settings:

| Setting | Purpose |
|---------|---------|
| `owner_chat_id` | Lark DM chat ID for digest notifications (required) |
| `owner_display_name` | Name used in attention-item rules |
| `lark_skill_path` | Legacy compatibility setting; fetching now uses `lark-cli` on PATH |
| `digest_schedule` | Array of `{hour, suffix, label, window_hours}` |
| `attention_rules.recruitment_groups` | Group names where new resumes always flag as owner action items |
| `sensitive_patterns` | Regex patterns for the desensitization scan |

## Usage

The component auto-registers three scheduler tasks on install:

| Task | Local Time | Window |
|------|-----------|--------|
| `lark-group-digest-morning` | 08:00 | Previous day 19:00 → now |
| `lark-group-digest-midday` | 13:00 | Today 08:00 → now |
| `lark-group-digest-evening` | 19:00 | Today 13:00 → now |

Cron expressions use the agent's configured timezone (from `.env TZ`).

The AI agent executes the full workflow: fetch messages → inspect images → summarize → build HTML → publish → notify owner.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/digest.mjs` | Fetch and format messages from Lark groups |
| `scripts/pagination.mjs` | Generic token-based API pagination |

## Collection and inactive groups

The fetcher enumerates the current user's groups in descending activity order,
then requests messages only inside the digest time window. After **three
consecutive groups confirmed idle since the window start**, it stops making history requests
for the remaining groups. For each successfully read window-empty group, make one
additional descending history request (`page_size: 1`, `start_time`, no `end_time`).
Only an empty probe counts towards stopping. Messages after the window end reset
the streak and are never included in the digest. A nonempty window result or any
read/probe error resets the streak. Probe failures are visible as
`activityCheck: "unavailable"` and `activityCheckError`; window results remain valid.
Skipped groups have `status: "skipped"`, `messageCount: null`, and an explicit
reason; they are not reported as verified empty groups.

This is a cost-saving heuristic, **not a completeness guarantee**. Lark does not
return the last-active timestamp. The extra probe prevents groups active only
after the window from incorrectly ending the scan. Activity
changes during pagination can also move groups across pages. See the official
[group-list response and pagination warning](https://open.larksuite.com/document/server-docs/group/chat/list).

For historical windows, retries after an authorization delay, or exhaustive
coverage, pass `--full-scan`. This disables early stopping and uses stable
creation-order enumeration:

```bash
node scripts/digest.mjs --start <UNIX_SEC> --end <UNIX_SEC> --full-scan
```

JSON retains `group`, `messageCount`, and `formatted`, plus `chatId`, `status`,
raw `messages`, and an `error` when a group is unavailable or partially read.
Keep raw archives in private local storage; summary pages must require owner
login and have no active share links. Summaries and notifications must distinguish
scanned, empty, failed, and skipped groups and disclose when early stopping occurs.

## Design Notes

Development-time architecture notes live in [docs/DESIGN.md](./docs/DESIGN.md).

## Built by OpenMax

Zylos is the open-source core of [OpenMax](https://openmax.com/) — the Human × Agent Collaboration Platform.

## License

[MIT](./LICENSE)
