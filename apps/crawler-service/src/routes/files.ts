import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { getTempFilePath } from "../services/temp-files.js";

/** GET /files/:id 返回临时文件内容；id 非法或不存在返回 404。 */
export default async function filesRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/files/:id", async (req, reply) => {
    const filePath = getTempFilePath(req.params.id);
    if (!filePath || !fs.existsSync(filePath)) {
      reply.code(404);
      return { error: "not found" };
    }
    // 简单场景直接回 Buffer；统一 application/octet-stream 由 agent 侧自行判定内容类型。
    const buf = fs.readFileSync(filePath);
    reply.type("application/octet-stream");
    return buf;
  });
}
