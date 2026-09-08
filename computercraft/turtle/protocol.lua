local M = {}

M.VERSION = 1

local skills = {
  ["movement.step"] = true,
  ["navigate.path"] = true,
  ["observation.block"] = true,
  ["inventory.inspect"] = true,
  ["inventory.deposit"] = true,
  ["inventory.withdraw"] = true,
  ["mining.excavate"] = true,
  ["fuel.refuel"] = true,
}

local directions = { N = true, E = true, S = true, W = true, UP = true, DOWN = true }
local relative_directions = { front = true, up = true, down = true }

local function fail(message)
  return false, message
end

local function integer(value)
  return type(value) == "number" and value == math.floor(value)
end

local function non_empty(value)
  return type(value) == "string" and string.len(value) > 0
end

local function identifier(value)
  return non_empty(value) and string.len(value) <= 128 and string.match(value, "^[A-Za-z0-9][A-Za-z0-9._:-]*$") ~= nil
end

local function release_version(value)
  return non_empty(value) and string.match(value, "^v[0-9]+%.[0-9]+%.[0-9]+[-0-9A-Za-z%.]*$") ~= nil
end

function M.is_update_path(value)
  local prefix = "computercraft/turtle/"
  return non_empty(value) and string.len(value) <= 256 and string.sub(value, 1, string.len(prefix)) == prefix
    and string.find(value, "..", 1, true) == nil
end

local function only_keys(value, allowed)
  for key, _ in pairs(value) do
    if not allowed[key] then
      return false, "unexpected argument: " .. tostring(key)
    end
  end
  return true
end

local function arguments_valid(skill, args)
  if type(args) ~= "table" then
    return fail("arguments must be a table")
  end
  if skill == "movement.step" then
    local ok, error_message = only_keys(args, { direction = true })
    if not ok or not directions[args.direction] then
      return fail(error_message or "movement.step.direction is invalid")
    end
  elseif skill == "navigate.path" then
    local ok, error_message = only_keys(args, { steps = true })
    if not ok then
      return fail(error_message)
    end
    if type(args.steps) ~= "table" or #args.steps < 1 or #args.steps > 1024 then
      return fail("navigate.path.steps must contain 1 to 1024 directions")
    end
    for _, direction in ipairs(args.steps) do
      if not directions[direction] then
        return fail("navigate.path has an invalid direction")
      end
    end
  elseif skill == "observation.block" then
    local ok, error_message = only_keys(args, { direction = true })
    if not ok or not relative_directions[args.direction] then
      return fail(error_message or "observation.block.direction is invalid")
    end
  elseif skill == "inventory.inspect" then
    local ok, error_message = only_keys(args, {})
    if not ok then
      return fail(error_message)
    end
  elseif skill == "inventory.deposit" then
    local ok, error_message = only_keys(args, { containerId = true, quantity = true, slot = true })
    if not ok then
      return fail(error_message)
    end
  elseif skill == "inventory.withdraw" then
    local ok, error_message = only_keys(args, { containerId = true, itemKey = true, quantity = true, slot = true })
    if not ok or not identifier(args.itemKey) or not integer(args.quantity) or args.quantity < 1 or args.quantity > 64 then
      return fail(error_message or "inventory.withdraw arguments are invalid")
    end
  elseif skill == "mining.excavate" then
    local ok, error_message = only_keys(args, { width = true, height = true, depth = true })
    if not ok then
      return fail(error_message)
    end
    for _, key in ipairs({ "width", "height", "depth" }) do
      if not integer(args[key]) or args[key] < 1 or args[key] > 64 then
        return fail("mining.excavate dimensions are invalid")
      end
    end
  elseif skill == "fuel.refuel" then
    local ok, error_message = only_keys(args, { maxItems = true })
    if not ok or not integer(args.maxItems) or args.maxItems < 1 or args.maxItems > 16 then
      return fail(error_message or "fuel.refuel.maxItems is invalid")
    end
  else
    return fail("unknown skill: " .. tostring(skill))
  end
  return true
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
  if type(command) ~= "table" or command.protocolVersion ~= M.VERSION then
    return fail("invalid or unsupported command protocol version")
  end
  for _, key in ipairs({ "commandId", "workerId", "issuedAt", "expiresAt" }) do
    if not non_empty(command[key]) then
      return fail("command." .. key .. " is required")
    end
  end
  if not skills[command.skill] then
    return fail("unknown skill: " .. tostring(command.skill))
  end
  if type(command.budget) ~= "table" or not integer(command.budget.maxPrimitives) or command.budget.maxPrimitives < 1 then
    return fail("command budget is invalid")
  end
  if not integer(command.budget.maxBlockChanges) or command.budget.maxBlockChanges < 0 then
    return fail("command block-change budget is invalid")
  end
  return arguments_valid(command.skill, command.arguments)
end

function M.validate_stop(message)
  if type(message) ~= "table" or message.protocolVersion ~= M.VERSION then
    return fail("invalid stop protocol version")
  end
  if type(message.control) ~= "table" or message.control.protocolVersion ~= M.VERSION then
    return fail("invalid stop control")
  end
  if message.type ~= "worker.stop" or not identifier(message.gatewayBootId) then
    return fail("invalid worker.stop envelope")
  end
  return true
end

function M.validate_update_message(message)
  if type(message) ~= "table" or message.protocolVersion ~= M.VERSION then return fail("invalid update message version") end
  if message.type ~= "worker.update.prepare" and message.type ~= "worker.update.file.begin"
    and message.type ~= "worker.update.file.chunk" and message.type ~= "worker.update.file.end"
    and message.type ~= "worker.update.activate" and message.type ~= "worker.update.abort" then
    return fail("unknown update message type")
  end
  for _, key in ipairs({ "gatewayBootId", "updateId", "releaseVersion", "workerId" }) do
    if not identifier(message[key]) then return fail("update." .. key .. " is invalid") end
  end
  if not release_version(message.releaseVersion) then return fail("update.releaseVersion is invalid") end
  if message.path ~= nil and not M.is_update_path(message.path) then return fail("update.path is invalid") end
  if message.type == "worker.update.file.chunk" then
    if not integer(message.chunkNumber) or message.chunkNumber < 0 then return fail("chunkNumber is invalid") end
    if not integer(message.totalChunks) or message.totalChunks < 1 then return fail("totalChunks is invalid") end
    if type(message.content) ~= "string" then return fail("chunk content is invalid") end
  end
  return true
end

function M.is_expired(timestamp)
  local clock = require("compat")
  if clock.now() then
    local expiry = clock.parse_time(timestamp)
    return not expiry or expiry <= clock.now()
  end
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
