#!/usr/bin/env node
/**
 * Pre-upgrade hook: backup config before upgrade.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = path.join(os.homedir(), 'zylos/components/lark-group-digest');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const BACKUP_PATH = path.join(DATA_DIR, `config.backup-${Date.now()}.json`);

if (fs.existsSync(CONFIG_PATH)) {
  fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
  console.log(`[lark-group-digest] Config backed up to ${BACKUP_PATH}`);
} else {
  console.log('[lark-group-digest] No config to back up');
}
