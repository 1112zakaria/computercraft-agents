local M = {}

local function is_reserved(reserved_slots, slot)
  return reserved_slots[slot] == true or reserved_slots[tostring(slot)] == true
end

local function total_count(api)
  local total = 0
  for slot = 1, 16 do
    total = total + (api.getItemCount(slot) or 0)
  end
  return total
end

function M.new(api, config, cancellation)
  local inventory = {
    api = api or turtle,
    reserved_slots = config.reserved_slots or {},
    cancellation = cancellation,
  }

  function inventory:selected_slot()
    return self.api.getSelectedSlot and self.api.getSelectedSlot() or 1
  end

  function inventory:snapshot()
    local selected = self:selected_slot()
    local slots = {}
    local free_slots = 0
    for slot = 1, 16 do
      local count = self.api.getItemCount(slot) or 0
      if count == 0 then
        free_slots = free_slots + 1
      else
        local detail = nil
        if self.api.getItemDetail then
          local ok, value = pcall(self.api.getItemDetail, slot)
          if ok then
            detail = value
          end
        end
        table.insert(slots, {
          slot = slot,
          itemKey = detail and detail.name or "unknown",
          count = count,
          damage = detail and (detail.damage or detail.metadata),
        })
      end
    end
    if #slots == 0 and textutils.EMPTY_ARRAY then
      slots = textutils.EMPTY_ARRAY
    end
    return { selectedSlot = selected, freeSlots = free_slots, slots = slots }
  end

  function inventory:count(item_key)
    local total = 0
    for slot = 1, 16 do
      if not is_reserved(self.reserved_slots, slot) and self.api.getItemDetail then
        local detail = self.api.getItemDetail(slot)
        if detail and detail.name == item_key then
          total = total + (self.api.getItemCount(slot) or 0)
        end
      end
    end
    return total
  end

  function inventory:free_slots()
    local free = 0
    for slot = 1, 16 do
      if not is_reserved(self.reserved_slots, slot) and (self.api.getItemCount(slot) or 0) == 0 then
        free = free + 1
      end
    end
    return free
  end

  function inventory:find(item_key, minimum)
    local needed = minimum or 1
    for slot = 1, 16 do
      if not is_reserved(self.reserved_slots, slot) and self.api.getItemDetail then
        local detail = self.api.getItemDetail(slot)
        local count = self.api.getItemCount(slot) or 0
        if detail and detail.name == item_key and count >= needed then
          return slot
        end
      end
    end
    return nil
  end

  function inventory:select(slot)
    if type(slot) ~= "number" or slot < 1 or slot > 16 or slot ~= math.floor(slot) then
      return false, "invalid slot"
    end
    if not self.api.select(slot) then
      return false, "select failed"
    end
    return true
  end

  function inventory:transfer(operation, direction, quantity)
    local allowed, reason = self.cancellation:check()
    if not allowed then
      return { status = reason == "CANCELLED" and "CANCELLED" or "BUDGET_EXHAUSTED" }
    end
    local before = total_count(self.api)
    local function call(method)
      if direction == "up" then
        return self.api[method .. "Up"](quantity)
      elseif direction == "down" then
        return self.api[method .. "Down"](quantity)
      end
      return self.api[method](quantity)
    end
    local method = operation == "deposit" and "drop" or "suck"
    local ok, transferred = pcall(call, method)
    self.cancellation:record(1, 0)
    if not ok then
      return { status = "ERROR", error = tostring(transferred) }
    end
    local after = total_count(self.api)
    local delta = operation == "deposit" and before - after or after - before
    return { status = transferred and "OK" or "NO_TRANSFER", moved = math.max(delta, 0) }
  end

  function inventory:deposit(direction, quantity, slot)
    local selected = self:selected_slot()
    if slot then
      local selected_ok, select_error = self:select(slot)
      if not selected_ok then
        return { status = "ERROR", error = select_error }
      end
    end
    local result = self:transfer("deposit", direction, quantity)
    self:select(selected)
    return result
  end

  function inventory:withdraw(direction, item_key, quantity, slot)
    local selected = self:selected_slot()
    local target_slot = slot or self:find(item_key, 1)
    if not target_slot then
      return { status = "MISSING_ITEM", itemKey = item_key }
    end
    local selected_ok, select_error = self:select(target_slot)
    if not selected_ok then
      return { status = "ERROR", error = select_error }
    end
    local result = self:transfer("withdraw", direction, quantity)
    self:select(selected)
    return result
  end

  return inventory
end

return M
