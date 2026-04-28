const { spawn: spawnChild } = require('child_process');
const { writeJson } = require('../http');

const DEFAULT_LOG_STREAM_LIMITS = {
    maxPendingLogEvents: 1000,
    maxEventsPerFlush: 120,
    maxSseLineLength: 4000,
    flushIntervalMs: 200,
    heartbeatIntervalMs: 15000
};

function truncateLogLine(line, maxLength = DEFAULT_LOG_STREAM_LIMITS.maxSseLineLength) {
    const message = String(line || '');
    if (message.length <= maxLength) return message;
    return `${message.slice(0, maxLength)} ... [server truncated, original length: ${message.length}]`;
}

function enqueueBoundedEvent(queue, event, maxEvents = DEFAULT_LOG_STREAM_LIMITS.maxPendingLogEvents) {
    let dropped = 0;
    if (queue.length >= maxEvents) {
        dropped = queue.length - maxEvents + 1;
        queue.splice(0, dropped);
    }
    queue.push(event);
    return dropped;
}

function createLogStreamService({
    appRoot,
    docker,
    getServiceDefinition,
    defaultServiceId,
    spawn = spawnChild,
    logger = console,
    platform = process.platform,
    limits = {}
}) {
    const settings = { ...DEFAULT_LOG_STREAM_LIMITS, ...limits };

    function streamLogs({ req, res, serviceId, headers = {} }) {
        if (!docker.dockerComposeCmd) {
            writeJson(res, 500, {
                status: 'error',
                message: 'Docker Compose not available'
            }, headers);
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const targetServiceId = serviceId || defaultServiceId();
        const def = getServiceDefinition(targetServiceId);
        if (!def || !def.exists) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: `[错误] 服务不存在或 compose 文件缺失: ${targetServiceId}` })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'close', code: -1 })}\n\n`);
            res.end();
            return;
        }

        const args = docker.composeArgsFor(def, ['logs', '-f', '--tail=50', def.composeService]);
        logger.log(`[Info] Starting real-time logs: ${docker.dockerComposeCmd} ${args.join(' ')}`);

        const child = spawn(docker.dockerComposeCmd, args, {
            cwd: appRoot,
            detached: platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let closed = false;
        let cleanupStarted = false;
        let waitingForDrain = false;
        let droppedLogEvents = 0;
        let stdoutRemainder = '';
        let stderrRemainder = '';
        let heartbeat = null;
        let flushTimer = null;
        const pendingEvents = [];

        function isResponseOpen() {
            return !closed && !res.destroyed && !res.writableEnded;
        }

        function pauseUntilDrain() {
            if (waitingForDrain || !isResponseOpen()) return;
            waitingForDrain = true;
            child.stdout.pause();
            child.stderr.pause();
            res.once('drain', () => {
                waitingForDrain = false;
                if (!isResponseOpen()) return;
                child.stdout.resume();
                child.stderr.resume();
                flushPendingEvents();
            });
        }

        function writeSse(payload) {
            if (!isResponseOpen()) return false;
            const ok = res.write(`data: ${JSON.stringify(payload)}\n\n`);
            if (!ok) pauseUntilDrain();
            return ok;
        }

        function enqueueLogLine(line) {
            if (!line) return;
            const message = truncateLogLine(line, settings.maxSseLineLength);
            droppedLogEvents += enqueueBoundedEvent(
                pendingEvents,
                { type: 'log', message },
                settings.maxPendingLogEvents
            );
        }

        function processLogChunk(chunk, streamName) {
            const existing = streamName === 'stdout' ? stdoutRemainder : stderrRemainder;
            const text = existing + chunk.toString('utf8');
            const lines = text.split(/\r?\n/);
            const remainder = lines.pop() || '';
            if (streamName === 'stdout') stdoutRemainder = remainder;
            else stderrRemainder = remainder;
            lines.forEach(enqueueLogLine);
        }

        function flushRemainders() {
            if (stdoutRemainder) {
                enqueueLogLine(stdoutRemainder);
                stdoutRemainder = '';
            }
            if (stderrRemainder) {
                enqueueLogLine(stderrRemainder);
                stderrRemainder = '';
            }
        }

        function flushPendingEvents() {
            if (!isResponseOpen()) return;
            if (droppedLogEvents > 0) {
                const dropped = droppedLogEvents;
                droppedLogEvents = 0;
                if (!writeSse({ type: 'warn', message: `[日志过多] 已丢弃 ${dropped} 条旧日志，继续显示最新内容。` })) return;
            }

            let sent = 0;
            while (pendingEvents.length > 0 && sent < settings.maxEventsPerFlush) {
                const event = pendingEvents.shift();
                if (!writeSse(event)) {
                    pendingEvents.unshift(event);
                    return;
                }
                sent += 1;
            }
        }

        function killLogsProcess() {
            if (child.killed || child.exitCode !== null) return;
            try {
                if (platform !== 'win32') {
                    process.kill(-child.pid, 'SIGTERM');
                } else {
                    child.kill('SIGTERM');
                }
            } catch (e) {
                try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
            }
            setTimeout(() => {
                if (child.killed || child.exitCode !== null) return;
                try {
                    if (platform !== 'win32') {
                        process.kill(-child.pid, 'SIGKILL');
                    } else {
                        child.kill('SIGKILL');
                    }
                } catch (_) {
                    // The process may already be gone.
                }
            }, 5000).unref?.();
        }

        function cleanupLogStream(reason, shouldKillChild = false) {
            if (cleanupStarted) return;
            cleanupStarted = true;
            closed = true;
            if (heartbeat) clearInterval(heartbeat);
            if (flushTimer) clearInterval(flushTimer);
            child.stdout.removeAllListeners('data');
            child.stderr.removeAllListeners('data');
            pendingEvents.length = 0;
            if (shouldKillChild) {
                logger.log(`[Info] Closing logs stream (${reason}), killing logs process...`);
                killLogsProcess();
            }
        }

        flushTimer = setInterval(flushPendingEvents, settings.flushIntervalMs);

        child.stdout.on('data', chunk => processLogChunk(chunk, 'stdout'));
        child.stderr.on('data', chunk => processLogChunk(chunk, 'stderr'));

        child.on('close', code => {
            logger.log(`[Info] Logs process exited with code ${code}`);
            cleanupStarted = true;
            if (heartbeat) clearInterval(heartbeat);
            if (flushTimer) clearInterval(flushTimer);
            flushRemainders();
            flushPendingEvents();
            if (isResponseOpen()) {
                writeSse({ type: 'close', code });
                closed = true;
                res.end();
            }
        });

        child.on('error', err => {
            logger.error('[Error] Failed to spawn logs process:', err.message);
            cleanupStarted = true;
            if (heartbeat) clearInterval(heartbeat);
            if (flushTimer) clearInterval(flushTimer);
            if (isResponseOpen()) {
                writeSse({ type: 'error', message: `[错误] ${err.message}` });
                writeSse({ type: 'close', code: -1 });
                closed = true;
                res.end();
            }
        });

        heartbeat = setInterval(() => {
            if (isResponseOpen()) {
                const ok = res.write(': heartbeat\n\n');
                if (!ok) pauseUntilDrain();
            } else {
                clearInterval(heartbeat);
            }
        }, settings.heartbeatIntervalMs);

        req.on('close', () => {
            cleanupLogStream('request closed', true);
        });

        res.on('close', () => {
            cleanupLogStream('response closed', true);
        });
    }

    return {
        streamLogs
    };
}

module.exports = {
    DEFAULT_LOG_STREAM_LIMITS,
    createLogStreamService,
    enqueueBoundedEvent,
    truncateLogLine
};
