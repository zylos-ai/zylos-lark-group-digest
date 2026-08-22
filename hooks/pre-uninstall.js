#!/usr/bin/env node
/**
 * Pre-uninstall hook: delete all scheduler tasks created by this component.
 * Reads task IDs from state.json and removes them via the scheduler CLI.
 * No direct sqlite3 usage.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const ZYLOS_DIR = process.env.ZYLOS_DIR || path.join(HOME, 'zylos');
const DATA_DIR = process.env.ZYLOS_DATA_DIR || path.join(ZYLOS_DIR, 'components/lark-group-digest');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const SCHEDULER_CLI = path.join(ZYLOS_DIR, '.claude/skills/scheduler/scripts/cli.js');

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

console.log('[lark-group-digest] Pre-uninstall: cleaning up scheduler tasks...');

try {
  const state = readJson(STATE_PATH);
  const taskIds = state.scheduler_task_ids || {};
  const entries = Object.entries(taskIds);

  if (entries.length === 0) {
    console.log('[lark-group-digest] No stored scheduler task IDs found.');
  } else {
    let removed = 0;
    for (const [slot, taskId] of entries) {
      try {
        run('node', [SCHEDULER_CLI, 'remove', taskId]);
        console.log(`[lark-group-digest] Removed task: ${taskId} (${slot})`);
        removed++;
      } catch (err) {
        console.log(`[lark-group-digest] Task ${taskId} (${slot}) already gone or not found.`);
      }
    }
    console.log(`[lark-group-digest] Removed ${removed} scheduler task(s).`);
  }

  state.scheduler_task_ids = {};
  writeJson(STATE_PATH, state);
} catch (err) {
  console.error(`[lark-group-digest] Warning: failed to clean up scheduler tasks: ${err.message}`);
}

console.log('[lark-group-digest] Pre-uninstall complete.');
