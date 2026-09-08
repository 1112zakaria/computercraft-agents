-- Gateway-managed turtle update receiver. The stable bootstrap and configuration files are
-- deliberately outside the managed runtime file set.
local M = {}

local prefix = "computercraft/turtle/"

local function now_iso()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function relative_path(path)
  return string.sub(path, string.len(prefix) + 1)
end

local function copy_file(source, destination)
  local parent = fs.getDir(destination)
  if parent and parent ~= "" and not fs.exists(parent) then fs.makeDir(parent) end
  if fs.exists(destination) then fs.delete(destination) end
  fs.copy(source, destination)
end

function M.new(config, client, protocol, id, logger, bootstrap)
  local manager = {
    config = config,
    client = client,
    protocol = protocol,
    id = id,
    logger = logger,
    bootstrap = bootstrap,
    current = nil,
  }

  function manager:send_ack(update, phase, path, chunk_number, error_message)
    return self.client:send({
      protocolVersion = 1,
      type = "worker.update.ack",
      gatewayBootId = update.gatewayBootId,
      updateId = update.updateId,
      workerId = self.config.worker_id,
      phase = phase,
      path = path,
      chunkNumber = chunk_number,
      error = error_message,
    })
  end

  function manager:event(update, event_type, message)
    return self.client:send_event({
      protocolVersion = 1,
      eventId = self.id.new("evt"),
      workerId = self.config.worker_id,
      sequence = self.client.state:next_sequence(),
      type = event_type,
      occurredAt = now_iso(),
      payload = {
        updateId = update.updateId,
        releaseVersion = update.releaseVersion,
        message = message,
      },
    })
  end

  function manager:fail(update, message)
    self.logger.warn("update failed: " .. tostring(message))
    self:send_ack(update, "FAILED", nil, nil, message)
    self:event(update, "worker.update.failed", message)
    if self.current and self.current.stage then
      if fs.exists(self.current.stage) then fs.delete(self.current.stage) end
    end
    self.current = nil
    return false, message
  end

  function manager:prepare(message)
    local valid, validation_error = self.protocol.validate_update_message(message)
    if not valid then return false, validation_error end
    if message.workerId ~= self.config.worker_id then return false, "update worker does not match this turtle" end
    if message.gatewayBootId ~= self.client.gateway_boot_id then return false, "stale gateway boot id" end
    if self.client.execution_state ~= "IDLE" then
      return self:fail(message, "worker is not idle")
    end
    if fs.exists(self.config.update_staging_path) then fs.delete(self.config.update_staging_path) end
    fs.makeDir(self.config.update_staging_path)
    self.current = {
      updateId = message.updateId,
      releaseVersion = message.releaseVersion,
      gatewayBootId = message.gatewayBootId,
      stage = self.config.update_staging_path,
      files = {},
    }
    self:event(message, "worker.update.started")
    return self:send_ack(message, "PREPARED")
  end

  function manager:begin_file(message)
    local valid, validation_error = self.protocol.validate_update_message(message)
    if not valid then self.logger.warn(validation_error); return false, validation_error end
    if not self.current or self.current.updateId ~= message.updateId then return false, "unknown update" end
    if self.current.gatewayBootId ~= message.gatewayBootId or self.current.releaseVersion ~= message.releaseVersion then
      return self:fail(message, "stale or mismatched update identity")
    end
    local relative = relative_path(message.path)
    local staged = fs.combine(self.current.stage, relative)
    local parent = fs.getDir(staged)
    if parent and parent ~= "" and not fs.exists(parent) then fs.makeDir(parent) end
    self.current.files[message.path] = { relative = relative, totalChunks = message.totalChunks }
    return true
  end

  function manager:chunk(message)
    local valid, validation_error = self.protocol.validate_update_message(message)
    if not valid then self.logger.warn(validation_error); return false, validation_error end
    local file = self.current and self.current.files[message.path]
    if not file or file.totalChunks ~= message.totalChunks then return self:fail(message, "unknown update file") end
    if self.current.gatewayBootId ~= message.gatewayBootId or self.current.releaseVersion ~= message.releaseVersion then
      return self:fail(message, "stale or mismatched update identity")
    end
    local chunk_path = fs.combine(self.current.stage, file.relative .. ".chunk." .. tostring(message.chunkNumber))
    if not fs.exists(chunk_path) then
      local handle = fs.open(chunk_path, "w")
      if not handle then return self:fail(message, "cannot stage update chunk") end
      handle.write(message.content)
      handle.close()
    end
    return self:send_ack(message, "FILE_RECEIVED", message.path, message.chunkNumber)
  end

  function manager:end_file(message)
    local valid, validation_error = self.protocol.validate_update_message(message)
    if not valid then self.logger.warn(validation_error); return false, validation_error end
    local file = self.current and self.current.files[message.path]
    if not file or file.totalChunks ~= message.totalChunks then return self:fail(message, "unknown update file") end
    if self.current.gatewayBootId ~= message.gatewayBootId or self.current.releaseVersion ~= message.releaseVersion then
      return self:fail(message, "stale or mismatched update identity")
    end
    local staged = fs.combine(self.current.stage, file.relative)
    local handle = fs.open(staged, "w")
    if not handle then return self:fail(message, "cannot assemble update file") end
    for chunk_number = 0, file.totalChunks - 1 do
      local chunk_path = staged .. ".chunk." .. tostring(chunk_number)
      if not fs.exists(chunk_path) then
        handle.close()
        return self:fail(message, "missing update chunk")
      end
      local chunk = fs.open(chunk_path, "r")
      if not chunk then handle.close(); return self:fail(message, "cannot read update chunk") end
      handle.write(chunk.readAll())
      chunk.close()
      fs.delete(chunk_path)
    end
    handle.close()
    return self:send_ack(message, "FILE_RECEIVED", message.path)
  end

  function manager:activate(message)
    local valid, validation_error = self.protocol.validate_update_message(message)
    if not valid then self.logger.warn(validation_error); return false, validation_error end
    if not self.current or self.current.updateId ~= message.updateId then return false, "unknown update" end
    if self.current.gatewayBootId ~= message.gatewayBootId or self.current.releaseVersion ~= message.releaseVersion then
      return self:fail(message, "stale or mismatched update identity")
    end
    local files = {}
    for path, file in pairs(self.current.files) do
      table.insert(files, file.relative)
      local source = fs.combine(self.current.stage, file.relative)
      if not fs.exists(source) then return self:fail(message, "staged file is missing") end
    end
    local journal = {
      updateId = message.updateId,
      releaseVersion = message.releaseVersion,
      files = files,
      backupPath = self.config.update_backup_path .. "/" .. message.updateId,
      versionPath = self.config.runtime_version_path,
    }
    if fs.exists(journal.backupPath) then fs.delete(journal.backupPath) end
    fs.makeDir(journal.backupPath)
    for _, relative in ipairs(files) do
      if fs.exists(relative) then copy_file(relative, fs.combine(journal.backupPath, relative)) end
    end
    if fs.exists(journal.versionPath) then copy_file(journal.versionPath, fs.combine(journal.backupPath, ".runtime-version")) end
    local started, start_error = self.bootstrap.begin(self.config.update_journal_path, journal)
    if not started then return self:fail(message, start_error) end
    self:event(message, "worker.update.staged")
    for _, relative in ipairs(files) do
      copy_file(fs.combine(self.current.stage, relative), relative)
    end
    local version_handle = fs.open(self.config.runtime_version_path, "w")
    if not version_handle then return self:fail(message, "cannot write runtime version") end
    version_handle.write(message.releaseVersion)
    version_handle.close()
    local marked, marked_error = self.bootstrap.mark_activated(self.config.update_journal_path, journal)
    if not marked then return self:fail(message, marked_error) end
    self:send_ack(message, "ACTIVATED")
    self:event(message, "worker.update.activated")
    os.reboot()
    return true
  end

  function manager:handle(message)
    if type(message) ~= "table" or not string.find(message.type or "", "^worker%.update%.") then return false end
    if message.type == "worker.update.prepare" then return self:prepare(message) end
    if message.type == "worker.update.file.begin" then return self:begin_file(message) end
    if message.type == "worker.update.file.chunk" then return self:chunk(message) end
    if message.type == "worker.update.file.end" then return self:end_file(message) end
    if message.type == "worker.update.activate" then return self:activate(message) end
    if message.type == "worker.update.abort" then return self:fail(message, message.reason or "operator aborted update") end
    return false, "unknown update message"
  end

  return manager
end

return M
