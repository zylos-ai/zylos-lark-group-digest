/**
 * Configuration loader for zylos-lark-group-digest
 *
 * Loads config from ~/zylos/components/lark-group-digest/config.json
 * with hot-reload support via file watcher.
 */

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
export const DATA_DIR = path.join(HOME, 'zylos/components/lark-group-digest');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  enabled: true,
  lark_skill_path: path.join(HOME, 'zylos/.claude/skills/lark'),
  output_dir: path.join(HOME, 'zylos/lark-group-digest/raw'),
  pages_dir: path.join(HOME, 'zylos/http/public/pages/daily-digest'),
  owner_open_id: '',
  owner_chat_id: '',
  digest_schedule: [
    { hour: 8, suffix: 'morning', label: 'morning', window_hours: 13 },
    { hour: 13, suffix: 'midday', label: 'midday', window_hours: 5 },
    { hour: 19, suffix: 'evening', label: 'evening', window_hours: 6 }
  ],
  sensitive_patterns: [
    'ou_[a-f0-9]{32}',
    'oc_[a-f0-9]{32}',
    'cli_[a-f0-9]{16}'
  ],
  settings: {}
};

let config = null;
let configWatcher = null;

/**
 * Load configuration from file
 * @returns {Object} Configuration object
 */
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } else {
      console.warn(`[lark-group-digest] Config file not found: ${CONFIG_PATH}`);
      config = { ...DEFAULT_CONFIG };
    }
  } catch (err) {
    console.error(`[lark-group-digest] Failed to load config: ${err.message}`);
    config = { ...DEFAULT_CONFIG };
  }
  return config;
}

/**
 * Get current configuration
 * @returns {Object} Configuration object
 */
export function getConfig() {
  if (!config) {
    loadConfig();
  }
  return config;
}

/**
 * Save configuration to file
 * @param {Object} newConfig - Configuration to save
 */
export function saveConfig(newConfig) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
    config = newConfig;
  } catch (err) {
    console.error(`[lark-group-digest] Failed to save config: ${err.message}`);
    throw err;
  }
}

/**
 * Start watching config file for changes
 * @param {Function} onChange - Callback when config changes
 */
export function watchConfig(onChange) {
  if (configWatcher) {
    configWatcher.close();
  }

  if (fs.existsSync(CONFIG_PATH)) {
    configWatcher = fs.watch(CONFIG_PATH, (eventType) => {
      if (eventType === 'change') {
        console.log('[lark-group-digest] Config file changed, reloading...');
        loadConfig();
        if (onChange) {
          onChange(config);
        }
      }
    });
  }
}

/**
 * Stop watching config file
 */
export function stopWatching() {
  if (configWatcher) {
    configWatcher.close();
    configWatcher = null;
  }
}
