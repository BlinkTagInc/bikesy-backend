-- Bikesy bicycle-only import profile for pinned Valhalla 3.5.1.
-- Keep the upstream access masks, oneway rules, nodes/barriers and restrictions.
-- Only remove the generic destination flag when an unconditional bicycle-specific
-- permission overrides access=destination. Never use these tiles for other modes:
-- Valhalla 3.5.1 stores the destination flag per edge, not per transport mode.
local upstream_ways_proc = ways_proc

local function bicycle_destination_exemption(tags)
  if tags["highway"] == nil or tags["barrier"] ~= nil or
      tags["access"] ~= "destination" or
      (tags["bicycle"] ~= "yes" and tags["bicycle"] ~= "designated") then
    return false
  end
  -- Ambiguous conditional/directional access needs separate interpretation.
  for key, _ in pairs(tags) do
    if (string.find(key, "conditional", 1, true) ~= nil and
        key ~= "maxspeed:conditional" and key ~= "source:maxspeed:conditional") or
        string.sub(key, 1, 8) == "bicycle:" or
        string.sub(key, 1, 7) == "access:" or
        string.sub(key, 1, 8) == "vehicle:" then
      return false
    end
  end
  if tags["vehicle"] ~= nil and tags["vehicle"] ~= "yes" then
    return false
  end
  -- Do not extend this correction to private/customer/permit access.
  for _, key in ipairs({"motor_vehicle", "motorcar"}) do
    local value = tags[key]
    if value ~= nil and value ~= "yes" and value ~= "no" and value ~= "destination" then
      return false
    end
  end
  return true
end

function ways_proc(tags, count)
  local exempt = bicycle_destination_exemption(tags)
  -- Preserve original tags: the upstream transformer mutates its input table.
  local facility_tags = {}
  for k, v in pairs(tags) do facility_tags[k] = v end
  local filter, transformed, polygon, road = upstream_ways_proc(tags, count)
  if filter == 0 and exempt then
    transformed["private"] = "false"
    transformed["no_thru_traffic"] = "false"
  end
  -- Normalize only facility classification, never access, oneway or restrictions.
  -- Specific side tags (including "no"/"separate") override :both, which overrides
  -- the generic tag. The stock importer incorrectly ignores :both here, and lets
  -- a generic facility mask an explicitly different side.
  if filter == 0 and facility_tags["highway"] ~= "cycleway" and
      facility_tags["highway"] ~= "path" and facility_tags["highway"] ~= "footway" and
      (facility_tags["cycleway:both"] ~= nil or facility_tags["cycleway:left"] ~= nil or
       facility_tags["cycleway:right"] ~= nil) then
    local generic = facility_tags["cycleway"]
    for _, side in ipairs({"left", "right"}) do
      local key = "cycleway:" .. side
      if facility_tags[key] == nil then
        facility_tags[key] = facility_tags["cycleway:both"] or generic
      end
    end
    facility_tags["cycleway"] = nil
    local n = 0
    for _, _ in pairs(facility_tags) do n = n + 1 end
    local _, facilities = upstream_ways_proc(facility_tags, n)
    for _, key in ipairs({"cycle_lane_right", "cycle_lane_left",
                          "cycle_lane_right_opposite", "cycle_lane_left_opposite"}) do
      transformed[key] = facilities[key]
    end
  end
  return filter, transformed, polygon, road
end
