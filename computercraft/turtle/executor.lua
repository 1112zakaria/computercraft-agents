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

function M.new(config, client, state, cancellation, movement, observation, inventory, fuel, cache, protocol, id, logger, excavation)
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
    elseif skill == "inventory.inspect" then
      return { status = "OK", inventory = self.inventory:snapshot() }
    elseif skill == "inventory.deposit" then
      return self.inventory:deposit(self.config.container_side, args.quantity, args.slot)
    elseif skill == "inventory.withdraw" then
      return self.inventory:withdraw(self.config.container_side, args.itemKey, args.quantity, args.slot)
    elseif skill == "fuel.refuel" then
      return self.fuel:refuel(args.maxItems)
    elseif skill == "mining.excavate" then
      return self.excavation:run(args.width, args.height, args.depth)
    end
    return { status = "UNIMPLEMENTED", error = "skill is reserved for a later runtime slice" }
  end

  function executor:execute(command)
    local valid, validation_error = self.protocol.validate_command(command)
    if not valid then
      self:emit(command and command.commandId or nil, "protocol.error", error_payload("INVALID_PAYLOAD", validation_error, false))
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
    elseif result.status ~= "OK" then
      event_type = "command.failed"
      payload = error_payload("INTERNAL_ERROR", result.error or result.status, true, result)
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
