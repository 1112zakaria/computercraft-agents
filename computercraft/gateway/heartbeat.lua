local M = {}

local function now_iso()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function as_json_array(values)
  if #values == 0 and textutils.EMPTY_ARRAY then
    return textutils.EMPTY_ARRAY
  end
  return values
end

local function worker_for_http(worker)
  return {
    workerId = worker.workerId,
    computerId = worker.computerId,
    workerBootId = worker.workerBootId,
    runtimeVersion = worker.runtimeVersion,
    status = worker.online and (worker.status or "ONLINE") or "OFFLINE",
    executionState = worker.executionState or "IDLE",
    capabilities = as_json_array(worker.capabilities or {}),
    lastSeenAt = worker.lastSeenAt or now_iso(),
    currentCommandId = worker.currentCommandId,
    position = worker.position,
    fuel = worker.fuel,
  }
end

function M.new(config, boot_id, registry, http_client, logger, id)
  local heartbeat = {
    config = config,
    boot_id = boot_id,
    registry = registry,
    http = http_client,
    logger = logger,
    id = id,
  }

  function heartbeat:registration()
    local workers = {}
    for _, worker in ipairs(self.registry:list()) do
      table.insert(workers, {
        workerId = worker.workerId,
        computerId = worker.computerId,
        runtimeVersion = worker.runtimeVersion,
        capabilities = as_json_array(worker.capabilities or {}),
      })
    end

    return {
      protocolVersion = 1,
      gatewayId = self.config.gateway_id,
      bootId = self.boot_id,
      minecraftServerId = self.config.minecraft_server_id,
      runtimeVersion = self.config.worker_runtime_version,
      capabilities = as_json_array(self.config.capabilities or {}),
      workers = as_json_array(workers),
    }
  end

  function heartbeat:send_registration()
    return self.http:request("POST", self.config.register_path, self:registration())
  end

  function heartbeat:send()
    self.registry:mark_stale(os.clock())
    local workers = {}
    for _, worker in ipairs(self.registry:list()) do
      table.insert(workers, worker_for_http(worker))
    end

    return self.http:request("POST", self.config.heartbeat_path, {
      protocolVersion = 1,
      gatewayId = self.config.gateway_id,
      bootId = self.boot_id,
      sentAt = now_iso(),
      uptimeSeconds = math.floor(os.clock()),
      status = "ONLINE",
      workers = as_json_array(workers),
    })
  end

  return heartbeat
end

return M
