local M = {}
local compat = assert(loadfile("compat.lua"))()

function M.new(path, limit, logger)
  local cache = {
    path = path,
    limit = limit,
    logger = logger,
    entries = {},
  }

  function cache:save()
    local temporary_path = self.path .. ".tmp"
    local handle = fs.open(temporary_path, "w")
    if not handle then
      return false, "cannot open command cache temporary file"
    end
    local encoded, encode_error = compat.encode_json(self.entries)
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

  function cache:load()
    if not fs.exists(self.path) then
      return true
    end
    local handle = fs.open(self.path, "r")
    if not handle then
      return false, "cannot open command cache"
    end
    local contents = handle.readAll()
    handle.close()
    local ok, value = pcall(textutils.unserializeJSON, contents)
    if not ok or type(value) ~= "table" then
      return false, "command cache is invalid JSON"
    end
    self.entries = value
    return true
  end

  function cache:get(command_id)
    for index, entry in ipairs(self.entries) do
      if entry.commandId == command_id then
        return entry, index
      end
    end
    return nil
  end

  function cache:put(command_id, result, event_type, payload)
    local _, existing_index = self:get(command_id)
    if existing_index then
      table.remove(self.entries, existing_index)
    end
    table.insert(self.entries, {
      commandId = command_id,
      result = result,
      eventType = event_type,
      payload = payload,
    })
    while #self.entries > self.limit do
      table.remove(self.entries, 1)
    end
    return self:save()
  end

  local loaded, load_error = cache:load()
  if not loaded and logger then
    logger.warn(load_error .. "; starting with an empty command cache")
  end
  return cache
end

return M
