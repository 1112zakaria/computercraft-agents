-- ComputerCraft 1.75 does not provide Lua's package/require loader.
-- Define the small loader needed by this runtime before loading modules.
if type(require) ~= "function" then
  local modules = {}
  function require(name)
    if modules[name] ~= nil then return modules[name] end
    local chunk, load_error = loadfile(name .. ".lua")
    if not chunk then
      error(load_error, 0)
    end
    modules[name] = chunk()
    return modules[name]
  end
end

require("compat").install()
local config_loader = require("config")
local bootstrap = require("update_bootstrap")
local logging = require("logging")
local ok, config_or_error = pcall(config_loader.load, "worker.conf")
if not ok then
  logging.error(config_or_error)
  return
end
local config = config_or_error
local recovered, recovery_error, pending_update, did_rollback = bootstrap.recover(config.update_journal_path)
if not recovered then
  logging.error(recovery_error)
  return
end

local runtime_ok, runtime_error = pcall(function()
local id = require("id")
local protocol = require("protocol")
local state_module = require("state")
local cancellation_module = require("cancellation")
local movement_module = require("movement")
local observation_module = require("observation")
local inventory_module = require("inventory")
local fuel_module = require("fuel")
local excavation_module = require("excavation")
local cache_module = require("idempotency")
local client_module
if config.transport == "direct-http" then
  client_module = require("direct_http_client")
else
  client_module = require("rednet_client")
end
local executor_module = require("executor")
local state = state_module.new(config.state_path, id)
local cancellation
local client
local function poll_control()
  if client and cancellation then
    client:poll_control(cancellation)
    client:maybe_heartbeat()
  end
end

cancellation = cancellation_module.new(poll_control)
local movement = movement_module.new(state, cancellation, turtle)
local observation = observation_module.new(turtle, cancellation)
local inventory = inventory_module.new(turtle, config, cancellation)
local fuel = fuel_module.new(turtle, config, cancellation)
local excavation = excavation_module.new(movement, observation, inventory)
client = client_module.new(config, state, inventory, fuel, protocol, logging)
local cache = cache_module.new(config.idempotency_path, config.max_cached_commands, logging)
local executor = executor_module.new(config, client, state, cancellation, movement, observation, inventory, fuel, cache, protocol, id, logging, excavation)
local update_manager = require("update_manager").new(config, client, protocol, id, logging, bootstrap)

local connected = false
while not connected do
  local registered, registration_error = client:register()
  if registered then
    connected = true
  else
    logging.warn("registration failed; retrying")
    sleep(2)
  end
end

logging.info("worker " .. config.worker_id .. " registered with boot id " .. state.boot_id)
client:heartbeat()
bootstrap.confirm(config.update_journal_path, nil)
if did_rollback and pending_update then
  client:send_event({
    protocolVersion = 1,
    eventId = id.new("evt"),
    workerId = config.worker_id,
    sequence = state:next_sequence(),
    type = "worker.update.rolled_back",
    occurredAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    payload = {
      updateId = pending_update.updateId,
      releaseVersion = pending_update.releaseVersion,
      message = "bootstrap restored the previous runtime",
    },
  })
end

while true do
  client:maybe_heartbeat()
  local sender_id, message = client:receive(config.receive_timeout_seconds)
  if sender_id and message and client:is_sender(sender_id) then
    if config.transport == "direct-http" and message.transport == "direct-http" then
      update_manager:process_direct(message)
    elseif string.find(message.type or "", "^worker%.update%.") then
      update_manager:handle(message)
    elseif message.type == "worker.command" then
      if message.gatewayBootId == client.gateway_boot_id then
        executor:execute(message.command)
      else
        logging.warn("ignored command from stale gateway boot")
      end
    elseif message.type == "worker.stop" then
      if message.gatewayBootId == client.gateway_boot_id then
        local valid, validation_error = protocol.validate_stop(message)
        if valid then
          cancellation:request_stop(message.control.reason or "operator stop")
        else
          logging.warn(validation_error)
        end
      end
    elseif message.type == "worker.protocol.error" then
      logging.warn("gateway rejected a message")
    end
  end
end
end)

if not runtime_ok then
  logging.error("turtle runtime stopped: " .. tostring(runtime_error))
  if pending_update then
    local rollback_ok = bootstrap.recover(config.update_journal_path)
    if rollback_ok then os.reboot() end
  end
end
