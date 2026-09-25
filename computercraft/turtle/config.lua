local M = {}

local function fail(message)
  error("turtle configuration: " .. message, 0)
end

local function required_string(config, key)
  local value = config[key]
  if type(value) ~= "string" or string.len(value) == 0 then
    fail(key .. " must be a non-empty string")
  end
  return value
end

local function container_side(value, key)
  if value ~= "front" and value ~= "up" and value ~= "down" then
    fail(key .. " must be front, up, or down")
  end
  return value
end

local function configured_container_sides(value)
  if value == nil then return {} end
  if type(value) ~= "table" then fail("container_sides must be a table") end
  local result = {}
  for id, side in pairs(value) do
    if type(id) ~= "string" or string.len(id) == 0 then
      fail("container_sides keys must be non-empty strings")
    end
    result[id] = container_side(side, "container_sides[" .. id .. "]")
  end
  return result
end

local function configured_runtime_version(config, path)
  if fs.exists(path) then
    local handle = fs.open(path, "r")
    if handle then
      local value = handle.readAll()
      handle.close()
      if type(value) == "string" and string.len(value) > 0 then return value end
    end
  end
  return required_string(config, "runtime_version")
end

function M.load(path)
  local config_path = path or "worker.conf"
  if not fs.exists(config_path) then
    fail("missing " .. config_path .. "; copy worker.conf.example and configure it locally")
  end

  local chunk, load_error = loadfile(config_path)
  if not chunk then
    fail("cannot load " .. config_path .. ": " .. tostring(load_error))
  end
  local ok, value = pcall(chunk)
  if not ok or type(value) ~= "table" then
    fail(config_path .. " must return a table")
  end

  local result = {}
  result.worker_id = required_string(value, "worker_id")
  result.transport = value.transport or "gateway-rednet"
  if result.transport ~= "gateway-rednet" and result.transport ~= "direct-http" then
    fail("transport must be gateway-rednet or direct-http")
  end
  if result.transport == "gateway-rednet" then
    result.modem_side = value.modem_side or "back"
    result.gateway_rednet_id = value.gateway_rednet_id
    if type(result.gateway_rednet_id) ~= "number" or result.gateway_rednet_id < 0 then
      fail("gateway_rednet_id must be a non-negative computer id")
    end
    result.rednet_protocol = required_string(value, "rednet_protocol")
  else
    result.vps_url = required_string(value, "vps_url")
    result.vps_bearer_secret = required_string(value, "vps_bearer_secret")
    result.minecraft_server_id = required_string(value, "minecraft_server_id")
  end
  result.runtime_version_path = value.runtime_version_path or "worker-runtime-version.txt"
  result.runtime_version = configured_runtime_version(value, result.runtime_version_path)
  result.state_path = value.state_path or "worker-state.json"
  result.idempotency_path = value.idempotency_path or "worker-command-cache.json"
  result.update_journal_path = value.update_journal_path or "worker-update-journal.json"
  result.update_staging_path = value.update_staging_path or "worker-update-staging"
  result.update_backup_path = value.update_backup_path or "worker-update-backup"
  result.poll_cursor_path = value.poll_cursor_path or "worker-poll-cursor.json"
  result.event_outbox_path = value.event_outbox_path or "worker-event-outbox.json"
  result.update_chunk_size = value.update_chunk_size or 768
  result.max_cached_commands = value.max_cached_commands or 64
  result.max_outbox_events = value.max_outbox_events or 256
  result.max_event_batch = value.max_event_batch or 32
  result.poll_interval_seconds = value.poll_interval_seconds or 2
  result.heartbeat_interval_seconds = value.heartbeat_interval_seconds or 10
  result.receive_timeout_seconds = value.receive_timeout_seconds or 1
  result.fuel_low_threshold = value.fuel_low_threshold or 100
  result.container_side = container_side(value.container_side or "front", "container_side")
  result.container_sides = configured_container_sides(value.container_sides)
  result.capabilities = value.capabilities or {
    "movement.step",
    "navigate.path",
    "observation.block",
    "peripheral.inspect",
    "inventory.inspect",
    "inventory.deposit",
    "inventory.withdraw",
    "mining.excavate",
    "mining.gather",
    "fuel.refuel",
  }
  result.acceptable_fuel_items = value.acceptable_fuel_items or {}
  result.reserved_slots = value.reserved_slots or {}
  return result
end

return M
