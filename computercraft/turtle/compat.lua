-- Legacy ComputerCraft has JSON encoding, but no JSON decoder or UTC clock.
-- Decode data only (never loadstring). UTC is anchored to authenticated VPS responses.
local M = {}
-- Lua table fields assigned nil disappear before encoding. Keep an explicit
-- sentinel for protocol fields whose wire value must be JSON null.
M.JSON_NULL = {}
-- CraftOS gives loadfile calls isolated environments. Persist the anchor in a small local file so
-- startup.lua, direct_http_client.lua and command modules use the same authenticated UTC clock.
local clock_path = "worker-clock.txt"

-- ComputerCraft 1.75 can expose tables from a different program environment to the
-- JSON serializer. Some releases also use a self-referential EMPTY_ARRAY sentinel.
-- Encode the small protocol JSON subset locally so runtime persistence never relies
-- on the legacy native serializer's recursive-table detection.
local function quote_json_string(value)
  local escaped = value:gsub('[%z\1-\31\\"]', function(character)
    local replacements = {
      ['"'] = '\\"',
      ['\\'] = '\\\\',
      ['\b'] = '\\b',
      ['\f'] = '\\f',
      ['\n'] = '\\n',
      ['\r'] = '\\r',
      ['\t'] = '\\t',
    }
    return replacements[character] or string.format('\\u%04x', string.byte(character))
  end)
  return '"' .. escaped .. '"'
end

local function json_encode(value, seen)
  if value == M.JSON_NULL then return "null" end
  local value_type = type(value)
  if value_type == "nil" then return "null" end
  if value_type == "string" then return quote_json_string(value) end
  if value_type == "boolean" then return value and "true" or "false" end
  if value_type == "number" then
    if value ~= value or value == math.huge or value == -math.huge then
      error("cannot encode non-finite number as JSON")
    end
    return tostring(value)
  end
  if value_type ~= "table" then error("cannot encode " .. value_type .. " as JSON") end
  if textutils.EMPTY_ARRAY and value == textutils.EMPTY_ARRAY then return "[]" end
  if seen[value] then error("cannot encode recursive table as JSON") end
  seen[value] = true

  local max_index = 0
  local is_array = true
  for key, _ in pairs(value) do
    if type(key) ~= "number" or key < 1 or key ~= math.floor(key) then
      is_array = false
      break
    end
    if key > max_index then max_index = key end
  end
  if is_array then
    for index = 1, max_index do
      if value[index] == nil then
        is_array = false
        break
      end
    end
  end

  local parts = {}
  if is_array then
    for index = 1, max_index do
      table.insert(parts, json_encode(value[index], seen))
    end
    seen[value] = nil
    return "[" .. table.concat(parts, ",") .. "]"
  end

  for key, item in pairs(value) do
    if type(key) ~= "string" then error("cannot encode non-string JSON key") end
    table.insert(parts, quote_json_string(key) .. ":" .. json_encode(item, seen))
  end
  seen[value] = nil
  return "{" .. table.concat(parts, ",") .. "}"
end

function M.encode_json(value)
  local ok, encoded_or_error = pcall(json_encode, value, {})
  if ok then return encoded_or_error end
  return nil, tostring(encoded_or_error)
end

local function leap(y) return y % 4 == 0 and (y % 100 ~= 0 or y % 400 == 0) end
local function months(y) return {31, leap(y) and 29 or 28,31,30,31,30,31,31,30,31,30,31} end
function M.parse_time(s)
  if type(s) ~= "string" then return nil end
  local y,m,d,h,n,v = s:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)Z$")
  if not y then y,m,d,h,n,v = s:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)%.%d+Z$") end
  y,m,d,h,n,v = tonumber(y),tonumber(m),tonumber(d),tonumber(h),tonumber(n),tonumber(v)
  if not y or y < 1970 or m < 1 or m > 12 or d < 1 or d > months(y)[m] or h > 23 or n > 59 or v > 59 then return nil end
  local days = d - 1
  for year=1970,y-1 do days = days + (leap(year) and 366 or 365) end
  for month=1,m-1 do days = days + months(y)[month] end
  return days * 86400 + h * 3600 + n * 60 + v
end
function M.sync(s)
  local value = M.parse_time(s)
  if not value then return false end
  local handle = fs.open(clock_path .. ".tmp", "w")
  if not handle then return false end
  handle.write(tostring(value) .. "|" .. tostring(os.clock()))
  handle.close()
  if fs.exists(clock_path) then fs.delete(clock_path) end
  fs.move(clock_path .. ".tmp", clock_path)
  return true
end
function M.now()
  if not fs.exists(clock_path) then return nil end
  local handle = fs.open(clock_path, "r")
  if not handle then return nil end
  local value = handle.readAll()
  handle.close()
  local anchor, tick = string.match(value or "", "^(%-?[%d%.]+)|(%-?[%d%.]+)$")
  anchor, tick = tonumber(anchor), tonumber(tick)
  return anchor and tick and anchor + os.clock() - tick or nil
end
function M.iso()
  local value = assert(M.now(), "UTC clock has not synchronized with VPS")
  local days = math.floor(value / 86400)
  local seconds = math.floor(value % 86400)
  local y,m = 1970,1
  while days >= (leap(y) and 366 or 365) do days = days - (leap(y) and 366 or 365); y=y+1 end
  while days >= months(y)[m] do days=days-months(y)[m]; m=m+1 end
  return string.format("%04d-%02d-%02dT%02d:%02d:%02dZ",y,m,days+1,math.floor(seconds/3600),math.floor(seconds/60)%60,seconds%60)
end
local function utf8(n)
  if n < 128 then return string.char(n) end
  if n < 2048 then return string.char(192+math.floor(n/64),128+n%64) end
  if n < 65536 then return string.char(224+math.floor(n/4096),128+math.floor(n/64)%64,128+n%64) end
  return string.char(240+math.floor(n/262144),128+math.floor(n/4096)%64,128+math.floor(n/64)%64,128+n%64)
end
function M.decode(s)
  assert(type(s)=="string" and #s <= 1048576, "invalid JSON input")
  local i, depth = 1, 0
  local parse
  local function ws() while s:sub(i,i):match("%s") do i=i+1 end end
  local function hex()
    local h=s:sub(i,i+3); assert(#h==4 and h:match("^%x+$"),"invalid unicode escape"); i=i+4; return tonumber(h,16)
  end
  local function str()
    assert(s:sub(i,i)=='"',"expected string"); i=i+1
    local out={}
    while i<=#s do
      local c=s:sub(i,i); i=i+1
      if c=='"' then return table.concat(out) end
      if c=='\\' then
        c=s:sub(i,i); i=i+1
        local escapes={['"']='"',['\\']='\\',['/']='/',b='\b',f='\f',n='\n',r='\r',t='\t'}
        if c=='u' then
          local n=hex()
          if n>=55296 and n<=56319 then
            assert(s:sub(i,i+1)=='\\u',"missing low surrogate"); i=i+2
            local low=hex(); assert(low>=56320 and low<=57343,"invalid low surrogate")
            n=65536+(n-55296)*1024+low-56320
          else assert(n<56320 or n>57343,"unexpected low surrogate") end
          c=utf8(n)
        else c=assert(escapes[c],"invalid escape") end
      else assert(c:byte()>=32,"control character in JSON string") end
      out[#out+1]=c
    end
    error("unterminated string")
  end
  parse=function()
    ws(); depth=depth+1; assert(depth<=64,"JSON nesting limit")
    local c=s:sub(i,i); local value
    if c=='"' then value=str()
    elseif c=='{' or c=='[' then
      local object=c=='{'; local closing=object and '}' or ']'; i=i+1; ws(); value={}; local index=1
      if s:sub(i,i)~=closing then
        while true do
          ws(); local key=index
          if object then key=str(); ws(); assert(s:sub(i,i)==':',"expected colon"); i=i+1 end
          value[key]=parse(); index=index+1; ws()
          if s:sub(i,i)~=',' then break end
          i=i+1
        end
      end
      assert(s:sub(i,i)==closing,"expected closing delimiter"); i=i+1
    elseif s:sub(i,i+3)=='true' then value=true; i=i+4
    elseif s:sub(i,i+4)=='false' then value=false; i=i+5
    elseif s:sub(i,i+3)=='null' then value=nil; i=i+4
    else
      local start=i
      if s:sub(i,i)=='-' then i=i+1 end
      if s:sub(i,i)=='0' then i=i+1 else
        assert(s:sub(i,i):match('[1-9]'),"expected JSON value")
        repeat i=i+1 until not s:sub(i,i):match('%d')
      end
      if s:sub(i,i)=='.' then i=i+1; assert(s:sub(i,i):match('%d'),"invalid fraction"); repeat i=i+1 until not s:sub(i,i):match('%d') end
      if s:sub(i,i):match('[eE]') then
        i=i+1; if s:sub(i,i):match('[+-]') then i=i+1 end
        assert(s:sub(i,i):match('%d'),"invalid exponent"); repeat i=i+1 until not s:sub(i,i):match('%d')
      end
      value=assert(tonumber(s:sub(start,i-1)),"invalid number")
      assert(value~=math.huge and value~=-math.huge,"number overflow")
    end
    depth=depth-1; return value
  end
  local result=parse(); ws(); assert(i>#s,"trailing JSON data"); return result
end
function M.install()
  textutils.unserializeJSON = textutils.unserializeJSON or M.decode
  if not os.date then
    os.date=function(format) assert(format=="!%Y-%m-%dT%H:%M:%SZ","unsupported date format"); return M.iso() end
  end
end
return M
