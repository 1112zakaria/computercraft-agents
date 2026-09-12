-- Minimal ComputerCraft 1.75 turtle poller for the MVP relay.
-- Configure these values, then run: turtle_poller.lua
local RELAY_URL = "http://127.0.0.1:8788"
local WORKER_ID = "alice"
local POLL_SECONDS = 2
local AUTH_ENABLED = false
local RELAY_SECRET = ""

local function url_encode(value)
  return string.gsub(value, "[^A-Za-z0-9_%-%.]", function(character)
    return string.format("%%%02X", string.byte(character))
  end)
end

local function headers()
  local result = { ["Content-Type"] = "text/plain" }
  if AUTH_ENABLED then result["Authorization"] = "Bearer " .. RELAY_SECRET end
  return result
end

local function close_response(response)
  if response and response.close then response.close() end
end

local function get(path)
  if not http or not http.get then return nil, "ComputerCraft HTTP API is unavailable" end
  local ok, response_or_error = pcall(http.get, RELAY_URL .. path, headers())
  if not ok or not response_or_error then
    return nil, tostring(response_or_error or "HTTP GET failed")
  end
  local response = response_or_error
  local status = response.getResponseCode and response.getResponseCode() or 200
  local body = response.readAll and response.readAll() or ""
  close_response(response)
  if status < 200 or status >= 300 then return nil, "HTTP GET status " .. tostring(status) end
  return body
end

local function post(path, body)
  if not http or not http.post then return nil, "ComputerCraft HTTP API is unavailable" end
  local ok, response_or_error = pcall(http.post, RELAY_URL .. path, body, headers())
  if not ok or not response_or_error then
    return nil, tostring(response_or_error or "HTTP POST failed")
  end
  local response = response_or_error
  local status = response.getResponseCode and response.getResponseCode() or 200
  local result = response.readAll and response.readAll() or ""
  close_response(response)
  if status < 200 or status >= 300 then return nil, "HTTP POST status " .. tostring(status) end
  return result
end

local function parse_job(body)
  if not body or body == "" then return nil end
  local first = string.find(body, "\n", 1, true)
  if not first then return nil, "job response is missing id" end
  local second = string.find(body, "\n", first + 1, true)
  if not second then return nil, "job response is missing filename" end
  local id = string.sub(body, 1, first - 1)
  local filename = string.sub(body, first + 1, second - 1)
  local program = string.sub(body, second + 1)
  if id == "" or filename == "" or program == "" then return nil, "job response is incomplete" end
  return { id = id, filename = filename, program = program }
end

local function save_program(filename, program)
  local handle = fs.open(filename, "w")
  if not handle then return false, "cannot open " .. filename end
  handle.write(program)
  handle.close()
  return true
end

local function check_stop()
  local body = get("/api/v1/stop?worker_id=" .. url_encode(WORKER_ID))
  if body and string.sub(body, 1, 5) == "stop\n" then
    post("/api/v1/stop/clear", WORKER_ID)
    return true, string.sub(body, 6)
  end
  return false
end

local function run_job(job)
  local saved, save_error = save_program(job.filename, job.program)
  if not saved then
    post("/api/v1/jobs/" .. job.id .. "/result?worker_id=" .. url_encode(WORKER_ID), "error\n" .. save_error)
    return
  end

  print("running " .. job.id .. " (source saved as " .. job.filename .. ")")
  local ok, execution_error = pcall(dofile, job.filename)
  if ok then
    post("/api/v1/jobs/" .. job.id .. "/result?worker_id=" .. url_encode(WORKER_ID), "ok\njob completed")
    print("completed " .. job.id)
  else
    post("/api/v1/jobs/" .. job.id .. "/result?worker_id=" .. url_encode(WORKER_ID), "error\n" .. tostring(execution_error))
    print("failed " .. job.id .. ": " .. tostring(execution_error))
  end
end

print("MVP relay poller online as " .. WORKER_ID)
while true do
  local stopped, reason = check_stop()
  if stopped then
    print("stop requested: " .. tostring(reason))
    sleep(POLL_SECONDS)
  else
    local body, poll_error = get("/api/v1/jobs/next?worker_id=" .. url_encode(WORKER_ID))
    if poll_error then
      print("poll failed: " .. poll_error)
    else
      local job, parse_error = parse_job(body)
      if parse_error then print("invalid job: " .. parse_error) end
      if job then run_job(job) end
    end
    sleep(POLL_SECONDS)
  end
end
