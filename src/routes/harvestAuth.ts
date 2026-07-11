/**
 * Keycloak OIDC gate for Harvest Admin (harvest.noirstack.com).
 * Cookie session + PKCE authorization code flow against auth.noirstack.com.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export type HarvestAuthUser = {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
};

type OidcState = { state: string; verifier: string; returnTo: string };

function loadHarvestAuthEnv() {
  const overlay = path.join(process.cwd(), '.env.harvest.local');
  if (fs.existsSync(overlay)) {
    dotenv.config({ path: overlay, override: false });
  }
}

loadHarvestAuthEnv();

function cfg() {
  const base = (process.env.KEYCLOAK_BASE_URL || 'https://auth.noirstack.com').replace(/\/$/, '');
  const realm = process.env.KEYCLOAK_REALM || 'gateway';
  const issuer = `${base}/realms/${realm}`;
  return {
    required: process.env.HARVEST_AUTH_REQUIRED !== '0',
    base,
    realm,
    issuer,
    clientId: process.env.KEYCLOAK_CLIENT_ID || 'harvest-noirstack',
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || '',
    redirectUri:
      process.env.KEYCLOAK_REDIRECT_URI ||
      'https://harvest.noirstack.com/api/harvest/auth/callback',
    homeUrl: process.env.KEYCLOAK_HOME_URL || 'https://harvest.noirstack.com',
    authUrl: `${issuer}/protocol/openid-connect/auth`,
    tokenUrl: `${issuer}/protocol/openid-connect/token`,
    userInfoUrl: `${issuer}/protocol/openid-connect/userinfo`,
    logoutUrl: `${issuer}/protocol/openid-connect/logout`,
    scope: process.env.KEYCLOAK_SCOPE || 'openid profile email',
    cookieSecure: process.env.NODE_ENV === 'production' || process.env.HARVEST_COOKIE_SECURE === '1',
  };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(
  res: Response,
  name: string,
  value: string,
  opts: { maxAgeMs?: number; httpOnly?: boolean; path?: string },
) {
  const c = cfg();
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path || '/'}`,
    'SameSite=Lax',
  ];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (c.cookieSecure) parts.push('Secure');
  if (opts.maxAgeMs != null) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeMs / 1000))}`);
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res: Response, name: string, pathName = '/') {
  const c = cfg();
  const parts = [`${name}=`, `Path=${pathName}`, 'Max-Age=0', 'SameSite=Lax'];
  if (c.cookieSecure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function isHarvestHost(req: Request): boolean {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (host.startsWith('harvest.noirstack.com')) return true;
  if (process.env.HARVEST_AUTH_FORCE === '1') return true;
  // Also gate /harvest path on other hosts when explicitly required
  if (process.env.HARVEST_AUTH_ON_PATH === '1' && req.path.startsWith('/harvest')) return true;
  return false;
}

/** Paths on the harvest host that should land on Collection Platform UI, not Judicium. */
const HARVEST_SURFACE_REDIRECTS = new Set(['/', '/dashboard', '/login', '/callback', '/logout']);

export function harvestSurfacePath(req: Request): string {
  return req.path === '/harvest' || req.path.startsWith('/harvest/') ? req.path : '/harvest';
}

/** After Keycloak login, send users to /harvest instead of Judicium home. */
export function redirectHarvestSurface(req: Request, res: Response, next: NextFunction) {
  if (!isHarvestHost(req)) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!HARVEST_SURFACE_REDIRECTS.has(req.path)) return next();
  return res.redirect(302, harvestSurfacePath(req));
}

export function getHarvestSession(req: Request): HarvestAuthUser | null {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies.harvest_session;
  if (!raw) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      user?: HarvestAuthUser;
      exp?: number;
    };
    if (!json?.user?.sub) return null;
    if (json.exp && Date.now() > json.exp) return null;
    return json.user;
  } catch {
    return null;
  }
}

function writeSession(res: Response, user: HarvestAuthUser, maxAgeSec: number) {
  const payload = b64url(
    JSON.stringify({
      user,
      exp: Date.now() + maxAgeSec * 1000,
    }),
  );
  setCookie(res, 'harvest_session', payload, { maxAgeMs: maxAgeSec * 1000, httpOnly: true });
}

async function exchangeCode(code: string, verifier: string) {
  const c = cfg();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    code_verifier: verifier,
  });
  if (c.clientSecret) body.set('client_secret', c.clientSecret);

  const tokenRes = await fetch(c.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokenJson: any = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson?.access_token) {
    throw new Error(`token exchange failed: ${JSON.stringify(tokenJson)}`);
  }

  const uiRes = await fetch(c.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const userInfo: any = await uiRes.json();
  if (!uiRes.ok || !userInfo?.sub) {
    throw new Error(`userinfo failed: ${JSON.stringify(userInfo)}`);
  }

  return {
    accessToken: String(tokenJson.access_token),
    idToken: tokenJson.id_token ? String(tokenJson.id_token) : '',
    expiresIn: Number(tokenJson.expires_in || 3600),
    user: {
      sub: String(userInfo.sub),
      email: userInfo.email ? String(userInfo.email) : undefined,
      name: userInfo.name ? String(userInfo.name) : undefined,
      preferred_username: userInfo.preferred_username
        ? String(userInfo.preferred_username)
        : undefined,
    } satisfies HarvestAuthUser,
  };
}

/** Require Keycloak session for harvest host / API. */
export function requireHarvestAuth(req: Request, res: Response, next: NextFunction) {
  const c = cfg();
  if (!c.required) return next();

  const onHarvestHost = isHarvestHost(req);
  const harvestApi = req.path.startsWith('/api/harvest');
  const harvestPath = req.path === '/harvest' || req.path.startsWith('/harvest/');

  // Gate: entire harvest.noirstack.com host, all /api/harvest/*, and /harvest path
  if (!onHarvestHost && !harvestApi && !harvestPath) return next();

  if (req.path.startsWith('/api/harvest/auth/')) return next();
  if (req.path === '/api/health') return next();

  // Cascades / internal orchestrator (machine token)
  if (req.path.startsWith('/api/collection/')) {
    const expected = process.env.COLLECTION_INTERNAL_TOKEN || '';
    const got = String(req.headers['x-collection-token'] || '');
    if (expected && got === expected) return next();
  }

  // Dev/Vite static assets must stay reachable on the harvest host
  if (
    req.path.startsWith('/@') ||
    req.path.startsWith('/src/') ||
    req.path.startsWith('/node_modules') ||
    req.path.startsWith('/assets/') ||
    req.path === '/favicon.ico'
  ) {
    return next();
  }

  const user = getHarvestSession(req);
  if (user) {
    (req as any).harvestUser = user;
    return next();
  }

  const wantsJson =
    harvestApi ||
    String(req.headers.accept || '').includes('application/json') ||
    Boolean(req.xhr);

  if (wantsJson) {
    return res.status(401).json({
      error: 'authentication_required',
      loginUrl: '/api/harvest/auth/login',
    });
  }

  let returnTo = req.originalUrl || '/';
  if (onHarvestHost && HARVEST_SURFACE_REDIRECTS.has(req.path)) {
    returnTo = harvestSurfacePath(req);
  }
  return res.redirect(`/api/harvest/auth/login?return_to=${encodeURIComponent(returnTo)}`);
}

export function registerHarvestAuthRoutes(app: Express): void {
  app.get('/api/harvest/auth/status', (req, res) => {
    const c = cfg();
    const user = getHarvestSession(req);
    res.json({
      required: c.required,
      authenticated: Boolean(user),
      user,
      issuer: c.issuer,
      clientId: c.clientId,
      loginUrl: '/api/harvest/auth/login',
      logoutUrl: '/api/harvest/auth/logout',
    });
  });

  app.get('/api/harvest/auth/login', (req, res) => {
    const c = cfg();
    if (!c.clientId || !c.redirectUri) {
      return res.status(500).json({ error: 'Keycloak client not configured' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const defaultReturn = isHarvestHost(req) ? '/harvest' : '/';
    const returnToRaw = String(req.query.return_to || defaultReturn);
    const returnTo = returnToRaw.startsWith('/') ? returnToRaw : defaultReturn;
    const payload: OidcState = { state, verifier, returnTo };
    setCookie(res, 'harvest_oidc', b64url(JSON.stringify(payload)), {
      maxAgeMs: 600_000,
      httpOnly: true,
      path: '/api/harvest/auth',
    });

    const url = new URL(c.authUrl);
    url.searchParams.set('client_id', c.clientId);
    url.searchParams.set('redirect_uri', c.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', c.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return res.redirect(url.toString());
  });

  app.get('/api/harvest/auth/callback', async (req, res) => {
    try {
      const err = String(req.query.error || '').trim();
      if (err) {
        return res
          .status(401)
          .send(`Keycloak authorization failed: ${err} ${req.query.error_description || ''}`);
      }
      const code = String(req.query.code || '').trim();
      const state = String(req.query.state || '').trim();
      if (!code || !state) return res.status(400).send('Missing code/state');

      const cookies = parseCookies(req.headers.cookie);
      let parsed: OidcState | null = null;
      try {
        parsed = JSON.parse(
          Buffer.from(String(cookies.harvest_oidc || ''), 'base64url').toString('utf8'),
        );
      } catch {
        parsed = null;
      }
      if (!parsed?.state || !parsed.verifier || parsed.state !== state) {
        return res.redirect('/api/harvest/auth/login');
      }

      const exchanged = await exchangeCode(code, parsed.verifier);
      clearCookie(res, 'harvest_oidc', '/api/harvest/auth');
      writeSession(res, exchanged.user, exchanged.expiresIn);
      if (exchanged.idToken) {
        setCookie(res, 'harvest_id_token', exchanged.idToken, {
          maxAgeMs: exchanged.expiresIn * 1000,
          httpOnly: true,
        });
      }
      const dest = parsed.returnTo.startsWith('/') ? parsed.returnTo : '/';
      return res.redirect(dest);
    } catch (e: any) {
      console.error('[harvest-auth] callback error:', e?.message || e);
      return res.status(500).send(`Auth callback failed: ${e?.message || e}`);
    }
  });

  app.get('/api/harvest/auth/logout', (req, res) => {
    const c = cfg();
    const cookies = parseCookies(req.headers.cookie);
    const idToken = cookies.harvest_id_token || '';
    clearCookie(res, 'harvest_session');
    clearCookie(res, 'harvest_id_token');
    clearCookie(res, 'harvest_oidc', '/api/harvest/auth');

    if (c.logoutUrl && c.clientId) {
      const url = new URL(c.logoutUrl);
      url.searchParams.set('client_id', c.clientId);
      url.searchParams.set('post_logout_redirect_uri', c.homeUrl);
      if (idToken) url.searchParams.set('id_token_hint', idToken);
      return res.redirect(url.toString());
    }
    return res.redirect('/');
  });

  app.get('/api/harvest/auth/me', (req, res) => {
    const user = getHarvestSession(req);
    if (!user) return res.status(401).json({ error: 'not_authenticated' });
    res.json({ user });
  });
}
