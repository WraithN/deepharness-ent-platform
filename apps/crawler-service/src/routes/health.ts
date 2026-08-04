import { FastifyInstance } from "fastify";

export default async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    await reply.send({ status: "ok" });
  });
}
