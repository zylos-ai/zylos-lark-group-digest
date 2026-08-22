#!/usr/bin/env node
/**
 * Configure hook: accept JSON config on stdin and merge into config.json.
 * Called by zylos core after collecting config.required values.
 *
 * Usage: printf '{"OWNER_CHAT_ID":"..."}' | node hooks/configure.js
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = path.join(os.homedir(), 'zylos/components/lark-group-digest');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const KEY_MAP = {
  OWNER_CHAT_ID: 'owner_chat_id',
  LARK_SKILL_PATH: 'lark_skill_path',
  OUTPUT_DIR: 'output_dir',
  PAGES_DIR: 'pages_dir',
  OWNER_DISPLAY_NAME: 'owner_display_name',
};

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const supplied = JSON.parse(input);
    fs.mkdirSync(DATA_DIR, { recursive: true });

    let config = {};
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }

    for (const [envKey, configKey] of Object.entries(KEY_MAP)) {
      if (supplied[envKey] !== undefined) {
        config[configKey] = supplied[envKey];
      }
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    console.log('[lark-group-digest] Configuration updated');
  } catch (err) {
    console.error(`[lark-group-digest] Configure failed: ${err.message}`);
    process.exit(1);
  }
});
