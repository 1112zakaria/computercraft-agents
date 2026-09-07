local M = {}

local function normalize_block(value)
  if type(value) ~= "table" then
    return nil
  end
  return {
    name = value.name or "unknown",
    metadata = value.metadata or value.damage,
  }
end

function M.new(api, cancellation)
  local observation = {
    api = api or turtle,
    cancellation = cancellation,
  }

  function observation:inspect(direction)
    local allowed, reason = self.cancellation:check()
    if not allowed then
      return { status = reason == "CANCELLED" and "CANCELLED" or "BUDGET_EXHAUSTED" }
    end
    local inspect = self.api.inspect
    if direction == "up" then
      inspect = self.api.inspectUp
    elseif direction == "down" then
      inspect = self.api.inspectDown
    end
    local ok, found, block = pcall(inspect)
    self.cancellation:record(1, 0)
    if not ok then
      return { status = "ERROR", error = tostring(found) }
    end
    if not found then
      return { status = "OK", block = nil, direction = direction }
    end
    return { status = "OK", block = normalize_block(block), direction = direction }
  end

  function observation:dig(direction)
    local allowed, reason = self.cancellation:check()
    if not allowed then
      return { status = reason == "CANCELLED" and "CANCELLED" or "BUDGET_EXHAUSTED" }
    end
    local can_change, change_reason = self.cancellation:can_spend(1, 1)
    if not can_change then
      return { status = "BUDGET_EXHAUSTED", error = change_reason }
    end
    local dig = self.api.dig
    if direction == "up" then
      dig = self.api.digUp
    elseif direction == "down" then
      dig = self.api.digDown
    end
    local ok, dug = pcall(dig)
    self.cancellation:record(1, ok and dug and 1 or 0)
    if not ok then
      return { status = "ERROR", error = tostring(dug) }
    end
    if not dug then
      return { status = "NOTHING_TO_DIG", direction = direction }
    end
    return { status = "OK", direction = direction, blockChange = true }
  end

  function observation:place(direction)
    local allowed, reason = self.cancellation:check()
    if not allowed then
      return { status = reason == "CANCELLED" and "CANCELLED" or "BUDGET_EXHAUSTED" }
    end
    local can_change, change_reason = self.cancellation:can_spend(1, 1)
    if not can_change then
      return { status = "BUDGET_EXHAUSTED", error = change_reason }
    end
    local place = self.api.place
    if direction == "up" then
      place = self.api.placeUp
    elseif direction == "down" then
      place = self.api.placeDown
    end
    local ok, placed = pcall(place)
    self.cancellation:record(1, ok and placed and 1 or 0)
    if not ok then
      return { status = "ERROR", error = tostring(placed) }
    end
    if not placed then
      return { status = "ERROR", error = "place failed", direction = direction }
    end
    return { status = "OK", direction = direction, blockChange = true }
  end

  return observation
end

return M
