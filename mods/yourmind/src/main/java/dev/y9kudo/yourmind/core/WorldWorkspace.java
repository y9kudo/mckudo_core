package dev.y9kudo.yourmind.core;

import java.util.*;

/** Kept separately for each server/world and dimension. */
public final class WorldWorkspace {
    public record Region(Point first, Point second) {
        public Region { valid(first); valid(second); }
        public boolean contains(Point p) {
            return p.x() >= Math.min(first.x(), second.x()) && p.x() <= Math.max(first.x(), second.x())
                    && p.y() >= Math.min(first.y(), second.y()) && p.y() <= Math.max(first.y(), second.y())
                    && p.z() >= Math.min(first.z(), second.z()) && p.z() <= Math.max(first.z(), second.z());
        }
        public long volume() { return ((long)Math.abs(first.x() - second.x()) + 1) * ((long)Math.abs(first.y() - second.y()) + 1) * ((long)Math.abs(first.z() - second.z()) + 1); }
    }
    private final LinkedHashMap<String, Point> points = new LinkedHashMap<>();
    private final LinkedHashMap<String, Region> regions = new LinkedHashMap<>();
    private Point first, second, goal;
    public void waypoint(String name, Point p) {
        Command.markerName(name); valid(p);
        if (!points.containsKey(name) && points.size() >= 64) throw new IllegalArgumentException("At most 64 waypoints per world");
        points.put(name, p);
    }
    public Point waypoint(String name) { Point p = points.get(name); if (p == null) throw new IllegalArgumentException("Unknown waypoint in this world: " + name); return p; }
    public void removeWaypoint(String name) { points.remove(name); }
    public void clearWaypoints() { points.clear(); }
    public Map<String, Point> waypoints() { return Collections.unmodifiableMap(new LinkedHashMap<>(points)); }
    public void first(Point p) { valid(p); first = p; }
    public void second(Point p) { valid(p); second = p; }
    public void clearSelection() { first = second = null; }
    public Region selection() { return first == null || second == null ? null : new Region(first, second); }
    public void goal(Point p) { if (p != null) valid(p); goal = p; }
    public Point goal() { return goal; }
    public void protect(String name) {
        Command.markerName(name); Region region = selection();
        if (region == null) throw new IllegalArgumentException("Set both #pos1 and #pos2 first");
        if (!regions.containsKey(name) && regions.size() >= 32) throw new IllegalArgumentException("At most 32 protected regions per world");
        regions.put(name, region);
    }
    public void unprotect(String name) { if (name.equals("all")) regions.clear(); else regions.remove(name); }
    public boolean protectedAt(Point p) { return regions.values().stream().anyMatch(r -> r.contains(p)); }
    public Map<String, Region> regions() { return Collections.unmodifiableMap(new LinkedHashMap<>(regions)); }
    public void restore(Map<String, Point> savedPoints, Map<String, Region> savedRegions) {
        if (savedPoints == null || savedRegions == null || savedPoints.size() > 64 || savedRegions.size() > 32) throw new IllegalArgumentException("Workspace limits exceeded");
        var checked = new WorldWorkspace(); savedPoints.forEach(checked::waypoint);
        savedRegions.forEach((name, r) -> { Command.markerName(name); if (r == null) throw new IllegalArgumentException("Invalid region"); valid(r.first()); valid(r.second()); checked.regions.put(name, r); });
        points.clear(); points.putAll(checked.points); regions.clear(); regions.putAll(checked.regions);
    }
    private static void valid(Point p) {
        if (p == null || Math.abs((long)p.x()) > 29_999_984 || Math.abs((long)p.z()) > 29_999_984 || p.y() < -64 || p.y() > 319)
            throw new IllegalArgumentException("Position outside Minecraft 1.21.1 build bounds");
    }
}
