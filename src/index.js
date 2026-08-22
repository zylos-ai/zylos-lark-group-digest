#!/usr/bin/env node
/**
 * zylos-lark-group-digest
 *
 * Automated Lark group message digest for Zylos agents.
 * This is a utility component — it runs on-demand via scheduled tasks,
 * not as a long-running daemon.
 */

import { getConfig, DATA_DIR } from './lib/config.js';

console.log(`[lark-group-digest] Starting...`);
console.log(`[lark-group-digest] Data directory: ${DATA_DIR}`);

const config = getConfig();
console.log(`[lark-group-digest] Config loaded, enabled: ${config.enabled}`);

if (!config.enabled) {
  console.log(`[lark-group-digest] Component disabled in config, exiting.`);
  process.exit(0);
}

console.log(`[lark-group-digest] Utility component ready. Use scripts/digest.mjs for message fetching.`);
