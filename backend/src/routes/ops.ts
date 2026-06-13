import type { FastifyInstance } from "fastify";
import { listRestoreDrills } from "../db/ops-drills.js";
import { getSession } from "./auth.js";

export async function opsRoutes(app: FastifyInstance) {
  app.get("/api/ops/restore-drills", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;
    if (!session.canManage) return reply.status(403).send({ error: "Owner access required" });
    return { drills: await listRestoreDrills() };
  });
}
