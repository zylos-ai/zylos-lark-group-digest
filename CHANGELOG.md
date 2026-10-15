# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Make scheduled Owner notifications use Card 2.0 by default and document delivery through C4 using the existing Lark messaging library, without changing the Lark component or recreating scheduler tasks.

## [0.3.0] - 2026-10-15

### Added
- Add a pure Card 2.0 digest notification preview builder and stdin JSON CLI with explicit coverage and image-inspection counts. Delivery remains on the existing notification flow pending a supported transport.

## [0.2.0] - 2026-10-15

### Changed
- Request original interactive card content and extract full nested card text instead of summarizing transformed placeholder images.
- Retry transient user authorization verification failures up to three attempts with bounded backoff; preserve immediate actionable authorization failures.
- Fetch the authorized user's groups and messages via `lark-cli`, including groups the bot has not joined.
- Verify user login and required read scopes on every run; provide an incremental authorization handoff to the owner when missing or expired.
- Preserve sender names, resource evidence, and per-group failures instead of silently reporting errors as empty groups.
- Use user identity for image retrieval.
- Scan by descending group activity and stop after three consecutive groups confirmed idle since the window start, explicitly marking remaining groups unscanned. Add `--full-scan` for exhaustive/historical collection.

## [0.1.0] - 2026-08-22

### Added
- Initial release as a standalone zylos component
- Config-driven digest.mjs — fetches messages from all Lark groups for a time window
- Generic token-based pagination helper (pagination.mjs) with dedup and safety limits
- Canonical HTML digest template with collapsible group panels, status pills, and attention board
- Lifecycle hooks: post-install, pre-upgrade, post-upgrade, configure
- Configurable schedule, owner notification, sensitive-info scanning patterns
- Attention rules: configurable recruitment groups for always-flag behavior
