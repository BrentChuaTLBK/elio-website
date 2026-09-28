// Server-only, read-only Google Analytics reporting. Credentials never leave
// this module; Google receives only the two fixed aggregate report requests.
type Issue = 'report_pending' | 'metric_mismatch' | 'restricted' | 'withheld' | 'unexpected_report' | 'network' | 'access' | 'busy' | 'day_changed';
type Count = { value: number | null; issue?: Issue; timeZone?: string };
type Report = {
  status: 'ready' | 'partial' | 'unavailable';
  visitorsToday: number | null;
  activeLast30Minutes: number | null;
  timeZone: string | null;
  updatedAt: string;
  issues?: { today?: Issue; realtime?: Issue };
};
class ReportError extends Error {
  issue: Issue;
  constructor(issue: Issue) { super(issue); this.issue = issue; }
}
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encoded = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));
const failed = (issue: Issue): Count => ({ value: null, issue });
const day = (timestamp: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp);

export function parseCount(data: any, metric: 'totalUsers' | 'activeUsers'): Count {
  const daily = metric === 'totalUsers';
  if (data?.kind !== `analyticsData#${daily ? 'runReport' : 'runRealtimeReport'}`) return failed('unexpected_report');
  if (data.metricHeaders?.length !== 1 || data.metricHeaders[0]?.name !== metric || data.metricHeaders[0]?.type !== 'TYPE_INTEGER') return failed('metric_mismatch');
  if ((data.dimensionHeaders?.length || 0) !== 0) return failed('unexpected_report');
  const metadata = data.metadata || {};
  if (metadata.schemaRestrictionResponse?.activeMetricRestrictions?.some((item: any) => item.metricName === metric)) return failed('restricted');
  if (metadata.emptyReason) return failed(metadata.subjectToThresholding ? 'withheld' : 'report_pending');
  if (metadata.dataLossFromOtherRow || metadata.dataTruncationReasons?.length || metadata.samplingMetadatas?.length) return failed('unexpected_report');
  let timeZone;
  if (daily) {
    try {
      if (typeof metadata.timeZone !== 'string' || !metadata.timeZone) return failed('unexpected_report');
      day(0, metadata.timeZone);
      timeZone = metadata.timeZone;
    } catch { return failed('unexpected_report'); }
  }
  const rows = data.rows ?? [];
  // Protobuf JSON can omit empty rows and a zero rowCount. A valid response
  // kind and the exact requested metric still have to be present.
  if (!Array.isArray(rows) || rows.length > 1 || (data.rowCount ?? rows.length) !== rows.length) return failed('unexpected_report');
  let value = 0;
  if (rows.length) {
    const row = rows[0];
    if ((row.dimensionValues?.length || 0) !== 0 || row.metricValues?.length !== 1 || !/^(0|[1-9]\d*)$/.test(row.metricValues[0]?.value)) return failed('unexpected_report');
    value = Number(row.metricValues[0].value);
    if (!Number.isSafeInteger(value)) return failed('unexpected_report');
  }
  if (value === 0 && metadata.subjectToThresholding) return failed('withheld');
  return { value, ...(timeZone ? { timeZone } : {}) };
}

export function createReporter({
  getEnv = (name: string) => Deno.env.get(name) || '',
  request = (...args: Parameters<typeof fetch>) => fetch(...args),
  now = () => Date.now(),
} = {}) {
  let configuration = '';
  let token: { value: string; expires: number } | null = null;
  let cached: { report: Report; expires: number } | null = null;
  let pending: Promise<Report> | null = null;

  async function googleJson(url: string, options: RequestInit) {
    let response;
    try { response = await request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
    catch { throw new ReportError('network'); }
    if (!response.ok) {
      if ([400, 401, 403, 404].includes(response.status)) throw new ReportError('access');
      throw new ReportError(response.status === 429 ? 'busy' : 'network');
    }
    try { return await response.json(); }
    catch { throw new ReportError('unexpected_report'); }
  }

  async function accessToken(secret: string) {
    if (token && token.expires > now()) return token.value;
    let account, key;
    try {
      account = JSON.parse(secret);
      if (account.type !== 'service_account' || typeof account.client_email !== 'string' || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(account.client_email)) throw new Error();
      const pem = account.private_key;
      if (typeof pem !== 'string' || !pem.startsWith('-----BEGIN PRIVATE KEY-----')) throw new Error();
      const bytes = Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')), c => c.charCodeAt(0));
      key = await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    } catch { throw new ReportError('access'); }
    const issued = Math.floor(now() / 1000);
    const unsigned = `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: issued, exp: issued + 3600 })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
    const result = await googleJson(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(new Uint8Array(signature))}` }),
    });
    if (typeof result.access_token !== 'string' || !result.access_token || result.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(result.expires_in) || result.expires_in <= 60) throw new ReportError('access');
    token = { value: result.access_token, expires: now() + (Math.min(result.expires_in, 3600) - 60) * 1000 };
    return token.value;
  }

  async function load(property: string, secret: string): Promise<Report> {
    const started = now();
    let today: Count, realtime: Count;
    try {
      const access = await accessToken(secret);
      const query = async (method: string, body: object, metric: 'totalUsers' | 'activeUsers'): Promise<Count> => {
        try {
          return parseCount(await googleJson(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:${method}`, {
            method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          }), metric);
        } catch (error) {
          if (error instanceof ReportError && error.issue === 'access') token = null;
          return failed(error instanceof ReportError ? error.issue : 'unexpected_report');
        }
      };
      [today, realtime] = await Promise.all([
        query('runReport', { dateRanges: [{ startDate: 'today', endDate: 'today' }], metrics: [{ name: 'totalUsers' }], limit: '1' }, 'totalUsers'),
        // The documented default is the last 30 minutes for all property types.
        query('runRealtimeReport', { metrics: [{ name: 'activeUsers' }], limit: '1' }, 'activeUsers'),
      ]);
      if (today.timeZone && day(started, today.timeZone) !== day(now(), today.timeZone)) today = { ...failed('day_changed'), timeZone: today.timeZone };
    } catch (error) {
      today = realtime = failed(error instanceof ReportError ? error.issue : 'unexpected_report');
    }
    const available = Number(today.value !== null) + Number(realtime.value !== null);
    return {
      status: available === 2 ? 'ready' : available === 1 ? 'partial' : 'unavailable',
      visitorsToday: today.value, activeLast30Minutes: realtime.value, timeZone: today.timeZone || null,
      updatedAt: new Date(now()).toISOString(),
      ...(available < 2 ? { issues: { ...(today.issue ? { today: today.issue } : {}), ...(realtime.issue ? { realtime: realtime.issue } : {}) } } : {}),
    };
  }

  return async (): Promise<Report | { status: 'not_configured' }> => {
    const property = getEnv('GA_PROPERTY_ID').trim(), secret = getEnv('GA_SERVICE_ACCOUNT_JSON').trim();
    const next = `${property}\n${secret}`;
    if (configuration !== next) { configuration = next; token = null; cached = null; pending = null; }
    if (!property || !secret) return { status: 'not_configured' };
    if (!/^[1-9]\d{0,19}$/.test(property)) return { status: 'unavailable', visitorsToday: null, activeLast30Minutes: null, timeZone: null, updatedAt: new Date(now()).toISOString(), issues: { today: 'access', realtime: 'access' } };
    if (cached && cached.expires > now() && (!cached.report.timeZone || day(Date.parse(cached.report.updatedAt), cached.report.timeZone) === day(now(), cached.report.timeZone))) return cached.report;
    if (pending) return pending;
    const operation = load(property, secret).then(report => {
      if (configuration === next) cached = { report, expires: now() + 60000 };
      return report;
    });
    pending = operation;
    try { return await operation; }
    finally { if (pending === operation) pending = null; }
  };
}
