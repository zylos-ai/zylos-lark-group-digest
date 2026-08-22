#!/usr/bin/env node
/**
 * Post-upgrade hook: migrate config schema if needed.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = path.join(os.homedir(), 'zylos/components/lark-group-digest');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(CONFIG_PATH)) {
  console.log('[lark-group-digest] No config to migrate');
  process.exit(0);
}

try {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  // v0.1.0 baseline — add any missing keys with defaults
  if (!config.sensitive_patterns) {
    config.sensitive_patterns = [
      'ou_[a-f0-9]{32}',
      'oc_[a-f0-9]{32}',
      'cli_[a-f0-9]{16}',
    ];
  }
  if (!config.attention_rules) {
    config.attention_rules = {
      always_flag_groups: [],
      recruitment_groups: [],
    };
  }
  if (!config.digest_schedule) {
    config.digest_schedule = [
      { hour: 8, suffix: 'morning', label: '上午', window_hours: 13 },
      { hour: 13, suffix: 'midday', label: '午间', window_hours: 5 },
      { hour: 19, suffix: 'evening', label: '晚间', window_hours: 6 },
    ];
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log('[lark-group-digest] Config migration complete');
} catch (err) {
  console.error(`[lark-group-digest] Config migration failed: ${err.message}`);
  process.exit(1);
}
