local M = {}
local counter = 0
math.randomseed(math.floor(os.time() * 1000 + os.clock() * 1000 + os.getComputerID()))

local function random_token(length)
  local alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  local result = ""
  for _ = 1, length do
    local index = math.random(1, string.len(alphabet))
    result = result .. string.sub(alphabet, index, index)
  end
  return result
end

function M.new(prefix)
  counter = counter + 1
  return tostring(prefix) .. "-" .. tostring(os.time()) .. "-" .. random_token(8) .. "-" .. counter
end

return M
