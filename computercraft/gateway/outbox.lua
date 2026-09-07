local M = {}

local function copy_event(event)
  local result = {}
  for key, value in pairs(event) do
    result[key] = value
  end
  return result
end

function M.new(path, max_events, max_batch, logger)
  local outbox = {
    path = path,
    max_events = max_events,
    max_batch = max_batch,
    logger = logger,
    events = {},
  }

  function outbox:save()
    local temporary_path = self.path .. ".tmp"
    local handle = fs.open(temporary_path, "w")
    if not handle then
      return false, "cannot open outbox temporary file"
    end
    handle.write(textutils.serializeJSON(self.events))
    handle.close()
    if fs.exists(self.path) then
      fs.delete(self.path)
    end
    fs.move(temporary_path, self.path)
    return true
  end

  function outbox:load()
    if not fs.exists(self.path) then
      return true
    end
    local handle = fs.open(self.path, "r")
    if not handle then
      return false, "cannot open outbox file"
    end
    local contents = handle.readAll()
    handle.close()
    local ok, parsed = pcall(textutils.unserializeJSON, contents)
    if not ok or type(parsed) ~= "table" then
      return false, "outbox file is invalid JSON"
    end
    self.events = parsed
    return true
  end

  function outbox:add(event)
    if #self.events >= self.max_events then
      table.remove(self.events, 1)
      if self.logger then
        self.logger.warn("event outbox full; oldest event dropped")
      end
    end
    table.insert(self.events, copy_event(event))
    return self:save()
  end

  function outbox:batch()
    local result = {}
    local limit = math.min(#self.events, self.max_batch)
    for index = 1, limit do
      table.insert(result, self.events[index])
    end
    return result
  end

  function outbox:acknowledge(event_ids)
    local accepted = {}
    for _, event_id in ipairs(event_ids or {}) do
      accepted[event_id] = true
    end
    local remaining = {}
    for _, event in ipairs(self.events) do
      if not accepted[event.eventId] then
        table.insert(remaining, event)
      end
    end
    self.events = remaining
    return self:save()
  end

  function outbox:size()
    return #self.events
  end

  local loaded, load_error = outbox:load()
  if not loaded and logger then
    logger.warn(load_error .. "; starting with an empty outbox")
  end
  return outbox
end

return M
