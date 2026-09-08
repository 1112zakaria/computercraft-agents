local M = {}

local function now_iso()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function append_query(path, key, value)
  local separator = string.find(path, "?", 1, true) and "&" or "?"
  return path .. separator .. key .. "=" .. tostring(value)
end

function M.new(config, boot_id, registry, outbox, http_client, logger, id, protocol)
  local dispatcher = {
    config = config,
    boot_id = boot_id,
    registry = registry,
    outbox = outbox,
    http = http_client,
    logger = logger,
    id = id,
    protocol = protocol,
    update_manager = nil,
    sequences = {},
    cursor = nil,
  }

  function dispatcher:next_sequence(worker_id)
    self.sequences[worker_id] = (self.sequences[worker_id] or 0) + 1
    return self.sequences[worker_id]
  end

  function dispatcher:set_update_manager(manager)
    self.update_manager = manager
  end

  function dispatcher:event(worker_id, command_id, event_type, payload)
    return {
      protocolVersion = 1,
      eventId = self.id.new("evt"),
      gatewayId = self.config.gateway_id,
      workerId = worker_id,
      commandId = command_id,
      sequence = self:next_sequence(worker_id or "gateway"),
      type = event_type,
      occurredAt = now_iso(),
      payload = payload or {},
    }
  end

  function dispatcher:enqueue_failure(worker_id, command_id, code, message)
    local event = self:event(worker_id, command_id, "command.failed", {
      error = {
        code = code,
        message = message,
        retryable = false,
      },
    })
    return self.outbox:add(event)
  end

  function dispatcher:send_to_worker(worker, message)
    if not worker or not worker.senderId then
      return false, "worker is not registered"
    end
    local ok, sent = pcall(rednet.send, worker.senderId, self.protocol.encode(message), self.config.rednet_protocol)
    if not ok or not sent then
      return false, "rednet send failed"
    end
    return true
  end

  function dispatcher:route_command(command)
    local valid, validation_error = self.protocol.validate_command(command)
    if not valid then
      return self:enqueue_failure(command.workerId or "gateway", command.commandId, "INVALID_PAYLOAD", validation_error)
    end
    if self.protocol.is_expired(command.expiresAt) then
      return self:enqueue_failure(command.workerId, command.commandId, "COMMAND_EXPIRED", "command has expired")
    end

    local worker = self.registry:resolve(command.workerId)
    if not worker then
      return self:enqueue_failure(command.workerId, command.commandId, "UNKNOWN_WORKER", "worker is not registered")
    end

    local sent, send_error = self:send_to_worker(worker, {
      protocolVersion = 1,
      type = "worker.command",
      gatewayBootId = self.boot_id,
      command = command,
    })
    if not sent then
      return self:enqueue_failure(command.workerId, command.commandId, "UNKNOWN_WORKER", send_error)
    end
    return true
  end

  function dispatcher:route_stop(control)
    local valid, validation_error = self.protocol.validate_stop(control)
    if not valid then
      self.logger.warn("invalid stop control: " .. validation_error)
      return false, validation_error
    end

    if control.type == "worker.stop" then
      local worker = self.registry:resolve(control.workerId)
      if not worker then
        return false, "worker is not registered"
      end
      return self:send_to_worker(worker, {
        protocolVersion = 1,
        type = "worker.stop",
        gatewayBootId = self.boot_id,
        control = control,
      })
    end

    local all_sent = true
    for _, worker in ipairs(self.registry:list()) do
      local sent = self:send_to_worker(worker, {
        protocolVersion = 1,
        type = "worker.stop",
        gatewayBootId = self.boot_id,
        control = control,
      })
      if not sent then
        all_sent = false
      end
    end
    return all_sent
  end

  function dispatcher:handle_poll(response)
    local valid, validation_error = self.protocol.validate_poll_response(response)
    if not valid then
      self.logger.warn("invalid command poll response: " .. validation_error)
      return false, validation_error
    end

    for _, control in ipairs(response.stopControls or {}) do
      self:route_stop(control)
    end
    for _, command in ipairs(response.commands) do
      self:route_command(command)
    end
    for _, update in ipairs(response.updates or {}) do
      if self.update_manager then
        local updated, update_error = self.update_manager:process(update)
        if not updated then
          local target_type, target_key = string.match(update.target, "^(%a+):(.+)$")
          local event_type = target_type == "gateway" and "gateway.update.failed" or "worker.update.failed"
          self.outbox:add(self:event(target_type == "worker" and target_key or nil, nil, event_type, {
            updateId = update.updateId,
            releaseVersion = update.releaseVersion,
            message = update_error,
          }))
          self.logger.warn("update failed: " .. tostring(update_error))
        end
      end
    end
    if response.nextCursor then
      self.cursor = response.nextCursor
    end
    return true
  end

  function dispatcher:poll()
    local path = self.config.commands_path
    if self.cursor then
      path = append_query(path, "after", self.cursor)
    end
    local response = self.http:request("GET", path)
    if not response.ok then
      return false, response.error
    end
    if not response.body then
      return false, "command poll returned an empty body"
    end
    return self:handle_poll(response.body)
  end

  function dispatcher:flush_events()
    local events = self.outbox:batch()
    if #events == 0 then
      return true
    end
    local response = self.http:request("POST", self.config.events_path, {
      protocolVersion = 1,
      gatewayId = self.config.gateway_id,
      bootId = self.boot_id,
      batchId = self.id.new("batch"),
      events = events,
    })
    if not response.ok then
      return false, response.error
    end
    if not response.body or type(response.body.acceptedEventIds) ~= "table" then
      return false, "event endpoint did not return acceptedEventIds"
    end
    return self.outbox:acknowledge(response.body.acceptedEventIds)
  end

  function dispatcher:send_protocol_error(sender_id, message)
    rednet.send(sender_id, self.protocol.encode({
      protocolVersion = 1,
      type = "worker.protocol.error",
      gatewayBootId = self.boot_id,
      error = {
        code = "INVALID_PAYLOAD",
        message = message,
        retryable = false,
      },
    }), self.config.rednet_protocol)
  end

  function dispatcher:handle_worker_message(sender_id, message)
    if type(message) ~= "table" or message.protocolVersion ~= 1 or type(message.type) ~= "string" then
      return self:send_protocol_error(sender_id, "invalid worker message envelope")
    end

    if message.type == "worker.register" then
      local valid, validation_error = self.protocol.validate_registration(message)
      if not valid then
        return self:send_protocol_error(sender_id, validation_error)
      end
      local worker = self.registry:register(message, sender_id)
      rednet.send(sender_id, self.protocol.encode({
        protocolVersion = 1,
        type = "worker.register.ack",
        gatewayId = self.config.gateway_id,
        gatewayBootId = self.boot_id,
        workerId = worker.workerId,
      }), self.config.rednet_protocol)
      return true
    elseif message.type == "worker.heartbeat" then
      local valid, validation_error = self.protocol.validate_worker_heartbeat(message)
      if not valid then
        return self:send_protocol_error(sender_id, validation_error)
      end
      local updated, update_error = self.registry:heartbeat(message, sender_id)
      if not updated then
        return self:send_protocol_error(sender_id, update_error)
      end
      return true
    elseif message.type == "worker.event" then
      local valid, validation_error = self.protocol.validate_worker_event(message.event)
      if not valid then
        return self:send_protocol_error(sender_id, validation_error)
      end
      local worker = self.registry:resolve_sender(sender_id)
      if not worker or worker.workerId ~= message.event.workerId then
        return self:send_protocol_error(sender_id, "event worker does not match registered sender")
      end
      message.event.gatewayId = self.config.gateway_id
      return self.outbox:add(message.event)
    elseif message.type == "worker.update.ack" then
      local valid, validation_error = self.protocol.validate_update_ack(message)
      if not valid then
        return self:send_protocol_error(sender_id, validation_error)
      end
      return true
    end

    return self:send_protocol_error(sender_id, "unknown worker message type")
  end

  function dispatcher:handle_rednet(sender_id, raw_message)
    local message, decode_error = self.protocol.decode(raw_message)
    if not message then
      return self:send_protocol_error(sender_id, decode_error)
    end
    if message.gatewayBootId and message.gatewayBootId ~= self.boot_id then
      return self:send_protocol_error(sender_id, "stale gateway boot id")
    end
    return self:handle_worker_message(sender_id, message)
  end

  return dispatcher
end

return M
