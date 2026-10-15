package dev.y9kudo.yourmind;

import dev.y9kudo.yourmind.core.Point;
import net.minecraft.client.MinecraftClient;
import net.minecraft.util.math.*;

/** Drives ordinary input keys. Vanilla owns physics, collisions and network packets. */
final class MotionController {
    private final MinecraftClient client;
    MotionController(MinecraftClient client) { this.client = client; }
    void release() {
        client.options.forwardKey.setPressed(false); client.options.backKey.setPressed(false);
        client.options.leftKey.setPressed(false); client.options.rightKey.setPressed(false);
        client.options.jumpKey.setPressed(false); client.options.sprintKey.setPressed(false);
        if (client.player != null) client.player.setSprinting(false);
    }
    void look(Vec3d target) {
        var player = client.player; if (player == null) return;
        Vec3d delta = target.subtract(player.getEyePos());
        float yaw = (float) (Math.toDegrees(Math.atan2(delta.z, delta.x)) - 90);
        float pitch = (float) -Math.toDegrees(Math.atan2(delta.y, Math.hypot(delta.x, delta.z)));
        player.setYaw(player.getYaw() + MathHelper.clamp(MathHelper.wrapDegrees(yaw - player.getYaw()), -14, 14));
        player.setPitch(player.getPitch() + MathHelper.clamp(pitch - player.getPitch(), -10, 10));
    }
    boolean step(Point point, boolean nextIsStraight) {
        var player = client.player; if (player == null || client.world == null) return false;
        double dx = point.x() + .5 - player.getX(), dz = point.z() + .5 - player.getZ();
        double distance = Math.hypot(dx, dz);
        if (distance < .3 && Math.abs(player.getY() - point.y()) < .65) { release(); return true; }
        // Revalidate collision immediately before execution, not just at search time.
        BlockPos feet = TerrainCapture.pos(point);
        if (!client.world.isChunkLoaded(feet) || TerrainCapture.classify(client.world, feet, client.world.getBlockState(feet)) != 1
                || TerrainCapture.classify(client.world, feet.up(), client.world.getBlockState(feet.up())) != 1) {
            release(); return false;
        }
        look(new Vec3d(point.x() + .5, player.getEyeY(), point.z() + .5));
        double desired = Math.atan2(dz, dx) - Math.PI / 2;
        double angle = MathHelper.wrapDegrees((float) (Math.toDegrees(desired) - player.getYaw()));
        // Turn first; this prevents walking sideways into a ledge while the view catches up.
        boolean aligned = Math.abs(angle) < 38;
        client.options.forwardKey.setPressed(aligned);
        client.options.leftKey.setPressed(false); client.options.rightKey.setPressed(false);
        boolean sprint = aligned && nextIsStraight && player.getHungerManager().getFoodLevel() > 6 && point.y() >= player.getY() - .1;
        client.options.sprintKey.setPressed(sprint); player.setSprinting(sprint);
        client.options.jumpKey.setPressed(aligned && player.isOnGround() && point.y() > player.getY() + .4);
        return false;
    }
}
