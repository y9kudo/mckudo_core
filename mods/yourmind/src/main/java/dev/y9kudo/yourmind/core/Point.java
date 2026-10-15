package dev.y9kudo.yourmind.core;

/** World block coordinates, independent of Minecraft classes. */
public record Point(int x, int y, int z) {
    public Point add(int dx, int dy, int dz) { return new Point(x + dx, y + dy, z + dz); }
    public double distanceSquared(Point b) {
        double dx = (double) x - b.x, dy = (double) y - b.y, dz = (double) z - b.z;
        return dx * dx + dy * dy + dz * dz;
    }
}
