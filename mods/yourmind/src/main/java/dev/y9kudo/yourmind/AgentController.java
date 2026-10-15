package dev.y9kudo.yourmind;

import dev.y9kudo.yourmind.core.*;
import net.minecraft.block.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.ChatScreen;
import net.minecraft.entity.ItemEntity;
import net.minecraft.item.*;
import net.minecraft.registry.*;
import net.minecraft.registry.tag.TagKey;
import net.minecraft.screen.CraftingScreenHandler;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.util.*;
import net.minecraft.util.hit.*;
import net.minecraft.util.math.*;
import net.minecraft.world.RaycastContext;
import java.util.*;
import java.util.concurrent.*;

/** One client body, one job, one route worker. All game access is on the client thread. */
public final class AgentController {
    private final MinecraftClient client;
    private final MotionController motion;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "YourMind-OMVectorize"); t.setDaemon(true); return t;
    });
    private final RoutePlanner planner = new RoutePlanner();
    private final Map<BlockPos, Integer> avoided = new HashMap<>();
    private final Set<String> seenBlocks = new HashSet<>();
    private Command job;
    private RecipeCatalog catalog;
    private TerrainCapture capture;
    private TerrainCapture resourceCapture;
    private String scanSelector;
    private VoxelGrid grid;
    private Future<RoutePlanner.Result> pending;
    private List<Point> route = List.of();
    private BlockPos target, digging, table, replant;
    private Item replantItem;
    private Point routeGoal;
    private ResourcePlanner.Step resourceStep;
    private boolean paused, craftPending, ownedScreen;
    private int tick, routeIndex, routeAt, snapshotAt, startedAt, mined, waitUntil, craftBefore, failures;
    private int pickupUntil, lootBefore;
    private String lootItem, status = "Idle", dimension = "";
    private Vec3d lastPosition;
    private int lastProgress;
    private volatile long routeNanos;
    private int visited;

    AgentController(MinecraftClient client) { this.client = client; this.motion = new MotionController(client); }
    public void submit(Command command) {
        switch (command.name()) {
            case "help" -> { YourMindClient.message("#goto x y z | #mine <block|#tag> [count] | #get <item> [total] | #farm [radius] | #pause | #resume | #stop | #status. End stops instantly. /yourmind <command> is also supported."); return; }
            case "status" -> { YourMindClient.message(status()); return; }
            case "stop" -> { stop("Stopped"); return; }
            case "pause" -> { paused = true; cancelRoute(); release(); status = "Paused"; return; }
            case "resume" -> { paused = false; failures = 0; startedAt = tick; grid = null; avoided.clear(); status = "Resuming"; return; }
        }
        if (client.player == null || client.world == null) throw new IllegalArgumentException("Join a Minecraft world first.");
        stop("Replaced task");
        if (command.name().equals("mine")) validateSelector(command.selector());
        if (command.name().equals("get") && !Registries.ITEM.containsId(identifier(command.selector())))
            throw new IllegalArgumentException("Unknown item: " + command.selector());
        job = command; paused = false; startedAt = tick; mined = 0; failures = 0;
        dimension = client.world.getRegistryKey().getValue().toString();
        status = "Starting " + command.name(); YourMindClient.message(status);
    }
    public String status() {
        return status + " | job=" + (job == null ? "none" : job.name()) + " | mined=" + mined
                + " | route=" + routeIndex + "/" + route.size() + " | search=" + String.format(Locale.ROOT, "%.2f", routeNanos / 1e6)
                + "ms, " + visited + " nodes | recipes=" + (catalog == null ? 0 : catalog.recipes.size());
    }
    public void stop(String reason) {
        if (ownedScreen && client.player != null) client.player.closeHandledScreen();
        job = null; paused = false; cancelRoute(); release(); capture = null; grid = null; target = null;
        resourceCapture = null; scanSelector = null;
        replant = null; craftPending = false; ownedScreen = false; resourceStep = null;
        pickupUntil = 0; lootItem = null; avoided.clear(); seenBlocks.clear(); status = reason;
    }
    public void disconnect() { stop("Disconnected"); catalog = null; table = null; dimension = ""; }
    private void release() {
        motion.release();
        if (client.interactionManager != null) client.interactionManager.cancelBlockBreaking();
        digging = null;
    }
    private void cancelRoute() {
        if (pending != null) pending.cancel(true);
        pending = null; route = List.of(); routeIndex = 0; routeGoal = null;
    }
    public void tick() {
        tick++;
        if (job == null || client.player == null || client.world == null || client.interactionManager == null) return;
        if (!dimension.equals(client.world.getRegistryKey().getValue().toString())) { stop("Dimension changed; submit the task again"); return; }
        if (!client.player.isAlive()) { stop("Player died; task stopped"); return; }
        if (paused) { motion.release(); return; }
        if (client.player.getHealth() < 6) { pause("Low health: paused for manual recovery"); return; }
        if (tick - startedAt > 12_000) { pause("Task exceeded its 10-minute budget; inspect #status and #resume"); return; }
        if (client.isPaused() || client.currentScreen != null && !(client.currentScreen instanceof ChatScreen) && !ownedScreen) {
            release(); return;
        }
        if (tick < waitUntil) { motion.release(); return; }
        try {
            if (catalog == null || catalog.recipes.isEmpty() && tick % 20 == 0) catalog = new RecipeCatalog(client);
            if (job.name().equals("get") && catalog.recipes.isEmpty()) { status = "Waiting for server recipes"; return; }
            if (craftPending) { finishCraft(); return; }
            if (replant != null) { replant(); return; }
            if (pickupUntil > tick) { collectLoot(); return; }
            if (pickupUntil != 0) {
                pickupUntil = 0;
                if (lootItem != null && inventory().getOrDefault(lootItem, 0) <= lootBefore) {
                    pause("Block changed but its loot was not confirmed. Free inventory space, then #resume."); return;
                }
                lootItem = null;
            }
            if (job.name().equals("goto")) {
                if (navigate(job.target(), 0)) finish("Destination reached"); return;
            }
            if (grid == null || tick - snapshotAt > 200 && target == null) {
                capture(); return;
            }
            if (job.name().equals("get")) { get(); return; }
            if (job.name().equals("farm")) { farm(); return; }
            if (mined >= job.count()) { finish("Requested blocks mined and pickup phase completed"); return; }
            if (target == null) chooseTarget(job.selector());
            if (target != null) mineTarget();
        } catch (Exception error) {
            pause("Task error: " + error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage()));
        }
    }
    private void capture() {
        motion.release(); status = "Capturing loaded terrain (2 ms slices)";
        if (capture == null) {
            capture = new TerrainCapture(client.world, client.player.getBlockPos(), 24, (pos, state) -> {
                String id = Registries.BLOCK.getId(state.getBlock()).toString();
                if (catalog.natural(id)) seenBlocks.add(id);
                return false;
            });
        }
        if (!capture.tick()) return;
        grid = capture.finish(); snapshotAt = tick;
        table = capture.tables.stream().min(Comparator.comparingDouble(p -> p.getSquaredDistance(client.player.getPos()))).orElse(null);
        capture = null;
    }
    private void chooseTarget(String selector) {
        motion.release(); status = "Searching observed blocks";
        if (resourceCapture == null || !selector.equals(scanSelector)) {
            scanSelector = selector;
            resourceCapture = new TerrainCapture(client.world, client.player.getBlockPos(), 24, (pos, state) ->
                    avoided.getOrDefault(pos, 0) <= tick && matches(state, selector) && !state.hasBlockEntity()
                            && state.getHardness(client.world, pos) >= 0);
        }
        if (!resourceCapture.tick()) return;
        target = resourceCapture.targets.stream().min(Comparator.comparingDouble(p -> p.getSquaredDistance(client.player.getPos()))).orElse(null);
        grid = resourceCapture.finish(); snapshotAt = tick; resourceCapture = null;
        if (target == null) pause("No reachable matching resource in the captured area. Move to another area, then #resume.");
        else status = "Approaching " + Registries.BLOCK.getId(client.world.getBlockState(target).getBlock());
    }
    private void get() {
        String item = identifier(job.selector()).toString(); Map<String, Integer> inv = inventory();
        if (inv.getOrDefault(item, 0) >= job.count()) { finish("Inventory target confirmed: " + item); return; }
        if (target != null) { mineTarget(); return; }
        if (table != null && !client.world.getBlockState(table).isOf(Blocks.CRAFTING_TABLE)) table = null;
        var model = new ResourcePlanner(catalog.recipes, catalog.obtainable(seenBlocks));
        resourceStep = model.next(item, job.count(), inv, table != null);
        if (resourceStep == null) { pause("No supported collection/crafting chain for " + item + " in observed terrain. Smelting and special machines are not in this mod build."); return; }
        status = resourceStep.reason() + ": " + resourceStep.item();
        switch (resourceStep.kind()) {
            case "obtain" -> {
                List<String> sources = catalog.sources.get(resourceStep.item());
                if (sources == null) { pause("Missing block source"); return; }
                chooseTarget(String.join("|", sources));
            }
            case "station" -> placeTable();
            case "craft" -> craft();
            default -> pause("Unsupported resource step: " + resourceStep.kind());
        }
    }
    private void craft() {
        if (resourceStep.needsTable()) {
            if (table == null) { pause("Crafting table is unavailable"); return; }
            if (!(client.player.currentScreenHandler instanceof CraftingScreenHandler)) {
                if (!nearAndVisible(table)) { approach(table); return; }
                motion.release(); motion.look(Vec3d.ofCenter(table));
                client.interactionManager.interactBlock(client.player, Hand.MAIN_HAND,
                        new BlockHitResult(Vec3d.ofCenter(table).add(0, .5, 0), Direction.UP, table, false));
                ownedScreen = true; waitUntil = tick + 8; return;
            }
        } else if (ownedScreen) {
            client.player.closeHandledScreen(); ownedScreen = false; waitUntil = tick + 4; return;
        }
        var recipe = catalog.entries.get(resourceStep.recipe());
        if (recipe == null || !client.player.getRecipeBook().contains(recipe)) { pause("Recipe is not unlocked on the server: " + resourceStep.recipe()); return; }
        craftBefore = inventory().getOrDefault(resourceStep.item(), 0);
        client.interactionManager.clickRecipe(client.player.currentScreenHandler.syncId, recipe, false);
        craftPending = true; waitUntil = tick + 8; status = "Waiting for recipe placement acknowledgement";
    }
    private void finishCraft() {
        var handler = client.player.currentScreenHandler;
        if (!handler.getSlot(0).hasStack()) {
            craftPending = false; pause("Server did not populate the crafting output; inventory left unchanged"); return;
        }
        // Only take the requested result, never an unrelated manually edited output.
        if (!RecipeCatalog.id(handler.getSlot(0).getStack().getItem()).equals(resourceStep.item())) {
            craftPending = false; pause("Crafting output changed unexpectedly"); return;
        }
        client.interactionManager.clickSlot(handler.syncId, 0, 0, SlotActionType.QUICK_MOVE, client.player);
        craftPending = false; waitUntil = tick + 8;
        // A later get() decision reads authoritative inventory, so a rejected craft is not completion.
        if (++failures > 64 && inventory().getOrDefault(resourceStep.item(), 0) <= craftBefore) pause("Repeated crafting acknowledgements failed");
        status = "Checking crafted inventory";
    }
    private void placeTable() {
        if (!selectItem(Items.CRAFTING_TABLE)) { if (waitUntil <= tick) pause("Crafting table item is unavailable"); return; }
        BlockPos origin = client.player.getBlockPos();
        for (Direction direction : Direction.Type.HORIZONTAL) {
            BlockPos pos = origin.offset(direction, 2), support = pos.down();
            if (!client.world.getBlockState(pos).isAir() || !client.world.getBlockState(support).isFullCube(client.world, support)) continue;
            motion.release(); motion.look(Vec3d.ofCenter(support));
            client.interactionManager.interactBlock(client.player, Hand.MAIN_HAND,
                    new BlockHitResult(Vec3d.ofCenter(support).add(0, .5, 0), Direction.UP, support, false));
            table = pos; waitUntil = tick + 8; return;
        }
        pause("No supported empty place for the crafting table within reach");
    }
    private void mineTarget() {
        if (ownedScreen) { client.player.closeHandledScreen(); ownedScreen = false; waitUntil = tick + 4; return; }
        BlockState state = client.world.getBlockState(target);
        if (state.isAir() || state.getCollisionShape(client.world, target).isEmpty() && !(state.getBlock() instanceof CropBlock)) {
            // A prediction alone is not a resource completion. Pickup is checked separately.
            mined++; cancelRoute(); release(); target = null; grid = null; pickupUntil = tick + 100; return;
        }
        if (target.equals(client.player.getBlockPos().down())) { rejectTarget("Refusing to mine the block under the player"); return; }
        if (!nearAndVisible(target)) { approach(target); return; }
        if (!equip(state)) { if (waitUntil <= tick) rejectTarget("No suitable tool for this block"); return; }
        motion.release(); motion.look(Vec3d.ofCenter(target));
        if (!lookingAt(target)) return;
        if (!target.equals(digging)) {
            digging = target; routeAt = tick;
            lootItem = resourceStep != null && job.name().equals("get") ? resourceStep.item() : expectedDrop(state);
            lootBefore = lootItem == null ? 0 : inventory().getOrDefault(lootItem, 0);
            client.interactionManager.attackBlock(target, hit(target).getSide());
        } else client.interactionManager.updateBlockBreakingProgress(target, hit(target).getSide());
        if (tick % 5 == 0) client.player.swingHand(Hand.MAIN_HAND);
        status = "Mining " + Registries.BLOCK.getId(state.getBlock());
        if (tick - routeAt > 400) rejectTarget("Block breaking exceeded 20 seconds");
    }
    private String expectedDrop(BlockState state) {
        String id = Registries.BLOCK.getId(state.getBlock()).toString();
        for (var source : catalog.sources.entrySet()) if (source.getValue().contains(id)) return source.getKey();
        String item = RecipeCatalog.id(state.getBlock().asItem()); return item.equals("minecraft:air") ? null : item;
    }
    private void collectLoot() {
        if (lootItem != null && inventory().getOrDefault(lootItem, 0) > lootBefore) {
            pickupUntil = 0; lootItem = null; cancelRoute(); motion.release(); return;
        }
        var items = client.world.getEntitiesByClass(ItemEntity.class, client.player.getBoundingBox().expand(8),
                entity -> entity.isAlive() && (lootItem == null || RecipeCatalog.id(entity.getStack().getItem()).equals(lootItem)));
        var nearest = items.stream().min(Comparator.comparingDouble(e -> e.squaredDistanceTo(client.player))).orElse(null);
        status = "Collecting dropped items";
        if (nearest != null) navigate(TerrainCapture.point(nearest.getBlockPos()), 0); else motion.release();
    }
    private void farm() {
        if (target == null) {
            if (resourceCapture == null) resourceCapture = new TerrainCapture(client.world, client.player.getBlockPos(), job.count(),
                    (pos, state) -> avoided.getOrDefault(pos, 0) <= tick && state.getBlock() instanceof CropBlock crop && crop.isMature(state));
            if (!resourceCapture.tick()) return;
            target = resourceCapture.targets.stream().min(Comparator.comparingDouble(p -> p.getSquaredDistance(client.player.getPos()))).orElse(null);
            resourceCapture = null;
            if (target == null) { finish("No eligible mature crops remain; skipped crops may need seeds or a walkable approach"); return; }
        }
        BlockState state = client.world.getBlockState(target);
        if (state.isAir()) { target = null; return; }
        if (!nearAndVisible(target)) { approach(target); return; }
        motion.release(); motion.look(Vec3d.ofCenter(target)); if (!lookingAt(target)) return;
        replantItem = state.isOf(Blocks.WHEAT) ? Items.WHEAT_SEEDS : state.isOf(Blocks.CARROTS) ? Items.CARROT
                : state.isOf(Blocks.POTATOES) ? Items.POTATO : state.isOf(Blocks.BEETROOTS) ? Items.BEETROOT_SEEDS : null;
        if (replantItem == null || inventory().getOrDefault(RecipeCatalog.id(replantItem), 0) < 1) {
            rejectTarget("A seed is required before harvesting, so the crop can be replanted"); return;
        }
        client.interactionManager.attackBlock(target, hit(target).getSide());
        client.player.swingHand(Hand.MAIN_HAND); replant = target; target = null; waitUntil = tick + 6; cancelRoute();
    }
    private void replant() {
        motion.release();
        if (!client.world.getBlockState(replant).isAir()) {
            if (client.world.getBlockState(replant).getBlock() instanceof CropBlock crop && !crop.isMature(client.world.getBlockState(replant))) {
                replant = null; pickupUntil = tick + 60; lootItem = null; mined++; return;
            }
            pause("Harvest was not confirmed by the server"); replant = null; return;
        }
        if (!client.world.getBlockState(replant.down()).isOf(Blocks.FARMLAND)) { pause("Farmland changed before replanting"); replant = null; return; }
        if (!selectItem(replantItem)) { if (waitUntil <= tick) { pause("Seed is unavailable for replanting"); replant = null; } return; }
        client.interactionManager.interactBlock(client.player, Hand.MAIN_HAND,
                new BlockHitResult(Vec3d.ofCenter(replant.down()).add(0, .5, 0), Direction.UP, replant.down(), false));
        waitUntil = tick + 6;
    }
    private boolean navigate(Point goal, int range) {
        if (RoutePlanner.reached(TerrainCapture.point(client.player.getBlockPos()), goal, range)
                && (range != 0 || client.player.getPos().squaredDistanceTo(goal.x() + .5, goal.y(), goal.z() + .5) < .2)) {
            cancelRoute(); motion.release(); return true;
        }
        if (grid == null) { capture(); return false; }
        if (routeGoal == null || !routeGoal.equals(goal)) {
            cancelRoute(); routeGoal = goal; Point start = TerrainCapture.point(client.player.getBlockPos());
            VoxelGrid snapshot = grid; double health = client.player.getHealth();
            long began = System.nanoTime();
            pending = worker.submit(() -> { var result = planner.plan(snapshot, start, goal, range, 18_000, health);
                routeNanos = System.nanoTime() - began; return result; });
            motion.release(); status = "Planning route"; return false;
        }
        if (pending != null) {
            if (!pending.isDone()) { motion.release(); return false; }
            try {
                var result = pending.get(); pending = null; visited = result.visited();
                route = result.points(); routeIndex = 0; lastPosition = client.player.getPos(); lastProgress = tick;
                if (route.isEmpty()) { rejectTarget("No collision-safe ground route"); return false; }
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); cancelRoute(); return false; }
            catch (ExecutionException | CancellationException e) { pause("Route worker failed: " + e.getMessage()); return false; }
        }
        if (routeIndex >= route.size()) { cancelRoute(); grid = null; return false; }
        Point next = route.get(routeIndex);
        BlockPos support = TerrainCapture.pos(next).down();
        if (!client.world.isChunkLoaded(support) || TerrainCapture.classify(client.world, support, client.world.getBlockState(support)) != VoxelGrid.SOLID) {
            cancelRoute(); grid = null; motion.release(); return false;
        }
        boolean straight = routeIndex + 1 < route.size() && route.get(routeIndex + 1).y() == next.y()
                && routeIndex > 0 && next.x() - route.get(routeIndex - 1).x() == route.get(routeIndex + 1).x() - next.x()
                && next.z() - route.get(routeIndex - 1).z() == route.get(routeIndex + 1).z() - next.z();
        if (motion.step(next, straight)) { routeIndex++; lastProgress = tick; }
        if (lastPosition == null || client.player.getPos().squaredDistanceTo(lastPosition) > .09) {
            lastPosition = client.player.getPos(); lastProgress = tick;
        }
        if (tick - lastProgress > 60) rejectTarget("Movement stalled; refreshing terrain");
        status = "Following route " + routeIndex + "/" + route.size(); return false;
    }
    private void approach(BlockPos block) {
        if (routeGoal != null) { navigate(routeGoal, 0); return; }
        Point best = null; double distance = Double.POSITIVE_INFINITY;
        for (BlockPos pos : BlockPos.iterate(block.add(-2, -2, -2), block.add(2, 1, 2))) {
            Point point = TerrainCapture.point(pos);
            if (grid == null || !grid.standing(point)) continue;
            Vec3d eye = new Vec3d(pos.getX() + .5, pos.getY() + 1.62, pos.getZ() + .5);
            if (eye.squaredDistanceTo(Vec3d.ofCenter(block)) > 16) continue;
            var ray = client.world.raycast(new RaycastContext(eye, Vec3d.ofCenter(block),
                    RaycastContext.ShapeType.OUTLINE, RaycastContext.FluidHandling.NONE, client.player));
            if (!ray.getBlockPos().equals(block)) continue;
            double value = pos.getSquaredDistance(client.player.getPos());
            if (value < distance) { distance = value; best = point; }
        }
        if (best == null) { rejectTarget("No visible supported approach to the resource"); return; }
        navigate(best, 0);
    }
    private void rejectTarget(String reason) {
        if (target != null) avoided.put(target, tick + 600);
        target = null; cancelRoute(); grid = null; release(); resourceStep = null;
        if (++failures >= 8 || job != null && job.name().equals("goto")) pause(reason); else status = reason;
    }
    private void pause(String reason) { paused = true; cancelRoute(); release(); status = reason; YourMindClient.message(reason); }
    private void finish(String reason) { stop(reason); YourMindClient.message(reason); }
    private BlockHitResult hit(BlockPos pos) {
        return client.world.raycast(new RaycastContext(client.player.getEyePos(), Vec3d.ofCenter(pos),
                RaycastContext.ShapeType.OUTLINE, RaycastContext.FluidHandling.NONE, client.player));
    }
    private boolean nearAndVisible(BlockPos pos) {
        return client.player.getEyePos().squaredDistanceTo(Vec3d.ofCenter(pos)) <= 16 && hit(pos).getBlockPos().equals(pos);
    }
    private boolean lookingAt(BlockPos pos) {
        HitResult ray = client.player.raycast(4.5, 1, false);
        return ray instanceof BlockHitResult block && block.getType() == HitResult.Type.BLOCK && block.getBlockPos().equals(pos);
    }
    private Map<String, Integer> inventory() {
        var result = new HashMap<String, Integer>();
        for (int i = 0; i < 36; i++) {
            ItemStack stack = client.player.getInventory().getStack(i);
            if (!stack.isEmpty()) result.merge(RecipeCatalog.id(stack.getItem()), stack.getCount(), Integer::sum);
        }
        return result;
    }
    private boolean equip(BlockState block) {
        int best = -1; float speed = 1;
        for (int i = 0; i < 36; i++) {
            ItemStack item = client.player.getInventory().getStack(i);
            if (block.isToolRequired() && !item.isSuitableFor(block)) continue;
            float value = item.getMiningSpeedMultiplier(block);
            if (value > speed || best < 0 && block.isToolRequired()) { speed = value; best = i; }
        }
        if (best >= 0) return selectSlot(best);
        if (block.isToolRequired()) return false;
        for (int i = 0; i < 36; i++) if (!client.player.getInventory().getStack(i).isDamageable()) return selectSlot(i);
        return false;
    }
    private boolean selectItem(Item item) {
        for (int i = 0; i < 36; i++) if (client.player.getInventory().getStack(i).isOf(item)) return selectSlot(i);
        return false;
    }
    private boolean selectSlot(int slot) {
        if (slot < 9) { client.player.getInventory().selectedSlot = slot; return true; }
        if (client.player.currentScreenHandler != client.player.playerScreenHandler) return false;
        client.interactionManager.clickSlot(client.player.playerScreenHandler.syncId, slot, 0, SlotActionType.SWAP, client.player);
        client.player.getInventory().selectedSlot = 0; waitUntil = tick + 3; return false;
    }
    private Identifier identifier(String name) {
        Identifier id = Identifier.tryParse(name.startsWith("#") ? name.substring(1) : name);
        if (id == null) throw new IllegalArgumentException("Invalid identifier"); return id;
    }
    private void validateSelector(String selector) {
        if (!selector.startsWith("#") && !Registries.BLOCK.containsId(identifier(selector)))
            throw new IllegalArgumentException("Unknown block: " + selector);
    }
    private boolean matches(BlockState state, String selector) {
        if (selector.contains("|")) return Arrays.stream(selector.split("\\|")).anyMatch(s -> matches(state, s));
        if (selector.startsWith("#")) return state.isIn(TagKey.of(RegistryKeys.BLOCK, identifier(selector)));
        return Registries.BLOCK.getId(state.getBlock()).equals(identifier(selector));
    }
}
