#!/usr/bin/env node
/**
 * Post-install hook: create data directories and default config.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = path.join(os.homedir(), 'zylos/components/lark-group-digest');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const LOGS_DIR = path.join(DATA_DIR, 'logs');

const DEFAULT_CONFIG = {
  lark_skill_path: path.join(os.homedir(), 'zylos/.claude/skills/lark'),
  output_dir: path.join(os.homedir(), 'zylos/lark-group-digest/raw'),
  pages_dir: path.join(os.homedir(), 'zylos/http/public/pages/daily-digest'),
  owner_chat_id: '',
  owner_display_name: '',
  digest_schedule: [
    { hour: 8, suffix: 'morning', label: '上午', window_hours: 13 },
    { hour: 13, suffix: 'midday', label: '午间', window_hours: 5 },
    { hour: 19, suffix: 'evening', label: '晚间', window_hours: 6 },
  ],
  sensitive_patterns: [
    'ou_[a-f0-9]{32}',
    'oc_[a-f0-9]{32}',
    'cli_[a-f0-9]{16}',
  ],
  attention_rules: {
    always_flag_groups: [],
    recruitment_groups: [],
  },
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

if (!fs.existsSync(CONFIG_PATH)) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
  console.log(`[lark-group-digest] Default config written to ${CONFIG_PATH}`);
} else {
  console.log(`[lark-group-digest] Config already exists at ${CONFIG_PATH}`);
}

// Ensure output and pages dirs exist
for (const dir of [DEFAULT_CONFIG.output_dir, DEFAULT_CONFIG.pages_dir]) {
  fs.mkdirSync(dir, { recursive: true });
}

console.log('[lark-group-digest] Post-install complete');
