#!/usr/bin/env node
/**
 * Post-upgrade hook: migrate config schema and re-register scheduler tasks
 * if the prompt has changed.
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

const TASKS = [
  { name: 'lark-group-digest-morning', cron: '0 8 * * *' },
  { name: 'lark-group-digest-midday',  cron: '0 13 * * *' },
  { name: 'lark-group-digest-evening', cron: '0 19 * * *' },
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
  const state = readJson(STATE_PATH, { schema_version: 1, scheduler_prompt_hash: null });

  if (state.scheduler_prompt_hash === expectedHash) {
    console.log('[lark-group-digest] Scheduler prompt unchanged; skipping re-registration');
    return;
  }

  console.log('[lark-group-digest] Scheduler prompt changed; re-registering tasks...');

  if (!fs.existsSync(SCHEDULER_DB)) {
    console.log('[lark-group-digest] Scheduler DB not found; skipping');
    return;
  }

  const names = TASKS.map(t => `'${t.name}'`).join(',');
  const sql = `SELECT id, name, prompt, status, COALESCE(cron_expression, '') AS cron FROM tasks WHERE name IN (${names}) OR prompt LIKE '%lark-group-digest%' ORDER BY id;`;
  const output = run('sqlite3', ['-json', SCHEDULER_DB, sql]).trim();
  const existingTasks = output ? JSON.parse(output) : [];

  for (const taskDef of TASKS) {
    const matching = existingTasks.filter(t => t.name === taskDef.name);

    for (const task of matching) {
      if (task.prompt !== expectedPrompt || task.status !== 'pending' || task.cron !== taskDef.cron) {
        console.log(`[lark-group-digest] Pausing stale task: ${task.id} (${task.name})`);
        run('node', [SCHEDULER_CLI, 'pause', task.id]);
      }
    }

    const activeCurrent = matching.find(
      t => t.prompt === expectedPrompt && t.status === 'pending' && t.cron === taskDef.cron
    );

    if (activeCurrent) {
      console.log(`[lark-group-digest] Task already current: ${activeCurrent.id} (${taskDef.name})`);
    } else {
      console.log(`[lark-group-digest] Creating task: ${taskDef.name} (${taskDef.cron})`);
      run('node', [SCHEDULER_CLI, 'add', expectedPrompt, '--cron', taskDef.cron, '--priority', '3', '--name', taskDef.name]);
    }
  }

  state.scheduler_prompt_hash = expectedHash;
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
