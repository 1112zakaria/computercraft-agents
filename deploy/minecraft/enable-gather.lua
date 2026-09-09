-- Add the capabilities used by the first bounded gather and inspection workflow.
-- This preserves the existing worker configuration and creates a backup before writing.
local config_path = "worker.conf"
local temporary_path = "worker.conf.gather.tmp"
local startup_temporary_path = "startup.gather.tmp"
local startup_hook = 'shell.run("startup.lua")\n'
local required = { "mining.gather", "navigate.path", "inventory.deposit", "peripheral.inspect" }

local function fail(message)
  error(message, 0)
end

local function backup_path()
  local base = "worker.conf.before-gather"
  if not fs.exists(base) then return base end
  for index = 1, 99 do
    local candidate = base .. "." .. tostring(index)
    if not fs.exists(candidate) then return candidate end
  end
  fail("could not choose a worker.conf backup path")
end

local function startup_backup_path()
  local base = "startup.previous"
  if not fs.exists(base) then return base end
  for index = 1, 99 do
    local candidate = base .. "." .. tostring(index)
    if not fs.exists(candidate) then return candidate end
  end
  fail("could not choose a startup hook backup path")
end

local function startup_hook_is_valid()
  if not fs.exists("startup") or fs.isDir("startup") then return false end
  local handle = fs.open("startup", "r")
  if not handle then return false end
  local content = handle.readAll()
  handle.close()
  return content == startup_hook
end

local function ensure_startup_hook()
  if startup_hook_is_valid() then return false end
  local had_existing = fs.exists("startup")
  local preserved = startup_backup_path()
  if had_existing then
    local moved, move_error = pcall(fs.move, "startup", preserved)
    if not moved then fail("could not preserve the existing startup hook: " .. tostring(move_error)) end
  end
  if fs.exists(startup_temporary_path) then fs.delete(startup_temporary_path) end
  local handle = fs.open(startup_temporary_path, "w")
  if not handle then
    if had_existing then fs.move(preserved, "startup") end
    fail("could not create the CraftOS startup hook")
  end
  handle.write(startup_hook)
  handle.close()
  local activated, activation_error = pcall(fs.move, startup_temporary_path, "startup")
  if not activated then
    if fs.exists(startup_temporary_path) then fs.delete(startup_temporary_path) end
    if had_existing then fs.move(preserved, "startup") end
    fail("could not activate the CraftOS startup hook: " .. tostring(activation_error))
  end
  if had_existing then
    print("Repaired CraftOS startup hook; previous copy: " .. preserved)
  else
    print("Created CraftOS startup hook")
  end
  return true
end

if not fs.exists(config_path) then
  fail("worker.conf was not found; copy worker.conf.example first")
end
if fs.isDir(config_path) then
  fail("worker.conf is a directory")
end

local chunk, load_error = loadfile(config_path)
if not chunk then fail("could not load worker.conf: " .. tostring(load_error)) end
local ok, config = pcall(chunk)
if not ok or type(config) ~= "table" then
  fail("worker.conf must return a table")
end

ensure_startup_hook()

if config.capabilities == nil then
  print("worker.conf has no explicit capabilities; runtime defaults already include first-use capabilities")
  return
end
if type(config.capabilities) ~= "table" then
  fail("worker.conf capabilities must be a table")
end

local present = {}
for _, capability in ipairs(config.capabilities) do
  if type(capability) == "string" then present[capability] = true end
end
local added = {}
for _, capability in ipairs(required) do
  if not present[capability] then
    table.insert(config.capabilities, capability)
    table.insert(added, capability)
  end
end

if #added == 0 then
  print("worker.conf already advertises first-use capabilities")
  return
end
if not textutils or type(textutils.serialize) ~= "function" then
  fail("textutils.serialize is required to update worker.conf")
end

local backup = backup_path()
local backed_up, backup_error = pcall(fs.copy, config_path, backup)
if not backed_up then
  fail("could not back up worker.conf: " .. tostring(backup_error))
end
local serialized = textutils.serialize(config)
if not serialized then
  fail("could not serialize worker.conf; original is preserved at " .. backup)
end
if fs.exists(temporary_path) then fs.delete(temporary_path) end
local handle = fs.open(temporary_path, "w")
if not handle then fail("could not create temporary worker.conf") end
handle.write("return " .. serialized .. "\n")
handle.close()
if fs.exists(config_path) then fs.delete(config_path) end
local activated, activation_error = pcall(fs.move, temporary_path, config_path)
if not activated then
  if fs.exists(config_path) then fs.delete(config_path) end
  fs.copy(backup, config_path)
  if fs.exists(temporary_path) then fs.delete(temporary_path) end
  fail("could not activate worker.conf; original was restored: " .. tostring(activation_error))
end

print("Added: " .. table.concat(added, ", "))
print("Backup: " .. backup)
print("Run startup to re-register with the updated capabilities")
