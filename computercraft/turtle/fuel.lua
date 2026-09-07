local M = {}

function M.new(api, config, cancellation)
  local fuel = {
    api = api or turtle,
    config = config,
    cancellation = cancellation,
  }

  function fuel:summary()
    local value = self.api.getFuelLevel and self.api.getFuelLevel() or "unlimited"
    if value == "unlimited" then
      return { level = nil, unlimited = true, reserve = self.config.fuel_low_threshold }
    end
    return { level = value, unlimited = false, reserve = self.config.fuel_low_threshold }
  end

  function fuel:is_low()
    local summary = self:summary()
    return not summary.unlimited and summary.level <= summary.reserve
  end

  function fuel:refuel(max_items)
    local selected = self.api.getSelectedSlot and self.api.getSelectedSlot() or 1
    local consumed = 0
    for slot = 1, 16 do
      if consumed >= max_items then
        break
      end
      local detail = self.api.getItemDetail and self.api.getItemDetail(slot)
      local allowed_item = false
      if detail then
        if #self.config.acceptable_fuel_items == 0 then
          allowed_item = true
        else
          for _, item_key in ipairs(self.config.acceptable_fuel_items) do
            if item_key == detail.name then
              allowed_item = true
            end
          end
        end
      end
      if allowed_item then
        local can_spend, reason = self.cancellation:check()
        if not can_spend then
          return { status = reason == "CANCELLED" and "CANCELLED" or "BUDGET_EXHAUSTED", consumed = consumed }
        end
        self.api.select(slot)
        local ok, refueled = pcall(self.api.refuel, 1)
        self.cancellation:record(1, 0)
        if ok and refueled then
          consumed = consumed + 1
        end
      end
    end
    self.api.select(selected)
    if consumed == 0 then
      return { status = "NO_FUEL_ITEM", consumed = 0 }
    end
    return { status = "OK", consumed = consumed, fuel = self:summary() }
  end

  return fuel
end

return M
