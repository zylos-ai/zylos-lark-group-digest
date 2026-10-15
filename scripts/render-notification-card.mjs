#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { buildNotificationCard } from './notification-card.mjs';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(`${JSON.stringify(buildNotificationCard(input), null, 2)}\n`);
} catch {
  // Do not echo potentially private input or parser errors containing input fragments.
  process.stderr.write('Invalid notification input. See references/notification-card.md.\n');
  process.exitCode = 1;
}
