#!/usr/bin/env node
/**
 * Post-upgrade hook: migrate config schema and re-register scheduler tasks
 * if the prompt has changed. Removes old tasks and creates fresh ones with
 * new random suffixes; stores IDs in state.json.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const ZYLOS_DIR = process.env.ZYLOS_DIR || path.join(HOME, 'zylos');
const DATA_DIR = process.env.ZYLOS_DATA_DIR || path.join(ZYLOS_DIR, 'components/lark-group-digest');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const SCHEDULER_DB = path.join(ZYLOS_DIR, 'scheduler/scheduler.db');
const SCHEDULER_CLI = path.join(ZYLOS_DIR, '.claude/skills/scheduler/scripts/cli.js');

const TASK_SLOTS = [
  { slot: 'morning', cron: '0 8 * * *' },
  { slot: 'midday',  cron: '0 13 * * *' },
  { slot: 'evening', cron: '0 19 * * *' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { ...fallback };
    throw err;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function randomSuffix() {
  return crypto.randomBytes(3).toString('hex');
}

function schedulerPrompt() {
  return [
    'lark-group-digest：读取 ~/zylos/.claude/skills/lark-group-digest/SKILL.md 后，',
    '按其 Execution Model 立即启动后台 subagent（model=sonnet, run_in_background）',
    '执行完整摘要流程（含图片查看、模板填充、发布、DM Owner、scheduler done），',
    '主 session 不得 inline 执行。',
  ].join('');
}

function promptHash(prompt) {
  return crypto.createHash('sha256').update(prompt).digest('hex');
}

function removeTask(taskId) {
  run('node', [SCHEDULER_CLI, 'remove', taskId]);
}

function addTask(slot, cron, prompt) {
  const name = `lark-group-digest-${slot}-${randomSuffix()}`;
  const output = run('node', [SCHEDULER_CLI, 'add', prompt, '--cron', cron, '--priority', '3', '--name', name]);
  const match = output.match(/Task created:\s*(task-\S+)/);
  if (!match) throw new Error(`Failed to parse task ID from CLI output: ${output}`);
  return match[1];
}

// ---------------------------------------------------------------------------
// Config migration
// ---------------------------------------------------------------------------

function migrateConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log('[lark-group-digest] No config to migrate');
    return;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

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
}

// ---------------------------------------------------------------------------
// Scheduler task re-registration (if prompt changed)
// ---------------------------------------------------------------------------

function ensureSchedulerTasks() {
  const expectedPrompt = schedulerPrompt();
  const expectedHash = promptHash(expectedPrompt);
  const state = readJson(STATE_PATH, { schema_version: 1, scheduler_prompt_hash: null, scheduler_task_ids: {} });

  if (state.scheduler_prompt_hash === expectedHash && Object.keys(state.scheduler_task_ids || {}).length > 0) {
    console.log('[lark-group-digest] Scheduler prompt unchanged; skipping re-registration');
    return;
  }

  console.log('[lark-group-digest] Scheduler prompt changed or no stored tasks; re-registering...');

  const oldIds = state.scheduler_task_ids || {};
  for (const [slot, taskId] of Object.entries(oldIds)) {
    try {
      removeTask(taskId);
      console.log(`[lark-group-digest] Removed old task: ${taskId} (${slot})`);
    } catch {
      console.log(`[lark-group-digest] Old task ${taskId} (${slot}) already gone.`);
    }
  }

  // Also clean up any legacy fixed-name tasks
  // TODO: replace with CLI query when scheduler adds --name filter
  if (fs.existsSync(SCHEDULER_DB)) {
    const legacyNames = TASK_SLOTS.map(t => `'lark-group-digest-${t.slot}'`).join(',');
    const sql = `SELECT id, name FROM tasks WHERE name IN (${legacyNames}) ORDER BY id;`;
    try {
      const output = run('sqlite3', ['-json', SCHEDULER_DB, sql]).trim();
      const tasks = output ? JSON.parse(output) : [];
      for (const task of tasks) {
        console.log(`[lark-group-digest] Removing legacy task: ${task.id} (${task.name})`);
        removeTask(task.id);
      }
    } catch { /* best effort */ }
  }

  const newIds = {};
  for (const { slot, cron } of TASK_SLOTS) {
    console.log(`[lark-group-digest] Creating task: ${slot} (${cron})`);
    const taskId = addTask(slot, cron, expectedPrompt);
    console.log(`[lark-group-digest] Created: ${taskId}`);
    newIds[slot] = taskId;
  }

  state.scheduler_prompt_hash = expectedHash;
  state.scheduler_task_ids = newIds;
  writeJson(STATE_PATH, { ...state, schema_version: 1 });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('[lark-group-digest] Post-upgrade starting...');

try {
  migrateConfig();
} catch (err) {
  console.error(`[lark-group-digest] Config migration failed: ${err.message}`);
  process.exit(1);
}

try {
  ensureSchedulerTasks();
} catch (err) {
  console.error(`[lark-group-digest] Scheduler re-registration failed: ${err.message}`);
}

console.log('[lark-group-digest] Post-upgrade complete!');
