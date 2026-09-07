local M = {}

local heading_index = { N = 1, E = 2, S = 3, W = 4 }

local function result(status, extra)
  local value = { status = status }
  for key, item in pairs(extra or {}) do
    value[key] = item
  end
  return value
end

function M.new(state, cancellation, api)
  local movement = {
    state = state,
    cancellation = cancellation,
    api = api or turtle,
  }

  function movement:turn_left()
    local allowed, reason = self.cancellation:check()
    if not allowed then
      return result(reason == "CANCELLED" and "CANCELLED" or "BUDGET_EXHAUSTED")
    end
    if not self.api.turnLeft() then
      return result("ERROR", { error = "turnLeft failed" })
    end
    self.cancellation:record(1, 0)
    self.state:turn_left()
    return result("OK", { position = self.state:position() })
  end

  function movement:turn_right()
    local allowed, reason = self.cancellation:check()
    if not allowed then
      return result(reason == "CANCELLED" and "CANCELLED" or "BUDGET_EXHAUSTED")
    end
    if not self.api.turnRight() then
      return result("ERROR", { error = "turnRight failed" })
    end
    self.cancellation:record(1, 0)
    self.state:turn_right()
    return result("OK", { position = self.state:position() })
  end

  function movement:face(direction)
    if not heading_index[direction] then
      return result("ERROR", { error = "invalid cardinal direction" })
    end
    local current = heading_index[self.state.facing]
    local target = heading_index[direction]
    local right_turns = (target - current) % 4
    local left_turns = (current - target) % 4
    local turn_right = right_turns <= left_turns
    local turns = turn_right and right_turns or left_turns
    for _ = 1, turns do
      local turn_result = turn_right and self:turn_right() or self:turn_left()
      if turn_result.status ~= "OK" then
        return turn_result
      end
    end
    return result("OK", { position = self.state:position() })
  end

  function movement:move(direction)
    local face_result
    if heading_index[direction] then
      face_result = self:face(direction)
      if face_result.status ~= "OK" then
        return face_result
      end
    end

    local allowed, reason = self.cancellation:check()
    if not allowed then
      return result(reason == "CANCELLED" and "CANCELLED" or "BUDGET_EXHAUSTED")
    end

    local fuel_level = self.api.getFuelLevel and self.api.getFuelLevel() or "unlimited"
    if type(fuel_level) == "number" and fuel_level <= 0 then
      return result("NO_FUEL", { position = self.state:position() })
    end

    local moved = false
    if direction == "UP" then
      moved = self.api.up()
    elseif direction == "DOWN" then
      moved = self.api.down()
    else
      moved = self.api.forward()
    end

    self.cancellation:record(1, 0)
    if not moved then
      return result("BLOCKED", { direction = direction, position = self.state:position() })
    end
    if direction == "UP" then
      self.state:move_vertical(1)
    elseif direction == "DOWN" then
      self.state:move_vertical(-1)
    else
      self.state:move_forward()
    end
    return result("OK", { position = self.state:position() })
  end

  function movement:path(steps)
    local last_result = result("OK", { position = self.state:position() })
    for _, direction in ipairs(steps) do
      last_result = self:move(direction)
      if last_result.status ~= "OK" then
        return last_result
      end
    end
    return last_result
  end

  return movement
end

return M
