#!/usr/bin/env node
/**
 * Post-install hook: create data directories, default config, and register
 * scheduler tasks for the three daily digest runs.
 *
 * Task names get a random hex suffix (e.g. lark-group-digest-morning-a3f8c1)
 * to avoid collisions with user-defined tasks. Created task IDs are stored in
 * state.json so pre-uninstall can delete them precisely via CLI.
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
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const SCHEDULER_DB = path.join(ZYLOS_DIR, 'scheduler/scheduler.db');
const SCHEDULER_CLI = path.join(ZYLOS_DIR, '.claude/skills/scheduler/scripts/cli.js');

const TASK_SLOTS = [
  { slot: 'morning', cron: '0 8 * * *' },
  { slot: 'midday',  cron: '0 13 * * *' },
  { slot: 'evening', cron: '0 19 * * *' },
];

const DEFAULT_CONFIG = {
  lark_skill_path: path.join(HOME, 'zylos/.claude/skills/lark'),
  output_dir: path.join(HOME, 'zylos/lark-group-digest/raw'),
  pages_dir: path.join(HOME, 'zylos/http/public/pages/daily-digest'),
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

const DEFAULT_STATE = {
  schema_version: 1,
  scheduler_prompt_hash: null,
  scheduler_task_ids: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  return true;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { ...fallback };
    throw err;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function randomSuffix() {
  return crypto.randomBytes(3).toString('hex');
}

// ---------------------------------------------------------------------------
// Scheduler prompt — generic, no person names or hardcoded IDs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Scheduler task management
// ---------------------------------------------------------------------------

function isTaskPending(taskId) {
  if (!taskId || !fs.existsSync(SCHEDULER_DB)) return false;
  // TODO: replace with CLI query when scheduler adds --name/--id filter with JSON output
  try {
    const sql = `SELECT status FROM tasks WHERE id = '${taskId}';`;
    const output = run('sqlite3', ['-json', SCHEDULER_DB, sql]).trim();
    if (!output) return false;
    const rows = JSON.parse(output);
    return rows.length > 0 && rows[0].status === 'pending';
  } catch {
    return false;
  }
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

function cleanupLegacyTasks() {
  if (!fs.existsSync(SCHEDULER_DB)) return;
  // Find old-style tasks with fixed names (no random suffix) and pause/remove them.
  // TODO: replace with CLI query when scheduler adds --name filter
  const legacyNames = TASK_SLOTS.map(t => `'lark-group-digest-${t.slot}'`).join(',');
  const sql = `SELECT id, name, status FROM tasks WHERE name IN (${legacyNames}) ORDER BY id;`;
  try {
    const output = run('sqlite3', ['-json', SCHEDULER_DB, sql]).trim();
    const tasks = output ? JSON.parse(output) : [];
    for (const task of tasks) {
      console.log(`[lark-group-digest] Removing legacy task: ${task.id} (${task.name})`);
      removeTask(task.id);
    }
  } catch { /* best effort */ }
}

function ensureSchedulerTasks() {
  const expectedPrompt = schedulerPrompt();
  const expectedHash = promptHash(expectedPrompt);
  const state = readJson(STATE_PATH, DEFAULT_STATE);
  const storedIds = state.scheduler_task_ids || {};

  cleanupLegacyTasks();

  const newIds = {};

  for (const { slot, cron } of TASK_SLOTS) {
    const existingId = storedIds[slot];

    if (existingId && isTaskPending(existingId)) {
      console.log(`[lark-group-digest] Task already registered: ${existingId} (${slot})`);
      newIds[slot] = existingId;
      continue;
    }

    if (existingId) {
      console.log(`[lark-group-digest] Stored task ${existingId} (${slot}) is no longer pending; replacing`);
      try { removeTask(existingId); } catch { /* may already be gone */ }
    }

    console.log(`[lark-group-digest] Creating scheduler task: ${slot} (${cron})`);
    const taskId = addTask(slot, cron, expectedPrompt);
    console.log(`[lark-group-digest] Created: ${taskId}`);
    newIds[slot] = taskId;
  }

  state.scheduler_prompt_hash = expectedHash;
  state.scheduler_task_ids = newIds;
  writeJson(STATE_PATH, { ...DEFAULT_STATE, ...state, schema_version: 1 });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('[lark-group-digest] Post-install starting...');
ensureDir(DATA_DIR);
ensureDir(LOGS_DIR);

if (writeIfMissing(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`)) {
  console.log('[lark-group-digest] Created config.json');
} else {
  const config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_PATH, DEFAULT_CONFIG) };
  writeJson(CONFIG_PATH, config);
  console.log('[lark-group-digest] Config exists; ensured default fields');
}

if (writeIfMissing(STATE_PATH, `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`)) {
  console.log('[lark-group-digest] Created state.json');
} else {
  const state = { ...DEFAULT_STATE, ...readJson(STATE_PATH, DEFAULT_STATE), schema_version: 1 };
  writeJson(STATE_PATH, state);
  console.log('[lark-group-digest] State exists; ensured default fields');
}

const config = readJson(CONFIG_PATH, DEFAULT_CONFIG);
for (const dir of [config.output_dir || DEFAULT_CONFIG.output_dir, config.pages_dir || DEFAULT_CONFIG.pages_dir]) {
  ensureDir(dir);
}

ensureSchedulerTasks();
console.log('[lark-group-digest] Post-install complete!');
