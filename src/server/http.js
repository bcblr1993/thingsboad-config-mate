function writeJson(res, statusCode, data, headers = {}) {
    res.writeHead(statusCode, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function readRequestBody(req, options = {}) {
    const limitBytes = options.limitBytes || 1024 * 1024;

    return new Promise((resolve, reject) => {
        let body = '';
        let receivedBytes = 0;
        let aborted = false;

        req.on('data', chunk => {
            if (aborted) return;
            receivedBytes += chunk.length;
            if (receivedBytes > limitBytes) {
                aborted = true;
                const error = new Error(`请求体超过 ${Math.floor(limitBytes / 1024)} KB 限制`);
                error.statusCode = 413;
                error.code = 'PAYLOAD_TOO_LARGE';
                /* 只暂停接收，不直接 destroy：连接被销毁后就无法把错误响应
                   写回客户端，调用方只会看到连接中断而不知道原因。 */
                req.pause();
                reject(error);
                return;
            }
            body += chunk.toString('utf8');
        });

        req.on('end', () => {
            if (!aborted) resolve(body);
        });
        req.on('error', error => {
            if (!aborted) reject(error);
        });
    });
}

/** 统一的错误响应：识别错误上携带的 statusCode，否则按 500 处理。 */
function respondError(res, error, headers = {}) {
    const statusCode = Number(error?.statusCode) || 500;
    writeJson(res, statusCode, {
        status: 'error',
        code: error?.code || undefined,
        message: error?.message || 'Internal Server Error'
    }, headers);
}

module.exports = {
    readRequestBody,
    respondError,
    writeJson
};
