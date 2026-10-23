import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRequest } from "../src/server.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleRequest(req, res);
}
