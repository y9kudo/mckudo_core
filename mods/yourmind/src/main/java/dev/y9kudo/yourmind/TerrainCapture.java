package dev.y9kudo.yourmind;

import dev.y9kudo.yourmind.core.*;
import net.minecraft.block.*;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.util.math.BlockPos;
import java.util.*;
import java.util.function.BiPredicate;

/** World reads stay on the client thread and yield after a bounded slice. */
final class TerrainCapture {
    private final ClientWorld world;
    private final Point origin;
    private final int width, height, depth;
    private final byte[] cells;
    private final BiPredicate<BlockPos, BlockState> match;
    private int cursor;
    final List<BlockPos> targets = new ArrayList<>();
    final List<BlockPos> tables = new ArrayList<>();

    TerrainCapture(ClientWorld world, BlockPos center, int radius, BiPredicate<BlockPos, BlockState> match) {
        this.world = world; this.match = match;
        int bottom = Math.max(world.getBottomY(), center.getY() - 8);
        this.origin = new Point(center.getX() - radius, bottom, center.getZ() - radius);
        this.width = this.depth = radius * 2 + 1;
        this.height = Math.min(25, world.getTopY() - bottom);
        this.cells = new byte[width * height * depth];
    }
    boolean tick() {
        long deadline = System.nanoTime() + 2_000_000L; int reads = 0;
        for (; cursor < cells.length && reads < 4096; cursor++, reads++) {
            if ((reads & 63) == 0 && System.nanoTime() >= deadline) return false;
            int x = cursor % width, z = cursor / width % depth, y = cursor / (width * depth);
            var pos = new BlockPos(origin.x() + x, origin.y() + y, origin.z() + z);
            if (!world.isChunkLoaded(pos)) continue;
            BlockState state = world.getBlockState(pos);
            cells[cursor] = classify(world, pos, state);
            if (state.isOf(Blocks.CRAFTING_TABLE)) tables.add(pos);
            if (targets.size() < 4096 && match.test(pos, state)) targets.add(pos);
        }
        return cursor == cells.length;
    }
    VoxelGrid finish() {
        if (cursor != cells.length) throw new IllegalStateException("Incomplete terrain capture");
        return new VoxelGrid(origin, width, height, depth, cells);
    }
    static byte classify(ClientWorld world, BlockPos pos, BlockState state) {
        if (!state.getFluidState().isEmpty() || state.isOf(Blocks.FIRE) || state.isOf(Blocks.SOUL_FIRE)
                || state.isOf(Blocks.MAGMA_BLOCK) || state.isOf(Blocks.CACTUS) || state.isOf(Blocks.POWDER_SNOW)
                || state.isOf(Blocks.SWEET_BERRY_BUSH) || state.isOf(Blocks.CAMPFIRE) || state.isOf(Blocks.SOUL_CAMPFIRE))
            return VoxelGrid.HAZARD;
        if (state.getCollisionShape(world, pos).isEmpty()) return VoxelGrid.AIR;
        return state.isFullCube(world, pos) ? VoxelGrid.SOLID : VoxelGrid.UNKNOWN;
    }
    static Point point(BlockPos p) { return new Point(p.getX(), p.getY(), p.getZ()); }
    static BlockPos pos(Point p) { return new BlockPos(p.x(), p.y(), p.z()); }
}
