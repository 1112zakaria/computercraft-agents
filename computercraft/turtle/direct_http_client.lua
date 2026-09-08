-- Direct HTTPS worker transport. This client intentionally mirrors the small interface exposed
-- by rednet_client.lua so the deterministic turtle executor is transport-independent.
local M = {}

local function now_iso()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function join_url(base, path)
  if string.sub(path, 1, 1) ~= "/" then path = "/" .. path end
  return base .. path
end

local function close_response(response)
  if response and response.close then response.close() end
end

local function read_json(path)
  if not fs.exists(path) then return {} end
  local handle = fs.open(path, "r")
  if not handle then return {} end
  local raw = handle.readAll()
  handle.close()
  local ok, value = pcall(textutils.unserializeJSON, raw)
  if ok and type(value) == "table" then return value end
  return {}
end

local function write_json(path, value)
  local handle = fs.open(path .. ".tmp", "w")
  if not handle then return false end
  handle.write(textutils.serializeJSON(value))
  handle.close()
  if fs.exists(path) then fs.delete(path) end
  fs.move(path .. ".tmp", path)
  return true
end

function M.new(config, state, inventory, fuel, protocol, logger)
  local transport = {
    config = config,
    state = state,
    inventory = inventory,
    fuel = fuel,
    protocol = protocol,
    logger = logger,
    gateway_boot_id = nil,
    execution_state = "IDLE",
    current_command_id = nil,
    last_heartbeat = 0,
    last_poll = 0,
    pending = {},
    cursor_state = read_json(config.poll_cursor_path),
    outbox = read_json(config.event_outbox_path),
  }

  transport.cursor = transport.cursor_state.cursor
  if type(transport.outbox) ~= "table" then transport.outbox = {} end

  function transport:request(method, path, body)
    if not http or not http.get or not http.post then
      return { ok = false, error = "ComputerCraft HTTP API is unavailable" }
    end
    local headers = {
      ["Content-Type"] = "application/json",
      ["X-Agent-Worker-Id"] = self.config.worker_id,
      ["Authorization"] = "Bearer " .. self.config.vps_bearer_secret,
    }
    local encoded_body = body and textutils.serializeJSON(body) or ""
    local ok, response_or_error
    local url = join_url(self.config.vps_url, path)
    if method == "GET" then
      ok, response_or_error = pcall(http.get, url, headers)
    elseif method == "POST" then
      ok, response_or_error = pcall(http.post, url, encoded_body, headers)
    else
      return { ok = false, error = "unsupported HTTP method" }
    end
    if not ok or not response_or_error then
      return { ok = false, error = tostring(response_or_error or "HTTP request failed") }
    end

    local response = response_or_error
    local status = response.getResponseCode and response.getResponseCode() or 200
    local raw_body = response.readAll and response.readAll() or ""
    close_response(response)
    if status < 200 or status >= 300 then
      return { ok = false, status = status, error = "HTTP status " .. tostring(status), rawBody = raw_body }
    end
    local parsed = nil
    if raw_body and string.len(raw_body) > 0 then
      local decoded, value = pcall(textutils.unserializeJSON, raw_body)
      if decoded then parsed = value end
    end
    return { ok = true, status = status, body = parsed, rawBody = raw_body }
  end

  function transport:get_raw(url)
    if not http or not http.get then
      return { ok = false, error = "ComputerCraft HTTP API is unavailable" }
    end
    local ok, response_or_error = pcall(http.get, url)
    if not ok or not response_or_error then
      return { ok = false, error = tostring(response_or_error or "HTTP request failed") }
    end
    local response = response_or_error
    local status = response.getResponseCode and response.getResponseCode() or 200
    local body = response.readAll and response.readAll() or ""
    close_response(response)
    if status < 200 or status >= 300 then
      return { ok = false, status = status, error = "HTTP status " .. tostring(status), body = body }
    end
    return { ok = true, status = status, body = body }
  end

  function transport:open() return true end

  function transport:is_sender(_sender_id)
    return true
  end

  function transport:send(_message)
    -- Direct updates use lifecycle events rather than Rednet acknowledgements.
    return true
  end

  function transport:registration_message()
    return {
      protocolVersion = 1,
      workerId = self.config.worker_id,
      workerBootId = self.state.boot_id,
      minecraftServerId = self.config.minecraft_server_id,
      computerId = os.getComputerID(),
      runtimeVersion = self.config.runtime_version,
      capabilities = self.config.capabilities,
    }
  end

  function transport:register()
    local response = self:request("POST", "/v1/worker/register", self:registration_message())
    if not response.ok or type(response.body) ~= "table" then
      return false, response.error or "direct worker registration failed"
    end
    self.gateway_boot_id = "direct-" .. self.state.boot_id
    self.last_heartbeat = 0
    self.last_poll = 0
    self:flush_events()
    return true
  end

  function transport:set_execution(execution_state, command_id)
    self.execution_state = execution_state
    self.current_command_id = command_id
  end

  function transport:heartbeat()
    if not self.gateway_boot_id then return false, "worker is not registered" end
    local response = self:request("POST", "/v1/worker/heartbeat", {
      protocolVersion = 1,
      minecraftServerId = self.config.minecraft_server_id,
      workerId = self.config.worker_id,
      workerBootId = self.state.boot_id,
      computerId = os.getComputerID(),
      runtimeVersion = self.config.runtime_version,
      status = "ONLINE",
      executionState = self.execution_state,
      capabilities = self.config.capabilities,
      lastSeenAt = now_iso(),
      currentCommandId = self.current_command_id,
      position = self.state:position(),
      fuel = self.fuel:summary(),
    })
    if response.ok then
      self.last_heartbeat = os.clock()
      self:flush_events()
      return true
    end
    return false, response.error
  end

  function transport:maybe_heartbeat()
    if os.clock() - self.last_heartbeat >= self.config.heartbeat_interval_seconds then
      self:heartbeat()
    end
  end

  function transport:save_cursor()
    return write_json(self.config.poll_cursor_path, { cursor = self.cursor })
  end

  function transport:poll_once(force)
    if not self.gateway_boot_id then return false, "worker is not registered" end
    if not force and os.clock() - self.last_poll < self.config.poll_interval_seconds then
      return true
    end
    local path = "/v1/worker/commands"
    if self.cursor then path = path .. "?after=" .. tostring(self.cursor) end
    local response = self:request("GET", path)
    if not response.ok or type(response.body) ~= "table" then
      return false, response.error or "direct worker poll failed"
    end
    self.last_poll = os.clock()
    local body = response.body
    for _, command in ipairs(body.commands or {}) do
      table.insert(self.pending, { senderId = "direct-http", message = { type = "worker.command", gatewayBootId = self.gateway_boot_id, command = command } })
    end
    for _, control in ipairs(body.stopControls or {}) do
      table.insert(self.pending, { senderId = "direct-http", message = { type = "worker.stop", gatewayBootId = self.gateway_boot_id, workerId = self.config.worker_id, control = control } })
    end
    for _, update in ipairs(body.updates or {}) do
      table.insert(self.pending, { senderId = "direct-http", message = update })
    end
    if body.nextCursor then
      self.cursor = body.nextCursor
      self:save_cursor()
    end
    self:flush_events()
    return true
  end

  function transport:poll_control(cancellation)
    self:poll_once(false)
    for index, item in ipairs(self.pending) do
      if item.message and item.message.type == "worker.stop" then
        table.remove(self.pending, index)
        cancellation:request_stop(item.message.control.reason or "operator stop")
        return true
      end
    end
    return false
  end

  function transport:receive(timeout)
    if #self.pending == 0 then self:poll_once(false) end
    if #self.pending > 0 then
      local pending = table.remove(self.pending, 1)
      return pending.senderId, pending.message
    end
    if timeout and timeout > 0 then sleep(timeout) end
    return nil, nil
  end

  function transport:queue_event(event)
    for _, existing in ipairs(self.outbox) do
      if existing.eventId == event.eventId then return true end
    end
    if #self.outbox >= self.config.max_outbox_events then
      return false, "direct worker event outbox is full"
    end
    table.insert(self.outbox, event)
    write_json(self.config.event_outbox_path, self.outbox)
    return true
  end

  function transport:flush_events()
    if not self.gateway_boot_id or #self.outbox == 0 then return true end
    local events = {}
    local limit = math.min(#self.outbox, self.config.max_event_batch)
    for index = 1, limit do table.insert(events, self.outbox[index]) end
    local response = self:request("POST", "/v1/worker/events", {
      protocolVersion = 1,
      workerId = self.config.worker_id,
      workerBootId = self.state.boot_id,
      batchId = "batch-" .. tostring(os.clock()),
      events = events,
    })
    if not response.ok or type(response.body) ~= "table" then return false end
    local accepted = {}
    for _, event_id in ipairs(response.body.acceptedEventIds or {}) do accepted[event_id] = true end
    local remaining = {}
    for _, event in ipairs(self.outbox) do
      if not accepted[event.eventId] then table.insert(remaining, event) end
    end
    self.outbox = remaining
    write_json(self.config.event_outbox_path, self.outbox)
    return true
  end

  function transport:send_event(event)
    local queued, queue_error = self:queue_event(event)
    if not queued then return false, queue_error end
    self:flush_events()
    return true
  end

  return transport
end

return M
