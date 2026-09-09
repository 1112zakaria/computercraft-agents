-- Stable recovery layer. Keep this file and startup.lua outside the managed runtime set.
local M = {}
local compat = assert(loadfile("compat.lua"))()
local startup_hook = 'shell.run("startup.lua")\n'

local function ensure_startup_hook()
  if fs.exists("startup") then return true end
  local temporary = "startup.bootstrap.tmp"
  if fs.exists(temporary) then fs.delete(temporary) end
  local handle = fs.open(temporary, "w")
  if not handle then return false, "cannot create CraftOS startup hook" end
  handle.write(startup_hook)
  handle.close()
  fs.move(temporary, "startup")
  return true
end

local function write_json(path, value)
  local handle = fs.open(path .. ".tmp", "w")
  if not handle then
    return false, "cannot write update journal"
  end
  local encoded, encode_error = compat.encode_json(value)
  if not encoded then
    handle.close()
    if fs.exists(path .. ".tmp") then fs.delete(path .. ".tmp") end
    return false, encode_error
  end
  handle.write(encoded)
  handle.close()
  if fs.exists(path) then
    fs.delete(path)
  end
  fs.move(path .. ".tmp", path)
  return true
end

local function read_json(path)
  if not fs.exists(path) then
    return nil
  end
  local handle = fs.open(path, "r")
  if not handle then
    return nil, "cannot read update journal"
  end
  local value = handle.readAll()
  handle.close()
  local ok, decoded = pcall(textutils.unserializeJSON, value)
  if not ok or type(decoded) ~= "table" then
    return nil, "update journal is invalid"
  end
  return decoded
end

local function restore(journal)
  if type(journal.files) ~= "table" or type(journal.backupPath) ~= "string" then
    return false, "update journal has no rollback information"
  end
  for _, path in ipairs(journal.files) do
    local backup = fs.combine(journal.backupPath, path)
    if fs.exists(backup) then
      if fs.exists(path) then
        fs.delete(path)
      end
      fs.copy(backup, path)
    end
  end
  if journal.versionPath then
    local version_backup = fs.combine(journal.backupPath, ".runtime-version")
    if fs.exists(version_backup) then
      if fs.exists(journal.versionPath) then fs.delete(journal.versionPath) end
      fs.copy(version_backup, journal.versionPath)
    elseif fs.exists(journal.versionPath) then
      fs.delete(journal.versionPath)
    end
  end
  return true
end

function M.recover(journal_path)
  local hook_ok, hook_error = ensure_startup_hook()
  if not hook_ok then return false, hook_error end
  local journal, read_error = read_json(journal_path)
  if not journal then
    return true, read_error
  end
  if journal.phase == "activated" then
    journal.phase = "awaiting-confirmation"
    local written, write_error = write_json(journal_path, journal)
    return written, write_error, written and journal or nil, false
  end
  if journal.phase == "activating" or journal.phase == "awaiting-confirmation" then
    local restored, restore_error = restore(journal)
    if not restored then
      return false, restore_error
    end
    if fs.exists(journal_path) then
      fs.delete(journal_path)
    end
    if journal.backupPath and fs.exists(journal.backupPath) then
      fs.delete(journal.backupPath)
    end
    return true, nil, journal, true
  end
  return true
end

function M.begin(journal_path, journal)
  journal.phase = "activating"
  return write_json(journal_path, journal)
end

function M.mark_activated(journal_path, journal)
  journal.phase = "activated"
  return write_json(journal_path, journal)
end

function M.confirm(journal_path, journal)
  if fs.exists(journal_path) then
    fs.delete(journal_path)
  end
  if journal and journal.backupPath and fs.exists(journal.backupPath) then
    fs.delete(journal.backupPath)
  end
  return true
end

return M
