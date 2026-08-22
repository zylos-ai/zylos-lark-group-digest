# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-22

### Added
- Initial release as a standalone zylos component
- Config-driven digest.mjs — fetches messages from all Lark groups for a time window
- Generic token-based pagination helper (pagination.mjs) with dedup and safety limits
- Canonical HTML digest template with collapsible group panels, status pills, and attention board
- Lifecycle hooks: post-install, pre-upgrade, post-upgrade, configure
- Configurable schedule, owner notification, sensitive-info scanning patterns
- Attention rules: configurable recruitment groups for always-flag behavior
