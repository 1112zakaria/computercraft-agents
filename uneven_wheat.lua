-- uneven_wheat.lua
-- ComputerCraft 1.75 / Minecraft 1.7.10
--
-- Alice's uneven-terrain wheat farmer.
--
-- Setup:
--   * Put Alice at the same HOME position every run.
--   * Alice must face the same direction every run. That direction is "north"
--     for the saved relative map.
--   * Normal cruising height is one block above the wheat crop itself
--     (two blocks above farmland).
--   * Put a vanilla chest directly BEHIND Alice at HOME, at turtle height.
--   * Give Alice wheat seeds, fuel, and a digging-capable turtle tool
--     (a diamond pickaxe is fine).
--
-- Commands:
--   uneven_wheat map [radius] [fuel]
--       Safely discovers the farm geometry and saves uneven_wheat.map.
--       Immature wheat is mapped just like mature wheat.
--
--   uneven_wheat farm [fuel]
--       Loads the saved map and farms it without rediscovering the terrain.
--       Alice uses shortest known routes, with straight movement used only as
--       a tie-breaker/preference among equally close choices.
--
--   uneven_wheat status
--       Shows information about the saved map.
--
--   uneven_wheat reset
--       Deletes the saved map.
--
-- With no command, Alice maps if no map exists, otherwise she farms.

local args = { ... }

local MAP_FILE = "uneven_wheat.map"
local MAP_VERSION = 3

local DEFAULT_MAX_RADIUS = 20
local DEFAULT_TARGET_FUEL = 12000
local KEEP_SEEDS = 16

local WHEAT = "minecraft:wheat"
local SEEDS = "minecraft:wheat_seeds"
local WATER = "minecraft:water"
local FLOWING_WATER = "minecraft:flowing_water"

local mode = string.lower(args[1] or "")
if mode == "" then
    if fs.exists(MAP_FILE) then
        mode = "farm"
    else
        mode = "map"
    end
end

local MAX_RADIUS = DEFAULT_MAX_RADIUS
local TARGET_FUEL = DEFAULT_TARGET_FUEL

if mode == "map" then
    MAX_RADIUS = tonumber(args[2]) or DEFAULT_MAX_RADIUS
    TARGET_FUEL = tonumber(args[3]) or DEFAULT_TARGET_FUEL
elseif mode == "farm" then
    TARGET_FUEL = tonumber(args[2]) or DEFAULT_TARGET_FUEL
end

-- Relative turtle coordinates. HOME is (0, 0, 0), and the direction Alice
-- faces when the program starts is north.
local x, y, z = 0, 0, 0
local dir = 0 -- 0=N, 1=E, 2=S, 3=W

local DX = { [0] = 0,  [1] = 1, [2] = 0,  [3] = -1 }
local DZ = { [0] = -1, [1] = 0, [2] = 1,  [3] = 0 }

local mapData = nil
local tried = {}
local serviced = {}
local abortReason = nil

local stats = {
    moves = 0,
    cellsMapped = 0,
    cropChecks = 0,
    harvested = 0,
    planted = 0,
    failedPlant = 0,
    failedHarvest = 0,
}

local function key(px, pz)
    return tostring(px) .. "," .. tostring(pz)
end

local function currentKey()
    return key(x, z)
end

local function inBounds(px, pz)
    return math.abs(px) <= MAX_RADIUS and math.abs(pz) <= MAX_RADIUS
end

local function opposite(d)
    return (d + 2) % 4
end

-- Straight is preferred only when choices are otherwise comparable.
local function preferredDirs(heading)
    return {
        heading,
        (heading + 3) % 4,
        (heading + 1) % 4,
        (heading + 2) % 4,
    }
end

local function rawForward()
    if turtle.forward() then
        x = x + DX[dir]
        z = z + DZ[dir]
        stats.moves = stats.moves + 1
        return true
    end
    return false
end

local function rawBack()
    if turtle.back() then
        x = x - DX[dir]
        z = z - DZ[dir]
        stats.moves = stats.moves + 1
        return true
    end
    return false
end

local function rawUp()
    if turtle.up() then
        y = y + 1
        stats.moves = stats.moves + 1
        return true
    end
    return false
end

local function rawDown()
    if turtle.down() then
        y = y - 1
        stats.moves = stats.moves + 1
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
        turnRight()
        turnRight()
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
        if turtle.getItemCount(i) == 0 then
            return true
        end
        if itemName(i) == name and turtle.getItemSpace(i) > 0 then
            return true
        end
    end
    return false
end

local function ensureFuel(target)
    local fuel = turtle.getFuelLevel()
    if fuel == "unlimited" then
        return true
    end
    if fuel >= target then
        return true
    end

    local old = turtle.getSelectedSlot()

    for i = 1, 16 do
        if turtle.getItemCount(i) > 0 then
            turtle.select(i)
            if turtle.refuel(0) then
                turtle.refuel()
                fuel = turtle.getFuelLevel()
                if fuel == "unlimited" or fuel >= target then
                    turtle.select(old)
                    return true
                end
            end
        end
    end

    turtle.select(old)
    fuel = turtle.getFuelLevel()
    return fuel == "unlimited" or fuel >= target
end

local function wheatAge(data)
    if not data then
        return nil
    end

    -- ComputerCraft 1.75 / Minecraft 1.7.10 reports crop growth as metadata.
    if data.metadata ~= nil then
        return tonumber(data.metadata)
    end

    -- Kept as a harmless compatibility fallback for newer inspection formats.
    if data.state and data.state.age ~= nil then
        return tonumber(data.state.age)
    end

    return nil
end

local function isWheat(data)
    return data and data.name == WHEAT
end

local function isWater(data)
    return data and (data.name == WATER or data.name == FLOWING_WATER)
end

local function plantSeed()
    if not selectItem(SEEDS) then
        stats.failedPlant = stats.failedPlant + 1
        return false
    end

    -- Alice stays at cruising height. placeDown can plant onto the farmland
    -- beneath the empty crop space without Alice occupying that crop space.
    if turtle.placeDown() then
        stats.planted = stats.planted + 1
        return true
    end

    stats.failedPlant = stats.failedPlant + 1
    return false
end

-- Determine what kind of traversable farm cell Alice is currently above.
--
-- SAFETY RULE: never descend onto bare farmland merely to inspect it.
-- Doing so places the turtle directly in the crop space above farmland and can
-- cause farmland to revert to dirt. Instead, bare farmland is detected by
-- successfully planting a seed from cruising height.
local function classifyCurrentSurface()
    local ok, data = turtle.inspectDown()

    if ok then
        if isWheat(data) then
            return "crop"
        end

        -- A solid block immediately below means Alice is not at the expected
        -- cruising height for a wheat/water farm cell.
        return nil
    end

    -- The crop space immediately below Alice is empty. First test for bare
    -- farmland WITHOUT moving down: planting a seed succeeds only when there
    -- is suitable farmland within placeDown's reach.
    if selectItem(SEEDS) then
        if turtle.placeDown() then
            stats.planted = stats.planted + 1
            return "crop"
        end
    else
        -- Without seeds there is no safe way for this program to distinguish
        -- bare farmland from another surface without risking a descent onto it.
        -- Abort mapping rather than silently saving an incomplete map.
        abortReason = "out of wheat seeds while mapping safely"
        return nil
    end

    -- Seed placement failed, so this is not normal plantable vanilla farmland.
    -- Descend one block only to test for an irrigation-water cell, then return
    -- immediately to cruising height.
    if not rawDown() then
        return nil
    end

    local groundOk, groundData = turtle.inspectDown()

    if not rawUp() then
        error("Could not return upward after water probe")
    end

    if groundOk and isWater(groundData) then
        return "water"
    end

    return nil
end

-- Move one horizontal cell while discovering unknown terrain. Alice tests
-- same elevation first, then one block higher, then one block lower.
-- Returns: success, verticalDelta, kind
local function tryNeighborAndClassify()
    local deltas = { 0, 1, -1 }

    for _, d in ipairs(deltas) do
        if abortReason then
            return false, nil, nil
        end

        if d == 0 then
            if rawForward() then
                local kind = classifyCurrentSurface()
                if kind then
                    return true, 0, kind
                end

                if not rawBack() then
                    error("Failed to reverse level terrain probe")
                end
            end

        elseif d == 1 then
            if rawUp() then
                if rawForward() then
                    local kind = classifyCurrentSurface()
                    if kind then
                        return true, 1, kind
                    end

                    if not rawBack() then
                        error("Failed to reverse uphill terrain probe")
                    end
                end

                if not rawDown() then
                    error("Failed to reverse uphill terrain probe")
                end
            end

        elseif d == -1 then
            if rawForward() then
                if rawDown() then
                    local kind = classifyCurrentSurface()
                    if kind then
                        return true, -1, kind
                    end

                    if not rawUp() then
                        error("Failed to reverse downhill terrain probe")
                    end
                end

                if not rawBack() then
                    error("Failed to reverse downhill terrain probe")
                end
            end
        end
    end

    return false, nil, nil
end

-- Traverse a confirmed map edge. delta is the target cruising Y minus the
-- current cruising Y and must be -1, 0, or +1.
local function moveKnown(delta)
    for attempt = 1, 20 do
        local sx, sy, sz = x, y, z
        local ok = false

        if delta == 0 then
            ok = rawForward()

        elseif delta == 1 then
            if rawUp() then
                if rawForward() then
                    ok = true
                else
                    if not rawDown() then
                        error("Could not undo blocked uphill move")
                    end
                end
            end

        elseif delta == -1 then
            if rawForward() then
                if rawDown() then
                    ok = true
                else
                    if not rawBack() then
                        error("Could not undo blocked downhill move")
                    end
                end
            end

        else
            error("Invalid mapped elevation change: " .. tostring(delta))
        end

        if ok then
            return true
        end

        if x ~= sx or y ~= sy or z ~= sz then
            error("Known-path movement desynchronized")
        end

        sleep(0.25)
    end

    return false
end

local function serviceCurrentCrop()
    stats.cropChecks = stats.cropChecks + 1

    local ok, data = turtle.inspectDown()

    if ok and isWheat(data) then
        local age = wheatAge(data)

        -- Immature wheat is intentionally left alone, but the map still keeps
        -- this position as a crop cell.
        if age ~= 7 then
            return
        end

        -- Make sure Alice can replant BEFORE breaking the mature crop.
        if not selectItem(SEEDS) then
            abortReason = "out of wheat seeds"
            return
        end

        if not hasRoomFor(WHEAT) or not hasRoomFor(SEEDS) then
            abortReason = "inventory nearly full"
            return
        end

        local dug, err = turtle.digDown()
        if not dug then
            stats.failedHarvest = stats.failedHarvest + 1
            print("Harvest failed: " .. tostring(err))
            return
        end

        stats.harvested = stats.harvested + 1

        if not plantSeed() then
            abortReason = "could not replant harvested wheat"
        end

    elseif not ok then
        -- This is a known crop cell whose crop is missing. Attempt to repair it
        -- from cruising height; never descend onto the farmland. Stop if the
        -- repair fails rather than continuing over a damaged/unknown crop cell.
        if not plantSeed() then
            abortReason = "could not plant known crop cell " .. currentKey()
        end

    else
        -- Something other than wheat occupies the crop layer. Leave it alone.
        print("WARNING: crop cell blocked by " .. tostring(data.name))
    end
end

local function serviceCellOnce(k)
    if serviced[k] then
        return
    end

    serviced[k] = true

    local cell = mapData and mapData.cells and mapData.cells[k]
    if cell and cell.kind == "crop" then
        serviceCurrentCrop()
    end
end

local function getCell(k)
    return mapData and mapData.cells and mapData.cells[k] or nil
end

local function edgeKey(d)
    return tostring(d)
end

local function getEdge(cell, d)
    if not cell or not cell.edges then
        return nil
    end
    return cell.edges[edgeKey(d)]
end

local function setEdge(cell, d, targetKey)
    cell.edges = cell.edges or {}
    cell.edges[edgeKey(d)] = targetKey
end

local function storeCurrentCell(kind, isHome)
    local k = currentKey()
    local existing = getCell(k)

    if existing then
        if existing.y ~= y then
            error("Map has two different elevations at " .. k)
        end

        if kind and existing.kind == "home" then
            existing.kind = kind
        end

        if isHome then
            existing.home = true
        end

        return existing, false
    end

    local cell = {
        x = x,
        y = y,
        z = z,
        kind = kind or "home",
        home = isHome or false,
        edges = {},
    }

    mapData.cells[k] = cell
    stats.cellsMapped = stats.cellsMapped + 1
    return cell, true
end

local function connectCells(aKey, d, bKey)
    local a = getCell(aKey)
    local b = getCell(bKey)

    if not a or not b then
        error("Tried to connect missing map cells")
    end

    setEdge(a, d, bKey)
    setEdge(b, opposite(d), aKey)
end

local function markTried(k, d)
    tried[k] = tried[k] or {}
    tried[k][edgeKey(d)] = true
end

local function wasTried(k, d)
    return tried[k] and tried[k][edgeKey(d)] == true
end

local function hasFrontier(k)
    local cell = getCell(k)
    if not cell then
        return false
    end

    for d = 0, 3 do
        local nx = cell.x + DX[d]
        local nz = cell.z + DZ[d]

        if inBounds(nx, nz) and not getEdge(cell, d) and not wasTried(k, d) then
            return true
        end
    end

    return false
end

local function attemptExploreDirection(d)
    local sourceKey = currentKey()
    local source = getCell(sourceKey)

    if not source then
        error("Current position is missing from map")
    end

    local nx = x + DX[d]
    local nz = z + DZ[d]

    if not inBounds(nx, nz) then
        markTried(sourceKey, d)
        return false
    end

    if getEdge(source, d) then
        markTried(sourceKey, d)
        return false
    end

    markTried(sourceKey, d)
    turnTo(d)

    local moved, delta, kind = tryNeighborAndClassify()
    if not moved then
        return false
    end

    local targetKey = currentKey()
    if targetKey ~= key(nx, nz) then
        error("Exploration coordinate mismatch")
    end

    local target = getCell(targetKey)
    if target and target.y ~= y then
        error("Vertically overlapping farm surfaces are not supported at " .. targetKey)
    end

    target = storeCurrentCell(kind, false)
    connectCells(sourceKey, d, targetKey)

    -- The reverse edge is now confirmed too.
    markTried(targetKey, opposite(d))

    serviceCellOnce(targetKey)
    return true, delta
end

local function stateId(k, heading)
    return k .. "|" .. tostring(heading)
end

-- Breadth-first path search over CONFIRMED map edges. Every map edge is one
-- farm-cell transition. Including heading in the state lets the queue order
-- prefer continuing straight among equal-length alternatives without allowing
-- straightness to beat a genuinely shorter route.
local function findShortestPath(predicate)
    local startKey = currentKey()
    local startHeading = dir
    local startId = stateId(startKey, startHeading)

    local queue = {
        { k = startKey, heading = startHeading, id = startId }
    }
    local head = 1
    local seen = { [startId] = true }
    local parent = {}

    while head <= #queue do
        local state = queue[head]
        head = head + 1

        if predicate(state.k) then
            local reversed = {}
            local cursor = state.id

            while cursor ~= startId do
                local p = parent[cursor]
                if not p then
                    error("Path reconstruction failed")
                end
                reversed[#reversed + 1] = p.dir
                cursor = p.prev
            end

            local path = {}
            for i = #reversed, 1, -1 do
                path[#path + 1] = reversed[i]
            end
            return path
        end

        local cell = getCell(state.k)
        if cell then
            local order = preferredDirs(state.heading)
            for _, d in ipairs(order) do
                local nextKey = getEdge(cell, d)
                if nextKey and getCell(nextKey) then
                    local nextId = stateId(nextKey, d)
                    if not seen[nextId] then
                        seen[nextId] = true
                        parent[nextId] = {
                            prev = state.id,
                            dir = d,
                        }
                        queue[#queue + 1] = {
                            k = nextKey,
                            heading = d,
                            id = nextId,
                        }
                    end
                end
            end
        end
    end

    return nil
end

local function moveAlongKnownPath(path, doService)
    for _, d in ipairs(path) do
        local sourceKey = currentKey()
        local source = getCell(sourceKey)
        if not source then
            error("Current mapped cell disappeared: " .. sourceKey)
        end

        local targetKey = getEdge(source, d)
        local target = targetKey and getCell(targetKey) or nil
        if not target then
            error("Saved map is missing a required edge from " .. sourceKey)
        end

        local delta = target.y - source.y
        if math.abs(delta) > 1 then
            error("Saved map contains an invalid elevation jump")
        end

        turnTo(d)
        if not moveKnown(delta) then
            return false, "mapped route is blocked near " .. sourceKey
        end

        if currentKey() ~= targetKey or y ~= target.y then
            error("Known-path coordinate mismatch")
        end

        if doService then
            serviceCellOnce(targetKey)
            if abortReason then
                return true
            end
        end
    end

    return true
end

local function pathHome()
    if currentKey() == key(0, 0) and y == 0 then
        turnTo(0)
        return true
    end

    local homeKey = key(0, 0)
    local path = findShortestPath(function(k)
        return k == homeKey
    end)

    if not path then
        return false
    end

    local ok = moveAlongKnownPath(path, false)
    if not ok then
        return false
    end

    if currentKey() ~= homeKey or y ~= 0 then
        return false
    end

    turnTo(0)
    return true
end

local function saveMap()
    mapData.version = MAP_VERSION
    mapData.radius = MAX_RADIUS
    mapData.complete = true

    local h = fs.open(MAP_FILE, "w")
    if not h then
        error("Could not open " .. MAP_FILE .. " for writing")
    end

    h.write(textutils.serialize(mapData))
    h.close()
end

local function loadMap()
    if not fs.exists(MAP_FILE) then
        return nil, "no saved map"
    end

    local h = fs.open(MAP_FILE, "r")
    if not h then
        return nil, "could not open saved map"
    end

    local raw = h.readAll()
    h.close()

    local data = textutils.unserialize(raw)
    if type(data) ~= "table" then
        return nil, "saved map is unreadable"
    end

    if data.version ~= MAP_VERSION then
        return nil, "saved map version is incompatible; run 'uneven_wheat map' again"
    end

    if not data.complete then
        return nil, "saved map is incomplete"
    end

    if type(data.cells) ~= "table" or not data.cells[key(0, 0)] then
        return nil, "saved map has no HOME cell"
    end

    return data, nil
end

local function countMapKinds(data)
    local total, crops, water = 0, 0, 0

    for _, cell in pairs(data.cells or {}) do
        total = total + 1
        if cell.kind == "crop" then
            crops = crops + 1
        elseif cell.kind == "water" then
            water = water + 1
        end
    end

    return total, crops, water
end

local function mapFarm()
    mapData = {
        version = MAP_VERSION,
        radius = MAX_RADIUS,
        complete = false,
        cells = {},
    }

    print("Mapping radius: +/-" .. tostring(MAX_RADIUS))
    print("HOME must stay fixed between runs.")
    print("")

    local homeKind = classifyCurrentSurface()
    local home = storeCurrentCell(homeKind or "home", true)
    serviceCellOnce(currentKey())

    while not abortReason do
        local current = getCell(currentKey())
        local moved = false
        local order = preferredDirs(dir)

        for _, d in ipairs(order) do
            local nx = current.x + DX[d]
            local nz = current.z + DZ[d]

            if inBounds(nx, nz) and not getEdge(current, d) and not wasTried(currentKey(), d) then
                if attemptExploreDirection(d) then
                    moved = true
                    break
                end
            end
        end

        if abortReason then
            break
        end

        if not moved then
            local path = findShortestPath(function(k)
                return hasFrontier(k)
            end)

            if not path then
                break
            end

            if #path == 0 then
                -- Defensive guard. The current cell should only be returned as
                -- a frontier if a direction remains untried.
                error("Frontier search stalled at " .. currentKey())
            end

            local ok, err = moveAlongKnownPath(path, true)
            if not ok then
                abortReason = err
            end
        end
    end

    print("")
    print("Mapping finished; returning HOME...")

    if not pathHome() then
        error("Could not return HOME using the discovered map")
    end

    if abortReason then
        print("Map NOT saved: " .. abortReason)
        return false
    end

    saveMap()

    local total, crops, water = countMapKinds(mapData)
    print("Saved " .. MAP_FILE)
    print("Mapped cells: " .. tostring(total))
    print("Crop cells: " .. tostring(crops))
    print("Water cells: " .. tostring(water))
    return true
end

local function nearestUnservicedCropPath()
    return findShortestPath(function(k)
        local cell = getCell(k)
        return cell and cell.kind == "crop" and not serviced[k]
    end)
end

local function remainingCropCount()
    local n = 0
    for k, cell in pairs(mapData.cells) do
        if cell.kind == "crop" and not serviced[k] then
            n = n + 1
        end
    end
    return n
end

local function farmMappedField()
    local data, err = loadMap()
    if not data then
        print("Cannot farm: " .. tostring(err))
        print("Run: uneven_wheat map [radius] [fuel]")
        return false
    end

    mapData = data
    MAX_RADIUS = mapData.radius or DEFAULT_MAX_RADIUS

    local total, crops, water = countMapKinds(mapData)
    print("Loaded map: " .. tostring(total) .. " cells")
    print("Crop cells: " .. tostring(crops))
    print("Water cells: " .. tostring(water))
    print("Remember: same HOME position and facing.")
    print("")

    serviceCellOnce(currentKey())

    while not abortReason and remainingCropCount() > 0 do
        local current = getCell(currentKey())
        if not current then
            error("Alice is not at a cell in the saved map")
        end

        -- First preference: an adjacent unserviced crop. Because every such
        -- choice costs one map edge, straight/left/right/back is only a
        -- tie-breaker here, not a reason to take a longer route.
        local chosenDir = nil
        local order = preferredDirs(dir)

        for _, d in ipairs(order) do
            local nextKey = getEdge(current, d)
            local nextCell = nextKey and getCell(nextKey) or nil
            if nextCell and nextCell.kind == "crop" and not serviced[nextKey] then
                chosenDir = d
                break
            end
        end

        local path
        if chosenDir ~= nil then
            path = { chosenDir }
        else
            -- No adjacent crop remains. Take the shortest CONFIRMED route to
            -- the nearest unserviced crop. BFS guarantees distance comes before
            -- the straightness preference.
            path = nearestUnservicedCropPath()
        end

        if not path then
            abortReason = "saved map cannot reach all crop cells"
            break
        end

        local ok, moveErr = moveAlongKnownPath(path, true)
        if not ok then
            abortReason = moveErr
            break
        end
    end

    print("")
    print("Returning HOME...")

    if not pathHome() then
        error("Could not return HOME using the saved map")
    end

    return abortReason == nil
end

local function isVanillaChestInFront()
    local ok, data = turtle.inspect()
    return ok and data and (
        data.name == "minecraft:chest" or
        data.name == "minecraft:trapped_chest"
    )
end

local function unloadBehind()
    turnRight()
    turnRight()

    if not isVanillaChestInFront() then
        print("WARNING: no vanilla chest behind HOME")
        print("Harvest remains inside Alice")
        turnRight()
        turnRight()
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

    turnRight()
    turnRight()
end

local function printStatus()
    local data, err = loadMap()
    if not data then
        print("No usable saved map: " .. tostring(err))
        return
    end

    local total, crops, water = countMapKinds(data)
    print("Alice Wheat Map")
    print("---------------")
    print("Version: " .. tostring(data.version))
    print("Radius: +/-" .. tostring(data.radius))
    print("Mapped cells: " .. tostring(total))
    print("Crop cells: " .. tostring(crops))
    print("Water cells: " .. tostring(water))
end

local function printUsage()
    print("Usage:")
    print("  uneven_wheat map [radius] [fuel]")
    print("  uneven_wheat farm [fuel]")
    print("  uneven_wheat status")
    print("  uneven_wheat reset")
end

if mode == "status" then
    printStatus()
    return
elseif mode == "reset" then
    if fs.exists(MAP_FILE) then
        fs.delete(MAP_FILE)
        print("Deleted " .. MAP_FILE)
    else
        print("No saved map to delete")
    end
    return
elseif mode ~= "map" and mode ~= "farm" then
    printUsage()
    return
end

term.clear()
term.setCursorPos(1, 1)
print("Alice - Uneven Wheat Farmer")
print("---------------------------")
print("Mode: " .. mode)
print("Fuel target: " .. tostring(TARGET_FUEL))
print("")

if not ensureFuel(TARGET_FUEL) then
    print("Not enough fuel")
    print("Target: " .. tostring(TARGET_FUEL))
    print("Add coal/charcoal/etc. and run again")
    return
end

if not selectItem(SEEDS) then
    print("No wheat seeds found")
    print("Alice needs seeds to farm safely.")
    return
end

print("Fuel: " .. tostring(turtle.getFuelLevel()))
print("Starting...")
print("")

local success
if mode == "map" then
    success = mapFarm()
else
    success = farmMappedField()
end

print("")
print("Back HOME")
if abortReason then
    print("Stopped early: " .. abortReason)
elseif success then
    print("Run complete")
end

unloadBehind()

print("")
print("Movement steps: " .. tostring(stats.moves))
if mode == "map" then
    print("New cells mapped: " .. tostring(stats.cellsMapped))
end
print("Crop cells checked: " .. tostring(stats.cropChecks))
print("Mature wheat harvested: " .. tostring(stats.harvested))
print("Seeds planted: " .. tostring(stats.planted))
if stats.failedHarvest > 0 then
    print("Failed harvests: " .. tostring(stats.failedHarvest))
end
if stats.failedPlant > 0 then
    print("Failed plant attempts: " .. tostring(stats.failedPlant))
end
print("Done")
