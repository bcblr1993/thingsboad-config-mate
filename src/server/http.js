function writeJson(res, statusCode, data, headers = {}) {
    res.writeHead(statusCode, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function readRequestBody(req, options = {}) {
    const limitBytes = options.limitBytes || 1024 * 1024;

    return new Promise((resolve, reject) => {
        let body = '';
        let receivedBytes = 0;

        req.on('data', chunk => {
            receivedBytes += chunk.length;
            if (receivedBytes > limitBytes) {
                reject(new Error(`Request body exceeds ${limitBytes} bytes`));
                req.destroy();
                return;
            }
            body += chunk.toString('utf8');
        });

        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

module.exports = {
    readRequestBody,
    writeJson
};
