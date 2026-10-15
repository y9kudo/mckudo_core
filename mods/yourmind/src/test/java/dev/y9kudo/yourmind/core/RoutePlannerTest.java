package dev.y9kudo.yourmind.core;

import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.function.Function;
import static org.junit.jupiter.api.Assertions.*;

class RoutePlannerTest {
    private final RoutePlanner planner = new RoutePlanner();
    private VoxelGrid grid(int width, int height, int depth, Function<Point, Byte> read) {
        byte[] cells = new byte[width * height * depth]; int index = 0;
        for (int y = 0; y < height; y++) for (int z = 0; z < depth; z++) for (int x = 0; x < width; x++)
            cells[index++] = read.apply(new Point(x, y, z));
        return new VoxelGrid(new Point(0, 0, 0), width, height, depth, cells);
    }
    @Test void diagonalRouteHasKnownOptimalCost() {
        var grid = grid(16, 5, 16, p -> p.y() == 0 ? VoxelGrid.SOLID : VoxelGrid.AIR);
        var route = planner.plan(grid, new Point(1, 1, 1), new Point(12, 1, 12), 0, 5000, 20);
        assertEquals(RoutePlanner.Status.COMPLETE, route.status());
        assertEquals(11 * Math.sqrt(2), route.cost(), 1e-9); assertEquals(11, route.points().size());
    }
    @Test void cannotClipDiagonalCornersOrCrossHazards() {
        var grid = grid(6, 5, 6, p -> p.y() == 0 || p.x() == 2 && p.z() == 1 || p.x() == 1 && p.z() == 2
                ? VoxelGrid.SOLID : p.x() == 2 && p.z() == 2 ? VoxelGrid.HAZARD : VoxelGrid.AIR);
        var start = new Point(1, 1, 1); var goal = new Point(3, 1, 3);
        var route = planner.plan(grid, start, goal, 0, 5000, 20);
        assertEquals(RoutePlanner.Status.COMPLETE, route.status());
        assertTrue(route.points().size() > 2);
        assertTrue(route.points().stream().allMatch(grid::standing));
    }
    @Test void jumpsNeedHeadroomAndNoRouteMinesThroughWall() {
        var open = grid(6, 6, 5, p -> p.y() == 0 || p.x() == 3 && p.y() == 1 ? VoxelGrid.SOLID : VoxelGrid.AIR);
        var goal = new Point(4, 1, 2);
        assertEquals(RoutePlanner.Status.COMPLETE, planner.plan(open, new Point(2, 1, 2), goal, 0, 5000, 20).status());
        var sealed = grid(6, 6, 5, p -> p.y() == 0 || p.x() == 3 || p.y() == 3 ? VoxelGrid.SOLID : VoxelGrid.AIR);
        assertEquals(RoutePlanner.Status.NO_PATH, planner.plan(sealed, new Point(2, 1, 2), goal, 0, 5000, 20).status());
    }
    @Test void unknownIsNotAirAndSnapshotCopiesMutableBuffers() {
        byte[] cells = new byte[8]; cells[0] = VoxelGrid.SOLID;
        var grid = new VoxelGrid(new Point(0, 0, 0), 2, 2, 2, cells); cells[0] = VoxelGrid.AIR;
        assertEquals(VoxelGrid.SOLID, grid.cell(new Point(0, 0, 0)));
        assertEquals(VoxelGrid.UNKNOWN, grid.cell(new Point(-1, 0, 0)));
        assertEquals(RoutePlanner.Status.NO_PATH, planner.plan(grid, new Point(0, 1, 0), new Point(1, 1, 1), 0, 100, 20).status());
    }
    @Test void boundedSegmentMakesProgressTowardDistantGoal() {
        var grid = grid(20, 5, 20, p -> p.y() == 0 ? VoxelGrid.SOLID : VoxelGrid.AIR);
        var start = new Point(2, 1, 2);
        var result = planner.plan(grid, start, new Point(500, 1, 500), 0, 500, 20);
        assertEquals(RoutePlanner.Status.SEGMENT, result.status()); assertTrue(result.visited() <= 500);
        assertTrue(result.points().getLast().distanceSquared(start) >= 16);
    }
    @Test void fallingIntoVoidAndFourBlockDropsAreRejected() {
        var grid = grid(8, 10, 5, p -> p.x() < 3 && p.y() < 6 || p.x() > 4 && p.y() == 0 ? VoxelGrid.SOLID : VoxelGrid.AIR);
        assertEquals(RoutePlanner.Status.NO_PATH,
                planner.plan(grid, new Point(2, 6, 2), new Point(5, 1, 2), 0, 5000, 20).status());
    }
    @Test void recalculationUsesNewGeometry() {
        var open = grid(10, 5, 10, p -> p.y() == 0 ? VoxelGrid.SOLID : VoxelGrid.AIR);
        var blocked = grid(10, 5, 10, p -> p.y() == 0 || p.x() == 5 ? VoxelGrid.SOLID : VoxelGrid.AIR);
        var start = new Point(2, 1, 4); var goal = new Point(8, 1, 4);
        assertEquals(RoutePlanner.Status.COMPLETE, planner.plan(open, start, goal, 0, 5000, 20).status());
        assertNotEquals(RoutePlanner.Status.COMPLETE, planner.plan(blocked, start, goal, 0, 5000, 20).status());
    }
    @Test void interruptionCancelsWorkerAndDoesNotReturnAPath() {
        var grid = grid(10, 5, 10, p -> p.y() == 0 ? VoxelGrid.SOLID : VoxelGrid.AIR);
        Thread.currentThread().interrupt();
        try { assertEquals(RoutePlanner.Status.CANCELLED, planner.plan(grid, new Point(1, 1, 1), new Point(8, 1, 8), 0, 5000, 20).status()); }
        finally { Thread.interrupted(); }
    }
    @Test void budgetsAndHealthAreValidated() {
        var grid = grid(6, 5, 6, p -> p.y() == 0 ? VoxelGrid.SOLID : VoxelGrid.AIR);
        assertThrows(IllegalArgumentException.class, () -> planner.plan(grid, new Point(1, 1, 1), new Point(4, 1, 4), 0, 100_001, 20));
        assertThrows(IllegalArgumentException.class, () -> planner.plan(grid, new Point(1, 1, 1), new Point(4, 1, 4), 0, 100, Double.NaN));
    }
}
