local M = {}

function M.new(poll_control)
  local cancellation = {
    poll_control = poll_control,
    stopped = false,
    reason = nil,
    command = nil,
    primitive_count = 0,
    block_change_count = 0,
    started_at = 0,
  }

  function cancellation:begin(command)
    self.command = command
    self.stopped = false
    self.reason = nil
    self.primitive_count = 0
    self.block_change_count = 0
    self.started_at = os.clock()
  end

  function cancellation:request_stop(reason)
    self.stopped = true
    self.reason = reason or "operator stop"
  end

  function cancellation:can_spend(primitives, block_changes)
    if not self.command then
      return false, "NO_COMMAND"
    end
    local budget = self.command.budget
    if self.primitive_count + primitives > budget.maxPrimitives then
      return false, "BUDGET_EXHAUSTED"
    end
    if self.block_change_count + block_changes > budget.maxBlockChanges then
      return false, "BLOCK_CHANGE_BUDGET_EXHAUSTED"
    end
    if budget.maxDurationMs and (os.clock() - self.started_at) * 1000 > budget.maxDurationMs then
      return false, "DURATION_BUDGET_EXHAUSTED"
    end
    return true
  end

  function cancellation:check()
    if self.poll_control then
      self.poll_control()
    end
    if self.stopped then
      return false, "CANCELLED"
    end
    return self:can_spend(1, 0)
  end

  function cancellation:record(primitives, block_changes)
    self.primitive_count = self.primitive_count + (primitives or 0)
    self.block_change_count = self.block_change_count + (block_changes or 0)
  end

  function cancellation:finish()
    self.command = nil
  end

  function cancellation:snapshot()
    return {
      primitiveCount = self.primitive_count,
      blockChangeCount = self.block_change_count,
      stopped = self.stopped,
      reason = self.reason,
    }
  end

  return cancellation
end

return M
