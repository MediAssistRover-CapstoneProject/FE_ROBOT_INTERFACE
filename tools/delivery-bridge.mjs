import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// This process can authenticate and READ upstream state. It has no execution,
// verification, step response, unlock or arbitrary proxy route.
export class BridgeError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const activeStatuses = ['RUNNING', 'RECOVERY_REQUIRED', 'ACCEPTED', 'QUEUED'];
const terminalStatuses = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const expiry = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : Date.now() + 240_000;
const text = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : null;

export function readConfig(env = process.env) {
  const base = new URL(env.MAR_BACKEND_URL || 'https://mediassistrover.duckdns.org');
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) {
    throw new BridgeError('CONFIG', 'MAR_BACKEND_URL phải là địa chỉ gốc HTTP(S).', 503);
  }
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw new BridgeError('CONFIG', 'Kết nối BE từ xa phải dùng HTTPS.', 503);
  }
  const config = {
    base: base.origin, host: env.MAR_DELIVERY_HOST || '127.0.0.1', port: Number(env.MAR_DELIVERY_PORT || 8790),
    pairingKey: env.MAR_DELIVERY_PAIRING_KEY || '', robotId: env.MAR_ROBOT_ID || '',
    robotCode: env.MAR_ROBOT_CODE || '', deviceSecret: env.MAR_DEVICE_SECRET || '',
    username: env.MAR_VIEWER_USERNAME || '', password: env.MAR_VIEWER_PASSWORD || '', viewerToken: env.MAR_VIEWER_ACCESS_TOKEN || '',
    origins: (env.MAR_DELIVERY_ALLOWED_ORIGINS || 'http://localhost:8081,http://localhost:8082,http://127.0.0.1:8081,http://127.0.0.1:8082').split(',').map(x => x.trim()).filter(Boolean),
    tlsCert: env.MAR_DELIVERY_TLS_CERT || '', tlsKey: env.MAR_DELIVERY_TLS_KEY || '',
    allowLanHttp: env.MAR_DELIVERY_ALLOW_LAN_HTTP === 'true',
  };
  if (config.pairingKey.length < 32 || !uuid.test(config.robotId) || !config.robotCode || !config.deviceSecret ||
      (!config.viewerToken && (!config.username || !config.password))) {
    throw new BridgeError('CONFIG', 'Cần cấu hình robot UUID, thông tin thiết bị, tài khoản đọc BE và pairing key ít nhất 32 ký tự trong .env.delivery-bridge.', 503);
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new BridgeError('CONFIG', 'Cổng bridge không hợp lệ.', 503);
  if (Boolean(config.tlsCert) !== Boolean(config.tlsKey)) throw new BridgeError('CONFIG', 'Cần cả TLS_CERT và TLS_KEY.', 503);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  if (!local && !config.tlsCert && !config.allowLanHttp) {
    throw new BridgeError('CONFIG', 'Tablet qua mạng cần TLS. Chỉ bật MAR_DELIVERY_ALLOW_LAN_HTTP=true khi thử trên LAN tin cậy.', 503);
  }
  return config;
}

export function createDeliveryReader(config, fetcher = fetch, now = Date.now) {
  let viewer = null, device = null, authFlight = null, snapshotFlight = null, cached = null, cachedKey = null;
  let lastJob = null, terminalSince = null, deadline = Infinity;
  const labels = new Map();
  async function upstream(path, token, body) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new BridgeError('UPSTREAM_TIMEOUT', 'Đọc trạng thái quá thời gian. Chờ kết nối lại.');
    const res = await fetcher(config.base + '/api/v1' + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, remaining))),
    });
    if (res.status === 401) { viewer = null; device = null; }
    if (!res.ok) throw new BridgeError('UPSTREAM_' + res.status, `BE trả HTTP ${res.status}. Kiểm tra quyền tài khoản đọc, thiết bị và nhiệm vụ.`, res.status === 401 ? 503 : 502);
    if (res.status === 204) return null;
    const data = await res.json();
    return data?.data ?? data;
  }
  async function authenticate() {
    if (viewer?.until > now() + 30_000 && device?.until > now() + 30_000) return;
    if (authFlight) return authFlight;
    authFlight = (async () => {
      if (!viewer || viewer.until <= now() + 30_000) {
        const login = config.viewerToken ? { accessToken: config.viewerToken } :
          await upstream('/auth/login', null, { username: config.username, password: config.password, deviceInfo: 'MAR read-only delivery display bridge' });
        if (!login.accessToken || login.mustChangePassword) throw new BridgeError('VIEWER_AUTH', 'Tài khoản đọc cần đăng nhập/đổi mật khẩu trên ứng dụng chính.', 503);
        const me = await upstream('/auth/me', login.accessToken);
        if (me?.status !== 'ACTIVE' || !['STAFF', 'ADMIN'].includes(me.role) || me.mustChangePassword) {
          throw new BridgeError('VIEWER_SCOPE', 'Tài khoản đọc cần ACTIVE và có quyền Staff/Admin hợp lệ.', 503);
        }
        viewer = { token: login.accessToken, until: expiry(login.accessTokenExpiresAt) };
      }
      if (!device || device.until <= now() + 30_000) {
        const login = await upstream('/pi/auth/token', null, { robotCode: config.robotCode, deviceSecret: config.deviceSecret });
        if (!login.accessToken || login.robotId?.toLowerCase() !== config.robotId.toLowerCase()) throw new BridgeError('DEVICE_SCOPE', 'Danh tính thiết bị không khớp robot đã cấu hình.', 503);
        device = { token: login.accessToken, until: expiry(login.expiresAt) };
      }
    })();
    try { await authFlight; } finally { authFlight = null; }
  }
  async function readJob(id) {
    const detail = await upstream('/jobs/' + encodeURIComponent(id), viewer.token);
    if (!detail?.job || !Array.isArray(detail.steps) || detail.job.jobId !== id || detail.job.robotId?.toLowerCase() !== config.robotId.toLowerCase()) {
      throw new BridgeError('JOB_SCOPE', 'Nhiệm vụ không thuộc robot này hoặc response job không hợp lệ.', 403);
    }
    return detail;
  }
  async function readDelivery(job) {
    if (!uuid.test(job.serviceRequestId || '')) return null;
    try {
      const delivery = await upstream('/delivery-requests/' + job.serviceRequestId, viewer.token);
      if (delivery?.request?.serviceRequestId !== job.serviceRequestId || delivery.request.requestType !== 'DELIVERY') return null;
      return delivery;
    } catch (e) {
      // A non-delivery job can have a service request but no delivery record.
      if (e.code === 'UPSTREAM_404') return null;
      throw e;
    }
  }
  async function discover() {
    const found = [];
    const lists = await Promise.all(activeStatuses.map(async status => {
      const jobs = [];
      let page = 0, pages = 1;
      do {
        const list = await upstream('/jobs?' + new URLSearchParams({ robotId: config.robotId, status, page: String(page), size: '100' }), viewer.token);
        if (!Array.isArray(list?.content)) throw new BridgeError('JOB_LIST', 'BE chưa trả danh sách job đúng hợp đồng.');
        pages = Number(list.totalPages ?? 1);
        if (!Number.isInteger(pages) || pages < 0 || pages > 20) throw new BridgeError('JOB_LIST_LIMIT', 'Danh sách nhiệm vụ vượt giới hạn hiển thị. Chọn mã nhiệm vụ cụ thể.');
        for (const job of list.content) {
          if (job.robotId?.toLowerCase() !== config.robotId.toLowerCase() || job.status !== status || !uuid.test(job.jobId || '')) continue;
          jobs.push(job);
        }
        page++;
      } while (page < pages);
      return jobs;
    }));
    const jobs = lists.flat();
    // Bound parallelism while avoiding one RTT per queued item.
    for (let index = 0; index < jobs.length; index += 4) {
      const batch = await Promise.all(jobs.slice(index, index + 4).map(async job => ({ job, delivery: await readDelivery(job) })));
      found.push(...batch.filter(item => item.delivery));
    }
    const executing = found.filter(x => ['RUNNING', 'RECOVERY_REQUIRED', 'ACCEPTED'].includes(x.job.status));
    if (executing.length > 1) throw new BridgeError('AMBIGUOUS_JOB', 'Có nhiều delivery đang thực thi trên robot. Cần kiểm tra điều phối trước khi hiển thị QR.', 409);
    if (executing.length) return executing[0];
    if (lastJob && (terminalSince === null || now() - terminalSince < 300_000)) {
      const detail = await readJob(lastJob);
      const delivery = await readDelivery(detail.job);
      if (delivery) return { job: detail.job, delivery, detail };
    }
    // FIFO presentation of queued jobs; a queue item never grants a QR action.
    return found.filter(x => x.job.status === 'QUEUED').sort((a,b) => String(a.job.queuedAt).localeCompare(String(b.job.queuedAt)) || a.job.jobId.localeCompare(b.job.jobId))[0] ?? null;
  }
  async function labelEndpoint(id) {
    if (!uuid.test(id || '')) return null;
    const cachedLabel = labels.get(id);
    if (cachedLabel?.until > now()) return cachedLabel.value;
    try { const data = await upstream('/endpoints/' + id, viewer.token); const value = text(data.endpointName ?? data.name ?? data.endpointCode); labels.set(id, { value, until: now() + 60_000 }); return value; }
    catch (e) { if (['UPSTREAM_403', 'UPSTREAM_404'].includes(e.code)) return null; throw e; }
  }
  function cleanStep(step) {
    if (!step) return null;
    const raw = step.resolvedInputsJson ?? {}, result = step.resultJson ?? {};
    const input = {};
    for (const key of ['method','purpose','action','prompt_key','endpoint_id','destination_endpoint_id','target_endpoint_id','compartment_id']) {
      if (typeof raw[key] === 'string') input[key] = raw[key];
    }
    if (!input.purpose && step.stepTypeSnapshot === 'AUTHENTICATE') {
      const purpose = step.stepCodeSnapshot?.endsWith('_SENDER') ? 'DELIVERY_SENDER' : step.stepCodeSnapshot?.endsWith('_RECEIVER') ? 'DELIVERY_RECEIVER' : null;
      if (purpose) input.purpose = purpose;
    }
    // Keep only presentation evidence, never auth grants or execution tokens.
    const outcome = {};
    for (const key of ['reached','verified','controller_ack','published','physicalStopConfirmed']) if (typeof result[key] === 'boolean') outcome[key] = result[key];
    return { jobStepId: step.jobStepId, stepTypeSnapshot: step.stepTypeSnapshot, stepCodeSnapshot: step.stepCodeSnapshot,
      status: step.status, resolvedInputsJson: input, resultJson: outcome, interruptionRequestedAt: step.interruptionRequestedAt ?? null };
  }
  async function readSnapshot(jobId) {
    await authenticate();
    let selected;
    if (jobId) { const detail = await readJob(jobId); selected = { detail, job: detail.job, delivery: await readDelivery(detail.job) }; }
    else selected = await discover();
    const empty = { robotId: config.robotId, mission: null, challenge: null, updatedAt: new Date(now()).toISOString(), visibility: 'ACCOUNT_SCOPE' };
    if (!selected) return empty;
    if (!selected.delivery) throw new BridgeError('NOT_DELIVERY', 'Mã nhiệm vụ này không phải giao hàng trong phạm vi tài khoản.', 404);
    const detail = selected.detail ?? await readJob(selected.job.jobId);
    const job = detail.job, delivery = selected.delivery;
    let step = detail.steps.find(s => s.jobStepId === job.selectedJobStepId) ?? null, challenge = null;
    if (job.status === 'RUNNING' && !job.cancelRequestedAt && step?.status === 'RUNNING' && !step.interruptionRequestedAt &&
        step.stepTypeSnapshot === 'AUTHENTICATE' && step.resolvedInputsJson?.method === 'QR_CODE') {
      const qr = await upstream('/pi/jobs/' + job.jobId + '/qr-challenge', device.token);
      if (qr) {
        const purpose = step.resolvedInputsJson?.purpose ?? (step.stepCodeSnapshot?.endsWith('_SENDER') ? 'DELIVERY_SENDER' : step.stepCodeSnapshot?.endsWith('_RECEIVER') ? 'DELIVERY_RECEIVER' : null);
        if (qr.jobId !== job.jobId || qr.authJobStepId !== step.jobStepId || !['DELIVERY_SENDER','DELIVERY_RECEIVER'].includes(qr.purpose) ||
            !purpose || qr.purpose !== purpose || !uuid.test(qr.challengeId || '') || typeof qr.qrPayload !== 'string' || qr.qrPayload.length > 4096) {
          throw new BridgeError('QR_SCOPE', 'QR không khớp nhiệm vụ, bước hoặc giai đoạn hiện tại.', 409);
        }
        if (Date.parse(qr.expiresAt) > now()) {
          const fresh = await readJob(job.jobId);
          const freshStep = fresh.steps.find(s => s.jobStepId === fresh.job.selectedJobStepId);
          if (fresh.job.status === 'RUNNING' && !fresh.job.cancelRequestedAt && freshStep?.jobStepId === step.jobStepId && freshStep.status === 'RUNNING' && !freshStep.interruptionRequestedAt) {
            challenge = { challengeId: qr.challengeId, jobId: qr.jobId, authJobStepId: qr.authJobStepId, purpose: qr.purpose, qrPayload: qr.qrPayload, expiresAt: qr.expiresAt };
          }
        }
      }
    }
    const [pickup, dropoff] = await Promise.all([labelEndpoint(delivery.pickupEndpointId), labelEndpoint(delivery.deliveryEndpointId ?? delivery.resolvedDeliveryEndpointId)]);
    if (lastJob !== job.jobId) terminalSince = null;
    lastJob = job.jobId;
    if (terminalStatuses.has(job.status)) terminalSince ??= now(); else terminalSince = null;
    return { ...empty, challenge, mission: {
      requestId: job.serviceRequestId, requestCode: text(delivery.request.requestCode), requestStatus: delivery.request.status,
      jobId: job.jobId, jobStatus: job.status, cancelRequestedAt: job.cancelRequestedAt ?? null, step: cleanStep(step),
      sender: { name: delivery.expectedSenderAccountId ? 'Nhân viên gửi đã được phân công' : 'Chưa có người gửi', location: pickup },
      receiver: { name: text(delivery.recipientName) || (delivery.expectedReceiverAccountId ? 'Nhân viên nhận đã được phân công' : 'Chưa có người nhận'), location: dropoff },
      items: Array.isArray(delivery.items) ? delivery.items.map(item => ({ itemName: item.sensitive ? 'Hàng cần bảo mật' : text(item.itemName), quantity: item.quantity, unit: text(item.unit, 40) })) : [],
      pickedUpAt: delivery.pickedUpAt ?? null, deliveredAt: delivery.deliveredAt ?? null,
    } };
  }
  return {
    async snapshot(jobId) {
      if (jobId && !uuid.test(jobId)) throw new BridgeError('JOB_ID', 'Job ID phải là UUID.', 400);
      jobId = jobId?.toLowerCase();
      const key = jobId || 'auto';
      if (cachedKey === key && cached && now() - cached.time < 1000) {
        if (cached.value.challenge && Date.parse(cached.value.challenge.expiresAt) <= now()) return { ...cached.value, challenge: null };
        return cached.value;
      }
      if (snapshotFlight) { await snapshotFlight; return this.snapshot(jobId); }
      deadline = now() + 20_000;
      snapshotFlight = readSnapshot(jobId);
      try { const value = await snapshotFlight; cachedKey = key; cached = { value, time: now() }; return value; }
      catch (e) { cached = null; throw e; } finally { snapshotFlight = null; }
    }
  };
}

function sameKey(actual, expected) {
  const a = Buffer.from(typeof actual === 'string' ? actual : ''), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function createHandler(config, reader) {
  return async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin)) return send(403, { code: 'ORIGIN', message: 'Origin không được phép.' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET'); res.setHeader('Access-Control-Allow-Headers', 'X-MAR-Display-Key'); res.writeHead(204); return res.end(); }
    if (req.method !== 'GET') return send(405, { code: 'READ_ONLY', message: 'Bridge chỉ cho phép đọc dữ liệu.' });
    let url;
    try { url = new URL(req.url || '/', 'http://localhost'); }
    catch { return send(400, { code: 'URL', message: 'Đường dẫn không hợp lệ.' }); }
    if (url.pathname === '/health') return send(200, { service: 'mar-delivery-display', version: 1 });
    if (url.pathname !== '/delivery/snapshot') return send(404, { code: 'NOT_FOUND', message: 'Đường dẫn không tồn tại.' });
    if (!sameKey(req.headers['x-mar-display-key'], config.pairingKey)) return send(401, { code: 'PAIRING', message: 'Mã ghép cặp không đúng.' });
    if ([...url.searchParams.keys()].some(k => k !== 'jobId') || url.searchParams.getAll('jobId').length > 1) return send(400, { code: 'QUERY', message: 'Tham số không hợp lệ.' });
    try { send(200, await reader.snapshot(url.searchParams.get('jobId') || undefined)); }
    catch (e) { send(e instanceof BridgeError ? e.status : 502, { code: e instanceof BridgeError ? e.code : 'UPSTREAM_UNAVAILABLE', message: e instanceof BridgeError ? e.message : 'Chưa đọc được dữ liệu BE. Kiểm tra mạng và cấu hình bridge.' }); }
  };
}

export function loadPrivateEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(MAR_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    loadPrivateEnv(resolve(process.cwd(), '.env.delivery-bridge'));
    const config = readConfig();
    const handler = createHandler(config, createDeliveryReader(config));
    const server = config.tlsCert ? https.createServer({ cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) }, handler) : http.createServer(handler);
    server.requestTimeout = 30_000; server.headersTimeout = 15_000;
    server.listen(config.port, config.host, () => console.log(`Delivery read-only bridge listening on ${config.tlsCert ? 'https' : 'http'}://${config.host}:${config.port}`));
    server.on('error', () => { console.error('Không khởi động được bridge. Kiểm tra địa chỉ/cổng/TLS.'); process.exitCode = 1; });
  } catch (e) { console.error(e instanceof BridgeError ? e.message : 'Không đọc được cấu hình bridge.'); process.exitCode = 1; }
}
