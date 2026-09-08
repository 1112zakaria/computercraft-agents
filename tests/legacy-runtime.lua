-- Run with lua5.1 from the repository root; no Minecraft or network required.
local ticks=0
os.clock=function() return ticks end
os.date=nil
textutils={}
package.path="computercraft/turtle/?.lua;"..package.path
local compat=require("compat")
compat.install()
local obj=compat.decode('{"commands":[],"ok":true,"no":false,"nextCursor":null,"n":-1.5e2,"s":"a\\n\\u0041\\uD83D\\uDE00"}')
assert(type(obj.commands)=="table" and obj.ok and obj.no==false and obj.nextCursor==nil)
assert(obj.n==-150 and obj.s=="a\nA"..string.char(240,159,152,128))
for _,s in ipairs({'{"x":}', '[1,]', '{"x":1,}', '01', '1e', '"\\q"', 'true false', 'loadstring("x")', '"\\uD800"'}) do
  assert(not pcall(compat.decode,s),s)
end
assert(not compat.now())
assert(not compat.sync("bad"))
assert(compat.sync("2026-09-08T23:59:59.123Z"))
assert(os.date("!%Y-%m-%dT%H:%M:%SZ")=="2026-09-08T23:59:59Z")
assert(assert(loadfile("computercraft/turtle/compat.lua"))().now(), "clock must span isolated modules")
ticks=2
assert(compat.iso()=="2026-09-09T00:00:01Z")
assert(not compat.parse_time("2026-02-29T00:00:00Z"))
local protocol=require("protocol")
assert(not protocol.is_expired("2026-09-09T00:00:02.000Z"))
assert(protocol.is_expired("2026-09-09T00:00:00.000Z"))
assert(protocol.is_expired("invalid"))
print("legacy JSON, synchronized UTC, and expiry tests passed")
os.getComputerID=function() return 9 end
os.time=function() return 12 end
local id=require("id")
assert(id.new("evt")~=id.new("evt"),"same-tick events must have unique IDs")
