local M = {}

function M.run(config)
  local id = require("id")
  local logger = require("logging")
  local protocol = require("protocol")
  local http_client = require("http_client").new(config, logger)
  local registry = require("worker_registry").new(config.worker_timeout_seconds)
  local outbox = require("outbox").new(config.outbox_path, config.max_outbox_events, config.max_event_batch, logger)
  local boot_id = id.new("gw")
  local heartbeat = require("heartbeat").new(config, boot_id, registry, http_client, logger, id)
  local dispatcher = require("dispatcher").new(config, boot_id, registry, outbox, http_client, logger, id, protocol)

  if not rednet.isOpen(config.modem_side) then
    rednet.open(config.modem_side)
  end

  logger.info("started gateway " .. config.gateway_id .. " with boot id " .. boot_id)
  local registered = false
  local retry_seconds = 1
  local next_register = 0
  local next_heartbeat = 0
  local next_poll = 0
  local next_flush = 0

  while true do
    local sender_id, raw_message = rednet.receive(config.rednet_protocol, config.rednet_receive_timeout_seconds)
    if sender_id and raw_message then
      dispatcher:handle_rednet(sender_id, raw_message)
    end

    local now = os.clock()
    if now >= next_register then
      local response = heartbeat:send_registration()
      if response.ok then
        registered = true
        retry_seconds = 1
        next_register = now + config.heartbeat_interval_seconds
        logger.info("gateway registration acknowledged")
      else
        registered = false
        next_register = now + retry_seconds
        retry_seconds = math.min(retry_seconds * 2, config.http_retry_max_seconds)
        logger.warn("gateway registration failed; retry scheduled")
      end
    end

    if registered and now >= next_poll then
      local ok = dispatcher:poll()
      if ok then
        next_poll = now + config.poll_interval_seconds
      else
        next_poll = now + retry_seconds
        retry_seconds = math.min(retry_seconds * 2, config.http_retry_max_seconds)
        logger.warn("command poll failed; retry scheduled")
      end
    end

    if registered and now >= next_heartbeat then
      local response = heartbeat:send()
      if response.ok then
        next_heartbeat = now + config.heartbeat_interval_seconds
      else
        registered = false
        next_register = now + retry_seconds
        logger.warn("gateway heartbeat failed; registration will be retried")
      end
    end

    if registered and now >= next_flush then
      local flushed = dispatcher:flush_events()
      if flushed then
        next_flush = now + 1
      else
        next_flush = now + retry_seconds
      end
    end
  end
end

return M
