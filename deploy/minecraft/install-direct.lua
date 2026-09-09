-- Manual bootstrap: install-direct <40-character reviewed Git commit>.
-- This preserves all existing root files in a new backup directory before replacement.
local commit = ({...})[1]
assert(type(commit)=="string" and #commit==40 and commit:match("^%x+$"), "expected pinned 40-character commit")
local files={"cancellation.lua","compat.lua","config.lua","direct_http_client.lua","excavation.lua","executor.lua","fuel.lua","id.lua","idempotency.lua","inventory.lua","logging.lua","movement.lua","observation.lua","protocol.lua","rednet_client.lua","startup","startup.lua","state.lua","update_bootstrap.lua","update_manager.lua"}
local root="https://raw.githubusercontent.com/1112zakaria/computercraft-agents/"..commit.."/computercraft/turtle/"
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
  if fs.exists(name) then fs.delete(name) end
  fs.copy(fs.combine(stage,name),name)
end
if not fs.exists("startup") then
  local hook=assert(fs.open("startup","w"));hook.write('shell.run("startup.lua")\n');hook.close()
end
print("Installed runtime. Original files: "..backup)
print("Configure worker.conf, then run startup.")
