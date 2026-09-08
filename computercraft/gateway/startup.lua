-- ComputerCraft 1.75 does not provide Lua's package/require loader.
-- Define the small loader needed by this runtime before loading modules.
if type(require) ~= "function" then
  function require(name)
    local chunk, load_error = loadfile(name .. ".lua")
    if not chunk then
      error(load_error, 0)
    end
    return chunk()
  end
end

local config_loader = require("config")
local bootstrap = require("update_bootstrap")
local gateway = require("gateway")
local logging = require("logging")

local ok, config_or_error = pcall(config_loader.load, "gateway.conf")
if not ok then
  logging.error(config_or_error)
  return
end

local recovered, recovery_error, pending_update, did_rollback = bootstrap.recover(config_or_error.update_journal_path)
if not recovered then
  logging.error(recovery_error)
  return
end
config_or_error.recovered_update = did_rollback and pending_update or nil
config_or_error.pending_update = pending_update

local run_ok, run_error = pcall(gateway.run, config_or_error)
if not run_ok then
  logging.error("gateway stopped: " .. tostring(run_error))
  if config_or_error.pending_update then
    local rollback_ok = bootstrap.recover(config_or_error.update_journal_path)
    if rollback_ok then os.reboot() end
  end
end
