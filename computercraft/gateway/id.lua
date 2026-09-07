local M = {}

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
  math.randomseed(os.time() + os.getComputerID())
  return tostring(prefix) .. "-" .. tostring(os.time()) .. "-" .. random_token(8)
end

return M
