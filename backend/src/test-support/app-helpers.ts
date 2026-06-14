/**
 * App helpers for route-level integration tests.
 *
 * buildRealApp() mounts the full Fastify app (cors + cookie + all dashboard routes)
 * using the same registration path as production, but without starting the bot or crons.
 *
 * makeSessionCookie() produces a valid signed cookie for a given telegramUserId
 * using the real signSession from routes/auth.ts.
 *
 * Top-level imports are safe here: globalSetup sets all env vars before any
 * test file (and thus this helper) is imported.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { dashboardCorsOptions } from "../http/cors.js";
import { dashboardRoutes } from "../routes/dashboard.js";
import { signSession } from "../routes/auth.js";

export async function buildRealApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, dashboardCorsOptions());
  await app.register(cookie);
  await app.register(dashboardRoutes);
  await app.ready();
  return app;
}

/**
 * Returns the cookie value for a signed session token.
 * Use as `Cookie: session=<value>` in inject() calls.
 */
export function makeSessionCookie(userId: number, firstName: string): string {
  const iat = Math.floor(Date.now() / 1000);
  return signSession(userId, firstName, iat);
}
