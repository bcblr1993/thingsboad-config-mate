const path = require('path');

/**
 * 全量容器快照。
 *
 * 原先每探测一个服务都要跑一次 `docker compose ps -q <service>`：compose CLI
 * 每次都要启动、解析编排文件、解析 env。容器内实测 8 个服务并发跑要 831ms，
 * 再加上逐个 `docker inspect` 174ms，整个 /api/services 就卡在这里。
 *
 * 改为一次 `docker ps -aq` + 一次 `docker inspect <全部 id>`：实测 66 + 43 = 109ms，
 * 拿到的信息比 compose ps 更全（标签、状态、启动时间、环境变量都在里面）。
 * 动态服务发现（postgres-ha / highgo-ha / redis-cluster 按容器名找）也能复用
 * 同一份快照，省掉另外 113ms。
 *
 * 与 compose ps 的语义差别：compose 按「项目 + 服务名」记账，这里按容器上的
 * compose 标签反查。docker compose v2 一定会写这三个标签，所以结果等价；差别
 * 只在于手工创建的同名容器——它没有标签，这里不会认领，而 compose ps 的旧路径
 * 会把它当成本服务。不认领才是对的，那本来就不是这个部署的容器。
 */

const DEFAULT_TTL_MS = 1000;

const LABEL_SERVICE = 'com.docker.compose.service';
const LABEL_WORKING_DIR = 'com.docker.compose.project.working_dir';
const LABEL_CONFIG_FILES = 'com.docker.compose.project.config_files';

function splitComposeConfigFiles(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

/**
 * 判断一个容器是否就是该服务定义对应的容器。
 *
 * 与 runtime.js 里的 composeContainerMatchesDefinition 不同：那个是「已经由
 * compose ps 选出候选，再校验是否兼容」，因此标签缺失时是放行的。这里是反过来
 * 从全部容器里挑，标签缺失就必须拒绝，否则任何无标签容器都会匹配上每个服务。
 */
function containerBelongsToDefinition(container, def, preparedDefinition = null) {
    if (!container || !def) return false;
    const labels = container.Config?.Labels || {};

    const service = labels[LABEL_SERVICE];
    if (!service || !def.composeService || service !== def.composeService) return false;

    const expectedDir = def.composeAbsPath ? path.resolve(path.dirname(def.composeAbsPath)) : '';
    const workingDir = labels[LABEL_WORKING_DIR];
    if (workingDir && expectedDir && path.resolve(workingDir) !== expectedDir) return false;

    const configFiles = splitComposeConfigFiles(labels[LABEL_CONFIG_FILES]);
    if (configFiles.length > 0) {
        const expected = [
            def.composeAbsPath,
            preparedDefinition?.composeAbsPath,
            preparedDefinition?.originalComposeAbsPath
        ].filter(Boolean).map(file => path.resolve(file));
        if (expected.length > 0 && !configFiles.some(file => expected.includes(path.resolve(file)))) {
            return false;
        }
    }

    /* 既没有 working_dir 也没有 config_files 时，只凭服务名认领是不够的——
       同名服务可能来自另一个部署目录。要求至少有一项目录信息对得上。 */
    if (!workingDir && configFiles.length === 0) return false;

    return true;
}

function normalizeName(name) {
    return String(name || '').replace(/^\//, '');
}

function createContainerIndex({
    docker,
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = 15000,
    logger = console,
    now = () => Date.now()
}) {
    let cache = null;
    let fetchedAt = 0;
    let inflight = null;

    function buildIndex(containers, images = null) {
        const byName = new Map();
        containers.forEach(container => {
            const name = normalizeName(container?.Name);
            if (name) byName.set(name, container);
        });
        return {
            containers,
            byName,
            images,
            /** 镜像是否已存在。拿不到镜像清单时返回 null，调用方退回单独查。 */
            hasImage(image) {
                if (!images || !image) return null;
                return images.has(String(image)) || images.has(`${image}:latest`);
            },
            /** 按容器名取，用于 HA / redis-cluster 这类按名字发现的服务。 */
            findByName(name) {
                return byName.get(normalizeName(name)) || null;
            },
            /** 按 compose 标签取，用于常规 compose 服务。 */
            findForDefinition(def, preparedDefinition) {
                return containers.find(c => containerBelongsToDefinition(c, def, preparedDefinition)) || null;
            }
        };
    }

    /* 本机已有镜像的集合。原先每个「未运行且配了 image」的服务都要单独跑一次
       `docker image inspect` 判断是不是镜像缺失——现场多数服务是停止状态，
       于是这一项也成了几百毫秒。一次 `docker images` 全拿回来即可。 */
    async function collectImages() {
        const result = await docker.exec(
            docker.dockerPath,
            ['images', '--format', '{{.Repository}}:{{.Tag}}'],
            { timeout: timeoutMs }
        );
        if (result.error) return null;
        const names = new Set();
        String(result.stdout || '').split(/\r?\n/).forEach(line => {
            const name = line.trim();
            if (!name || name.startsWith('<none>')) return;
            names.add(name);
            // 不带 tag 的引用按 :latest 处理，与 docker 的默认行为一致。
            if (name.endsWith(':latest')) names.add(name.slice(0, -':latest'.length));
        });
        return names;
    }

    async function collect() {
        const ps = await docker.exec(docker.dockerPath, ['ps', '-aq'], { timeout: timeoutMs });
        // 拿不到就返回 null，调用方退回原来的逐服务探测，不要因此报错。
        if (ps.error) return null;

        const ids = String(ps.stdout || '').trim().split(/\r?\n/).filter(Boolean);
        if (ids.length === 0) return buildIndex([], await collectImages());

        const [inspected, images] = await Promise.all([
            docker.exec(docker.dockerPath, ['inspect', ...ids], { timeout: timeoutMs }),
            collectImages()
        ]);
        if (inspected.error) return null;

        try {
            const parsed = JSON.parse(inspected.stdout || '[]');
            return buildIndex(Array.isArray(parsed) ? parsed : [], images);
        } catch (error) {
            logger.error?.(`[ContainerIndex] 解析 inspect 输出失败：${error.message}`);
            return null;
        }
    }

    /** 取当前快照。TTL 内复用，并发调用合并为一次。 */
    function get() {
        if (cache && now() - fetchedAt < ttlMs) return Promise.resolve(cache);
        if (inflight) return inflight;

        inflight = Promise.resolve()
            .then(collect)
            .then(index => {
                if (index) {
                    cache = index;
                    fetchedAt = now();
                }
                return index;
            })
            .catch(error => {
                logger.error?.(`[ContainerIndex] 采集失败：${error.message}`);
                return null;
            })
            .finally(() => { inflight = null; });

        return inflight;
    }

    function invalidate() {
        cache = null;
        fetchedAt = 0;
    }

    return { get, invalidate, containerBelongsToDefinition };
}

module.exports = {
    DEFAULT_TTL_MS,
    containerBelongsToDefinition,
    createContainerIndex
};
