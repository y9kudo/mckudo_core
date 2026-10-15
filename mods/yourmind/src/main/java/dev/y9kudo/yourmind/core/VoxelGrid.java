package dev.y9kudo.yourmind.core;

/** Immutable bounded collision snapshot. Unknown space is never traversable. */
public final class VoxelGrid {
    public static final byte UNKNOWN = 0, AIR = 1, SOLID = 2, HAZARD = 3;
    private final Point origin;
    private final int width, height, depth;
    private final byte[] cells;

    public VoxelGrid(Point origin, int width, int height, int depth, byte[] cells) {
        if (width < 1 || height < 1 || depth < 1 || (long) width * height * depth > 2_000_000
                || cells.length != (long) width * height * depth) throw new IllegalArgumentException("Invalid voxel dimensions");
        for (byte cell : cells) if (cell < UNKNOWN || cell > HAZARD) throw new IllegalArgumentException("Invalid voxel cell");
        this.origin = origin; this.width = width; this.height = height; this.depth = depth;
        this.cells = cells.clone();
    }
    public byte cell(Point p) {
        int x = p.x() - origin.x(), y = p.y() - origin.y(), z = p.z() - origin.z();
        if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth) return UNKNOWN;
        return cells[(y * depth + z) * width + x];
    }
    public boolean standing(Point p) {
        return cell(p) == AIR && cell(p.add(0, 1, 0)) == AIR && cell(p.add(0, -1, 0)) == SOLID;
    }
    public boolean clearColumn(Point p, int top) {
        for (int y = p.y(); y <= top; y++) if (cell(new Point(p.x(), y, p.z())) != AIR) return false;
        return true;
    }
}
