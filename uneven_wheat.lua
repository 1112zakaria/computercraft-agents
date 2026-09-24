-- uneven_wheat.lua
-- ComputerCraft 1.75 / Minecraft 1.7.10
--
-- Alice's uneven-terrain wheat farmer.
--
-- Setup:
--   * Start NEW map/farm/auto commands from the same HOME position every run.
--   * For a NEW command Alice must face the same direction. That direction is
--     "north" for the saved relative map. A crash resume restores position and
--     heading from the recovery journal instead of assuming Alice is at HOME.
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
--   uneven_wheat auto [period_minutes] [fuel]
--       Farms immediately, then repeats on a fixed start-to-start period.
--       Default period is 60 minutes. Alice must remain chunk-loaded.
--       Per-cell plant/harvest problems are logged and skipped. Temporary
--       supply shortages pause at HOME and are retried every 5 minutes.
--
--   uneven_wheat mapauto [radius] [period_minutes] [fuel]
--       Maps the farm ONCE at startup, saves the new map, then switches to
--       periodic auto-farming using that saved map. Because mapping already
--       services the crops, the first automatic farm run waits one full period.
--       An existing map is only replaced after a successful mapping run.
--
--   uneven_wheat resume
--       Resumes an interrupted farm/auto job from uneven_wheat.state.
--       A ComputerCraft startup program can call this after a server restart.
--
--   uneven_wheat stop
--       Clears crash-recovery state so a deliberately stopped auto job will
--       not resume on the next reboot. Does not delete the farm map.
--
--   uneven_wheat status
--       Shows information about the saved map and crash-recovery state.
--
--   uneven_wheat reset
--       Deletes the saved map and crash-recovery state.
--
-- With no command, Alice resumes an interrupted job if recovery state exists;
-- otherwise she maps if no map exists, or farms if a map already exists.

local args = { ... }

local MAP_FILE = "uneven_wheat.map"
local MAP_VERSION = 3

-- Crash-recovery journal. The primary, temp, and backup files are all checked
-- on startup; the newest valid generation wins. This makes checkpoint writes
-- tolerant of a server stopping in the middle of a file rotation.
local STATE_FILE = "uneven_wheat.state"
local STATE_TMP_FILE = "uneven_wheat.state.tmp"
local STATE_BACKUP_FILE = "uneven_wheat.state.bak"
local STATE_VERSION = 1

local DEFAULT_MAX_RADIUS = 20
local DEFAULT_TARGET_FUEL = 12000
local DEFAULT_AUTO_PERIOD_MINUTES = 60
local SUPPLY_RETRY_MINUTES = 5
local MAX_SOFT_FAILURE_DETAILS = 12
local KEEP_SEEDS = 16

-- Navigation reliability settings. A route edge that fails to move is treated
-- as a temporary observation, not a permanent map failure. Farming will retry
-- a fully blocked route set a few times before ending only that cycle, while
-- HOME recovery keeps reconsidering temporary blocks until a route opens.
local FARM_ROUTE_RECOVERY_ROUNDS = 3
local FARM_ROUTE_RECOVERY_DELAY_SECONDS = 2
local HOME_ROUTE_RECOVERY_MAX_DELAY_SECONDS = 10

local WHEAT = "minecraft:wheat"
local SEEDS = "minecraft:wheat_seeds"
local WATER = "minecraft:water"
local FLOWING_WATER = "minecraft:flowing_water"

local mode = string.lower(args[1] or "")
if mode == "" then
    if fs.exists(STATE_FILE) or fs.exists(STATE_TMP_FILE) or
       fs.exists(STATE_BACKUP_FILE) then
        mode = "resume"
    elseif fs.exists(MAP_FILE) then
        mode = "farm"
    else
        mode = "map"
    end
end

local MAX_RADIUS = DEFAULT_MAX_RADIUS
local TARGET_FUEL = DEFAULT_TARGET_FUEL
local AUTO_PERIOD_MINUTES = DEFAULT_AUTO_PERIOD_MINUTES

if mode == "map" then
    MAX_RADIUS = tonumber(args[2]) or DEFAULT_MAX_RADIUS
    TARGET_FUEL = tonumber(args[3]) or DEFAULT_TARGET_FUEL
elseif mode == "farm" then
    TARGET_FUEL = tonumber(args[2]) or DEFAULT_TARGET_FUEL
elseif mode == "auto" then
    AUTO_PERIOD_MINUTES = tonumber(args[2]) or DEFAULT_AUTO_PERIOD_MINUTES
    TARGET_FUEL = tonumber(args[3]) or DEFAULT_TARGET_FUEL
elseif mode == "mapauto" then
    MAX_RADIUS = tonumber(args[2]) or DEFAULT_MAX_RADIUS
    AUTO_PERIOD_MINUTES = tonumber(args[3]) or DEFAULT_AUTO_PERIOD_MINUTES
    TARGET_FUEL = tonumber(args[4]) or DEFAULT_TARGET_FUEL
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
local blockedEdges = {}
local abortReason = nil       -- fatal: auto mode must stop
local cycleStopReason = nil   -- recoverable: return HOME, then keep scheduler alive
local softFailures = {}
local sessionSoftFailures = 0

-- Persistent job state is intentionally separate from the permanent farm map.
-- Only normal saved-map farming (farm/auto) is crash-resumable. Initial mapping
-- remains a HOME-start operation; mapauto becomes resumable once mapping has
-- completed and it transitions into normal auto farming.
local checkpointSeq = 0
local runtime = {
    active = false,
    jobMode = nil,
    phase = nil,
    cycle = 1,
    pendingMove = nil,
    pendingTurn = nil,
    pendingEdge = nil,
}

local function newStats()
    return {
        moves = 0,
        cellsMapped = 0,
        cropChecks = 0,
        harvested = 0,
        planted = 0,
        failedPlant = 0,
        failedHarvest = 0,
        softFailures = 0,
    }
end

local stats = newStats()

local function deleteIfExists(path)
    if fs.exists(path) then
        fs.delete(path)
    end
end

local function readRecoveryFile(path)
    if not fs.exists(path) then
        return nil
    end

    local h = fs.open(path, "r")
    if not h then
        return nil
    end

    local raw = h.readAll()
    h.close()

    local data = textutils.unserialize(raw)
    if type(data) ~= "table" or data.version ~= STATE_VERSION then
        return nil
    end

    return data
end

local function loadRecoveryState()
    local best = nil
    local files = { STATE_FILE, STATE_TMP_FILE, STATE_BACKUP_FILE }

    for _, path in ipairs(files) do
        local data = readRecoveryFile(path)
        if data then
            local seq = tonumber(data.seq) or 0
            local bestSeq = best and (tonumber(best.seq) or 0) or -1
            if not best or seq > bestSeq then
                best = data
            end
        end
    end

    return best
end

local function recoveryStateExists()
    return fs.exists(STATE_FILE) or fs.exists(STATE_TMP_FILE) or
           fs.exists(STATE_BACKUP_FILE)
end

local function writeRecoverySnapshot(snapshot)
    deleteIfExists(STATE_TMP_FILE)

    local h = fs.open(STATE_TMP_FILE, "w")
    if not h then
        error("Could not open " .. STATE_TMP_FILE .. " for writing")
    end

    h.write(textutils.serialize(snapshot))
    h.close()

    -- Rotate only after a complete temp file exists. If the server stops during
    -- rotation, loadRecoveryState() will choose the newest valid generation.
    deleteIfExists(STATE_BACKUP_FILE)
    if fs.exists(STATE_FILE) then
        fs.move(STATE_FILE, STATE_BACKUP_FILE)
    end
    fs.move(STATE_TMP_FILE, STATE_FILE)
end

local function checkpointState()
    if not runtime.active then
        return
    end

    checkpointSeq = checkpointSeq + 1

    writeRecoverySnapshot({
        version = STATE_VERSION,
        seq = checkpointSeq,
        active = true,
        jobMode = runtime.jobMode,
        phase = runtime.phase,
        cycle = runtime.cycle,
        x = x,
        y = y,
        z = z,
        dir = dir,
        maxRadius = MAX_RADIUS,
        targetFuel = TARGET_FUEL,
        autoPeriodMinutes = AUTO_PERIOD_MINUTES,
        serviced = serviced,
        pendingMove = runtime.pendingMove,
        pendingTurn = runtime.pendingTurn,
        pendingEdge = runtime.pendingEdge,
        -- Reserved so future GPS support can verify/replace this source without
        -- changing the rest of the recovery format. No GPS logic exists yet.
        positionSource = "checkpoint",
    })
end

local function clearRecoveryState()
    runtime.active = false
    runtime.pendingMove = nil
    runtime.pendingTurn = nil
    runtime.pendingEdge = nil
    deleteIfExists(STATE_FILE)
    deleteIfExists(STATE_TMP_FILE)
    deleteIfExists(STATE_BACKUP_FILE)
end

local function startRuntime(jobMode, phase, cycle)
    runtime.active = true
    runtime.jobMode = jobMode
    runtime.phase = phase
    runtime.cycle = cycle or 1
    runtime.pendingMove = nil
    runtime.pendingTurn = nil
    runtime.pendingEdge = nil
    checkpointState()
end

local function setRuntimePhase(phase)
    if not runtime.active then
        return
    end
    runtime.phase = phase
    checkpointState()
end

local function beginTurnCheckpoint(kind, targetDir)
    if not runtime.active then
        return
    end

    runtime.pendingTurn = {
        kind = kind,
        fromDir = dir,
        targetDir = targetDir,
    }
    checkpointState()
end

local function finishTurnCheckpoint()
    if not runtime.active then
        return
    end
    runtime.pendingTurn = nil
    checkpointState()
end

local function beginMovementCheckpoint(kind)
    if not runtime.active then
        return
    end

    runtime.pendingMove = {
        kind = kind,
        x = x,
        y = y,
        z = z,
        dir = dir,
        fuelBefore = turtle.getFuelLevel(),
    }
    checkpointState()
end

local function finishMovementCheckpoint()
    if not runtime.active then
        return
    end
    runtime.pendingMove = nil
    checkpointState()
end

local function beginEdgeCheckpoint(sourceKey, targetKey, d, delta, source, target)
    if not runtime.active then
        return
    end

    runtime.pendingEdge = {
        sourceKey = sourceKey,
        targetKey = targetKey,
        dir = d,
        delta = delta,
        source = { x = source.x, y = source.y, z = source.z },
        target = { x = target.x, y = target.y, z = target.z },
    }
    checkpointState()
end

local function finishEdgeCheckpoint()
    if not runtime.active then
        return
    end
    runtime.pendingEdge = nil
    checkpointState()
end

-- A physical turtle move consumes exactly one fuel when fuel is enabled. The
-- pending-move journal lets startup distinguish "the move never happened" from
-- "the move happened but the post-move checkpoint never reached disk". This
-- closes the most dangerous crash window without needing GPS.
local function recoverPendingMoveRecord(state)
    local pending = state.pendingMove
    if type(pending) ~= "table" then
        return true, nil
    end

    local before = pending.fuelBefore
    local now = turtle.getFuelLevel()

    if type(before) ~= "number" or type(now) ~= "number" then
        return false,
            "cannot resolve an interrupted physical move because fuel is unlimited/non-numeric"
    end

    local used = before - now
    if used ~= 0 and used ~= 1 then
        return false,
            "cannot resolve interrupted move: fuel changed by " .. tostring(used)
    end

    state.x = tonumber(pending.x) or state.x
    state.y = tonumber(pending.y) or state.y
    state.z = tonumber(pending.z) or state.z
    state.dir = tonumber(pending.dir) or state.dir

    if used == 1 then
        if pending.kind == "forward" then
            state.x = state.x + DX[state.dir]
            state.z = state.z + DZ[state.dir]
        elseif pending.kind == "back" then
            state.x = state.x - DX[state.dir]
            state.z = state.z - DZ[state.dir]
        elseif pending.kind == "up" then
            state.y = state.y + 1
        elseif pending.kind == "down" then
            state.y = state.y - 1
        else
            return false, "unknown interrupted move type: " .. tostring(pending.kind)
        end
    end

    state.pendingMove = nil
    return true, used == 1 and "completed" or "not completed"
end

local function recordSoftFailure(kind, message)
    stats.softFailures = stats.softFailures + 1
    sessionSoftFailures = sessionSoftFailures + 1
    if #softFailures < MAX_SOFT_FAILURE_DETAILS then
        softFailures[#softFailures + 1] = {
            kind = kind,
            message = message,
        }
    end
    print("WARNING: " .. message)
end

-- Auto mode runs several farm cycles in one program invocation. Each cycle
-- starts with Alice physically at HOME and facing the original HOME direction.
local function resetFarmCycleState()
    x, y, z = 0, 0, 0
    dir = 0
    mapData = nil
    tried = {}
    serviced = {}
    blockedEdges = {}
    abortReason = nil
    cycleStopReason = nil
    softFailures = {}
    stats = newStats()
end

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

local function blockedEdgeKey(k, d)
    return k .. "|" .. tostring(d)
end

local function isEdgeBlocked(k, d)
    return blockedEdges[blockedEdgeKey(k, d)] == true
end

local function markEdgeBlocked(sourceKey, d, targetKey)
    blockedEdges[blockedEdgeKey(sourceKey, d)] = true
    if targetKey then
        blockedEdges[blockedEdgeKey(targetKey, opposite(d))] = true
    end
end

local function hasBlockedEdges()
    return next(blockedEdges) ~= nil
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
    beginMovementCheckpoint("forward")
    if turtle.forward() then
        x = x + DX[dir]
        z = z + DZ[dir]
        stats.moves = stats.moves + 1
        finishMovementCheckpoint()
        return true
    end
    finishMovementCheckpoint()
    return false
end

local function rawBack()
    beginMovementCheckpoint("back")
    if turtle.back() then
        x = x - DX[dir]
        z = z - DZ[dir]
        stats.moves = stats.moves + 1
        finishMovementCheckpoint()
        return true
    end
    finishMovementCheckpoint()
    return false
end

local function rawUp()
    beginMovementCheckpoint("up")
    if turtle.up() then
        y = y + 1
        stats.moves = stats.moves + 1
        finishMovementCheckpoint()
        return true
    end
    finishMovementCheckpoint()
    return false
end

local function rawDown()
    beginMovementCheckpoint("down")
    if turtle.down() then
        y = y - 1
        stats.moves = stats.moves + 1
        finishMovementCheckpoint()
        return true
    end
    finishMovementCheckpoint()
    return false
end

local function turnLeft()
    local targetDir = (dir + 3) % 4
    beginTurnCheckpoint("left", targetDir)
    turtle.turnLeft()
    dir = targetDir
    finishTurnCheckpoint()
end

local function turnRight()
    local targetDir = (dir + 1) % 4
    beginTurnCheckpoint("right", targetDir)
    turtle.turnRight()
    dir = targetDir
    finishTurnCheckpoint()
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
        return false, "out of wheat seeds"
    end

    -- Alice stays at cruising height. placeDown can plant onto the farmland
    -- beneath the empty crop space without Alice occupying that crop space.
    if turtle.placeDown() then
        stats.planted = stats.planted + 1
        return true, nil
    end

    stats.failedPlant = stats.failedPlant + 1
    return false, "seed placement failed"
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

        -- Never harvest a mature crop unless Alice already has a seed available
        -- to replant it. Running out of seeds is recoverable at HOME, so end this
        -- cycle early instead of killing the automatic scheduler.
        if not selectItem(SEEDS) then
            cycleStopReason = "out of wheat seeds"
            return
        end

        -- A full inventory is also recoverable: return HOME, unload, and allow
        -- the next scheduled cycle to run normally.
        if not hasRoomFor(WHEAT) or not hasRoomFor(SEEDS) then
            cycleStopReason = "inventory nearly full"
            return
        end

        local dug, err = turtle.digDown()
        if not dug then
            stats.failedHarvest = stats.failedHarvest + 1
            recordSoftFailure(
                "harvest",
                "harvest failed at " .. currentKey() .. ": " .. tostring(err)
            )
            return
        end

        stats.harvested = stats.harvested + 1

        local planted, plantErr = plantSeed()
        if not planted then
            if plantErr == "out of wheat seeds" then
                -- The crop was already harvested, so remember the damaged cell
                -- and return HOME before touching more mature crops.
                recordSoftFailure(
                    "replant",
                    "could not replant harvested wheat at " .. currentKey() ..
                    ": " .. tostring(plantErr)
                )
                cycleStopReason = "out of wheat seeds"
            else
                -- A single bad farmland/crop position must not stop unattended
                -- farming. Leave it for repair on the next cycle.
                recordSoftFailure(
                    "replant",
                    "could not replant harvested wheat at " .. currentKey() ..
                    ": " .. tostring(plantErr)
                )
            end
        end

    elseif not ok then
        -- This is a known crop cell whose crop is missing. Attempt to repair it
        -- from cruising height. A single failed placement is a soft per-cell
        -- failure and will be retried on a later cycle.
        local planted, plantErr = plantSeed()
        if not planted then
            if plantErr == "out of wheat seeds" then
                cycleStopReason = "out of wheat seeds"
            else
                recordSoftFailure(
                    "plant",
                    "could not plant known crop cell " .. currentKey() ..
                    ": " .. tostring(plantErr)
                )
            end
        end

    else
        -- Something other than wheat occupies the crop layer. Leave it alone
        -- and continue. This is a soft failure because the rest of the field is
        -- still safe to harvest.
        recordSoftFailure(
            "blocked_crop",
            "crop cell " .. currentKey() .. " blocked by " .. tostring(data.name)
        )
    end
end

local function serviceCellOnce(k)
    if serviced[k] then
        return
    end

    local cell = mapData and mapData.cells and mapData.cells[k]
    if cell and cell.kind == "crop" then
        serviceCurrentCrop()

        -- Supply/inventory stops are intentionally NOT marked serviced. If the
        -- server stops or Alice returns HOME for supplies, this crop is retried.
        if abortReason or cycleStopReason then
            checkpointState()
            return
        end
    end

    -- Mark only after the cell action is complete. If the server dies after a
    -- harvest but before replanting, resume sees this cell as unfinished and
    -- repairs the empty farmland before moving on.
    serviced[k] = true
    checkpointState()
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
                if nextKey and getCell(nextKey) and not isEdgeBlocked(state.k, d) then
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
        beginEdgeCheckpoint(sourceKey, targetKey, d, delta, source, target)

        if not moveKnown(delta) then
            -- moveKnown only returns false after repeated attempts while Alice
            -- remains on the original mapped cell. Temporarily exclude this edge
            -- and let the caller re-plan through another known route.
            finishEdgeCheckpoint()
            markEdgeBlocked(sourceKey, d, targetKey)
            recordSoftFailure(
                "route",
                "mapped route blocked between " .. sourceKey .. " and " .. targetKey
            )
            return false, "blocked"
        end

        if currentKey() ~= targetKey or y ~= target.y then
            error("Known-path coordinate mismatch")
        end

        finishEdgeCheckpoint()

        if doService then
            serviceCellOnce(targetKey)
            if abortReason or cycleStopReason then
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

    -- blockedEdges contains only temporary movement failures observed during
    -- this cycle. They must never poison the emergency route HOME. Start HOME
    -- recovery with the complete saved graph available again.
    blockedEdges = {}

    local recoveryRound = 0

    while currentKey() ~= homeKey or y ~= 0 do
        local path = findShortestPath(function(k)
            return k == homeKey
        end)

        if not path then
            if hasBlockedEdges() then
                -- Every currently usable route HOME has encountered a temporary
                -- obstruction. Forget those temporary exclusions, wait briefly
                -- for mobs/players/transient obstructions to move, and retry.
                -- Do not terminate the unattended farming program for this.
                recoveryRound = recoveryRound + 1

                print(
                    "WARNING: HOME routes temporarily blocked; retrying (" ..
                    tostring(recoveryRound) .. ")"
                )

                blockedEdges = {}
                sleep(math.min(
                    2 * recoveryRound,
                    HOME_ROUTE_RECOVERY_MAX_DELAY_SECONDS
                ))
            else
                -- With no temporary exclusions at all, failure to find HOME
                -- means the saved graph itself is disconnected/corrupt. That is
                -- a genuine map failure rather than a soft movement failure.
                return false
            end
        else
            local ok, moveErr = moveAlongKnownPath(path, false)

            if not ok then
                if moveErr == "blocked" then
                    -- The failed edge has just been temporarily excluded. Loop
                    -- and try another known route. If that eventually exhausts
                    -- all routes, the recovery block above clears them and tries
                    -- again rather than killing Alice's program.
                    sleep(1)
                else
                    return false
                end
            else
                -- Successful progress means an earlier transient problem has
                -- cleared; restart the backoff for any future obstruction.
                recoveryRound = 0
            end
        end
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
                if hasBlockedEdges() then
                    abortReason = "mapping interrupted by blocked route"
                end
                break
            end

            if #path == 0 then
                -- Defensive guard. The current cell should only be returned as
                -- a frontier if a direction remains untried.
                error("Frontier search stalled at " .. currentKey())
            end

            local ok, moveErr = moveAlongKnownPath(path, true)
            if not ok and moveErr ~= "blocked" then
                abortReason = moveErr
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

local function farmMappedField(resuming)
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
    if resuming then
        print("Resuming saved cycle at " .. currentKey() ..
              " y=" .. tostring(y) .. " dir=" .. tostring(dir))
    else
        print("Remember: same HOME position and facing.")
    end
    print("")

    local here = getCell(currentKey())
    if not here or here.y ~= y then
        error("Saved recovery position is not a cruising cell in the farm map")
    end

    setRuntimePhase("farming")
    serviceCellOnce(currentKey())

    -- Counts occasions where every currently known route to remaining crops has
    -- become temporarily excluded. Actual successful movement resets this.
    local routeRecoveryRounds = 0

    while not abortReason and not cycleStopReason and remainingCropCount() > 0 do
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
            if nextCell and nextCell.kind == "crop" and
               not serviced[nextKey] and not isEdgeBlocked(currentKey(), d) then
                chosenDir = d
                break
            end
        end

        local path
        if chosenDir ~= nil then
            path = { chosenDir }
        else
            -- No adjacent crop remains. Take the shortest currently usable
            -- confirmed route to the nearest unserviced crop.
            path = nearestUnservicedCropPath()
        end

        if not path then
            if hasBlockedEdges() then
                -- A mob/player/transient obstruction may have caused enough
                -- edges to be blacklisted that the remaining field appears
                -- unreachable. Reconsider all temporary exclusions a few times
                -- before ending this cycle. This is never a fatal map failure.
                routeRecoveryRounds = routeRecoveryRounds + 1

                if routeRecoveryRounds <= FARM_ROUTE_RECOVERY_ROUNDS then
                    print(
                        "Temporary route blockage; retrying farm routes (" ..
                        tostring(routeRecoveryRounds) .. "/" ..
                        tostring(FARM_ROUTE_RECOVERY_ROUNDS) .. ")"
                    )
                    blockedEdges = {}
                    sleep(FARM_ROUTE_RECOVERY_DELAY_SECONDS)
                else
                    cycleStopReason =
                        "some crop cells temporarily unreachable after retries"
                    break
                end
            else
                -- No path exists even without temporary edge exclusions, so the
                -- saved map itself is inconsistent/disconnected.
                abortReason = "saved map cannot reach all crop cells"
                break
            end
        else
            local ok, moveErr = moveAlongKnownPath(path, true)
            if not ok then
                if moveErr == "blocked" then
                    -- Stay on the current known cell and let the loop re-plan
                    -- while excluding the edge that just failed. Do not count
                    -- this as fatal; only a completely exhausted route set
                    -- advances routeRecoveryRounds above.
                else
                    abortReason = tostring(moveErr)
                    break
                end
            else
                -- Any successful route traversal proves useful progress and
                -- clears the consecutive full-route recovery count.
                routeRecoveryRounds = 0
            end
        end
    end

    print("")
    print("Returning HOME...")
    setRuntimePhase("returning_home")

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

    local recovery = loadRecoveryState()
    if recovery and recovery.active then
        print("")
        print("Crash recovery: ACTIVE")
        print("Job: " .. tostring(recovery.jobMode))
        print("Phase: " .. tostring(recovery.phase))
        print("Cycle: " .. tostring(recovery.cycle or 1))
        print("Position: " .. tostring(recovery.x) .. "," ..
              tostring(recovery.y) .. "," .. tostring(recovery.z))
        print("Direction: " .. tostring(recovery.dir))
        if recovery.pendingMove then
            print("Pending physical move journal present")
        end
        if recovery.pendingTurn then
            print("Pending turn journal present")
        end
        if recovery.pendingEdge then
            print("Pending mapped-edge transaction present")
        end
    else
        print("")
        print("Crash recovery: inactive")
    end
end

local function printUsage()
    print("Usage:")
    print("  uneven_wheat map [radius] [fuel]")
    print("  uneven_wheat farm [fuel]")
    print("  uneven_wheat auto [period_minutes] [fuel]")
    print("  uneven_wheat mapauto [radius] [period_minutes] [fuel]")
    print("  uneven_wheat resume")
    print("  uneven_wheat stop")
    print("  uneven_wheat status")
    print("  uneven_wheat reset")
end

if mode == "status" then
    printStatus()
    return
elseif mode == "stop" then
    if recoveryStateExists() then
        clearRecoveryState()
        print("Cleared crash-recovery state")
        print("Alice will not auto-resume this job on reboot")
    else
        print("No crash-recovery state to clear")
    end
    return
elseif mode == "reset" then
    clearRecoveryState()
    if fs.exists(MAP_FILE) then
        fs.delete(MAP_FILE)
        print("Deleted " .. MAP_FILE)
    else
        print("No saved map to delete")
    end
    return
elseif mode ~= "map" and mode ~= "farm" and mode ~= "auto" and
       mode ~= "mapauto" and mode ~= "resume" then
    printUsage()
    return
end

local function printRunStats(runMode)
    print("Movement steps: " .. tostring(stats.moves))
    if runMode == "map" then
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
    if stats.softFailures > 0 then
        print("Soft failures this cycle: " .. tostring(stats.softFailures))
        for _, failure in ipairs(softFailures) do
            print("  - " .. failure.message)
        end
        if stats.softFailures > #softFailures then
            print("  ... plus " .. tostring(stats.softFailures - #softFailures) .. " more")
        end
    end
    if sessionSoftFailures > 0 then
        print("Soft failures this session: " .. tostring(sessionSoftFailures))
    end
end

local function checkSupplies()
    if not ensureFuel(TARGET_FUEL) then
        print("Not enough fuel")
        print("Target: " .. tostring(TARGET_FUEL))
        return false
    end

    if not selectItem(SEEDS) then
        print("No wheat seeds found")
        return false
    end

    return true
end

local function waitForSupplies()
    local retrySeconds = SUPPLY_RETRY_MINUTES * 60

    while not checkSupplies() do
        print("Alice is safely at HOME.")
        print("Add fuel/seeds; checking again in " ..
              tostring(SUPPLY_RETRY_MINUTES) .. " minutes.")
        print("Hold Ctrl+T to stop automatic farming.")
        sleep(retrySeconds)
        print("")
        print("Rechecking supplies...")
    end

    return true
end

local function printRunHeader(runMode)
    term.clear()
    term.setCursorPos(1, 1)
    print("Alice - Uneven Wheat Farmer")
    print("---------------------------")
    print("Mode: " .. runMode)
    print("Fuel target: " .. tostring(TARGET_FUEL))
    if runMode == "auto" or runMode == "mapauto" then
        print("Farm period: " .. tostring(AUTO_PERIOD_MINUTES) .. " min")
    end
    print("")
end

local function validateAutoSettings()
    if AUTO_PERIOD_MINUTES <= 0 then
        print("period_minutes must be greater than 0")
        return false
    end
    return true
end

local function runAutoFarm(waitBeforeFirstCycle, startingCycle)
    if not validateAutoSettings() then
        return
    end

    local data, mapErr = loadMap()
    if not data then
        print("Cannot auto-farm: " .. tostring(mapErr))
        print("Run: uneven_wheat map [radius] [fuel]")
        clearRecoveryState()
        return
    end

    local periodSeconds = AUTO_PERIOD_MINUTES * 60
    local cycle = startingCycle or 1

    if not runtime.active then
        -- At entry Alice must physically be HOME and facing the original HOME
        -- direction. Subsequent cycles preserve that invariant themselves.
        startRuntime("auto", waitBeforeFirstCycle and "waiting" or
                     "waiting_supplies", cycle)
    else
        runtime.jobMode = "auto"
        runtime.cycle = cycle
        checkpointState()
    end

    if waitBeforeFirstCycle then
        runtime.cycle = cycle
        setRuntimePhase("waiting")
        print("")
        print("Initial mapping already serviced the farm.")
        print("Next farm cycle in " .. tostring(AUTO_PERIOD_MINUTES) .. " minutes.")
        print("Hold Ctrl+T to stop automatic farming.")
        sleep(periodSeconds)
    end

    while true do
        resetFarmCycleState()
        runtime.cycle = cycle
        setRuntimePhase("waiting_supplies")

        printRunHeader("auto")
        print("Cycle: " .. tostring(cycle))

        waitForSupplies()

        print("Fuel: " .. tostring(turtle.getFuelLevel()))
        print("Starting farm cycle...")
        print("")

        -- Keep the configured period approximately start-to-start during normal
        -- uninterrupted operation. After a reboot, waiting resumes immediately
        -- rather than attempting to reconstruct wall-clock downtime.
        local cycleStarted = os.clock()
        local success = farmMappedField(false)

        print("")
        print("Back HOME")
        if abortReason then
            print("Fatal stop: " .. abortReason)
        elseif cycleStopReason then
            print("Cycle ended early: " .. cycleStopReason)
        elseif success then
            print("Farm cycle complete")
        end

        setRuntimePhase("unloading")
        unloadBehind()

        print("")
        printRunStats("farm")

        if abortReason or not success then
            print("")
            print("Automatic farming stopped due to a navigation/map safety failure.")
            clearRecoveryState()
            return
        end

        local elapsed = os.clock() - cycleStarted
        local waitSeconds = periodSeconds - elapsed

        cycle = cycle + 1
        runtime.cycle = cycle
        setRuntimePhase("waiting")

        print("")
        if waitSeconds > 0 then
            print(string.format(
                "Next farm cycle in %.1f minutes.",
                waitSeconds / 60
            ))
            print("Hold Ctrl+T to stop automatic farming.")
            sleep(waitSeconds)
        else
            print("Cycle took longer than the configured period.")
            print("Starting the next cycle immediately.")
        end
    end
end


-- Normalize a crash that occurred between the two physical moves of an uneven
-- mapped edge. The raw-move journal restores the exact intermediate coordinate;
-- this routine safely backs out to the known source cell and lets pathfinding
-- retry the edge normally. If the edge had already completed, it simply accepts
-- the target cell. This is deliberately map-based and contains no GPS logic.
local function normalizePendingEdgeAfterResume()
    local edge = runtime.pendingEdge
    if type(edge) ~= "table" then
        return true
    end

    local source = edge.source
    local target = edge.target
    if type(source) ~= "table" or type(target) ~= "table" then
        return false, "recovery journal has an invalid pending edge"
    end

    local function at(px, py, pz)
        return x == px and y == py and z == pz
    end

    if at(target.x, target.y, target.z) then
        print("Recovered completed mapped edge to " .. tostring(edge.targetKey))
        finishEdgeCheckpoint()
        return true
    end

    if at(source.x, source.y, source.z) then
        print("Recovered mapped edge at its source; route will be retried")
        finishEdgeCheckpoint()
        return true
    end

    turnTo(tonumber(edge.dir) or dir)

    if tonumber(edge.delta) == 1 and
       at(source.x, source.y + 1, source.z) then
        print("Recovering interrupted uphill edge back to source...")
        for attempt = 1, 20 do
            if rawDown() then
                finishEdgeCheckpoint()
                return true
            end
            sleep(0.25)
        end
        return false, "could not back out of interrupted uphill edge"
    end

    if tonumber(edge.delta) == -1 and
       at(target.x, source.y, target.z) then
        print("Recovering interrupted downhill edge back to source...")
        for attempt = 1, 20 do
            if rawBack() then
                finishEdgeCheckpoint()
                return true
            end
            sleep(0.25)
        end
        return false, "could not back out of interrupted downhill edge"
    end

    return false,
        "saved position does not match the interrupted mapped-edge transaction"
end

local function restoreRuntimeFromRecovery(state)
    if not state or not state.active then
        return false, "no active crash-recovery state"
    end

    if state.jobMode ~= "farm" and state.jobMode ~= "auto" then
        return false, "unsupported recovery job: " .. tostring(state.jobMode)
    end

    -- Without GPS (or another absolute heading sensor) there is no reliable way
    -- to tell whether a server stopped immediately before or immediately after a
    -- turtle turn. Detect that tiny ambiguous window and stop safely instead of
    -- guessing a heading and corrupting the map-relative position. Future GPS
    -- support can resolve this journal entry automatically.
    if type(state.pendingTurn) == "table" then
        return false,
            "server stopped during a turn; heading is ambiguous until GPS support is added"
    end

    local ok, moveResult = recoverPendingMoveRecord(state)
    if not ok then
        return false, moveResult
    end

    if moveResult then
        print("Interrupted physical move was " .. moveResult .. ".")
    end

    x = tonumber(state.x) or 0
    y = tonumber(state.y) or 0
    z = tonumber(state.z) or 0
    dir = tonumber(state.dir) or 0
    MAX_RADIUS = tonumber(state.maxRadius) or DEFAULT_MAX_RADIUS
    TARGET_FUEL = tonumber(state.targetFuel) or DEFAULT_TARGET_FUEL
    AUTO_PERIOD_MINUTES = tonumber(state.autoPeriodMinutes) or
                          DEFAULT_AUTO_PERIOD_MINUTES
    serviced = type(state.serviced) == "table" and state.serviced or {}
    blockedEdges = {}
    tried = {}
    abortReason = nil
    cycleStopReason = nil
    softFailures = {}
    stats = newStats()

    checkpointSeq = tonumber(state.seq) or 0
    runtime.active = true
    runtime.jobMode = state.jobMode
    runtime.phase = state.phase or "farming"
    runtime.cycle = tonumber(state.cycle) or 1
    runtime.pendingMove = nil
    runtime.pendingTurn = nil
    runtime.pendingEdge = state.pendingEdge

    local data, mapErr = loadMap()
    if not data then
        return false, "cannot resume without a valid map: " .. tostring(mapErr)
    end
    mapData = data
    MAX_RADIUS = mapData.radius or MAX_RADIUS

    -- Write the resolved pending-move result before any further movement.
    checkpointState()

    local edgeOk, edgeErr = normalizePendingEdgeAfterResume()
    if not edgeOk then
        return false, edgeErr
    end

    local here = getCell(currentKey())
    if not here or here.y ~= y then
        return false,
            "saved position " .. currentKey() .. " y=" .. tostring(y) ..
            " is not a cruising cell in the saved map"
    end

    return true
end

local function finishRecoveredCycleAndContinue()
    print("")
    print("Back HOME after crash recovery")
    setRuntimePhase("unloading")
    unloadBehind()
    printRunStats("farm")

    if runtime.jobMode == "farm" then
        clearRecoveryState()
        print("Recovered farm run complete")
        return
    end

    local nextCycle = (runtime.cycle or 1) + 1
    runtime.cycle = nextCycle
    setRuntimePhase("waiting")

    print("")
    print("Recovered cycle complete.")
    print("Next farm cycle in " .. tostring(AUTO_PERIOD_MINUTES) .. " minutes.")
    print("Hold Ctrl+T to stop automatic farming.")
    sleep(AUTO_PERIOD_MINUTES * 60)

    runAutoFarm(false, nextCycle)
end

local function resumeInterruptedJob()
    local state = loadRecoveryState()
    if not state or not state.active then
        print("No active Alice farming job to resume")
        return
    end

    printRunHeader("resume")
    print("Restoring " .. tostring(state.jobMode) ..
          " job, phase=" .. tostring(state.phase) ..
          ", cycle=" .. tostring(state.cycle or 1))

    local ok, err = restoreRuntimeFromRecovery(state)
    if not ok then
        print("")
        print("RECOVERY STOPPED SAFELY")
        print(tostring(err))
        print("Recovery state was preserved for diagnosis.")
        return
    end

    print("Recovered position: " .. currentKey() ..
          " y=" .. tostring(y) .. " dir=" .. tostring(dir))

    local phase = runtime.phase

    if phase == "farming" then
        print("Continuing interrupted farming cycle...")
        local success = farmMappedField(true)
        if not success or abortReason then
            print("Recovery encountered a fatal map/navigation failure.")
            clearRecoveryState()
            return
        end
        finishRecoveredCycleAndContinue()
        return
    end

    if phase == "returning_home" then
        print("Continuing interrupted return HOME...")
        if not pathHome() then
            print("Could not recover a route HOME from the saved map")
            return
        end
        finishRecoveredCycleAndContinue()
        return
    end

    if phase == "unloading" then
        if currentKey() ~= key(0, 0) or y ~= 0 then
            print("Unload recovery was not at HOME; returning HOME first...")
            setRuntimePhase("returning_home")
            if not pathHome() then
                print("Could not recover a route HOME from the saved map")
                return
            end
        end
        finishRecoveredCycleAndContinue()
        return
    end

    if phase == "waiting" or phase == "waiting_supplies" then
        if currentKey() ~= key(0, 0) or y ~= 0 then
            print("Saved waiting phase was away from HOME; returning HOME first...")
            setRuntimePhase("returning_home")
            if not pathHome() then
                print("Could not recover a route HOME from the saved map")
                return
            end
        end

        if runtime.jobMode == "farm" then
            -- A one-shot farm job normally never waits. Treat this conservatively
            -- as an unfinished farm cycle and restart it immediately from HOME.
            serviced = {}
            setRuntimePhase("farming")
            local success = farmMappedField(false)
            if success and not abortReason then
                finishRecoveredCycleAndContinue()
            end
            return
        end

        print("Server restarted while Alice was waiting at HOME.")
        print("Starting the saved auto cycle immediately.")
        runAutoFarm(false, runtime.cycle or 1)
        return
    end

    print("Unknown recovery phase: " .. tostring(phase))
    print("Recovery state was preserved.")
end

if mode == "resume" then
    resumeInterruptedJob()
    return
end

if mode == "auto" then
    -- A fresh auto command is a new job. If an old recovery journal exists,
    -- replace it only because the user explicitly issued a new auto command.
    clearRecoveryState()
    runAutoFarm(false, 1)
    return
end

if mode == "mapauto" then
    if not validateAutoSettings() then
        return
    end

    printRunHeader("mapauto")

    -- Remember whether a valid old map exists. mapFarm() does not overwrite it
    -- unless the new mapping completes successfully, so it can be used as a
    -- fallback if a recoverable mapping problem occurs.
    local previousMap = loadMap()

    waitForSupplies()

    print("Fuel: " .. tostring(turtle.getFuelLevel()))
    print("Mapping once before automatic farming...")
    print("")

    local success = mapFarm()

    print("")
    print("Back HOME")
    if abortReason then
        print("Mapping stopped: " .. abortReason)
    elseif cycleStopReason then
        print("Mapping completed with recoverable issue: " .. cycleStopReason)
    elseif success then
        print("Initial mapping complete")
    end

    unloadBehind()

    print("")
    printRunStats("map")

    if abortReason or not success then
        print("")
        print("The new map was not saved.")
        if previousMap then
            print("Falling back to the previous valid map and starting auto-farm.")
            clearRecoveryState()
            runAutoFarm(false, 1)
        else
            print("No previous valid map is available; automatic farming cannot start.")
        end
        return
    end

    -- mapFarm() already visited/serviced the mapped crop cells, so running a
    -- normal farm pass immediately would duplicate the same traversal. Wait one
    -- full configured period, then use only the saved map from then on.
    clearRecoveryState()
    runAutoFarm(true, 1)
    return
end

printRunHeader(mode)

if not checkSupplies() then
    return
end

print("Fuel: " .. tostring(turtle.getFuelLevel()))
print("Starting...")
print("")

local success
if mode == "map" then
    success = mapFarm()
else
    -- A one-shot farm is resumable too. Mapping itself is intentionally not
    -- journaled because a crash can occur while Alice is probing an unknown cell;
    -- future GPS support can make that safe without guessing.
    clearRecoveryState()
    startRuntime("farm", "farming", 1)
    success = farmMappedField(false)
end

print("")
print("Back HOME")
if abortReason then
    print("Fatal stop: " .. abortReason)
elseif cycleStopReason then
    print("Stopped early (recoverable): " .. cycleStopReason)
elseif success then
    print("Run complete")
end

if mode == "farm" and runtime.active then
    setRuntimePhase("unloading")
end
unloadBehind()

print("")
printRunStats(mode)

if mode == "farm" and runtime.active then
    clearRecoveryState()
end

print("Done")
