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
local gateway = require("gateway")
local logging = require("logging")

local ok, config_or_error = pcall(config_loader.load, "gateway.conf")
if not ok then
  logging.error(config_or_error)
  return
end

local run_ok, run_error = pcall(gateway.run, config_or_error)
if not run_ok then
  logging.error("gateway stopped: " .. tostring(run_error))
end
