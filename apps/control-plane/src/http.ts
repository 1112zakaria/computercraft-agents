import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { errorResponse, HttpError, repositoryErrorToHttp } from "./gateway-service";
import type { GatewayService } from "./gateway-service";

export interface HttpServerOptions {
  readonly service: GatewayService;
  readonly maxBodyBytes: number;
}

function sendJson(response: ServerResponse, statusCode: number, body: object): void {
  const encoded = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(encoded));
  response.end(encoded);
}

function sendNoContent(response: ServerResponse): void {
  response.statusCode = 204;
  response.end();
}

function requestMethod(request: IncomingMessage): string {
  return request.method?.toUpperCase() ?? "GET";
}

async function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBodyBytes) {
      throw new HttpError(413, "INVALID_PAYLOAD", "request body exceeds the configured limit");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createControlPlaneServer(options: HttpServerOptions): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://control-plane.local");
      const method = requestMethod(request);
      const workerPathMatch = url.pathname.match(/^\/v1\/workers(?:\/([^/]+))?$/);

      if (method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, options.service.health());
        return;
      }

      if (
        workerPathMatch ||
        url.pathname === "/v1/diagnostics" ||
        url.pathname === "/v1/commands" ||
        url.pathname === "/v1/stop-controls"
      ) {
        options.service.authenticateAdmin(request.headers);
        if (method === "GET" && workerPathMatch) {
          const encodedWorkerId = workerPathMatch[1];
          if (encodedWorkerId) {
            let workerId: string;
            try {
              workerId = decodeURIComponent(encodedWorkerId);
            } catch {
              throw new HttpError(400, "INVALID_PAYLOAD", "worker id is not valid URL encoding");
            }
            sendJson(response, 200, await options.service.getWorker(workerId));
          } else {
            sendJson(response, 200, { workers: await options.service.listWorkers() });
          }
          return;
        }
        if (method === "GET" && url.pathname === "/v1/diagnostics") {
          sendJson(response, 200, await options.service.diagnostics());
          return;
        }
        if (method !== "POST") {
          throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
        }
        const adminBody = options.service.parseBody(await readBody(request, options.maxBodyBytes));
        if (url.pathname === "/v1/commands") {
          sendJson(response, 200, await options.service.enqueueCommand(adminBody));
          return;
        }
        if (url.pathname === "/v1/stop-controls") {
          sendJson(response, 200, await options.service.enqueueStopControl(adminBody));
          return;
        }
      }

      if (!url.pathname.startsWith("/v1/gateway/")) {
        sendJson(response, 404, { error: "not found" });
        return;
      }

      const context = options.service.authenticate(request.headers);
      if (method === "GET" && url.pathname === "/v1/gateway/authenticated-connectivity") {
        sendNoContent(response);
        return;
      }
      if (method === "GET" && url.pathname === "/v1/gateway/commands") {
        const body = await options.service.poll(context, url.searchParams.get("after"));
        sendJson(response, 200, body);
        return;
      }

      if (method !== "POST") {
        throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
      }

      const body = options.service.parseBody(await readBody(request, options.maxBodyBytes));
      if (url.pathname === "/v1/gateway/register") {
        sendJson(response, 200, await options.service.register(context, body));
        return;
      }
      if (url.pathname === "/v1/gateway/heartbeat") {
        sendJson(response, 200, await options.service.heartbeat(context, body));
        return;
      }
      if (url.pathname === "/v1/gateway/events") {
        sendJson(response, 200, await options.service.events(context, body));
        return;
      }
      if (url.pathname === "/v1/gateway/ack") {
        sendJson(response, 200, { protocolVersion: 1, accepted: true });
        return;
      }

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      const httpError = repositoryErrorToHttp(error);
      if (httpError.statusCode >= 500) {
        console.error(`Control-plane request failed: ${httpError.message}`);
      }
      sendJson(response, httpError.statusCode, errorResponse(httpError));
    }
  });
}
