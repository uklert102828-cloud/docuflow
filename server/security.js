import crypto from 'node:crypto';

const COOKIE_NAME = 'docuflow_session';
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key),
  );
}

function signature(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(secret, sid = crypto.randomUUID(), now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sid, exp: now + SEVEN_DAYS })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}

export function readSessionToken(token, secret, now = Date.now()) {
  if (!token) return null;
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return null;
  const expected = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const target = Buffer.from(expected);
  if (supplied.length !== target.length || !crypto.timingSafeEqual(supplied, target)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.exp > now && parsed.sid ? parsed : null;
  } catch {
    return null;
  }
}

export function sessionFromRequest(req, secret) {
  return readSessionToken(parseCookies(req.headers.cookie)[COOKIE_NAME], secret);
}

export function setSessionCookie(res, token, secure) {
  const flags = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SEVEN_DAYS / 1000}`];
  if (secure) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function clearSessionCookie(res, secure) {
  const flags = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (secure) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function passwordMatches(value, expected) {
  const left = Buffer.from(String(value || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

export { COOKIE_NAME, SEVEN_DAYS };
