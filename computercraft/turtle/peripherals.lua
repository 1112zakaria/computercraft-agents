local M = {}

local SIDES = { "top", "bottom", "front", "back", "left", "right" }

local function copy_methods(value)
  local methods = {}
  if type(value) ~= "table" then return methods end
  for _, method in ipairs(value) do
    if type(method) == "string" and string.len(method) > 0 and string.len(method) <= 128 then
      methods[#methods + 1] = method
    end
    if #methods >= 256 then break end
  end
  table.sort(methods)
  return methods
end

local function primary_type(api, side)
  local ok, first = pcall(api.getType, side)
  if not ok or type(first) ~= "string" or string.len(first) == 0 then
    return "unknown"
  end
  return first
end

function M.new(api, cancellation)
  local peripherals = {
    api = api or peripheral,
    cancellation = cancellation,
  }

  function peripherals:inspect_side(side)
    local allowed, reason = self.cancellation:check()
    if not allowed then
      return nil, reason == "CANCELLED" and "CANCELLED" or "BUDGET_EXHAUSTED"
    end
    local present_ok, present = pcall(self.api.isPresent, side)
    self.cancellation:record(1, 0)
    if not present_ok or not present then return nil end

    local methods_ok, methods = pcall(self.api.getMethods, side)
    return {
      side = side,
      type = primary_type(self.api, side),
      methods = methods_ok and copy_methods(methods) or {},
    }
  end

  function peripherals:inspect(side)
    local sides = side and { side } or SIDES
    local found = {}
    for _, candidate in ipairs(sides) do
      local entry, error_status = self:inspect_side(candidate)
      if error_status then return { status = error_status } end
      if entry then found[#found + 1] = entry end
    end
    return { status = "OK", peripherals = found, count = #found }
  end

  return peripherals
end

return M
