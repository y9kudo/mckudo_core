package dev.y9kudo.yourmind.core;

import java.util.*;

/** Validated settings shared by execution, rendering and configuration import. */
public final class AgentSettings {
    private final LinkedHashMap<String, String> values = new LinkedHashMap<>();
    public AgentSettings() { reset(); }
    public void reset() {
        values.clear();
        for (String key : List.of("render", "hud", "path", "targets", "goal", "waypoints", "selection", "protection", "labels", "sprint", "jump")) values.put(key, "true");
        values.put("xray", "false"); values.put("radius", "24"); values.put("nodes", "18000");
        values.put("timeout", "600"); values.put("renderdistance", "128"); values.put("turnspeed", "14");
    }
    public void set(String name, String value) {
        name = name.toLowerCase(Locale.ROOT); value = value.toLowerCase(Locale.ROOT);
        if (!values.containsKey(name)) throw new IllegalArgumentException("Unknown setting: " + name);
        if (Set.of("radius", "nodes", "timeout", "renderdistance", "turnspeed").contains(name)) {
            int n; try { n = Integer.parseInt(value); } catch (NumberFormatException e) { throw new IllegalArgumentException("Expected an integer for " + name); }
            int min = switch (name) { case "radius" -> 8; case "nodes" -> 1000; case "timeout" -> 30; case "renderdistance" -> 16; default -> 2; };
            int max = switch (name) { case "radius" -> 48; case "nodes" -> 50000; case "timeout" -> 3600; case "renderdistance" -> 256; default -> 90; };
            if (n < min || n > max) throw new IllegalArgumentException(name + " must be " + min + ".." + max);
            value = Integer.toString(n);
        } else {
            value = switch (value) { case "on" -> "true"; case "off" -> "false"; default -> value; };
            if (!Set.of("true", "false").contains(value)) throw new IllegalArgumentException("Expected on/off or true/false for " + name);
        }
        values.put(name, value);
    }
    public boolean enabled(String name) { return Boolean.parseBoolean(values.get(name)); }
    public int integer(String name) { return Integer.parseInt(values.get(name)); }
    public Map<String, String> snapshot() { return Collections.unmodifiableMap(new LinkedHashMap<>(values)); }
    public void restore(Map<String, String> saved) {
        if (saved == null || saved.size() > 32) throw new IllegalArgumentException("Invalid settings document");
        var checked = new AgentSettings(); saved.forEach(checked::set);
        values.clear(); values.putAll(checked.values);
    }
}
