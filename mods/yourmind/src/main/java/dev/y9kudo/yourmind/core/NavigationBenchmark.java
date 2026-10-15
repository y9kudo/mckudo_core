package dev.y9kudo.yourmind.core;

import java.util.*;

/** Standalone fixed-fixture CPU sample; it is not a live-game throughput claim. */
public final class NavigationBenchmark {
    public static void main(String[] args) {
        int width = 48, height = 6, depth = 48; byte[] cells = new byte[width * height * depth]; int index = 0;
        for (int y = 0; y < height; y++) for (int z = 0; z < depth; z++) for (int x = 0; x < width; x++)
            cells[index++] = y == 0 || x == 24 && y < 4 && z < 40 ? VoxelGrid.SOLID : VoxelGrid.AIR;
        var grid = new VoxelGrid(new Point(0, 0, 0), width, height, depth, cells);
        var planner = new RoutePlanner(); Point start = new Point(4, 1, 4), goal = new Point(42, 1, 42);
        double[] ms = new double[40]; RoutePlanner.Result result = null;
        for (int i = -12; i < ms.length; i++) {
            long began = System.nanoTime(); result = planner.plan(grid, start, goal, 0, 12_000, 20);
            double elapsed = (System.nanoTime() - began) / 1e6;
            if (result.status() != RoutePlanner.Status.COMPLETE || Math.abs(result.cost() - 63.69848480983497) > 1e-8)
                throw new IllegalStateException("Benchmark route semantics changed");
            if (i >= 0) ms[i] = elapsed;
        }
        Arrays.sort(ms);
        System.out.printf(Locale.ROOT,
                "{\"language\":\"Java\",\"fixture\":\"48x6x48-wall\",\"samples\":40,\"warmup\":12,\"cost\":%.12f,\"visited\":%d,\"medianMs\":%.4f,\"p95Ms\":%.4f,\"p99Ms\":%.4f,\"includesWorldCapture\":false}%n",
                result.cost(), result.visited(), ms[20], ms[38], ms[39]);
    }
}
