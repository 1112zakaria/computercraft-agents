local M = {}

local function now_iso()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function error_payload(code, message, retryable, details)
  return {
    error = {
      code = code,
      message = message,
      retryable = retryable,
      details = details,
    },
  }
end

local function protocol_error_payload(code, message, retryable, details)
  return {
    code = code,
    message = message,
    retryable = retryable,
    details = details,
  }
end

function M.new(config, client, state, cancellation, movement, observation, inventory, fuel, cache, protocol, id, logger, excavation, peripherals)
  local executor = {
    config = config,
    client = client,
    state = state,
    cancellation = cancellation,
    movement = movement,
    observation = observation,
    inventory = inventory,
    fuel = fuel,
    cache = cache,
    protocol = protocol,
    id = id,
    logger = logger,
    excavation = excavation,
    peripherals = peripherals,
  }

  function executor:emit(command_id, event_type, payload)
    return self.client:send_event({
      protocolVersion = 1,
      eventId = self.id.new("evt"),
      workerId = self.config.worker_id,
      commandId = command_id,
      sequence = self.state:next_sequence(),
      type = event_type,
      occurredAt = now_iso(),
      payload = payload or {},
    })
  end

  function executor:replay(entry)
    self:emit(entry.commandId, entry.eventType, entry.payload)
    return entry.result
  end

  function executor:run_skill(command)
    local skill = command.skill
    local args = command.arguments
    if skill == "movement.step" then
      return self.movement:move(args.direction)
    elseif skill == "navigate.path" then
      return self.movement:path(args.steps)
    elseif skill == "observation.block" then
      return self.observation:inspect(args.direction)
    elseif skill == "peripheral.inspect" then
      return self.peripherals:inspect(args.side)
    elseif skill == "inventory.inspect" then
      return { status = "OK", inventory = self.inventory:snapshot() }
    elseif skill == "inventory.deposit" then
      local direction, direction_error = self:container_direction(args.containerId)
      if not direction then
        return { status = "UNKNOWN_CONTAINER", containerId = args.containerId, error = direction_error }
      end
      local result = self.inventory:deposit(direction, args.quantity, args.itemKey, args.slot)
      if result.status == "OK" then result.inventory = self.inventory:snapshot() end
      return result
    elseif skill == "inventory.withdraw" then
      local direction, direction_error = self:container_direction(args.containerId)
      if not direction then
        return { status = "UNKNOWN_CONTAINER", containerId = args.containerId, error = direction_error }
      end
      local result = self.inventory:withdraw(direction, args.itemKey, args.quantity, args.slot)
      if result.status == "OK" then result.inventory = self.inventory:snapshot() end
      return result
    elseif skill == "fuel.refuel" then
      return self.fuel:refuel(args.maxItems)
    elseif skill == "mining.excavate" then
      return self.excavation:run(args.width, args.height, args.depth)
    elseif skill == "mining.gather" then
      return self.excavation:gather(args.itemKey, args.quantity, args.maxDepth)
    end
    return { status = "UNIMPLEMENTED", error = "skill is reserved for a later runtime slice" }
  end

  function executor:container_direction(container_id)
    if container_id == nil then
      return self.config.container_side
    end
    local direction = self.config.container_sides and self.config.container_sides[container_id]
    if not direction then
      return nil, "container is not configured"
    end
    return direction
  end

  function executor:execute(command)
    local valid, validation_error = self.protocol.validate_command(command)
    if not valid then
      self:emit(
        command and command.commandId or nil,
        "protocol.error",
        protocol_error_payload("INVALID_PAYLOAD", validation_error, false)
      )
      return { status = "INVALID_PAYLOAD", error = validation_error }
    end
    if self.protocol.is_expired(command.expiresAt) then
      local payload = error_payload("COMMAND_EXPIRED", "command has expired", false)
      self:emit(command.commandId, "command.failed", payload)
      return { status = "COMMAND_EXPIRED" }
    end

    local previous = self.cache:get(command.commandId)
    if previous then
      return self:replay(previous)
    end

    self.cancellation:begin(command)
    self.client:set_execution("EXECUTING", command.commandId)
    self:emit(command.commandId, "command.started", { skill = command.skill })
    local result = self:run_skill(command)
    if command.skill == "observation.block" and result.status == "OK" then
      self:emit(command.commandId, "block.observed", {
        direction = command.arguments.direction,
        block = result.block or self.protocol.JSON_NULL,
        position = self.state:position(),
      })
    end
    if command.skill == "peripheral.inspect" and result.status == "OK" then
      for _, peripheral_info in ipairs(result.peripherals or {}) do
        self:emit(command.commandId, "peripheral.observed", {
          side = peripheral_info.side,
          type = peripheral_info.type,
          methods = peripheral_info.methods,
        })
      end
    end
    if (command.skill == "inventory.deposit" or command.skill == "inventory.withdraw")
      and result.status == "OK" and result.inventory and result.inventory.slots then
      self:emit(command.commandId, "inventory.changed", { slots = result.inventory.slots })
    end
    local event_type = "command.completed"
    local payload = { result = result, position = self.state:position() }

    if result.status == "BLOCKED" then
      self:emit(command.commandId, "movement.blocked", {
        direction = result.direction,
        reason = "movement primitive was blocked",
        position = self.state:position(),
      })
      event_type = "command.failed"
      payload = error_payload("INTERNAL_ERROR", "movement blocked", true, result)
    elseif result.status == "CANCELLED" then
      event_type = "command.cancelled"
      payload = { reason = self.cancellation.reason or "operator stop" }
    elseif result.status == "NO_FUEL" then
      event_type = "command.failed"
      payload = error_payload("INTERNAL_ERROR", "worker is out of fuel", true, result)
    elseif result.status == "BUDGET_EXHAUSTED" or result.status == "BLOCK_CHANGE_BUDGET_EXHAUSTED" then
      event_type = "command.failed"
      payload = error_payload("INVALID_ARGUMENTS", "command budget exhausted", false, result)
    elseif result.status == "UNIMPLEMENTED" or result.status == "UNSUPPORTED_PATTERN" then
      event_type = "command.failed"
      payload = error_payload("UNKNOWN_SKILL", result.error, false)
    elseif result.status == "UNKNOWN_CONTAINER" then
      event_type = "command.failed"
      payload = error_payload("INVALID_ARGUMENTS", result.error or "container is not configured", false, result)
    elseif result.status == "INVENTORY_FULL" then
      self:emit(command.commandId, "inventory.full", { freeSlots = 0 })
      event_type = "command.failed"
      payload = error_payload("INVALID_ARGUMENTS", "worker inventory is full; deposit items before gathering", true, result)
    elseif result.status ~= "OK" then
      event_type = "command.failed"
      payload = error_payload("INTERNAL_ERROR", result.error or result.status, true, result)
    end

    if event_type == "command.failed" then
      payload.position = self.state:position()
    end

    self:emit(command.commandId, event_type, payload)
    self.cache:put(command.commandId, result, event_type, payload)
    self.cancellation:finish()
    self.client:set_execution("IDLE", nil)
    self.client:maybe_heartbeat()
    return result
  end

  return executor
end

return M
