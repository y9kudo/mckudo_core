package dev.y9kudo.yourmind.core;

import java.util.*;

/** Immutable render input; drawing never starts a terrain scan or path search. */
public record DebugFrame(String status, String task, boolean paused, Point goal, List<Point> route, int routeIndex,
                         Point miningTarget, List<Point> candidates, Map<String, Point> waypoints,
                         WorldWorkspace.Region selection, Map<String, WorldWorkspace.Region> protection,
                         List<String> queue, int mined, int visited, double searchMs) {
    public DebugFrame {
        route = List.copyOf(route); candidates = List.copyOf(candidates);
        waypoints = Collections.unmodifiableMap(new LinkedHashMap<>(waypoints));
        protection = Collections.unmodifiableMap(new LinkedHashMap<>(protection)); queue = List.copyOf(queue);
    }
}
