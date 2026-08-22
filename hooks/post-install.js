#!/usr/bin/env node
/**
 * Post-install hook: create data directories, default config, and register
 * scheduler tasks for the three daily digest runs.
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

const TASKS = [
  { name: 'lark-group-digest-morning', cron: '0 8 * * *' },
  { name: 'lark-group-digest-midday',  cron: '0 13 * * *' },
  { name: 'lark-group-digest-evening', cron: '0 19 * * *' },
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

function requireSqliteCli() {
  try {
    execFileSync('which', ['sqlite3'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    console.error('[lark-group-digest] sqlite3 CLI is required but not found.');
    process.exit(1);
  }
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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

function schedulerTasks() {
  if (!fs.existsSync(SCHEDULER_DB)) return [];
  const names = TASKS.map(t => `'${t.name}'`).join(',');
  const sql = `SELECT id, name, prompt, status, COALESCE(cron_expression, '') AS cron FROM tasks WHERE name IN (${names}) OR prompt LIKE '%lark-group-digest%' ORDER BY id;`;
  const output = run('sqlite3', ['-json', SCHEDULER_DB, sql]).trim();
  return output ? JSON.parse(output) : [];
}

function pauseTask(taskId) {
  run('node', [SCHEDULER_CLI, 'pause', taskId]);
}

function addTask(taskDef, prompt) {
  run('node', [SCHEDULER_CLI, 'add', prompt, '--cron', taskDef.cron, '--priority', '3', '--name', taskDef.name]);
}

function isManagedPrompt(task) {
  const prompt = task.prompt || '';
  return prompt.includes('lark-group-digest') && prompt.includes('SKILL.md');
}

function ensureSchedulerTasks() {
  const expectedPrompt = schedulerPrompt();
  const expectedHash = promptHash(expectedPrompt);
  const state = readJson(STATE_PATH, DEFAULT_STATE);
  const existingTasks = schedulerTasks();

  for (const taskDef of TASKS) {
    const matching = existingTasks.filter(t => t.name === taskDef.name);
    const activeCurrent = matching.find(
      t => t.prompt === expectedPrompt && t.status === 'pending' && t.cron === taskDef.cron
    );

    for (const task of matching) {
      const isStale = task.prompt !== expectedPrompt || task.status !== 'pending' || task.cron !== taskDef.cron;
      if (isStale) {
        console.log(`[lark-group-digest] Pausing stale task: ${task.id} (${task.name})`);
        pauseTask(task.id);
      }
    }

    // Also pause any unrelated tasks that match the managed prompt pattern but have wrong name
    for (const task of existingTasks) {
      if (!TASKS.some(td => td.name === task.name) && isManagedPrompt(task) && task.status === 'pending') {
        console.log(`[lark-group-digest] Pausing orphan managed task: ${task.id}`);
        pauseTask(task.id);
      }
    }

    if (activeCurrent) {
      console.log(`[lark-group-digest] Task already registered: ${activeCurrent.id} (${taskDef.name})`);
    } else {
      console.log(`[lark-group-digest] Creating scheduler task: ${taskDef.name} (${taskDef.cron})`);
      addTask(taskDef, expectedPrompt);
    }
  }

  state.scheduler_prompt_hash = expectedHash;
  writeJson(STATE_PATH, { ...DEFAULT_STATE, ...state, schema_version: 1 });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('[lark-group-digest] Post-install starting...');
requireSqliteCli();
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

// Ensure output and pages dirs from config
const config = readJson(CONFIG_PATH, DEFAULT_CONFIG);
for (const dir of [config.output_dir || DEFAULT_CONFIG.output_dir, config.pages_dir || DEFAULT_CONFIG.pages_dir]) {
  ensureDir(dir);
}

ensureSchedulerTasks();
console.log('[lark-group-digest] Post-install complete!');
