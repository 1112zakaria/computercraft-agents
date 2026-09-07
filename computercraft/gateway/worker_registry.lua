local M = {}

function M.new(timeout_seconds)
  local registry = {
    by_worker = {},
    by_sender = {},
    order = {},
    timeout_seconds = timeout_seconds,
  }

  function registry:register(worker, sender_id)
    local existing = self.by_worker[worker.workerId]
    if existing and existing.senderId ~= sender_id then
      self.by_sender[existing.senderId] = nil
    end

    if not existing then
      table.insert(self.order, worker.workerId)
    end

    worker.senderId = sender_id
    worker.lastSeenClock = os.clock()
    worker.online = true
    self.by_worker[worker.workerId] = worker
    self.by_sender[sender_id] = worker.workerId
    return worker
  end

  function registry:heartbeat(worker, sender_id)
    local worker_id = self.by_sender[sender_id]
    if worker_id == nil or worker_id ~= worker.workerId then
      return false, "worker is not registered from this sender"
    end
    local existing = self.by_worker[worker.workerId]
    if existing == nil then
      return false, "worker is not registered"
    end
    for key, value in pairs(worker) do
      existing[key] = value
    end
    existing.senderId = sender_id
    existing.lastSeenClock = os.clock()
    existing.online = true
    return true
  end

  function registry:resolve(worker_id)
    return self.by_worker[worker_id]
  end

  function registry:resolve_sender(sender_id)
    local worker_id = self.by_sender[sender_id]
    if worker_id == nil then
      return nil
    end
    return self.by_worker[worker_id]
  end

  function registry:mark_stale(now)
    for _, worker_id in ipairs(self.order) do
      local worker = self.by_worker[worker_id]
      if worker and worker.online and now - worker.lastSeenClock > self.timeout_seconds then
        worker.online = false
        worker.status = "OFFLINE"
      end
    end
  end

  function registry:list()
    local workers = {}
    for _, worker_id in ipairs(self.order) do
      local worker = self.by_worker[worker_id]
      if worker then
        table.insert(workers, worker)
      end
    end
    return workers
  end

  return registry
end

return M
