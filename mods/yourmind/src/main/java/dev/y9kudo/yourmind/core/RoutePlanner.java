package dev.y9kudo.yourmind.core;

import java.util.*;

/** OMVectorize Java ground planner. Only immutable snapshots enter the worker. */
public final class RoutePlanner {
    public enum Status { COMPLETE, SEGMENT, NO_PATH, CANCELLED }
    public record Result(Status status, List<Point> points, int visited, double cost) {
        public Result { points = List.copyOf(points); }
    }
    private record State(Point point, int damage) {}
    private record Node(State state, double cost, double estimate, Node parent) {}
    private static double heuristic(Point p, Point goal, int range) {
        double x = Math.max(0, Math.abs((double) p.x() - goal.x()) - range);
        double z = Math.max(0, Math.abs((double) p.z() - goal.z()) - range);
        return Math.max(x, z) + (Math.sqrt(2) - 1) * Math.min(x, z)
                + Math.max(0, Math.abs((double) p.y() - goal.y()) - range) * .3;
    }
    public static boolean reached(Point p, Point goal, int range) {
        return Math.abs((long) p.x() - goal.x()) <= range && Math.abs((long) p.y() - goal.y()) <= range
                && Math.abs((long) p.z() - goal.z()) <= range;
    }
    public Result plan(VoxelGrid grid, Point start, Point goal, int range, int maxNodes, double health) {
        return plan(grid, start, goal, range, maxNodes, health, true);
    }
    public Result plan(VoxelGrid grid, Point start, Point goal, int range, int maxNodes, double health, boolean allowJump) {
        if (range < 0 || range > 4 || maxNodes < 1 || maxNodes > 100_000 || !Double.isFinite(health))
            throw new IllegalArgumentException("Invalid route budget");
        if (!grid.standing(start)) return new Result(Status.NO_PATH, List.of(), 0, 0);
        var queue = new PriorityQueue<Node>(Comparator.comparingDouble(Node::estimate).thenComparingDouble(Node::cost));
        var best = new HashMap<State, Double>();
        var first = new Node(new State(start, 0), 0, heuristic(start, goal, range), null);
        queue.add(first); best.put(first.state(), 0.0); Node closest = first; int visited = 0;
        while (!queue.isEmpty() && visited < maxNodes) {
            if (Thread.currentThread().isInterrupted()) return new Result(Status.CANCELLED, List.of(), visited, 0);
            Node node = queue.poll(); Point p = node.state().point();
            if (node.cost() > best.getOrDefault(node.state(), Double.POSITIVE_INFINITY)) continue;
            visited++;
            if (reached(p, goal, range)) return result(Status.COMPLETE, node, visited);
            if (heuristic(p, goal, range) < heuristic(closest.state().point(), goal, range)) closest = node;
            for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) {
                if (dx == 0 && dz == 0) continue;
                boolean diagonal = dx != 0 && dz != 0;
                for (int dy = allowJump ? 1 : 0; dy >= -3; dy--) {
                    Point next = p.add(dx, dy, dz);
                    if (!grid.standing(next) || diagonal && dy != 0) continue;
                    if (diagonal && (!grid.standing(p.add(dx, 0, 0)) || !grid.standing(p.add(0, 0, dz)))) continue;
                    if (dy == 1 && grid.cell(p.add(0, 2, 0)) != VoxelGrid.AIR) continue;
                    if (!grid.clearColumn(next, p.y() + 1)) continue;
                    int damage = node.state().damage() + Math.max(0, -dy - 3);
                    if (health - damage < 6) continue;
                    double cost = node.cost() + (diagonal ? Math.sqrt(2) : 1) + Math.abs(dy) * .3;
                    var state = new State(next, damage);
                    if (cost >= best.getOrDefault(state, Double.POSITIVE_INFINITY)) continue;
                    best.put(state, cost); queue.add(new Node(state, cost, cost + heuristic(next, goal, range), node));
                }
            }
        }
        // A segment must make useful progress; a one-cell oscillation is not a route.
        if (closest.state().point().distanceSquared(start) >= 16
                && heuristic(closest.state().point(), goal, range) + 2 < heuristic(start, goal, range))
            return result(Status.SEGMENT, closest, visited);
        return new Result(Status.NO_PATH, List.of(), visited, 0);
    }
    private Result result(Status status, Node node, int visited) {
        var points = new ArrayList<Point>(); double cost = node.cost();
        for (; node.parent() != null; node = node.parent()) points.add(node.state().point());
        Collections.reverse(points); return new Result(status, points, visited, cost);
    }
}
