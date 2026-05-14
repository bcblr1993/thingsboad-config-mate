/**
 * ESM entry point for Config Mate.
 *
 * Stage 1 responsibilities:
 *   - Load the compatibility bridge so window.__CM__ becomes available.
 *   - That's it. Business logic still lives in legacy /assets/app.js
 *     for now; refactor stages 3+ will move it here.
 *
 * Loading order in index.html:
 *   <script src="assets/api.js"></script>        ← legacy IIFE (sets window.fetch)
 *   <script src="assets/modules/*.js"></script>  ← legacy IIFE modules
 *   <script src="assets/app.js"></script>        ← legacy boot
 *   <script type="module" src="assets/src/main.js"></script>  ← this file (defer)
 *
 * Because <script type=module> is implicit-defer, this file runs AFTER the
 * legacy classic scripts finish parsing — meaning window.ConfigMateApi and
 * window.fetch are guaranteed to exist when bridge.js loads.
 */

import './bridge.js';
import { logger } from './core/logger.js';
import { env } from './core/env.js';

logger.info(`Config Mate ${env.version} (${env.appType}) — infra ready.`);
