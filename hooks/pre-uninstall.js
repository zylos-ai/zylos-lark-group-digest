#!/usr/bin/env node
/**
 * Pre-uninstall hook: pause all scheduler tasks created by this component.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const ZYLOS_DIR = process.env.ZYLOS_DIR || path.join(HOME, 'zylos');
const SCHEDULER_DB = path.join(ZYLOS_DIR, 'scheduler/scheduler.db');
const SCHEDULER_CLI = path.join(ZYLOS_DIR, '.claude/skills/scheduler/scripts/cli.js');

const TASK_NAMES = [
  'lark-group-digest-morning',
  'lark-group-digest-midday',
  'lark-group-digest-evening',
];

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function findTasks() {
  if (!fs.existsSync(SCHEDULER_DB)) return [];
  const names = TASK_NAMES.map(n => `'${n}'`).join(',');
  const sql = `SELECT id, name, status FROM tasks WHERE name IN (${names}) AND status = 'pending' ORDER BY id;`;
  const output = run('sqlite3', ['-json', SCHEDULER_DB, sql]).trim();
  return output ? JSON.parse(output) : [];
}

function pauseTask(taskId) {
  run('node', [SCHEDULER_CLI, 'pause', taskId]);
}

console.log('[lark-group-digest] Pre-uninstall: cleaning up scheduler tasks...');

try {
  const tasks = findTasks();
  if (tasks.length === 0) {
    console.log('[lark-group-digest] No active scheduler tasks found.');
  } else {
    for (const task of tasks) {
      console.log(`[lark-group-digest] Pausing task: ${task.id} (${task.name})`);
      pauseTask(task.id);
    }
    console.log(`[lark-group-digest] Paused ${tasks.length} scheduler task(s).`);
  }
} catch (err) {
  console.error(`[lark-group-digest] Warning: failed to clean up scheduler tasks: ${err.message}`);
}

console.log('[lark-group-digest] Pre-uninstall complete.');
