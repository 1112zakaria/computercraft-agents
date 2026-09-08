local M = {}

M.VERSION = 1

local skill_names = {
  ["movement.step"] = true,
  ["navigate.path"] = true,
  ["observation.block"] = true,
  ["inventory.inspect"] = true,
  ["inventory.deposit"] = true,
  ["inventory.withdraw"] = true,
  ["mining.excavate"] = true,
  ["fuel.refuel"] = true,
}

local directions = {
  N = true,
  E = true,
  S = true,
  W = true,
  UP = true,
  DOWN = true,
}

local relative_directions = {
  front = true,
  up = true,
  down = true,
}

local event_types = {
  ["worker.online"] = true,
  ["worker.offline"] = true,
  ["worker.state"] = true,
  ["command.accepted"] = true,
  ["command.started"] = true,
  ["command.progress"] = true,
  ["command.completed"] = true,
  ["command.failed"] = true,
  ["command.cancelled"] = true,
  ["movement.blocked"] = true,
  ["fuel.low"] = true,
  ["fuel.empty"] = true,
  ["inventory.changed"] = true,
  ["inventory.full"] = true,
  ["block.observed"] = true,
  ["peripheral.observed"] = true,
  ["protocol.error"] = true,
  ["worker.update.started"] = true,
  ["worker.update.staged"] = true,
  ["worker.update.activated"] = true,
  ["worker.update.failed"] = true,
  ["worker.update.rolled_back"] = true,
  ["gateway.update.started"] = true,
  ["gateway.update.staged"] = true,
  ["gateway.update.activated"] = true,
  ["gateway.update.failed"] = true,
  ["gateway.update.rolled_back"] = true,
}

local function fail(message)
  return false, message
end

local function is_integer(value)
  return type(value) == "number" and value == math.floor(value)
end

local function is_non_empty_string(value)
  return type(value) == "string" and string.len(value) > 0
end

local function is_id(value)
  return is_non_empty_string(value) and string.len(value) <= 128 and string.match(value, "^[A-Za-z0-9][A-Za-z0-9._:-]*$") ~= nil
end

local function is_release_version(value)
  return is_non_empty_string(value) and string.match(value, "^v[0-9]+%.[0-9]+%.[0-9]+[-0-9A-Za-z%.]*$") ~= nil
end

local function is_safe_path(value)
  return is_non_empty_string(value) and string.len(value) <= 256 and string.sub(value, 1, 1) ~= "/"
    and string.find(value, "..", 1, true) == nil
end

function M.is_update_path(value, prefix)
  return is_safe_path(value) and string.sub(value, 1, string.len(prefix)) == prefix
end

local function has_only_keys(value, allowed)
  for key, _ in pairs(value) do
    if not allowed[key] then
      return false, "unexpected argument: " .. tostring(key)
    end
  end
  return true
end

local function validate_version(value)
  if value.protocolVersion ~= M.VERSION then
    return fail("unsupported or missing protocolVersion")
  end
  return true
end

local function validate_budget(budget)
  if type(budget) ~= "table" then
    return fail("budget must be a table")
  end
  if not is_integer(budget.maxPrimitives) or budget.maxPrimitives < 1 or budget.maxPrimitives > 1000000 then
    return fail("budget.maxPrimitives must be between 1 and 1000000")
  end
  if not is_integer(budget.maxBlockChanges) or budget.maxBlockChanges < 0 or budget.maxBlockChanges > 1000000 then
    return fail("budget.maxBlockChanges must be between 0 and 1000000")
  end
  if budget.maxInventoryTransfers ~= nil and (not is_integer(budget.maxInventoryTransfers) or budget.maxInventoryTransfers < 0) then
    return fail("budget.maxInventoryTransfers must be a non-negative integer")
  end
  if budget.maxDurationMs ~= nil and (not is_integer(budget.maxDurationMs) or budget.maxDurationMs < 1) then
    return fail("budget.maxDurationMs must be a positive integer")
  end
  return true
end

local function validate_arguments(skill, arguments)
  if type(arguments) ~= "table" then
    return fail("arguments must be a table")
  end

  if skill == "movement.step" then
    local ok, error_message = has_only_keys(arguments, { direction = true })
    if not ok or not directions[arguments.direction] then
      return fail(error_message or "movement.step.direction is invalid")
    end
    return true
  elseif skill == "navigate.path" then
    local ok, error_message = has_only_keys(arguments, { steps = true })
    if not ok then
      return fail(error_message)
    end
    if type(arguments.steps) ~= "table" or #arguments.steps < 1 or #arguments.steps > 1024 then
      return fail("navigate.path.steps must contain 1 to 1024 directions")
    end
    for index, direction in ipairs(arguments.steps) do
      if not directions[direction] then
        return fail("navigate.path.steps[" .. tostring(index) .. "] is invalid")
      end
    end
    return true
  elseif skill == "observation.block" then
    local ok, error_message = has_only_keys(arguments, { direction = true })
    if not ok or not relative_directions[arguments.direction] then
      return fail(error_message or "observation.block.direction is invalid")
    end
    return true
  elseif skill == "inventory.inspect" then
    local ok, error_message = has_only_keys(arguments, {})
    if not ok then
      return fail(error_message)
    end
    return true
  elseif skill == "inventory.deposit" then
    local ok, error_message = has_only_keys(arguments, { containerId = true, quantity = true, slot = true })
    if not ok then
      return fail(error_message)
    end
    if arguments.quantity ~= nil and (not is_integer(arguments.quantity) or arguments.quantity < 1 or arguments.quantity > 64) then
      return fail("inventory.deposit.quantity is invalid")
    end
    if arguments.slot ~= nil and (not is_integer(arguments.slot) or arguments.slot < 1 or arguments.slot > 16) then
      return fail("inventory.deposit.slot is invalid")
    end
    return true
  elseif skill == "inventory.withdraw" then
    local ok, error_message = has_only_keys(arguments, { containerId = true, itemKey = true, quantity = true, slot = true })
    if not ok then
      return fail(error_message)
    end
    if not is_id(arguments.itemKey) then
      return fail("inventory.withdraw.itemKey is required")
    end
    if not is_integer(arguments.quantity) or arguments.quantity < 1 or arguments.quantity > 64 then
      return fail("inventory.withdraw.quantity is invalid")
    end
    if arguments.slot ~= nil and (not is_integer(arguments.slot) or arguments.slot < 1 or arguments.slot > 16) then
      return fail("inventory.withdraw.slot is invalid")
    end
    return true
  elseif skill == "mining.excavate" then
    local ok, error_message = has_only_keys(arguments, { width = true, height = true, depth = true })
    if not ok then
      return fail(error_message)
    end
    for _, key in ipairs({ "width", "height", "depth" }) do
      if not is_integer(arguments[key]) or arguments[key] < 1 or arguments[key] > 64 then
        return fail("mining.excavate." .. key .. " is invalid")
      end
    end
    return true
  elseif skill == "fuel.refuel" then
    local ok, error_message = has_only_keys(arguments, { maxItems = true })
    if not ok then
      return fail(error_message)
    end
    if not is_integer(arguments.maxItems) or arguments.maxItems < 1 or arguments.maxItems > 16 then
      return fail("fuel.refuel.maxItems is invalid")
    end
    return true
  end

  return fail("unknown skill: " .. tostring(skill))
end

function M.encode(value)
  return textutils.serializeJSON(value)
end

function M.decode(value)
  if type(value) ~= "string" then
    return nil, "message must be a string"
  end
  local ok, result = pcall(textutils.unserializeJSON, value)
  if not ok or type(result) ~= "table" then
    return nil, "invalid JSON message"
  end
  return result
end

function M.validate_command(command)
  if type(command) ~= "table" then
    return fail("command must be a table")
  end
  local ok, error_message = validate_version(command)
  if not ok then
    return fail(error_message)
  end
  for _, key in ipairs({ "commandId", "workerId", "issuedAt", "expiresAt" }) do
    if not is_non_empty_string(command[key]) then
      return fail("command." .. key .. " is required")
    end
  end
  if not skill_names[command.skill] then
    return fail("unknown skill: " .. tostring(command.skill))
  end
  ok, error_message = validate_budget(command.budget)
  if not ok then
    return fail(error_message)
  end
  return validate_arguments(command.skill, command.arguments)
end

function M.validate_registration(message)
  if type(message) ~= "table" then
    return fail("registration must be a table")
  end
  local ok, error_message = validate_version(message)
  if not ok then
    return fail(error_message)
  end
  for _, key in ipairs({ "workerId", "workerBootId", "runtimeVersion" }) do
    if not is_id(message[key]) then
      return fail("registration." .. key .. " is invalid")
    end
  end
  if not is_integer(message.computerId) or message.computerId < 0 then
    return fail("registration.computerId is invalid")
  end
  if type(message.capabilities) ~= "table" then
    return fail("registration.capabilities must be a table")
  end
  return true
end

function M.validate_worker_heartbeat(message)
  if type(message) ~= "table" then
    return fail("heartbeat must be a table")
  end
  local ok, error_message = validate_version(message)
  if not ok then
    return fail(error_message)
  end
  if not is_id(message.workerId) or not is_id(message.workerBootId) then
    return fail("heartbeat worker identity is invalid")
  end
  if not is_non_empty_string(message.status) or not is_non_empty_string(message.executionState) then
    return fail("heartbeat status is invalid")
  end
  return true
end

function M.validate_worker_event(message)
  if type(message) ~= "table" then
    return fail("worker event must be a table")
  end
  local ok, error_message = validate_version(message)
  if not ok then
    return fail(error_message)
  end
  if not is_id(message.eventId) or not event_types[message.type] then
    return fail("worker event identity or type is invalid")
  end
  if not is_integer(message.sequence) or message.sequence < 0 then
    return fail("worker event sequence is invalid")
  end
  if type(message.payload) ~= "table" then
    return fail("worker event payload must be a table")
  end
  return true
end

function M.validate_stop(control)
  if type(control) ~= "table" then
    return fail("stop control must be a table")
  end
  local ok, error_message = validate_version(control)
  if not ok then
    return fail(error_message)
  end
  if not is_id(control.controlId) or not is_non_empty_string(control.type) then
    return fail("stop control identity is invalid")
  end
  if control.type == "worker.stop" and not is_id(control.workerId) then
    return fail("worker.stop.workerId is invalid")
  end
  if control.type ~= "worker.stop" and control.type ~= "all.stop" then
    return fail("unknown stop control type")
  end
  return true
end

function M.validate_update_control(update)
  if type(update) ~= "table" then return fail("update must be a table") end
  local ok, error_message = validate_version(update)
  if not ok then return fail(error_message) end
  for _, key in ipairs({ "updateId", "target", "manifestUrl", "issuedAt", "expiresAt", "gatewayId" }) do
    if not is_non_empty_string(update[key]) then return fail("update." .. key .. " is required") end
  end
  if not is_release_version(update.releaseVersion) then return fail("update.releaseVersion is invalid") end
  if string.sub(update.manifestUrl, 1, 8) ~= "https://" then return fail("update.manifestUrl must use HTTPS") end
  if string.match(update.target, "^(gateway|worker|fleet):[A-Za-z0-9][A-Za-z0-9%._:-]*$") == nil then
    return fail("update.target is invalid")
  end
  if update.status ~= "QUEUED" and update.status ~= "RUNNING" and update.status ~= "CANARY" then
    return fail("update.status is not active")
  end
  return true
end

function M.validate_update_ack(message)
  if type(message) ~= "table" or message.protocolVersion ~= M.VERSION then return fail("invalid update ack version") end
  if message.type ~= "worker.update.ack" or not is_id(message.gatewayBootId) or not is_id(message.updateId) then
    return fail("invalid update ack envelope")
  end
  if not is_id(message.workerId) then return fail("invalid update ack worker") end
  if message.phase ~= "PREPARED" and message.phase ~= "FILE_RECEIVED" and message.phase ~= "ACTIVATED"
    and message.phase ~= "FAILED" and message.phase ~= "ROLLED_BACK" then
    return fail("invalid update ack phase")
  end
  return true
end

function M.validate_poll_response(response)
  if type(response) ~= "table" then
    return fail("poll response must be a table")
  end
  local ok, error_message = validate_version(response)
  if not ok then
    return fail(error_message)
  end
  if type(response.commands) ~= "table" then
    return fail("poll response.commands must be a table")
  end
  for index, command in ipairs(response.commands) do
    ok, error_message = M.validate_command(command)
    if not ok then
      return fail("commands[" .. tostring(index) .. "]: " .. error_message)
    end
  end
  if response.stopControls ~= nil then
    if type(response.stopControls) ~= "table" then
      return fail("poll response.stopControls must be a table")
    end
    for index, control in ipairs(response.stopControls) do
      ok, error_message = M.validate_stop(control)
      if not ok then
        return fail("stopControls[" .. tostring(index) .. "]: " .. error_message)
      end
    end
  end
  if response.updates ~= nil then
    if type(response.updates) ~= "table" then return fail("poll response.updates must be a table") end
    for index, update in ipairs(response.updates) do
      ok, error_message = M.validate_update_control(update)
      if not ok then return fail("updates[" .. tostring(index) .. "]: " .. error_message) end
    end
  end
  return true
end

function M.is_expired(timestamp)
  if type(timestamp) ~= "string" then
    return true
  end
  local year, month, day, hour, minute, second = string.match(timestamp, "^(%d%d%d%d)-(%d%d)-(%d%d)T(%d%d):(%d%d):(%d%d)Z$")
  if not year then
    return true
  end
  local expiry = os.time({
    year = tonumber(year),
    month = tonumber(month),
    day = tonumber(day),
    hour = tonumber(hour),
    min = tonumber(minute),
    sec = tonumber(second),
  })
  return expiry <= os.time()
end

return M
