local M = {}
local compat = assert(loadfile("compat.lua"))()

local headings = { "N", "E", "S", "W" }
local deltas = {
  N = { x = 0, z = -1 },
  E = { x = 1, z = 0 },
  S = { x = 0, z = 1 },
  W = { x = -1, z = 0 },
}

local function valid_state(value)
  return type(value) == "table"
    and type(value.x) == "number"
    and type(value.y) == "number"
    and type(value.z) == "number"
    and deltas[value.facing] ~= nil
end

function M.new(path, id)
  local state = {
    path = path,
    x = 0,
    y = 0,
    z = 0,
    dimension = 0,
    facing = "N",
    confidence = "UNCERTAIN",
    last_anchor_at = nil,
    sequence = 0,
    boot_id = id.new("turtle"),
  }

  function state:save()
    local temporary_path = self.path .. ".tmp"
    local handle = fs.open(temporary_path, "w")
    if not handle then
      return false, "cannot open state temporary file"
    end
    local encoded, encode_error = compat.encode_json({
      x = self.x,
      y = self.y,
      z = self.z,
      dimension = self.dimension,
      facing = self.facing,
      confidence = self.confidence,
      last_anchor_at = self.last_anchor_at,
      sequence = self.sequence,
    })
    if not encoded then
      handle.close()
      if fs.exists(temporary_path) then fs.delete(temporary_path) end
      return false, encode_error
    end
    handle.write(encoded)
    handle.close()
    if fs.exists(self.path) then
      fs.delete(self.path)
    end
    fs.move(temporary_path, self.path)
    return true
  end

  function state:load()
    if not fs.exists(self.path) then
      return true
    end
    local handle = fs.open(self.path, "r")
    if not handle then
      return false, "cannot open state file"
    end
    local contents = handle.readAll()
    handle.close()
    local ok, value = pcall(textutils.unserializeJSON, contents)
    if not ok or not valid_state(value) then
      self.confidence = "UNCERTAIN"
      return false, "state file is invalid; starting uncertain"
    end
    for _, key in ipairs({ "x", "y", "z", "dimension", "facing", "confidence", "last_anchor_at", "sequence" }) do
      if value[key] ~= nil then
        self[key] = value[key]
      end
    end
    return true
  end

  function state:position()
    return {
      dimension = self.dimension,
      x = self.x,
      y = self.y,
      z = self.z,
      facing = self.facing,
      confidence = self.confidence,
    }
  end

  function state:next_sequence()
    self.sequence = self.sequence + 1
    self:save()
    return self.sequence
  end

  function state:turn_left()
    local index = 1
    for position, heading in ipairs(headings) do
      if heading == self.facing then
        index = position
      end
    end
    index = index - 1
    if index < 1 then
      index = #headings
    end
    self.facing = headings[index]
    self:save()
  end

  function state:turn_right()
    local index = 1
    for position, heading in ipairs(headings) do
      if heading == self.facing then
        index = position
      end
    end
    index = index + 1
    if index > #headings then
      index = 1
    end
    self.facing = headings[index]
    self:save()
  end

  function state:move_forward()
    local delta = deltas[self.facing]
    self.x = self.x + delta.x
    self.z = self.z + delta.z
    self:save()
  end

  function state:move_vertical(amount)
    self.y = self.y + amount
    self:save()
  end

  function state:mark_position_uncertain()
    self.confidence = "UNCERTAIN"
    self:save()
  end

  function state:anchor(position)
    if type(position) ~= "table" or type(position.x) ~= "number" or type(position.y) ~= "number" or type(position.z) ~= "number" then
      return false, "anchor position is invalid"
    end
    if not deltas[position.facing] then
      return false, "anchor facing is invalid"
    end
    self.x = position.x
    self.y = position.y
    self.z = position.z
    self.dimension = position.dimension or self.dimension
    self.facing = position.facing
    self.confidence = "CONFIRMED"
    self.last_anchor_at = os.date("!%Y-%m-%dT%H:%M:%SZ")
    self:save()
    return true
  end

  state:load()
  state:save()
  return state
end

return M
