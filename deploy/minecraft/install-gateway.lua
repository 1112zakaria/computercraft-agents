-- Manual bootstrap: install-gateway <40-character reviewed Git commit>.
-- This preserves all existing root files in a new backup directory before replacement.
local commit = ({...})[1]
assert(type(commit)=="string" and #commit==40 and commit:match("^%x+$"), "expected pinned 40-character commit")
local files={"config.lua","dispatcher.lua","gateway.conf.example","gateway.lua","heartbeat.lua","http_client.lua","id.lua","logging.lua","outbox.lua","protocol.lua","startup","startup.lua","update_bootstrap.lua","update_manager.lua","worker_registry.lua"}
local root="https://raw.githubusercontent.com/1112zakaria/computercraft-agents/"..commit.."/computercraft/gateway/"
local suffix=tostring(math.floor(os.clock()*1000))
local stage="manual-install-stage-"..suffix
local backup="manual-install-backup-"..suffix
assert(not fs.exists(stage) and not fs.exists(backup),"installation directory exists")
fs.makeDir(stage)
for _,name in ipairs(files) do
  print("Downloading "..name)
  local r,e=http.get(root..name)
  assert(r,e or "download failed")
  local content=r.readAll(); r.close()
  assert(loadstring(content,"@"..name),"downloaded Lua failed parsing")
  local f=assert(fs.open(fs.combine(stage,name),"w")); f.write(content); f.close()
end
fs.makeDir(backup)
for _,name in ipairs(fs.list("")) do
  if name~=stage and name~=backup and name~="rom" and not fs.isDir(name) then
    fs.copy(name,fs.combine(backup,name))
  end
end
for _,name in ipairs(files) do
  -- Preserve a valid CraftOS boot hook. A malformed hook is replaced below,
  -- after the existing copy has already been retained in the backup folder.
  if name~="startup" then
    if fs.exists(name) then fs.delete(name) end
    fs.copy(fs.combine(stage,name),name)
  end
end
local function valid_startup_hook()
  if not fs.exists("startup") or fs.isDir("startup") then return false end
  local handle=fs.open("startup","r")
  if not handle then return false end
  local content=handle.readAll();handle.close()
  return content=='shell.run("startup.lua")\n'
end
if not valid_startup_hook() then
  if fs.exists("startup") then
    local preserved=fs.combine(backup,"startup.previous")
    if fs.exists(preserved) then fs.delete(preserved) end
    fs.move("startup",preserved)
  end
  local hook=assert(fs.open("startup","w"));hook.write('shell.run("startup.lua")\n');hook.close()
end
print("Installed gateway runtime. Original files: "..backup)
print("Preserved gateway.conf and gateway outbox if present. Configure locally, then run startup.")
