const fs = require('fs');
const path = require('path');

function resolveAppRoot(env = process.env, cwd = process.cwd()) {
    return path.resolve(env.APP_ROOT || cwd);
}

function makeAppContext(root, appType, appDir, yamlPath, mode = 'package') {
    return {
        appRoot: root,
        appType,
        appId: appType === 'EDGE' ? 'iotedge' : 'iotcloud',
        appDir,
        yamlPath,
        mode
    };
}

function normalizeAppType(value) {
    const normalized = (value || '').trim().toUpperCase();
    return normalized === 'EDGE' || normalized === 'CLOUD' ? normalized : '';
}

function parseEnvFileAt(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf-8');
    const result = {};

    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const parts = trimmed.split('=');
        const key = parts[0].trim();
        let val = parts.slice(1).join('=').trim();

        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        result[key] = val;
    });

    return result;
}

function readAppTypeFromEnvFile(appDir) {
    const env = parseEnvFileAt(path.join(appDir, '.env'));
    return normalizeAppType(env.APP_TYPE || env.APPTYPE);
}

function resolveAppContext(root, env = process.env) {
    const appRoot = path.resolve(root);
    const forcedType = normalizeAppType(env.APP_TYPE);

    const rootEdgeDir = path.join(appRoot, 'services', 'iotedge');
    const rootCloudDir = path.join(appRoot, 'services', 'iotcloud');
    const nestedEdgeRoot = path.join(appRoot, 'sprixin-iotedge');
    const nestedCloudRoot = path.join(appRoot, 'sprixin-iotcloud');

    function serviceCandidate(type, appDir, yaml, candidateRoot = appRoot, mode = 'package') {
        return {
            type,
            appDir,
            yaml,
            root: candidateRoot,
            mode,
            dirExists: fs.existsSync(appDir),
            yamlExists: fs.existsSync(yaml),
            envType: readAppTypeFromEnvFile(appDir)
        };
    }

    function chooseCandidate(candidates) {
        const available = candidates.filter(candidate => candidate.dirExists || candidate.yamlExists);
        if (available.length === 0) return null;

        const forced = available.find(candidate => candidate.type === forcedType);
        if (forced) return forced;

        const envMatched = available.find(candidate => candidate.envType && candidate.envType === candidate.type);
        if (envMatched) return envMatched;

        return available.find(candidate => candidate.yamlExists) || available[0];
    }

    const directMatched = chooseCandidate([
        serviceCandidate('CLOUD', rootCloudDir, path.join(rootCloudDir, 'conf', 'thingsboard.yml')),
        serviceCandidate('EDGE', rootEdgeDir, path.join(rootEdgeDir, 'conf', 'tb-edge.yml'))
    ]);
    if (directMatched) {
        return makeAppContext(directMatched.root, directMatched.type, directMatched.appDir, directMatched.yaml, directMatched.mode);
    }

    const nestedMatched = chooseCandidate([
        serviceCandidate(
            'CLOUD',
            path.join(nestedCloudRoot, 'services', 'iotcloud'),
            path.join(nestedCloudRoot, 'services', 'iotcloud', 'conf', 'thingsboard.yml'),
            nestedCloudRoot
        ),
        serviceCandidate(
            'EDGE',
            path.join(nestedEdgeRoot, 'services', 'iotedge'),
            path.join(nestedEdgeRoot, 'services', 'iotedge', 'conf', 'tb-edge.yml'),
            nestedEdgeRoot
        )
    ]);
    if (nestedMatched) {
        return makeAppContext(nestedMatched.root, nestedMatched.type, nestedMatched.appDir, nestedMatched.yaml, nestedMatched.mode);
    }

    const legacyMatched = chooseCandidate([
        serviceCandidate('CLOUD', appRoot, path.join(appRoot, 'conf', 'thingsboard.yml'), appRoot, 'legacy'),
        serviceCandidate('EDGE', appRoot, path.join(appRoot, 'conf', 'tb-edge.yml'), appRoot, 'legacy')
    ]);
    if (legacyMatched) {
        return makeAppContext(legacyMatched.root, legacyMatched.type, legacyMatched.appDir, legacyMatched.yaml, legacyMatched.mode);
    }

    const fallbackType = forcedType === 'EDGE' ? 'EDGE' : 'CLOUD';
    const fallbackAppDir = fallbackType === 'EDGE' ? rootEdgeDir : rootCloudDir;
    const fallbackYaml = fallbackType === 'EDGE'
        ? path.join(fallbackAppDir, 'conf', 'tb-edge.yml')
        : path.join(fallbackAppDir, 'conf', 'thingsboard.yml');

    return makeAppContext(
        appRoot,
        fallbackType,
        fs.existsSync(fallbackAppDir) ? fallbackAppDir : appRoot,
        fallbackYaml,
        'unknown'
    );
}

module.exports = {
    makeAppContext,
    normalizeAppType,
    parseEnvFileAt,
    readAppTypeFromEnvFile,
    resolveAppContext,
    resolveAppRoot
};
