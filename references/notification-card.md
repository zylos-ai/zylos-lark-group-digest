# Digest notification card preview

Generate a stable Lark Card 2.0 payload from structured JSON, without credentials,
network access, or delivery side effects:

```bash
node scripts/render-notification-card.mjs < references/notification-card.example.json > /tmp/digest-card.json
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

## Delivery boundary

This is a payload generator for preview and future integration, **not a sender**.
The current standard Lark C4 sender does not expose a complete Card 2.0 payload
interface. Continue using the existing digest link/highlights notification flow;
do not pass this JSON as ordinary message text, bypass C4, or add a temporary
transport adapter. Automatic card delivery requires a separately approved,
supported transport. No Lark or C4 component changes are included here.

Before any future delivery, verify recipient scope, content confidentiality, and
actual page access; `enable_forward: false` is presentation configuration, not
an access-control guarantee. Local owner-specific policies are not part of this
portable template. The CLI exits nonzero on invalid JSON/input and prints only
a generic error without private input. A JSON payload alone does not prove
client rendering; preview in a supported client when a transport is available.
