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
