local M = {}

local function fail(message)
  error("gateway configuration: " .. message, 0)
end

local function required_string(config, key)
  local value = config[key]
  if type(value) ~= "string" or string.len(value) == 0 then
    fail(key .. " must be a non-empty string")
  end
  return value
end

local function positive_number(config, key, default)
  local value = config[key]
  if value == nil then
    value = default
  end
  if type(value) ~= "number" or value <= 0 then
    fail(key .. " must be a positive number")
  end
  return value
end

local function non_negative_number(config, key, default)
  local value = config[key]
  if value == nil then
    value = default
  end
  if type(value) ~= "number" or value < 0 then
    fail(key .. " must be a non-negative number")
  end
  return value
end

local function runtime_version(config, configured, path)
  if fs.exists(path) then
    local handle = fs.open(path, "r")
    if handle then
      local value = handle.readAll()
      handle.close()
      if type(value) == "string" and string.len(value) > 0 then return value end
    end
  end
  return required_string(config, configured)
end

function M.load(path)
  local config_path = path or "gateway.conf"
  if not fs.exists(config_path) then
    fail("missing " .. config_path .. "; copy gateway.conf.example and configure it locally")
  end

  local chunk, load_error = loadfile(config_path)
  if not chunk then
    fail("cannot load " .. config_path .. ": " .. tostring(load_error))
  end

  local ok, value = pcall(chunk)
  if not ok or type(value) ~= "table" then
    fail("" .. config_path .. " must return a table")
  end

  local result = {}
  result.gateway_id = required_string(value, "gateway_id")
  result.minecraft_server_id = required_string(value, "minecraft_server_id")
  result.vps_url = required_string(value, "vps_url")
  result.gateway_bearer_secret = required_string(value, "gateway_bearer_secret")
  result.rednet_protocol = required_string(value, "rednet_protocol")
  result.runtime_version_path = value.runtime_version_path or "gateway-runtime-version.txt"
  result.worker_runtime_version = runtime_version(value, "worker_runtime_version", result.runtime_version_path)
  result.modem_side = value.modem_side or "back"
  result.capabilities = value.capabilities or {}
  result.register_path = value.register_path or "/v1/gateway/register"
  result.heartbeat_path = value.heartbeat_path or "/v1/gateway/heartbeat"
  result.commands_path = value.commands_path or "/v1/gateway/commands"
  result.events_path = value.events_path or "/v1/gateway/events"
  result.outbox_path = value.outbox_path or "gateway-outbox.json"
  result.update_journal_path = value.update_journal_path or "gateway-update-journal.json"
  result.update_staging_path = value.update_staging_path or "gateway-update-staging"
  result.update_backup_path = value.update_backup_path or "gateway-update-backup"
  result.update_chunk_size = positive_number(value, "update_chunk_size", 768)
  result.update_ack_timeout_seconds = positive_number(value, "update_ack_timeout_seconds", 5)
  result.poll_interval_seconds = positive_number(value, "poll_interval_seconds", 2)
  result.heartbeat_interval_seconds = positive_number(value, "heartbeat_interval_seconds", 10)
  result.http_retry_max_seconds = positive_number(value, "http_retry_max_seconds", 60)
  result.max_outbox_events = positive_number(value, "max_outbox_events", 256)
  result.max_event_batch = positive_number(value, "max_event_batch", 32)
  result.worker_timeout_seconds = positive_number(value, "worker_timeout_seconds", 30)
  result.rednet_receive_timeout_seconds = non_negative_number(value, "rednet_receive_timeout_seconds", 1)

  if string.sub(result.vps_url, -1) == "/" then
    result.vps_url = string.sub(result.vps_url, 1, string.len(result.vps_url) - 1)
  end

  return result
end

return M
