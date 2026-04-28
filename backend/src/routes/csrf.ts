import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function parseOrigin(value: string | string[] | undefined): string | null {
  const origin = Array.isArray(value) ? value[0] : value;
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function originMatchesHost(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function isTrustedMutationOrigin(
  originHeader: string | string[] | undefined,
  hostHeader: string | undefined,
): boolean {
  const origin = parseOrigin(originHeader);
  if (!origin) return true;
  return originMatchesHost(origin, hostHeader) || config.allowedOrigins.includes(origin);
}

export async function installCsrfOriginGuard(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!unsafeMethods.has(request.method.toUpperCase())) return;
    if (isTrustedMutationOrigin(request.headers.origin, request.headers.host)) return;
    return reply.status(403).send({ error: "Cross-site request blocked" });
  });
}
