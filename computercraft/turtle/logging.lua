local M = {}

local function write(level, message)
  print("[agents-turtle][" .. level .. "] " .. tostring(message))
end

function M.info(message)
  write("INFO", message)
end

function M.warn(message)
  write("WARN", message)
end

function M.error(message)
  write("ERROR", message)
end

return M
