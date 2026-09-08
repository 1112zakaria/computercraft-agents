-- Gateway-managed release downloader and Rednet transfer coordinator.
local M = {}

local turtle_prefix = "computercraft/turtle/"
local gateway_prefix = "computercraft/gateway/"

local function relative_path(path, prefix)
  return string.sub(path, string.len(prefix) + 1)
end

local function now_iso()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function write_text(path, contents)
  local parent = fs.getDir(path)
  if parent and parent ~= "" and not fs.exists(parent) then fs.makeDir(parent) end
  local handle = fs.open(path, "w")
  if not handle then return false, "cannot write " .. path end
  handle.write(contents)
  handle.close()
  return true
end

local function copy_file(source, destination)
  local parent = fs.getDir(destination)
  if parent and parent ~= "" and not fs.exists(parent) then fs.makeDir(parent) end
  if fs.exists(destination) then fs.delete(destination) end
  fs.copy(source, destination)
end

function M.new(config, http_client, dispatcher, registry, protocol, logger, bootstrap)
  local manager = {
    config = config,
    http = http_client,
    dispatcher = dispatcher,
    registry = registry,
    protocol = protocol,
    logger = logger,
    bootstrap = bootstrap,
  }

  function manager:event(worker_id, event_type, update, message)
    self.dispatcher.outbox:add(self.dispatcher:event(worker_id, nil, event_type, {
      updateId = update.updateId,
      releaseVersion = update.releaseVersion,
      message = message,
    }))
  end

  function manager:manifest(update)
    local response = self.http:get_raw(update.manifestUrl)
    if not response.ok or not response.body then return nil, response.error or "manifest download failed" end
    local ok, manifest = pcall(textutils.unserializeJSON, response.body)
    if not ok or type(manifest) ~= "table" then return nil, "manifest is not valid JSON" end
    if manifest.version ~= update.releaseVersion or type(manifest.runtimeFiles) ~= "table" then
      return nil, "manifest version or runtimeFiles do not match update"
    end
    return manifest
  end

  function manager:download_file(file)
    if type(file) ~= "table" or type(file.path) ~= "string" or type(file.downloadUrl) ~= "string" then
      return nil, "manifest runtime file is invalid"
    end
    local raw_prefix = "https://raw.githubusercontent.com/"
    if string.sub(file.downloadUrl, 1, string.len(raw_prefix)) ~= raw_prefix then
      return nil, "runtime download must use GitHub raw HTTPS"
    end
    local response = self.http:get_raw(file.downloadUrl)
    if not response.ok or type(response.body) ~= "string" then return nil, response.error or "runtime file download failed" end
    return response.body
  end

  function manager:acknowledge(worker, update, phase, path, chunk_number)
    local deadline = os.clock() + self.config.update_ack_timeout_seconds
    while os.clock() < deadline do
      local sender_id, raw_message = rednet.receive(self.config.rednet_protocol, 1)
      if sender_id == worker.senderId and raw_message then
        local message = self.protocol.decode(raw_message)
        if message and message.type == "worker.update.ack" and message.updateId == update.updateId then
          local valid, validation_error = self.protocol.validate_update_ack(message)
          if not valid then return false, validation_error end
          if message.phase == "FAILED" then return false, message.error or "worker rejected update" end
          if message.phase == phase and (not path or message.path == path)
            and (chunk_number == nil or message.chunkNumber == chunk_number) then
            return true
          end
        end
      end
    end
    return false, "update acknowledgement timed out"
  end

  function manager:send(worker, message)
    return self.dispatcher:send_to_worker(worker, message)
  end

  function manager:transfer_file(worker, update, file)
    local content, download_error = self:download_file(file)
    if not content then return false, download_error end
    local chunk_size = self.config.update_chunk_size
    local total_chunks = math.max(1, math.ceil(string.len(content) / chunk_size))
    local sent, send_error = self:send(worker, {
      protocolVersion = 1,
      type = "worker.update.file.begin",
      gatewayBootId = self.dispatcher.boot_id,
      updateId = update.updateId,
      releaseVersion = update.releaseVersion,
      workerId = worker.workerId,
      path = file.path,
      totalChunks = total_chunks,
    })
    if not sent then return false, send_error end
    for chunk_number = 0, total_chunks - 1 do
      local start = chunk_number * chunk_size + 1
      local chunk = string.sub(content, start, start + chunk_size - 1)
      sent, send_error = self:send(worker, {
        protocolVersion = 1,
        type = "worker.update.file.chunk",
        gatewayBootId = self.dispatcher.boot_id,
        updateId = update.updateId,
        releaseVersion = update.releaseVersion,
        workerId = worker.workerId,
        path = file.path,
        chunkNumber = chunk_number,
        totalChunks = total_chunks,
        content = chunk,
      })
      if not sent then return false, send_error end
      local acknowledged, acknowledgement_error = self:acknowledge(worker, update, "FILE_RECEIVED", file.path, chunk_number)
      if not acknowledged then return false, acknowledgement_error end
    end
    sent, send_error = self:send(worker, {
      protocolVersion = 1,
      type = "worker.update.file.end",
      gatewayBootId = self.dispatcher.boot_id,
      updateId = update.updateId,
      releaseVersion = update.releaseVersion,
      workerId = worker.workerId,
      path = file.path,
      totalChunks = total_chunks,
    })
    if not sent then return false, send_error end
    return self:acknowledge(worker, update, "FILE_RECEIVED", file.path)
  end

  function manager:update_worker(update, worker)
    self:event(worker.workerId, "worker.update.started", update)
    local stopped, stop_error = self:send(worker, {
      protocolVersion = 1,
      type = "worker.stop",
      gatewayBootId = self.dispatcher.boot_id,
      control = {
        protocolVersion = 1,
        controlId = "update-stop-" .. update.updateId,
        issuedAt = now_iso(),
        type = "worker.stop",
        workerId = worker.workerId,
        reason = "stop before runtime update",
      },
    })
    if not stopped then return false, stop_error end
    sleep(1)
    local sent, send_error = self:send(worker, {
      protocolVersion = 1,
      type = "worker.update.prepare",
      gatewayBootId = self.dispatcher.boot_id,
      updateId = update.updateId,
      releaseVersion = update.releaseVersion,
      workerId = worker.workerId,
      expiresAt = update.expiresAt,
    })
    if not sent then return false, send_error end
    local prepared, prepare_error = self:acknowledge(worker, update, "PREPARED")
    if not prepared then return false, prepare_error end

    local manifest, manifest_error = self:manifest(update)
    if not manifest then return false, manifest_error end
    for _, file in ipairs(manifest.runtimeFiles) do
      if self.protocol.is_update_path(file.path, turtle_prefix) then
        local transferred, transfer_error = self:transfer_file(worker, update, file)
        if not transferred then return false, transfer_error end
      end
    end

    sent, send_error = self:send(worker, {
      protocolVersion = 1,
      type = "worker.update.activate",
      gatewayBootId = self.dispatcher.boot_id,
      updateId = update.updateId,
      releaseVersion = update.releaseVersion,
      workerId = worker.workerId,
    })
    if not sent then return false, send_error end
    return self:acknowledge(worker, update, "ACTIVATED")
  end

  function manager:update_gateway(update)
    self:event(nil, "gateway.update.started", update)
    local manifest, manifest_error = self:manifest(update)
    if not manifest then return false, manifest_error end
    local stage = fs.combine(self.config.update_staging_path, update.updateId)
    if fs.exists(stage) then fs.delete(stage) end
    fs.makeDir(stage)
    local files = {}
    for _, file in ipairs(manifest.runtimeFiles) do
      if self.protocol.is_update_path(file.path, gateway_prefix) then
        local content, download_error = self:download_file(file)
        if not content then return false, download_error end
        local relative = relative_path(file.path, gateway_prefix)
        local staged = fs.combine(stage, relative)
        local written, write_error = write_text(staged, content)
        if not written then return false, write_error end
        table.insert(files, relative)
      end
    end
    self:event(nil, "gateway.update.staged", update)
    local backup = fs.combine(self.config.update_backup_path, update.updateId)
    if fs.exists(backup) then fs.delete(backup) end
    fs.makeDir(backup)
    local journal = {
      updateId = update.updateId,
      releaseVersion = update.releaseVersion,
      files = files,
      backupPath = backup,
      versionPath = self.config.runtime_version_path,
    }
    for _, relative in ipairs(files) do
      if fs.exists(relative) then copy_file(relative, fs.combine(backup, relative)) end
    end
    if fs.exists(journal.versionPath) then copy_file(journal.versionPath, fs.combine(backup, ".runtime-version")) end
    local started, start_error = self.bootstrap.begin(self.config.update_journal_path, journal)
    if not started then return false, start_error end
    for _, relative in ipairs(files) do copy_file(fs.combine(stage, relative), relative) end
    local version_handle = fs.open(self.config.runtime_version_path, "w")
    if not version_handle then return false, "cannot write runtime version" end
    version_handle.write(update.releaseVersion)
    version_handle.close()
    local marked, marked_error = self.bootstrap.mark_activated(self.config.update_journal_path, journal)
    if not marked then return false, marked_error end
    self:event(nil, "gateway.update.activated", update)
    os.reboot()
    return true
  end

  function manager:process(update)
    if self.protocol.is_expired(update.expiresAt) then return false, "update has expired" end
    local target_type, target_key = string.match(update.target, "^(%a+):(.+)$")
    if target_type == "gateway" then
      if target_key ~= self.config.gateway_id then return true end
      return self:update_gateway(update)
    end
    local workers = {}
    if target_type == "worker" then
      local worker = self.registry:resolve(target_key)
      if worker then table.insert(workers, worker) end
    else
      workers = self.registry:list()
    end
    if #workers == 0 then return false, "no target worker is online" end
    for _, worker in ipairs(workers) do
      local updated, update_error = self:update_worker(update, worker)
      if not updated then return false, update_error end
    end
    return true
  end

  return manager
end

return M
