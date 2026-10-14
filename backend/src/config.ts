import path from 'node:path';

const env = process.env;

const dataDir = path.resolve(env.DATA_DIR ?? './data');

export const config = {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
    dataDir,
    dbPath: path.join(dataDir, 'brpan.db'),
    domain: env.DOMAIN ?? '',
    adminUsername: env.ADMIN_USERNAME ?? 'admin',
    adminPassword: env.ADMIN_PASSWORD ?? '',
    xrayBin: env.XRAY_BIN ?? 'xray',
    xrayAssetDir: env.XRAY_LOCATION_ASSET ?? '',
    xrayApiPort: Number(env.XRAY_API_PORT ?? 61000),
    caddyAdmin: env.CADDY_ADMIN ?? 'http://127.0.0.1:2019',
    caddyEnabled: (env.CADDY_ENABLED ?? 'true') === 'true',
    caddyHttpsPort: Number(env.CADDY_HTTPS_PORT ?? 8443),
    caddyCertDir: env.CADDY_CERT_DIR ?? '/caddy-data/caddy/certificates',
    caddyfilePath: env.CADDYFILE_PATH ?? '',
    awgBin: env.AWG_BIN ?? 'amneziawg-go',
    awgToolBin: env.AWG_TOOL_BIN ?? 'awg',
    wgToolBin: env.WG_TOOL_BIN ?? 'wg',
    openvpnBin: env.OPENVPN_BIN ?? 'openvpn',
    opensslBin: env.OPENSSL_BIN ?? 'openssl',
    staticDir: env.STATIC_DIR ?? path.resolve('../frontend/dist'),
    statsIntervalSec: Number(env.STATS_INTERVAL ?? 15),
    disableCores: env.DISABLE_CORES === 'true',
};
