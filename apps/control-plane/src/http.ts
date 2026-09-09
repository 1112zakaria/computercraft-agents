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
      const workerPathPlanMatch = url.pathname.match(/^\/v1\/workers\/([^/]+)\/path-to\/([^/]+)$/);
      const workerAnchorPathMatch = url.pathname.match(/^\/v1\/workers\/([^/]+)\/anchor$/);
      const workerProvisionPath = url.pathname === "/v1/workers/provision";
      const updatePathMatch = url.pathname.match(/^\/v1\/updates(?:\/([^/]+))?$/);
      const agentPathMatch = url.pathname.match(/^\/v1\/agents(?:\/([^/]+))?$/);
      const projectsPath = url.pathname === "/v1/projects";
      const featureGatesPath = url.pathname === "/v1/feature-gates";
      const goalsPath = url.pathname === "/v1/goals";
      const taskPathMatch = url.pathname.match(/^\/v1\/tasks(?:\/([^/]+))?$/);
      const taskPlanningContextPathMatch = url.pathname.match(
        /^\/v1\/tasks\/([^/]+)\/planning-context$/,
      );
      const taskTransitionPathMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/transition$/);
      const taskDispatchPathMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/dispatch$/);
      const runnableTasksPath = url.pathname === "/v1/tasks/runnable";
      const schedulerTickPath = url.pathname === "/v1/scheduler/tick";
      const locationsPath = url.pathname === "/v1/locations";
      const locationPathMatch = url.pathname.match(/^\/v1\/locations\/([^/]+)$/);
      const worldCellsPath = url.pathname === "/v1/world/cells";

      if (method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, options.service.health());
        return;
      }

      if (
        workerPathMatch ||
        workerPathPlanMatch ||
        workerAnchorPathMatch ||
        workerProvisionPath ||
        updatePathMatch ||
        agentPathMatch ||
        projectsPath ||
        featureGatesPath ||
        goalsPath ||
        taskPathMatch ||
        taskPlanningContextPathMatch ||
        taskTransitionPathMatch ||
        taskDispatchPathMatch ||
        runnableTasksPath ||
        schedulerTickPath ||
        locationsPath ||
        locationPathMatch ||
        worldCellsPath ||
        url.pathname === "/v1/diagnostics" ||
        url.pathname === "/v1/commands" ||
        url.pathname === "/v1/stop-controls"
      ) {
        options.service.authenticateAdmin(request.headers);
        if (method === "GET" && workerPathPlanMatch) {
          let workerId: string;
          let locationName: string;
          try {
            workerId = decodeURIComponent(workerPathPlanMatch[1]!);
            locationName = decodeURIComponent(workerPathPlanMatch[2]!);
          } catch {
            throw new HttpError(400, "INVALID_PAYLOAD", "path target is not valid URL encoding");
          }
          sendJson(response, 200, await options.service.planPathToLocation(workerId, locationName));
          return;
        }
        if (method === "POST" && workerAnchorPathMatch) {
          let workerId: string;
          try {
            workerId = decodeURIComponent(workerAnchorPathMatch[1]!);
          } catch {
            throw new HttpError(400, "INVALID_PAYLOAD", "worker id is not valid URL encoding");
          }
          const anchorBody = options.service.parseBody(
            await readBody(request, options.maxBodyBytes),
          );
          sendJson(response, 200, await options.service.anchorWorker(workerId, anchorBody));
          return;
        }
        if (method === "GET" && workerPathMatch && !workerProvisionPath) {
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
        if (method === "POST" && workerProvisionPath) {
          const provisionBody = options.service.parseBody(
            await readBody(request, options.maxBodyBytes),
          );
          sendJson(response, 200, await options.service.provisionDirectWorker(provisionBody));
          return;
        }
        if (method === "GET" && url.pathname === "/v1/diagnostics") {
          sendJson(response, 200, await options.service.diagnostics());
          return;
        }
        if (method === "GET" && updatePathMatch) {
          const encodedUpdateId = updatePathMatch[1];
          if (encodedUpdateId) {
            let updateId: string;
            try {
              updateId = decodeURIComponent(encodedUpdateId);
            } catch {
              throw new HttpError(400, "INVALID_PAYLOAD", "update id is not valid URL encoding");
            }
            sendJson(response, 200, await options.service.getUpdate(updateId));
          } else {
            sendJson(response, 200, { updates: await options.service.listUpdates() });
          }
          return;
        }
        if (method === "GET" && agentPathMatch) {
          const encodedAgentName = agentPathMatch[1];
          if (encodedAgentName) {
            let agentName: string;
            try {
              agentName = decodeURIComponent(encodedAgentName);
            } catch {
              throw new HttpError(400, "INVALID_PAYLOAD", "agent name is not valid URL encoding");
            }
            sendJson(response, 200, await options.service.getAgent(agentName));
          } else {
            sendJson(response, 200, { agents: await options.service.listAgents() });
          }
          return;
        }
        if (method === "GET" && projectsPath) {
          sendJson(response, 200, { projects: await options.service.listProjects() });
          return;
        }
        if (method === "GET" && featureGatesPath) {
          sendJson(response, 200, { featureGates: options.service.listFeatureGates() });
          return;
        }
        if (goalsPath) {
          if (method === "GET") {
            sendJson(response, 200, { goals: await options.service.listGoals() });
            return;
          }
          if (method === "POST") {
            const goalBody = options.service.parseBody(
              await readBody(request, options.maxBodyBytes),
            );
            sendJson(response, 202, await options.service.createGoal(goalBody));
            return;
          }
        }
        if (runnableTasksPath) {
          if (method !== "GET") {
            throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
          }
          sendJson(response, 200, { tasks: await options.service.listRunnableTasks() });
          return;
        }
        if (schedulerTickPath) {
          if (method !== "POST") {
            throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
          }
          sendJson(response, 200, { dispatched: await options.service.dispatchRunnableTasks() });
          return;
        }
        if (taskPathMatch) {
          if (method === "GET" && taskPathMatch[1]) {
            let taskId: string;
            try {
              taskId = decodeURIComponent(taskPathMatch[1]);
            } catch {
              throw new HttpError(400, "INVALID_PAYLOAD", "task id is not valid URL encoding");
            }
            sendJson(response, 200, await options.service.getTask(taskId));
            return;
          }
          if (method === "GET" && !taskPathMatch[1]) {
            sendJson(response, 200, { tasks: await options.service.listTasks() });
            return;
          }
          if (method === "POST" && taskPathMatch[1]) {
            let taskId: string;
            try {
              taskId = decodeURIComponent(taskPathMatch[1]);
            } catch {
              throw new HttpError(400, "INVALID_PAYLOAD", "task id is not valid URL encoding");
            }
            const taskBody = options.service.parseBody(
              await readBody(request, options.maxBodyBytes),
            );
            sendJson(response, 200, await options.service.claimTask(taskId, taskBody));
            return;
          }
        }
        if (taskPlanningContextPathMatch) {
          if (method !== "GET") {
            throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
          }
          let taskId: string;
          try {
            taskId = decodeURIComponent(taskPlanningContextPathMatch[1]!);
          } catch {
            throw new HttpError(400, "INVALID_PAYLOAD", "task id is not valid URL encoding");
          }
          sendJson(response, 200, await options.service.planningContext(taskId));
          return;
        }
        if (taskTransitionPathMatch) {
          if (method !== "POST") {
            throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
          }
          let taskId: string;
          try {
            taskId = decodeURIComponent(taskTransitionPathMatch[1]!);
          } catch {
            throw new HttpError(400, "INVALID_PAYLOAD", "task id is not valid URL encoding");
          }
          const transitionBody = options.service.parseBody(
            await readBody(request, options.maxBodyBytes),
          );
          sendJson(response, 200, await options.service.transitionTask(taskId, transitionBody));
          return;
        }
        if (taskDispatchPathMatch) {
          if (method !== "POST") {
            throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
          }
          let taskId: string;
          try {
            taskId = decodeURIComponent(taskDispatchPathMatch[1]!);
          } catch {
            throw new HttpError(400, "INVALID_PAYLOAD", "task id is not valid URL encoding");
          }
          const dispatchBody = options.service.parseBody(
            await readBody(request, options.maxBodyBytes),
          );
          sendJson(response, 200, await options.service.dispatchTask(taskId, dispatchBody));
          return;
        }
        if (locationsPath) {
          if (method === "GET") {
            sendJson(response, 200, { locations: await options.service.listNamedLocations() });
            return;
          }
          if (method === "POST") {
            const locationBody = options.service.parseBody(
              await readBody(request, options.maxBodyBytes),
            );
            sendJson(response, 200, await options.service.createNamedLocation(locationBody));
            return;
          }
        }
        if (locationPathMatch) {
          if (method !== "GET") {
            throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
          }
          let locationName: string;
          try {
            locationName = decodeURIComponent(locationPathMatch[1]!);
          } catch {
            throw new HttpError(400, "INVALID_PAYLOAD", "location name is not valid URL encoding");
          }
          sendJson(response, 200, await options.service.resolveNamedLocation(locationName));
          return;
        }
        if (worldCellsPath) {
          if (method !== "GET") {
            throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
          }
          sendJson(response, 200, { cells: await options.service.listWorldCells() });
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
        if (url.pathname === "/v1/updates") {
          sendJson(response, 202, await options.service.enqueueUpdate(adminBody));
          return;
        }
      }

      if (!url.pathname.startsWith("/v1/gateway/")) {
        if (!url.pathname.startsWith("/v1/worker/")) {
          sendJson(response, 404, { error: "not found" });
          return;
        }

        const workerContext = options.service.authenticateWorker(request.headers);
        if (method === "GET" && url.pathname === "/v1/worker/commands") {
          sendJson(
            response,
            200,
            await options.service.pollDirectWorker(workerContext, url.searchParams.get("after")),
          );
          return;
        }
        if (method !== "POST") {
          throw new HttpError(405, "INVALID_PAYLOAD", "method is not supported");
        }
        const workerBody = options.service.parseBody(await readBody(request, options.maxBodyBytes));
        if (url.pathname === "/v1/worker/register") {
          sendJson(
            response,
            200,
            await options.service.registerDirectWorker(workerContext, workerBody),
          );
          return;
        }
        if (url.pathname === "/v1/worker/heartbeat") {
          sendJson(
            response,
            200,
            await options.service.heartbeatDirectWorker(workerContext, workerBody),
          );
          return;
        }
        if (url.pathname === "/v1/worker/events") {
          sendJson(
            response,
            200,
            await options.service.directWorkerEvents(workerContext, workerBody),
          );
          return;
        }
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
