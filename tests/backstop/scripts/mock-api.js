const FIXED_NOW_ISO = '2026-05-20T08:00:00+08:00';

const configMeta = {
    APPTYPE: { label: '平台类型', group: '核心设置', type: 'select', options: ['CLOUD', 'EDGE'], required: true },
    SPRING_DATASOURCE_URL: { label: 'PostgreSQL JDBC 地址', group: 'SQL 数据库', type: 'text', required: true },
    SPRING_DATASOURCE_USERNAME: { label: '数据库用户', group: 'SQL 数据库', type: 'text', required: true },
    SPRING_DATASOURCE_PASSWORD: { label: '数据库密码', group: 'SQL 数据库', type: 'password', required: true, sensitive: true },
    DATABASE_TS_TYPE: { label: '时序存储类型', group: '核心存储', type: 'select', options: ['sql', 'cassandra'], required: true },
    CASSANDRA_URL: { label: 'Cassandra 地址', group: 'Cassandra', type: 'text', required: true },
    REDIS_HOST: { label: 'Redis 地址', group: '缓存配置', type: 'text', required: true },
    REDIS_PORT: { label: 'Redis 端口', group: '缓存配置', type: 'number', min: 1, max: 65535, required: true },
    TB_QUEUE_TYPE: { label: '队列类型', group: '消息队列', type: 'select', options: ['kafka', 'in-memory'], required: true },
    TB_KAFKA_SERVERS: { label: 'Kafka Brokers', group: '消息队列', type: 'text', required: true },
    MQTT_BIND_PORT: { label: 'MQTT 监听端口', group: 'MQTT 传输', type: 'number', min: 1, max: 65535, required: true }
};

const configValues = {
    APPTYPE: 'CLOUD',
    SPRING_DATASOURCE_URL: 'jdbc:postgresql://postgres:5432/thingsboard',
    SPRING_DATASOURCE_USERNAME: 'thingsboard',
    SPRING_DATASOURCE_PASSWORD: 'thingsboard',
    DATABASE_TS_TYPE: 'cassandra',
    CASSANDRA_URL: 'cassandra:9042',
    REDIS_HOST: 'redis',
    REDIS_PORT: '6379',
    TB_QUEUE_TYPE: 'kafka',
    TB_KAFKA_SERVERS: 'kafka:9092',
    MQTT_BIND_PORT: '1883'
};

const services = [
    { id: 'postgres', label: 'PostgreSQL', tier: 'storage', status: 'running', running: true, image: 'postgres:15', portsSummary: '5432', cpuPercent: 3.2, memory: '256 MB' },
    { id: 'cassandra', label: 'Cassandra', tier: 'storage', status: 'running', running: true, image: 'cassandra:4.1', portsSummary: '9042', cpuPercent: 5.1, memory: '1.2 GB' },
    { id: 'redis', label: 'Redis', tier: 'cache', status: 'stopped', running: false, image: 'redis:7', portsSummary: '6379', message: '等待运维确认后启动' },
    { id: 'kafka', label: 'Kafka', tier: 'queue', status: 'running', running: true, image: 'bitnami/kafka:3.7', portsSummary: '9092', cpuPercent: 2.4, memory: '512 MB' },
    { id: 'iotcloud', label: 'IoT Cloud', tier: 'business', status: 'running', running: true, image: 'sprixin/iotcloud:4.1', portsSummary: '8080, 1883', cpuPercent: 8.5, memory: '768 MB' },
    { id: 'netdata', label: 'Netdata', tier: 'monitor', status: 'missing-image', running: false, image: 'netdata/netdata:stable', message: '本地缺少镜像' }
];

const plan = {
    appService: 'iotcloud',
    services: [
        { id: 'postgres', label: 'PostgreSQL', order: 10 },
        { id: 'cassandra', label: 'Cassandra', order: 20 },
        { id: 'redis', label: 'Redis', order: 30 },
        { id: 'kafka', label: 'Kafka', order: 40 },
        { id: 'iotcloud', label: 'IoT Cloud', order: 50 }
    ],
    statuses: services
        .filter(service => ['postgres', 'cassandra', 'redis', 'kafka', 'iotcloud'].includes(service.id))
        .map(service => ({ id: service.id, label: service.label, status: service.status, running: service.running })),
    missingServices: ['redis'],
    warnings: ['Redis 当前未启动，保存并应用前请确认缓存服务状态。']
};

const deployment = {
    status: 'success',
    appRoot: '/opt/sprixin',
    appDir: '/opt/sprixin/services/iotcloud',
    appType: 'CLOUD',
    appService: 'iotcloud',
    envPath: '/opt/sprixin/services/iotcloud/.env',
    yamlPath: '/opt/sprixin/services/iotcloud/conf/thingsboard.yml',
    authRequired: true,
    docker: { cli: '/usr/bin/docker', compose: 'docker compose', socketMounted: true, available: true, message: '' },
    diagnostics: {
        status: 'warning',
        checks: [
            { id: 'app-root', label: '部署目录', target: '/opt/sprixin', state: 'ok', detail: '部署目录可访问' },
            { id: 'docker', label: 'Docker', target: '/var/run/docker.sock', state: 'ok', detail: 'Docker socket 可用' },
            { id: 'images', label: '镜像', target: 'netdata', state: 'warning', detail: '监控镜像未导入' }
        ]
    }
};

const history = [
    { filename: '.env.20260520-074600.bak', timestamp: '2026-05-20T07:46:00+08:00', size: 2148 },
    { filename: '.env.20260519-230500.bak', timestamp: '2026-05-19T23:05:00+08:00', size: 2084 }
];

function json(data, status = 200) {
    return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    };
}

function text(body, status = 200) {
    return {
        status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body
    };
}

function responseFor(pathname, method, authenticated) {
    if (pathname === '/api/auth/status') return json({ required: true, authenticated, operator: authenticated ? 'admin' : '' });
    if (pathname === '/api/login' && method === 'POST') return json({ status: 'success', operator: 'admin' });
    if (pathname === '/api/version') return json({ version: '1.4.17' });
    if (!authenticated) return json({ status: 'unauthorized', message: '请先登录 Config Mate' }, 401);
    if (pathname === '/api/config') return json({ status: 'success', meta: configMeta, values: configValues });
    if (pathname === '/api/deployment') return json(deployment);
    if (pathname === '/api/plan') return json({ status: 'success', plan });
    if (pathname === '/api/services') return json({ status: 'success', services });
    if (pathname === '/api/disk-usage') return json({ status: 'success', usage: { available: true, percent: 62, usedBytes: 33285996544, totalBytes: 53687091200 } });
    if (pathname === '/api/diff-runtime') {
        return json({
            status: 'success',
            service: 'iotcloud',
            diffs: [
                { key: 'SPRING_DATASOURCE_URL', state: 'MODIFIED', runtimeVal: 'jdbc:postgresql://old-postgres:5432/thingsboard', localVal: configValues.SPRING_DATASOURCE_URL },
                { key: 'REDIS_HOST', state: 'UNCHANGED', runtimeVal: 'redis', localVal: 'redis' },
                { key: 'TB_KAFKA_SERVERS', state: 'NEW', runtimeVal: '', localVal: 'kafka:9092' }
            ]
        });
    }
    if (pathname === '/api/history') return json({ status: 'success', data: history });
    if (pathname === '/api/check-install') return json({ status: 'success', exists: true, message: '安装文件可用' });
    if (pathname === '/api/status') return json({ status: 'running', service: 'iotcloud', dockerComposeMissing: false, missingFiles: [], message: 'running' });
    if (pathname === '/api/validate-compose') return json({ status: 'success', errors: [] });
    if (pathname === '/api/env-raw') return text(Object.entries(configValues).map(([key, value]) => `${key}=${value}`).join('\n'));
    const serviceConfigMatch = pathname.match(/^\/api\/services\/([^/]+)\/config$/);
    if (serviceConfigMatch) {
        const serviceId = decodeURIComponent(serviceConfigMatch[1]);
        return json({
            status: 'success',
            serviceId,
            sections: [
                { title: '端口', items: [{ key: 'ports', value: serviceId === 'iotcloud' ? '8080:8080, 1883:1883' : '内部访问' }] },
                { title: '镜像', items: [{ key: 'image', value: (services.find(service => service.id === serviceId) || {}).image || 'unknown' }] }
            ]
        });
    }
    return json({ status: 'success' });
}

module.exports = async (page, scenario) => {
    const authenticated = scenario.authenticated !== false;

    await page.evaluateOnNewDocument((fixedNow) => {
        const RealDate = Date;
        class MockDate extends RealDate {
            constructor(...args) {
                if (args.length === 0) super(fixedNow);
                else super(...args);
            }
            static now() {
                return new RealDate(fixedNow).getTime();
            }
        }
        MockDate.UTC = RealDate.UTC;
        MockDate.parse = RealDate.parse;
        window.Date = MockDate;
    }, FIXED_NOW_ISO);

    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const requestUrl = new URL(request.url());
        if (!requestUrl.pathname.startsWith('/api/')) {
            request.continue();
            return;
        }
        request.respond(responseFor(requestUrl.pathname, request.method(), authenticated));
    });
};
