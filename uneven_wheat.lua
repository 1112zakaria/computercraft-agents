-- uneven_wheat.lua
-- ComputerCraft 1.75 / Minecraft 1.7.10
--
-- Bounded DFS wheat farmer for uneven terrain.
-- Setup:
--   * Farming Turtle at the EDGE of the farm, facing INTO the farm.
--   * Turtle is one block above the wheat crop layer (two above farmland).
--   * Vanilla chest directly BEHIND the turtle, at turtle height.
--   * Put some wheat seeds and fuel in the turtle.
--
-- The program explores reachable terrain within +/-20 blocks of home,
-- permits at most one block of elevation change per horizontal move,
-- harvests only mature vanilla wheat, replants, returns home, and unloads.

local MAX_RADIUS = 20
local TARGET_FUEL = 12000
local KEEP_SEEDS = 16

local WHEAT = "minecraft:wheat"
local SEEDS = "minecraft:wheat_seeds"

-- Surfaces the turtle may travel over. Water allows crossing irrigation.
local ALLOWED_GROUND = {
    ["minecraft:farmland"] = true,
    ["minecraft:water"] = true,
    ["minecraft:flowing_water"] = true,
}

-- Relative turtle coordinates. Starting direction is treated as north.
local x, y, z = 0, 0, 0
local dir = 0 -- 0=N, 1=E, 2=S, 3=W

local DX = { [0] = 0,  [1] = 1, [2] = 0,  [3] = -1 }
local DZ = { [0] = -1, [1] = 0, [2] = 1,  [3] = 0 }

local visited = {}
local abortReason = nil
local stats = { cells = 0, harvested = 0, planted = 0, failedPlant = 0 }

local function key(px, pz)
    return tostring(px) .. "," .. tostring(pz)
end

local function inBounds(px, pz)
    return math.abs(px) <= MAX_RADIUS and math.abs(pz) <= MAX_RADIUS
end

local function rawForward()
    if turtle.forward() then
        x = x + DX[dir]
        z = z + DZ[dir]
        return true
    end
    return false
end

local function rawBack()
    if turtle.back() then
        x = x - DX[dir]
        z = z - DZ[dir]
        return true
    end
    return false
end

local function rawUp()
    if turtle.up() then
        y = y + 1
        return true
    end
    return false
end

local function rawDown()
    if turtle.down() then
        y = y - 1
        return true
    end
    return false
end

local function turnLeft()
    turtle.turnLeft()
    dir = (dir + 3) % 4
end

local function turnRight()
    turtle.turnRight()
    dir = (dir + 1) % 4
end

local function turnTo(target)
    local diff = (target - dir) % 4
    if diff == 1 then
        turnRight()
    elseif diff == 2 then
        turnRight(); turnRight()
    elseif diff == 3 then
        turnLeft()
    end
end

local function itemName(slot)
    local d = turtle.getItemDetail(slot)
    return d and d.name or nil
end

local function selectItem(name)
    for i = 1, 16 do
        if turtle.getItemCount(i) > 0 and itemName(i) == name then
            turtle.select(i)
            return true
        end
    end
    return false
end

local function hasRoomFor(name)
    for i = 1, 16 do
        if turtle.getItemCount(i) == 0 then return true end
        if itemName(i) == name and turtle.getItemSpace(i) > 0 then return true end
    end
    return false
end

local function ensureFuel(target)
    local fuel = turtle.getFuelLevel()
    if fuel == "unlimited" or fuel >= target then return true end

    local old = turtle.getSelectedSlot()
    for i = 1, 16 do
        if turtle.getItemCount(i) > 0 then
            turtle.select(i)
            if turtle.refuel(0) then
                turtle.refuel()
                fuel = turtle.getFuelLevel()
                if fuel >= target then
                    turtle.select(old)
                    return true
                end
            end
        end
    end
    turtle.select(old)
    return turtle.getFuelLevel() >= target
end

local function wheatAge(data)
    if not data then return nil end
    if data.metadata ~= nil then return tonumber(data.metadata) end
    if data.state and data.state.age ~= nil then return tonumber(data.state.age) end
    return nil
end

local function isWheat(data)
    return data and data.name == WHEAT
end

local function isAllowedGround(data)
    return data and ALLOWED_GROUND[data.name] == true
end

-- At correct cruising height there is exactly one crop/air block between
-- turtle and ground. If wheat is directly below, the tile is valid.
-- If air is below, temporarily descend to inspect the actual surface.
local function verifySurface()
    local ok, data = turtle.inspectDown()

    if ok then
        if isWheat(data) then return true end
        -- Ground immediately below means the turtle is one block too low.
        return false
    end

    if not rawDown() then return false end
    local groundOk, groundData = turtle.inspectDown()
    if not rawUp() then error("Could not return upward after terrain probe") end

    return groundOk and isAllowedGround(groundData)
end

-- Move one horizontal cell, accepting only -1/0/+1 elevation changes.
-- Returns success, verticalDelta.
local function tryNeighbor()
    local deltas = { 0, 1, -1 }

    for _, d in ipairs(deltas) do
        if d == 0 then
            if rawForward() then
                if verifySurface() then return true, 0 end
                if not rawBack() then error("Failed to reverse level probe") end
            end

        elseif d == 1 then
            if rawUp() then
                if rawForward() then
                    if verifySurface() then return true, 1 end
                    if not rawBack() then error("Failed to reverse uphill probe") end
                end
                if not rawDown() then error("Failed to reverse uphill probe") end
            end

        elseif d == -1 then
            if rawForward() then
                if rawDown() then
                    if verifySurface() then return true, -1 end
                    if not rawUp() then error("Failed to reverse downhill probe") end
                end
                if not rawBack() then error("Failed to reverse downhill probe") end
            end
        end
    end

    return false, nil
end

-- Traverse an already-known edge while backtracking.
local function moveKnown(delta)
    for attempt = 1, 20 do
        local sx, sy, sz = x, y, z
        local ok = false

        if delta == 0 then
            ok = rawForward()
        elseif delta == 1 then
            if rawUp() then
                if rawForward() then ok = true else rawDown() end
            end
        elseif delta == -1 then
            if rawForward() then
                if rawDown() then ok = true else rawBack() end
            end
        end

        if ok then return true end
        if x ~= sx or y ~= sy or z ~= sz then
            error("Backtracking movement desynchronized")
        end
        sleep(0.25)
    end
    return false
end

local function plantSeed()
    if not selectItem(SEEDS) then
        stats.failedPlant = stats.failedPlant + 1
        return false
    end

    if turtle.placeDown() then
        stats.planted = stats.planted + 1
        return true
    end

    stats.failedPlant = stats.failedPlant + 1
    return false
end

local function serviceCurrentTile()
    local ok, data = turtle.inspectDown()

    if ok and isWheat(data) then
        local age = wheatAge(data)
        if age == 7 then
            if not hasRoomFor(WHEAT) or not hasRoomFor(SEEDS) then
                abortReason = "inventory nearly full"
                return
            end

            if turtle.digDown() then
                stats.harvested = stats.harvested + 1
                plantSeed()
            end
        end

    elseif not ok then
        -- On empty farmland this plants; above water it simply fails.
        if selectItem(SEEDS) and turtle.placeDown() then
            stats.planted = stats.planted + 1
        end
    end
end

local function returnOneFrame(frame)
    turnTo((frame.cameDir + 2) % 4)
    if not moveKnown(-frame.cameDelta) then
        error("Unable to backtrack to parent cell")
    end
end

local function explore()
    visited[key(0, 0)] = true
    stats.cells = 1

    -- Explicit stack avoids recursion depth problems.
    local stack = {
        { nextDir = 0, cameDir = nil, cameDelta = 0 }
    }

    serviceCurrentTile()

    while #stack > 0 do
        if abortReason then break end

        local frame = stack[#stack]

        if frame.nextDir >= 4 then
            if #stack == 1 then break end
            table.remove(stack)
            returnOneFrame(frame)
        else
            local nextDir = frame.nextDir
            frame.nextDir = frame.nextDir + 1

            local nx = x + DX[nextDir]
            local nz = z + DZ[nextDir]

            if inBounds(nx, nz) and not visited[key(nx, nz)] then
                turnTo(nextDir)
                local moved, delta = tryNeighbor()

                if moved then
                    visited[key(x, z)] = true
                    stats.cells = stats.cells + 1
                    serviceCurrentTile()

                    table.insert(stack, {
                        nextDir = 0,
                        cameDir = nextDir,
                        cameDelta = delta,
                    })
                end
            end
        end
    end

    -- Early stop: unwind the exact DFS route back home.
    while #stack > 1 do
        local frame = stack[#stack]
        table.remove(stack)
        returnOneFrame(frame)
    end

    if x ~= 0 or y ~= 0 or z ~= 0 then
        error("Backtracked, but did not reach home coordinates")
    end

    turnTo(0)
end

local function isVanillaChestInFront()
    local ok, data = turtle.inspect()
    return ok and data and (
        data.name == "minecraft:chest" or
        data.name == "minecraft:trapped_chest"
    )
end

local function unloadBehind()
    turnRight(); turnRight()

    if not isVanillaChestInFront() then
        print("WARNING: no vanilla chest behind home")
        print("Harvest remains inside turtle")
        turnRight(); turnRight()
        return
    end

    local totalSeeds = 0
    for i = 1, 16 do
        if itemName(i) == SEEDS then
            totalSeeds = totalSeeds + turtle.getItemCount(i)
        end
    end
    local seedsToDrop = math.max(0, totalSeeds - KEEP_SEEDS)

    for i = 1, 16 do
        local name = itemName(i)
        if name == WHEAT then
            turtle.select(i)
            if not turtle.drop() then
                print("WARNING: chest full; some wheat kept")
            end
        elseif name == SEEDS and seedsToDrop > 0 then
            local amount = math.min(turtle.getItemCount(i), seedsToDrop)
            turtle.select(i)
            if turtle.drop(amount) then
                seedsToDrop = seedsToDrop - amount
            else
                print("WARNING: chest full; some seeds kept")
                seedsToDrop = 0
            end
        end
    end

    turnRight(); turnRight()
end

term.clear()
term.setCursorPos(1, 1)
print("Uneven Wheat Farmer")
print("-------------------")
print("Radius: +/-" .. MAX_RADIUS)
print("Max step: 1 block")
print("")

if not ensureFuel(TARGET_FUEL) then
    print("Not enough fuel")
    print("Target: " .. TARGET_FUEL)
    print("Add coal/charcoal/etc. and run again")
    return
end

print("Fuel: " .. tostring(turtle.getFuelLevel()))
print("Starting exploration...")
print("")

explore()

print("")
print("Back home")
if abortReason then
    print("Stopped early: " .. abortReason)
else
    print("Reachable area complete")
end

unloadBehind()

print("")
print("Visited cells: " .. stats.cells)
print("Mature wheat harvested: " .. stats.harvested)
print("Seeds planted: " .. stats.planted)
if stats.failedPlant > 0 then
    print("Failed replant attempts: " .. stats.failedPlant)
end
print("Done")
