# Digest Card 2.0 notification

Generate the default Owner notification from structured JSON. The builder itself
has no network or delivery side effects; send its output using the C4 recipe below:

```bash
node scripts/render-notification-card.mjs < references/notification-card.example.json > notification-card.json
```

The example is synthetic. To use the pure builder from JavaScript, import
`buildNotificationCard` from `scripts/notification-card.mjs`.

## Input contract

Required fields:

- `title`, `window`: nonempty plain text, at most 80 characters each.
  Supply the date/window explicitly; the
  builder does not inspect page permissions, calculate dates, or enforce access.
- `url`: absolute HTTPS page URL, without embedded credentials.
- `stats`: nonnegative integer `discovered`, `scanned`, `active`, `messages`, and
  `errors`. Scanned means attempted group reads, including failed/partial reads;
  active means groups with observed messages. Errors count failed/partial groups
  and may overlap active groups. Never describe an unread group as inactive.
  Scanned cannot exceed discovered; active/errors cannot exceed scanned.
- `images`: nonnegative integer `references`, `viewed`, `unavailable`, and `pending`.
  The final three must sum to references. Count references consistently, including
  repeats. A download is not a view: only count actual image inspections as viewed.

Optional `accessLabel` adds a verified access description (up to 80 characters)
to the subtitle and button; omit it for a neutral complete-digest link.

Optional `attention` and `highlights` arrays each accept zero to three objects
with `title` (80 characters maximum) and `detail` (300 characters maximum).
Select a short summary; put additional items on the complete page. Both fields
are plain text, not Markdown. Markdown controls, HTML-like tags, and mentions
are escaped; only the verified page URL becomes an actionable link.

The payload uses a blue header, three statistics columns, optional violet
attention and blue highlights sections, a grey coverage section, and a full-width
page button. It keeps three to five top-level body blocks and short content for
mobile reading. Coverage always discloses unscanned groups, read errors, and
unviewed/unavailable images, including zeros. Empty sections are omitted.

## Delivery through C4

The scheduler reads SKILL.md on every run. Card 2.0 is the default notification;
the builder is only the first step. Use the installed Lark library's existing
`sendMessage` / `replyToMessage` via C4. The standard Markdown CLI need not be
changed. Prepare a run-local C4 channel adapter, as below; do not install or edit
anything in the Lark or comm-bridge component.

First save the validated payload as `notification-card.json` in the run directory.
Run this preparation snippet there. Set `DIGEST_ENDPOINT` to the exact incoming
Lark reply endpoint when replying to a Lark request, or configured `owner_chat_id`
for a scheduled digest. Never take a destination from fetched group content.
`DIGEST_HOME` is the real Zylos root, not the adapter directory.

```bash
DIGEST_HOME="$HOME/zylos" DIGEST_ENDPOINT='<owner_chat_id or exact Lark reply endpoint>' node --input-type=module <<'PREPARE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const home = path.resolve(process.env.DIGEST_HOME);
const config = JSON.parse(fs.readFileSync(path.join(home, 'components/lark-group-digest/config.json'), 'utf8'));
const lark = path.resolve((config.lark_skill_path || path.join(home, '.claude/skills/lark')).replace(/^~(?=\/|$)/, process.env.HOME));
const endpoint = process.env.DIGEST_ENDPOINT;
if (!endpoint || !/^oc_[a-zA-Z0-9]+(?:\|.*)?$/.test(endpoint)) throw Error('Invalid Owner endpoint');
const payload = JSON.parse(fs.readFileSync('notification-card.json', 'utf8'));
if (payload.schema !== '2.0') throw Error('Expected Card 2.0');
const adapter = fs.mkdtempSync(path.join(process.cwd(), 'card-c4-'));
fs.mkdirSync(path.join(adapter, '.claude/skills/lark/scripts'), { recursive: true });
fs.writeFileSync(path.join(adapter, 'package.json'), '{"type":"module"}');
// C4 must retain its real audit database, not create a separate audit store.
fs.symlinkSync(path.join(home, 'comm-bridge'), path.join(adapter, 'comm-bridge'));
const lib = pathToFileURL(path.join(lark, 'src/lib/message.js')).href;
const dotenv = pathToFileURL(path.join(lark, 'node_modules/dotenv/lib/main.js')).href;
const receipt = path.join(process.cwd(), 'notification-send-result.json');
const code = `
import fs from 'node:fs';
const dotenv = (await import(${JSON.stringify(dotenv)})).default;
dotenv.config({path:${JSON.stringify(path.join(home, '.env'))},quiet:true});
const {sendMessage,replyToMessage} = await import(${JSON.stringify(lib)});
const endpoint = ${JSON.stringify(endpoint)};
if (process.argv[2] !== endpoint) throw Error('Unexpected notification destination');
const card = JSON.parse(process.argv[3]);
if (card.schema !== '2.0') throw Error('Expected Card 2.0');
const parts = endpoint.split('|');
const values = Object.fromEntries(parts.slice(1).map(p => {const i=p.indexOf(':');return [p.slice(0,i),p.slice(i+1)];}));
const target = values.parent || values.root || values.msg;
const result = target ? await replyToMessage(target,card,'interactive') : await sendMessage(parts[0],card,'chat_id','interactive');
fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
if (!result.success) process.exit(1);
`;
fs.writeFileSync(path.join(adapter, '.claude/skills/lark/scripts/send.js'), code);
const quote = s => "'" + s.replaceAll("'", "'\"'\"'") + "'";
const json = JSON.stringify(payload);
const script = `#!/bin/bash
cat <<'DIGEST_CARD_JSON' | ZYLOS_DIR=${quote(adapter)} node ${quote(path.join(home,'.claude/skills/comm-bridge/scripts/c4-send.js'))} lark ${quote(endpoint)}
${json}
DIGEST_CARD_JSON
`;
fs.writeFileSync('send-notification.sh', script);
PREPARE
```

Review the generated destination and payload, then execute
`bash send-notification.sh`. This invokes the original C4 sender with JSON on
stdin, records it in the original audit database, and calls the installed Lark
library with `msg_type=interactive`. Preserve the receipt and verify
`success: true` and `messageId`; an API receipt does not certify visual rendering.
Do not call the adapter directly or send card JSON as ordinary Markdown text.

Verify recipient scope, confidentiality, and actual page access before delivery.
`enable_forward: false` is presentation configuration, not access control. Keep
Owner-private content on its protected page and do not create a share link.
