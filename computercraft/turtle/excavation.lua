local M = {}

function M.new(movement, observation)
  local excavation = {
    movement = movement,
    observation = observation,
  }

  function excavation:tunnel(depth)
    local dug_blocks = 0
    local moved_blocks = 0
    for step = 1, depth do
      local inspected = self.observation:inspect("front")
      if inspected.status ~= "OK" then
        return inspected
      end

      if inspected.block then
        local dug = self.observation:dig("front")
        if dug.status ~= "OK" and dug.status ~= "NOTHING_TO_DIG" then
          return dug
        end
        if dug.status == "OK" then
          dug_blocks = dug_blocks + 1
        end
      end

      if step < depth then
        local moved = self.movement:move("FORWARD")
        if moved.status ~= "OK" then
          moved.dugBlocks = dug_blocks
          moved.movedBlocks = moved_blocks
          return moved
        end
        moved_blocks = moved_blocks + 1
      end
    end
    return {
      status = "OK",
      dugBlocks = dug_blocks,
      movedBlocks = moved_blocks,
      depth = depth,
    }
  end

  function excavation:run(width, height, depth)
    -- The first safe implementation is a one-block-wide, one-block-high tunnel.
    -- Reject other shapes instead of pretending to support an untested turning pattern.
    if width ~= 1 or height ~= 1 then
      return {
        status = "UNSUPPORTED_PATTERN",
        error = "only a one-block-wide, one-block-high tunnel is supported",
      }
    end
    return self:tunnel(depth)
  end

  return excavation
end

return M
