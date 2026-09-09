local M = {}

local function normalize_item_key(item_key)
  if string.find(item_key, ":", 1, true) then
    return item_key
  end
  return "minecraft:" .. string.lower(item_key)
end

function M.new(movement, observation, inventory)
  local excavation = {
    movement = movement,
    observation = observation,
    inventory = inventory,
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

  function excavation:gather(item_key, quantity, max_depth)
    item_key = normalize_item_key(item_key)
    local initial_count = self.inventory:count(item_key)
    if initial_count >= quantity then
      return {
        status = "OK",
        itemKey = item_key,
        quantity = quantity,
        collected = initial_count,
        depth = 0,
      }
    end

    local inspected_depth = 0
    for step = 1, max_depth do
      local inspected = self.observation:inspect("front")
      if inspected.status ~= "OK" then
        return inspected
      end
      inspected_depth = step

      if inspected.block then
        local dug = self.observation:dig("front")
        if dug.status ~= "OK" and dug.status ~= "NOTHING_TO_DIG" then
          dug.itemKey = item_key
          dug.depth = inspected_depth
          return dug
        end
      end

      local collected = self.inventory:count(item_key)
      if collected >= quantity then
        return {
          status = "OK",
          itemKey = item_key,
          quantity = quantity,
          collected = collected,
          depth = inspected_depth,
        }
      end

      if step < max_depth then
        local moved = self.movement:move("FORWARD")
        if moved.status ~= "OK" then
          moved.itemKey = item_key
          moved.collected = collected
          moved.depth = inspected_depth
          return moved
        end
      end
    end

    return {
      status = "TARGET_NOT_REACHED",
      itemKey = item_key,
      quantity = quantity,
      collected = self.inventory:count(item_key),
      depth = inspected_depth,
      error = "target quantity was not reached within maxDepth",
    }
  end

  return excavation
end

return M
