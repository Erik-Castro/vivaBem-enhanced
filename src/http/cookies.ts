import type { Context } from "@hono/hono";
import { deleteCookie, getCookie, setCookie } from "@hono/hono/cookie";
import type { AppConfig } from "../config.ts";
import type { AppEnv } from "./types.ts";

export const ACCESS_COOKIE = "vb_access";
export const REFRESH_COOKIE = "vb_refresh";
export const CSRF_COOKIE = "vb_csrf";
export const CSRF_HEADER = "X-CSRF-Token";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export interface AuthCookiePayload {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly csrfToken: string;
  readonly accessMaxAgeSeconds: number;
  readonly refreshMaxAgeSeconds: number;
}

export function setAuthCookies(
  c: Context<AppEnv>,
  config: AppConfig,
  payload: AuthCookiePayload,
): void {
  setCookie(c, ACCESS_COOKIE, payload.accessToken, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: payload.accessMaxAgeSeconds,
  });

  setCookie(c, REFRESH_COOKIE, payload.refreshToken, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: payload.refreshMaxAgeSeconds,
  });

  // Legível pelo JS: o frontend reenvia no header `X-CSRF-Token`.
  setCookie(c, CSRF_COOKIE, payload.csrfToken, {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: "/",
  });
}

export function setCsrfCookie(
  c: Context<AppEnv>,
  config: AppConfig,
  csrfToken: string,
): void {
  setCookie(c, CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: "/",
  });
}

export function clearAuthCookies(c: Context<AppEnv>, config: AppConfig): void {
  deleteCookie(c, ACCESS_COOKIE, { path: "/", secure: config.cookieSecure });
  deleteCookie(c, REFRESH_COOKIE, {
    path: REFRESH_COOKIE_PATH,
    secure: config.cookieSecure,
  });
  deleteCookie(c, CSRF_COOKIE, { path: "/", secure: config.cookieSecure });
}

export function getRefreshToken(c: Context<AppEnv>): string | undefined {
  return getCookie(c, REFRESH_COOKIE);
}

export function getCsrfCookie(c: Context<AppEnv>): string | undefined {
  return getCookie(c, CSRF_COOKIE);
}
