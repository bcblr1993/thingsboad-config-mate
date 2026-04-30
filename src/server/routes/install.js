const fs = require('fs');
const path = require('path');
const { spawn: spawnChild } = require('child_process');
const { writeJson } = require('../http');

function checkComposeFileContent(filePath, keyword, logger = console) {
    try {
        if (!filePath) return false;
        const content = fs.readFileSync(filePath, 'utf-8');
        const regex = new RegExp(`^\\s*${keyword}\\s*:`);
        return content.split('\n').some(line => {
            const trimmed = line.trim();
            return regex.test(line) && !trimmed.startsWith('#');
        });
    } catch (e) {
        logger.error?.(`[Error] checkComposeFileContent failed for ${filePath}:`, e);
        return false;
    }
}

function validateComposeFiles({ appDir, appDef }) {
    const confDir = path.join(appDir, 'conf');
    const tbConfigPath = path.join(confDir, 'thingsboard.yml');
    const edgeConfigPath = path.join(confDir, 'tb-edge.yml');

    if (!fs.existsSync(tbConfigPath) && !fs.existsSync(edgeConfigPath)) {
        return {
            status: 'config_missing',
            msg: 'Missing ThingsBoard configuration files',
            files: ['conf/thingsboard.yml', 'conf/tb-edge.yml']
        };
    }

    const requiredFiles = [
        { label: appDef?.composePath || 'docker-compose.yml', path: appDef?.composeAbsPath },
        { label: appDef?.installComposePath || 'docker-compose-install.yml', path: appDef?.installComposeAbsPath }
    ];

    const missingFiles = requiredFiles
        .filter(file => !file.path || !fs.existsSync(file.path))
        .map(file => file.label);

    if (missingFiles.length > 0) {
        return { status: 'missing', files: missingFiles };
    }

    const errors = requiredFiles
        .filter(file => !checkComposeFileContent(file.path, 'env_file'))
        .map(file => ({ file: file.label, msg: '未配置 env_file (Missing env_file property)' }));

    if (errors.length > 0) return { status: 'error', errors };
    return { status: 'success' };
}

function createInstallRoutes({
    appRoot,
    appDir,
    dockerRuntime,
    getServiceDefinition,
    getPackageServiceId,
    guardAppServiceDependencies,
    spawn = spawnChild,
    logger = console
}) {
    function handle(req, res, { method, pathname, headers }) {
        if (pathname === '/api/check-install' && method === 'GET') {
            const appDef = getServiceDefinition(getPackageServiceId());
            const installFile = appDef?.installComposeAbsPath;
            writeJson(res, 200, { status: 'success', exists: !!installFile && fs.existsSync(installFile) }, headers);
            return true;
        }

        if (pathname === '/api/validate-compose' && method === 'GET') {
            const appDef = getServiceDefinition(getPackageServiceId());
            writeJson(res, 200, validateComposeFiles({ appDir, appDef }), headers);
            return true;
        }

        if (pathname === '/api/install' && method === 'POST') {
            handleInstall(req, res, headers).catch(e => {
                writeJson(res, 500, { status: 'error', message: e.message }, headers);
            });
            return true;
        }

        return false;
    }

    async function handleInstall(req, res, headers) {
        if (!dockerRuntime.dockerComposeCmd) {
            writeJson(res, 500, { status: 'error', message: 'Docker not available' }, headers);
            return;
        }

        const appDef = getServiceDefinition(getPackageServiceId());
        if (!appDef?.installComposeAbsPath || !fs.existsSync(appDef.installComposeAbsPath)) {
            writeJson(res, 404, { status: 'error', message: 'Install compose file not found' }, headers);
            return;
        }

        const block = await guardAppServiceDependencies('执行初始化安装');
        if (block) {
            writeJson(res, 409, block, headers);
            return;
        }

        const argsDown = [...dockerRuntime.dockerComposeCmdArgs, '-f', appDef.installComposeAbsPath, 'down'];
        const argsUp = [...dockerRuntime.dockerComposeCmdArgs, '-f', appDef.installComposeAbsPath, 'up'];
        logger.log?.(`[Info] Starting Installation (Mode: Down then Up): ${appDef.installComposePath}`);

        res.writeHead(200, {
            ...headers,
            'Content-Type': 'text/plain',
            'Transfer-Encoding': 'chunked'
        });

        let activeChild = null;
        req.on('close', () => {
            if (activeChild && !activeChild.killed) {
                logger.log?.('[Info] Request cancelled, killing active process...');
                activeChild.kill('SIGTERM');
                setTimeout(() => {
                    if (activeChild && !activeChild.killed) activeChild.kill('SIGKILL');
                }, 5000);
            }
        });

        res.write('[INFO] 正在执行清理 (Clean up)...\n');
        activeChild = spawn(dockerRuntime.dockerComposeCmd, argsDown, { cwd: appRoot });
        activeChild.stdout.on('data', d => res.write(d));
        activeChild.stderr.on('data', d => res.write(d));
        activeChild.on('close', codeDown => {
            if (codeDown !== 0) {
                res.write(`[WARN] 清理命令退出代码: ${codeDown} (通常表示无运行容器，可忽略)\n`);
            } else {
                res.write('[INFO] 清理完成。\n');
            }

            res.write('[INFO] 正在启动安装 (Start Install)...\n');
            let hasInstallError = false;
            activeChild = spawn(dockerRuntime.dockerComposeCmd, argsUp, { cwd: appRoot });
            const pipeInstallOutput = d => {
                const str = d.toString();
                if (str.includes(' ERROR') || str.includes('ERROR ')) hasInstallError = true;
                res.write(d);
            };
            activeChild.stdout.on('data', pipeInstallOutput);
            activeChild.stderr.on('data', pipeInstallOutput);
            activeChild.on('close', codeUp => {
                logger.log?.(`[Info] Installation finished with code ${codeUp}`);
                if (codeUp === 0 && !hasInstallError) {
                    res.write('\n[SUCCESS] 安装完成。\n');
                } else {
                    const reason = hasInstallError ? '检测到错误日志' : `退出代码：${codeUp}`;
                    res.write(`\n[ERROR] 安装初始化流程失败 (${reason})。\n`);
                }
                res.end();
                activeChild = null;
            });
        });
    }

    return {
        handle
    };
}

module.exports = {
    checkComposeFileContent,
    createInstallRoutes,
    validateComposeFiles
};
