local M = {}

local function join_url(base, path)
  if string.sub(path, 1, 1) ~= "/" then
    path = "/" .. path
  end
  return base .. path
end

local function close_response(response)
  if response and response.close then
    response.close()
  end
end

function M.new(config, logger)
  local client = {
    config = config,
    logger = logger,
  }

  function client:request(method, path, body)
    if not http or not http.get or not http.post then
      return { ok = false, error = "ComputerCraft HTTP API is unavailable" }
    end

    local headers = {
      ["Content-Type"] = "application/json",
      ["X-Agent-Gateway-Id"] = self.config.gateway_id,
      ["Authorization"] = "Bearer " .. self.config.gateway_bearer_secret,
    }
    local url = join_url(self.config.vps_url, path)
    local encoded_body = body and textutils.serializeJSON(body) or nil
    local ok, response_or_error, request_error

    if method == "GET" then
      ok, response_or_error, request_error = pcall(http.get, url, headers)
    elseif method == "POST" then
      ok, response_or_error, request_error = pcall(http.post, url, encoded_body or "", headers)
    else
      return { ok = false, error = "unsupported HTTP method" }
    end

    if not ok or not response_or_error then
      return { ok = false, error = tostring(request_error or response_or_error or "HTTP request failed") }
    end

    local response = response_or_error
    local status = response.getResponseCode and response.getResponseCode() or 200
    local raw_body = response.readAll and response.readAll() or ""
    close_response(response)
    if status < 200 or status >= 300 then
      return { ok = false, status = status, error = "HTTP status " .. tostring(status), rawBody = raw_body }
    end

    local parsed = nil
    if raw_body and string.len(raw_body) > 0 then
      local decoded, decode_error = pcall(textutils.unserializeJSON, raw_body)
      if decoded then
        parsed = decode_error
      end
    end
    return { ok = true, status = status, body = parsed }
  end

  function client:get_raw(url)
    if not http or not http.get then
      return { ok = false, error = "ComputerCraft HTTP API is unavailable" }
    end
    local ok, response_or_error, request_error = pcall(http.get, url)
    if not ok or not response_or_error then
      return { ok = false, error = tostring(request_error or response_or_error or "HTTP request failed") }
    end
    local response = response_or_error
    local status = response.getResponseCode and response.getResponseCode() or 200
    local body = response.readAll and response.readAll() or ""
    close_response(response)
    if status < 200 or status >= 300 then
      return { ok = false, status = status, error = "HTTP status " .. tostring(status), body = body }
    end
    return { ok = true, status = status, body = body }
  end

  return client
end

return M
