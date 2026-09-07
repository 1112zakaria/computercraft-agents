local M = {}

local function now_iso()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function as_json_array(values)
  if #values == 0 and textutils.EMPTY_ARRAY then
    return textutils.EMPTY_ARRAY
  end
  return values
end

function M.new(config, state, inventory, fuel, protocol, logger)
  local client = {
    config = config,
    state = state,
    inventory = inventory,
    fuel = fuel,
    protocol = protocol,
    logger = logger,
    gateway_boot_id = nil,
    execution_state = "IDLE",
    current_command_id = nil,
    last_heartbeat = 0,
    pending = {},
  }

  function client:open()
    if not rednet.isOpen(self.config.modem_side) then
      rednet.open(self.config.modem_side)
    end
  end

  function client:send(message)
    local ok, sent = pcall(rednet.send, self.config.gateway_rednet_id, self.protocol.encode(message), self.config.rednet_protocol)
    if not ok or not sent then
      return false, "rednet send failed"
    end
    return true
  end

  function client:registration_message()
    return {
      protocolVersion = 1,
      type = "worker.register",
      workerId = self.config.worker_id,
      workerBootId = self.state.boot_id,
      computerId = os.getComputerID(),
      runtimeVersion = self.config.runtime_version,
      capabilities = as_json_array(self.config.capabilities),
    }
  end

  function client:register()
    self:open()
    local sent, send_error = self:send(self:registration_message())
    if not sent then
      return false, send_error
    end
    local deadline = os.clock() + 5
    while os.clock() < deadline do
      local sender_id, raw_message = rednet.receive(self.config.rednet_protocol, 1)
      if sender_id == self.config.gateway_rednet_id and raw_message then
        local message = self.protocol.decode(raw_message)
        if message and message.type == "worker.register.ack" and message.workerId == self.config.worker_id then
          self.gateway_boot_id = message.gatewayBootId
          self.last_heartbeat = 0
          return true
        end
        if message then
          table.insert(self.pending, { senderId = sender_id, message = message })
        end
      end
    end
    return false, "registration acknowledgement timeout"
  end

  function client:set_execution(state, command_id)
    self.execution_state = state
    self.current_command_id = command_id
  end

  function client:heartbeat()
    if not self.gateway_boot_id then
      return false, "gateway is not registered"
    end
    local position = self.state:position()
    local message = {
      protocolVersion = 1,
      type = "worker.heartbeat",
      gatewayBootId = self.gateway_boot_id,
      workerId = self.config.worker_id,
      workerBootId = self.state.boot_id,
      status = "ONLINE",
      executionState = self.execution_state,
      runtimeVersion = self.config.runtime_version,
      capabilities = as_json_array(self.config.capabilities),
      lastSeenAt = now_iso(),
      currentCommandId = self.current_command_id,
      position = position,
      fuel = self.fuel:summary(),
    }
    local sent, error_message = self:send(message)
    if sent then
      self.last_heartbeat = os.clock()
    end
    return sent, error_message
  end

  function client:maybe_heartbeat()
    if os.clock() - self.last_heartbeat >= self.config.heartbeat_interval_seconds then
      self:heartbeat()
    end
  end

  function client:send_event(event)
    if not self.gateway_boot_id then
      return false, "gateway is not registered"
    end
    return self:send({
      protocolVersion = 1,
      type = "worker.event",
      gatewayBootId = self.gateway_boot_id,
      event = event,
    })
  end

  function client:poll_control(cancellation)
    local sender_id, raw_message = rednet.receive(self.config.rednet_protocol, 0)
    if not sender_id or sender_id ~= self.config.gateway_rednet_id then
      return false
    end
    local message = self.protocol.decode(raw_message)
    if not message then
      return false
    end
    if message.type == "worker.stop" and message.gatewayBootId == self.gateway_boot_id then
      local valid, error_message = self.protocol.validate_stop(message)
      if valid then
        cancellation:request_stop(message.control.reason or "operator stop")
        return true
      end
      self.logger.warn("invalid stop control: " .. error_message)
      return false
    end
    table.insert(self.pending, { senderId = sender_id, message = message })
    return false
  end

  function client:receive(timeout)
    if #self.pending > 0 then
      local pending = table.remove(self.pending, 1)
      return pending.senderId, pending.message
    end
    local sender_id, raw_message = rednet.receive(self.config.rednet_protocol, timeout)
    if not sender_id or not raw_message then
      return nil, nil
    end
    local message, error_message = self.protocol.decode(raw_message)
    if not message then
      self.logger.warn(error_message)
      return sender_id, nil
    end
    return sender_id, message
  end

  return client
end

return M
