import { createHash, randomBytes } from 'node:crypto';
import type { UserRole } from '@altera/core';
import { DEFAULT_JWT_ACCESS_TTL_SEC, DEFAULT_JWT_REFRESH_TTL_SEC } from '@altera/core';
import { SignJWT, jwtVerify } from 'jose';

export interface JwtConfig {
  secret: string;
  accessTtlSec?: number;
  refreshTtlSec?: number;
  issuer?: string;
  audience?: string;
}

export interface AccessClaims {
  sub: string; // user id
  tid: string; // tenant id
  role: UserRole;
  username: string;
  typ: 'access' | 'refresh';
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function secondsFromNow(sec: number): number {
  return Math.floor(Date.now() / 1000) + sec;
}

export async function signAccessToken(
  cfg: JwtConfig,
  claims: Omit<AccessClaims, 'typ'>,
): Promise<string> {
  const ttl = cfg.accessTtlSec ?? DEFAULT_JWT_ACCESS_TTL_SEC;
  return new SignJWT({ ...claims, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(secondsFromNow(ttl))
    .setIssuer(cfg.issuer ?? 'altera-os')
    .setAudience(cfg.audience ?? 'altera-api')
    .sign(encodeSecret(cfg.secret));
}

export async function signRefreshToken(
  cfg: JwtConfig,
  claims: Omit<AccessClaims, 'typ'>,
): Promise<string> {
  const ttl = cfg.refreshTtlSec ?? DEFAULT_JWT_REFRESH_TTL_SEC;
  return new SignJWT({ ...claims, typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(secondsFromNow(ttl))
    .setIssuer(cfg.issuer ?? 'altera-os')
    .setAudience(cfg.audience ?? 'altera-api')
    .sign(encodeSecret(cfg.secret));
}

export async function verifyToken(cfg: JwtConfig, token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, encodeSecret(cfg.secret), {
    issuer: cfg.issuer ?? 'altera-os',
    audience: cfg.audience ?? 'altera-api',
  });
  return payload as unknown as AccessClaims;
}

export function newRefreshTokenRaw(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
