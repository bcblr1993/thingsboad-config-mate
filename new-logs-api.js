// Temporary file to hold the new logs API implementation
// This will be manually copied to tb-config-src.js

// SSE for Container Logs - Using callback mode like restart API
if (url === '/api/logs' && method === 'GET') {
    if (!dockerComposeCmd) {
        res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'error',
            message: 'Docker Compose not available'
        }));
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Get last 50 lines of logs using callback mode (like restart API)
    const args = [...dockerComposeCmdArgs, 'logs', '--tail=50', 'iotcloud'];
    const cmd = `${dockerComposeCmd} ${args.join(' ')}`;
    console.log(`[Info] Fetching logs: ${cmd}`);

    exec(cmd, { cwd: __dirname, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
        if (error) {
            console.error('[Error] Failed to fetch logs:', error.message);
            res.write(`data: ${JSON.stringify({ type: 'error', message: `[错误] ${error.message}` })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'close', code: error.code || -1 })}\n\n`);
            res.end();
            return;
        }

        // Send logs line by line
        res.write(`data: ${JSON.stringify({ type: 'log', message: '========== 最近 50 行容器日志 ==========' })}\n\n`);

        const allOutput = (stdout + stderr).trim();
        if (allOutput) {
            const lines = allOutput.split('\n');
            lines.forEach(line => {
                res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
            });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'log', message: '(无日志输出)' })}\n\n`);
        }

        res.write(`data: ${JSON.stringify({ type: 'log', message: '' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'success', message: '✓ 重启命令已执行' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'log', message: '' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'log', message: '如需查看实时日志，请执行：' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'log', message: `  ${dockerComposeCmd} ${[...dockerComposeCmdArgs, 'logs', '-f', 'iotcloud'].join(' ')}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'log', message: '========================================' })}\n\n`);

        res.write(`data: ${JSON.stringify({ type: 'close', code: 0 })}\n\n`);
        res.end();
    });

    return;
}
