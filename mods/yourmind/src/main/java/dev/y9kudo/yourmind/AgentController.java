package dev.y9kudo.yourmind;

import dev.y9kudo.yourmind.core.*;
import net.minecraft.block.*;
import net.minecraft.client.MinecraftClient;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.gui.screen.ChatScreen;
import net.minecraft.entity.ItemEntity;
import net.minecraft.item.*;
import net.minecraft.registry.*;
import net.minecraft.registry.tag.TagKey;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.screen.CraftingScreenHandler;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.util.*;
import net.minecraft.util.hit.*;
import net.minecraft.util.math.*;
import net.minecraft.world.RaycastContext;
import net.minecraft.component.DataComponentTypes;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;

/** One client body, one job, one route worker. All game access is on the client thread. */
public final class AgentController {
    private final MinecraftClient client;
    private final MotionController motion;
    private final AgentSettings settings = new AgentSettings();
    private final TaskQueue queue = new TaskQueue();
    private final Map<String, WorldWorkspace> workspaces = new LinkedHashMap<>();
    private final ConfigurationStore configuration = new ConfigurationStore(FabricLoader.getInstance().getConfigDir().resolve("yourmind.json"));
    private List<Point> candidates = List.of();
    private Point jobGoal, farmOrigin;
    private int patrolIndex, operationBefore, operationFood, operationAt, dropIssued;
    private boolean usingFood;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "YourMind-OMVectorize"); t.setDaemon(true); return t;
    });
    private final RoutePlanner planner = new RoutePlanner();
    private final Map<BlockPos, Integer> avoided = new HashMap<>();
    private final Set<String> seenBlocks = new HashSet<>();
    private final Deque<String> toolGoals = new ArrayDeque<>();
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
    private DebugFrame debugCache;
    private int debugAt = -1;

    AgentController(MinecraftClient client) {
        this.client = client; this.motion = new MotionController(client, settings);
        try { loadConfiguration(); } catch (IOException error) { status = error.getMessage(); }
    }
    public AgentSettings settings() { return settings; }
    private void connected() { if (client.player == null || client.world == null) throw new IllegalArgumentException("Join a Minecraft world first."); }
    private Point position() { connected(); return TerrainCapture.point(client.player.getBlockPos()); }
    WorldWorkspace workspace() {
        connected();
        String server = client.getServer() != null ? client.getServer().getSavePath(WorldSavePath.ROOT).toAbsolutePath().normalize().toString()
                : client.getCurrentServerEntry() != null ? client.getCurrentServerEntry().address : "unknown-server";
        String key = server + "|" + client.world.getRegistryKey().getValue();
        if (!workspaces.containsKey(key) && workspaces.size() >= 64) throw new IllegalArgumentException("World workspace limit reached; back up and edit config/yourmind.json");
        return workspaces.computeIfAbsent(key, ignored -> new WorldWorkspace());
    }
    private void loadConfiguration() throws IOException {
        var restored = configuration.load(); settings.restore(restored.settings().snapshot()); workspaces.clear(); workspaces.putAll(restored.worlds());
    }
    public DebugFrame debugFrame() {
        if (debugCache != null && debugAt == tick) return debugCache;
        WorldWorkspace world;
        try { world = client.world == null || client.player == null ? new WorldWorkspace() : workspace(); }
        catch (IllegalArgumentException error) { world = new WorldWorkspace(); }
        debugAt = tick;
        return debugCache = new DebugFrame(status, job == null ? "idle" : job.name() + (job.selector().isEmpty() ? "" : " " + job.selector()), paused,
                jobGoal != null ? jobGoal : routeGoal != null ? routeGoal : world.goal(), route, routeIndex,
                target == null ? null : TerrainCapture.point(target), candidates, world.waypoints(), world.selection(), world.regions(),
                queue.snapshot().stream().map(c -> c.name() + " " + c.selector()).toList(), mined, visited, routeNanos / 1e6);
    }
    public void submit(Command command) {
        debugAt = -1;
        if (localCommand(command)) return;
        connected();
        if (Set.of("mine", "find").contains(command.name())) validateSelector(command.selector());
        if (Set.of("get", "craft", "drop", "equip").contains(command.name()) && !Registries.ITEM.containsId(identifier(command.selector())))
            throw new IllegalArgumentException("Unknown item: " + command.selector());
        if (command.name().equals("collect") && !command.selector().equals("all") && !Registries.ITEM.containsId(identifier(command.selector())))
            throw new IllegalArgumentException("Unknown item: " + command.selector());
        Point destination = resolveGoal(command);
        if (destination != null) workspace().goal(destination);
        if (command.name().equals("patrol")) command.arguments().forEach(name -> workspace().waypoint(name));
        clearCurrent("Replaced task");
        job = command; paused = false; startedAt = tick; mined = 0; failures = 0;
        jobGoal = destination; farmOrigin = position(); patrolIndex = 0; operationAt = 0;
        operationBefore = Set.of("craft", "drop", "collect").contains(command.name()) && !command.selector().equals("all")
                ? inventory().getOrDefault(identifier(command.selector()).toString(), 0) : 0;
        dropIssued = 0;
        if (command.name().equals("collect") && command.selector().equals("all")) operationBefore = inventory().values().stream().mapToInt(Integer::intValue).sum();
        if (command.name().equals("craft")) job = new Command("craft", command.selector(), operationBefore + command.count(), null, command.arguments());
        dimension = client.world.getRegistryKey().getValue().toString();
        status = "Starting " + command.name(); YourMindClient.message(status);
    }
    private Point resolveGoal(Command c) {
        Point p = position();
        return switch (c.name()) {
            case "goto" -> c.target() == null ? workspace().waypoint(c.selector()) : c.target();
            case "home" -> workspace().waypoint("home");
            case "path" -> { if (workspace().goal() == null) throw new IllegalArgumentException("Set #goal first"); yield workspace().goal(); }
            case "offset" -> p.add(c.target().x(), c.target().y(), c.target().z());
            case "up" -> p.add(0, c.count(), 0);
            case "down" -> p.add(0, -c.count(), 0);
            case "forward", "back", "left", "right", "explore" -> {
                double yaw = Math.toRadians(client.player.getYaw() + (c.name().equals("back") ? 180 : c.name().equals("left") ? -90 : c.name().equals("right") ? 90 : 0));
                yield p.add((int)Math.round(-Math.sin(yaw) * c.count()), 0, (int)Math.round(Math.cos(yaw) * c.count()));
            }
            case "look" -> c.target();
            default -> null;
        };
    }
    private boolean localCommand(Command c) {
        switch (c.name()) {
            case "help" -> {
                int pages = (Command.HELP.size() + 7) / 8, page = Math.min(c.count(), pages);
                YourMindClient.message("YourMind " + YourMindClient.VERSION + " | help " + page + "/" + pages + " | " + Command.HELP.size() + " commands | End stops immediately");
                Command.HELP.entrySet().stream().skip((page - 1L) * 8).limit(8).forEach(e -> YourMindClient.message("#" + e.getKey() + " " + e.getValue())); return true;
            }
            case "version" -> { YourMindClient.message("YourMind " + YourMindClient.VERSION + " | Fabric 1.21.1 | developed by y9kudo"); return true; }
            case "status" -> { YourMindClient.message(status()); return true; }
            case "stop" -> { stop("Stopped"); return true; }
            case "pause" -> { if (job != null) pause("Paused"); return true; }
            case "resume", "retry" -> {
                if (job == null) throw new IllegalArgumentException("There is no current task");
                paused = false; failures = 0; startedAt = tick; avoided.clear(); refreshRoute();
                if (job.name().equals("eat")) operationAt = 0;
                if (c.name().equals("retry")) { target = null; pickupUntil = 0; craftPending = false; toolGoals.clear(); }
                status = "Resuming " + job.name(); return true;
            }
            case "repath" -> { refreshRoute(); status = "Route refresh requested"; return true; }
            case "skip" -> { clearCurrent("Skipped task"); nextQueued(); return true; }
            case "clearqueue" -> { queue.clear(); YourMindClient.message("Waiting tasks cleared"); return true; }
            case "queue", "repeat" -> {
                connected(); queue.add(Command.parse(c.selector()), c.count());
                YourMindClient.message("Waiting tasks: " + queue.size()); if (job == null) nextQueued(); return true;
            }
            case "tasks" -> {
                YourMindClient.message(status()); int n = 1;
                for (Command task : queue.snapshot()) YourMindClient.message((n++) + ". " + task.name() + " " + task.selector() + " " + (task.target() == null ? "" : task.target())); return true;
            }
            case "settings" -> { settings.snapshot().forEach((k,v) -> YourMindClient.message(k + " = " + v)); return true; }
            case "set" -> { settings.set(c.selector(), c.arguments().get(1)); if (Set.of("radius", "nodes", "jump").contains(c.selector().toLowerCase(Locale.ROOT))) refreshRoute(); YourMindClient.message(c.selector() + " = " + settings.snapshot().get(c.selector().toLowerCase(Locale.ROOT))); return true; }
            case "resetsettings" -> { settings.reset(); refreshRoute(); YourMindClient.message("Default settings restored"); return true; }
            case "render", "hud" -> { settings.set(c.name(), c.selector().equals("toggle") ? Boolean.toString(!settings.enabled(c.name())) : c.selector()); YourMindClient.message(c.name() + " = " + settings.enabled(c.name())); return true; }
            case "save", "load" -> {
                try { if (c.name().equals("save")) configuration.save(settings, workspaces); else { loadConfiguration(); refreshRoute(); } }
                catch (IOException error) { throw new IllegalArgumentException(error.getMessage()); }
                YourMindClient.message("Configuration " + (c.name().equals("save") ? "saved to" : "loaded from") + " config/yourmind.json"); return true;
            }
        }
        if (Command.isJob(c.name())) return false;
        connected();
        switch (c.name()) {
            case "pos" -> YourMindClient.message(position() + " | " + client.world.getRegistryKey().getValue());
            case "inventory" -> {
                var entries = inventory().entrySet().stream().filter(e -> e.getKey().contains(c.selector())).sorted(Map.Entry.comparingByKey()).toList();
                YourMindClient.message("Inventory: " + entries.size() + " item types"); entries.stream().limit(16).forEach(e -> YourMindClient.message(e.getKey() + " x" + e.getValue()));
            }
            case "blocks" -> Registries.BLOCK.getIds().stream().filter(id -> id.toString().contains(c.selector())).sorted(Comparator.comparing(Identifier::toString)).limit(16).forEach(id -> YourMindClient.message(id.toString()));
            case "recipes" -> {
                if (catalog == null) catalog = new RecipeCatalog(client);
                YourMindClient.message("Crafting recipes from server: " + catalog.recipes.size());
                catalog.recipes.stream().filter(r -> r.output().contains(c.selector())).limit(8).forEach(r -> YourMindClient.message(r.id() + " -> " + r.output() + " x" + r.count() + " | " + r.ingredients()));
            }
            case "goal" -> {
                if (c.target() != null) workspace().goal(c.target());
                else if (c.selector().equalsIgnoreCase("clear")) workspace().goal(null);
                else if (c.selector().equalsIgnoreCase("here")) workspace().goal(position());
                else if (!c.selector().isEmpty()) workspace().goal(workspace().waypoint(c.selector()));
                YourMindClient.message("Goal: " + workspace().goal() + " | use #path to move");
            }
            case "sethome" -> { workspace().waypoint("home", position()); YourMindClient.message("Home saved; #save persists it"); }
            case "waypoint" -> {
                String action = c.arguments().getFirst().toLowerCase(Locale.ROOT);
                switch (action) {
                    case "add" -> { workspace().waypoint(c.arguments().get(1), c.target() == null ? position() : c.target()); YourMindClient.message("Waypoint added; #save persists it"); }
                    case "remove" -> workspace().removeWaypoint(c.arguments().get(1));
                    case "clear" -> workspace().clearWaypoints();
                    case "goto" -> submit(new Command("goto", "", 0, workspace().waypoint(c.arguments().get(1))));
                    case "list" -> workspace().waypoints().forEach((k,p) -> YourMindClient.message(k + " = " + p));
                }
            }
            case "pos1", "pos2" -> {
                Point p = c.target() != null ? c.target() : client.crosshairTarget instanceof BlockHitResult block && block.getType() == HitResult.Type.BLOCK ? TerrainCapture.point(block.getBlockPos()) : position();
                if (c.name().equals("pos1")) workspace().first(p); else workspace().second(p);
                YourMindClient.message(c.name() + " = " + p);
            }
            case "selection" -> {
                if (!c.arguments().isEmpty()) workspace().clearSelection();
                var selection = workspace().selection(); YourMindClient.message(selection == null ? "Selection is incomplete" : selection + " | " + selection.volume() + " blocks");
            }
            case "protect" -> { workspace().protect(c.selector()); release(); target = null; resourceCapture = null; candidates = List.of(); YourMindClient.message("Protected region: " + c.selector() + "; #save persists it"); }
            case "unprotect" -> { workspace().unprotect(c.selector()); YourMindClient.message("Protection updated"); }
            default -> throw new IllegalArgumentException("Unimplemented command: " + c.name());
        }
        return true;
    }
    private void refreshRoute() { cancelRoute(); release(); grid = null; capture = null; resourceCapture = null; }
    private boolean specialJob() {
        switch (job.name()) {
            case "come", "follow" -> {
                var player = client.world.getPlayers().stream().filter(p -> p != client.player && p.getName().getString().equalsIgnoreCase(job.selector())).findFirst().orElse(null);
                if (player == null) { pause("Player is not visible in loaded terrain: " + job.selector()); return true; }
                if (player.squaredDistanceTo(client.player) <= job.count() * job.count()) {
                    cancelRoute(); motion.release(); motion.look(player.getEyePos());
                    if (job.name().equals("come")) finish("Player reached"); else status = "Following " + job.selector() + " at a safe distance";
                } else {
                    Point next = TerrainCapture.point(player.getBlockPos());
                    if (routeGoal != null && routeGoal.distanceSquared(next) < 4) next = routeGoal;
                    navigate(next, 2);
                }
                return true;
            }
            case "patrol" -> {
                Point next = workspace().waypoint(job.arguments().get(patrolIndex % job.arguments().size()));
                if (navigate(next, 0)) { patrolIndex++; waitUntil = tick + 20; }
                return true;
            }
            case "look" -> {
                Vec3d aim;
                if (jobGoal != null) aim = Vec3d.ofCenter(TerrainCapture.pos(jobGoal));
                else {
                    var player = client.world.getPlayers().stream().filter(p -> p.getName().getString().equalsIgnoreCase(job.selector())).findFirst().orElse(null);
                    if (player == null) { pause("Player is not visible: " + job.selector()); return true; } aim = player.getEyePos();
                }
                motion.release(); motion.look(aim); if (++operationAt >= 24) finish("View aligned"); return true;
            }
            case "equip" -> {
                if (selectItem(Registries.ITEM.get(identifier(job.selector())))) finish("Item equipped: " + job.selector());
                else if (waitUntil <= tick) pause("Item is not in inventory: " + job.selector()); return true;
            }
            case "drop" -> {
                int now = inventory().getOrDefault(identifier(job.selector()).toString(), 0);
                if (operationBefore - now >= job.count()) { finish("Requested items dropped"); return true; }
                if (dropIssued >= job.count()) { pause("Drop result was not confirmed; no extra items will be dropped"); return true; }
                if (!selectItem(Registries.ITEM.get(identifier(job.selector())))) { if (waitUntil <= tick) pause("Requested item is unavailable"); return true; }
                client.player.dropSelectedItem(false); dropIssued++; waitUntil = tick + 6; return true;
            }
            case "eat" -> { eat(); return true; }
            case "collect" -> {
                int now = job.selector().equals("all") ? inventory().values().stream().mapToInt(Integer::intValue).sum() : inventory().getOrDefault(identifier(job.selector()).toString(), 0);
                if (now - operationBefore >= job.count() && (job.arguments().size() >= 2 || !job.selector().equals("all"))) { finish("Collected inventory target confirmed"); return true; }
                var entities = client.world.getEntitiesByClass(ItemEntity.class, client.player.getBoundingBox().expand(16), e -> e.isAlive() && (job.selector().equals("all") || RecipeCatalog.id(e.getStack().getItem()).equals(identifier(job.selector()).toString())));
                var nearest = entities.stream().min(Comparator.comparingDouble(e -> e.squaredDistanceTo(client.player))).orElse(null);
                if (nearest == null) { finish("Pickup area clear; inventory change: " + (now - operationBefore)); return true; }
                navigate(TerrainCapture.point(nearest.getBlockPos()), 0); return true;
            }
            default -> { return false; }
        }
    }
    private void eat() {
        if (operationAt == 0) {
            if (!client.player.canConsume(false)) { pause("Food is not needed at the current hunger level"); return; }
            Item chosen = null; int nutrition = 0;
            for (int i = 0; i < 36; i++) {
                ItemStack item = client.player.getInventory().getStack(i); var food = item.get(DataComponentTypes.FOOD);
                if (food != null && food.nutrition() > nutrition && !item.isOf(Items.ROTTEN_FLESH) && !item.isOf(Items.SPIDER_EYE)
                        && !item.isOf(Items.POISONOUS_POTATO) && !item.isOf(Items.PUFFERFISH)) { chosen = item.getItem(); nutrition = food.nutrition(); }
            }
            if (chosen == null) { pause("No usable food in inventory"); return; }
            if (!selectItem(chosen)) { if (waitUntil <= tick) pause("Cannot equip food"); return; }
            operationFood = client.player.getHungerManager().getFoodLevel(); operationAt = tick;
            client.interactionManager.interactItem(client.player, Hand.MAIN_HAND); usingFood = true;
        }
        motion.release(); client.options.useKey.setPressed(true);
        if (client.player.getHungerManager().getFoodLevel() > operationFood) { finish("Food consumption confirmed"); return; }
        if (tick - operationAt > 100) pause("Food consumption was not confirmed");
    }
    public String status() {
        return status + " | job=" + (job == null ? "none" : job.name()) + " | mined=" + mined
                + " | route=" + routeIndex + "/" + route.size() + " | search=" + String.format(Locale.ROOT, "%.2f", routeNanos / 1e6)
                + "ms, " + visited + " nodes | recipes=" + (catalog == null ? 0 : catalog.recipes.size());
    }
    public void stop(String reason) {
        debugAt = -1;
        queue.clear(); clearCurrent(reason);
    }
    private void clearCurrent(String reason) {
        if (ownedScreen && client.player != null) client.player.closeHandledScreen();
        job = null; paused = false; cancelRoute(); release(); capture = null; grid = null; target = null;
        resourceCapture = null; scanSelector = null;
        replant = null; craftPending = false; ownedScreen = false; resourceStep = null;
        pickupUntil = 0; lootItem = null; avoided.clear(); seenBlocks.clear(); toolGoals.clear(); status = reason;
        candidates = List.of(); jobGoal = null; usingFood = false; operationAt = 0;
    }
    public void disconnect() { stop("Disconnected"); catalog = null; table = null; dimension = ""; }
    private void release() {
        motion.release();
        if (usingFood) { client.options.useKey.setPressed(false); if (client.player != null) client.player.stopUsingItem(); usingFood = false; }
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
        if (client.player.getHealth() < 6 && !job.name().equals("eat")) { pause("Low health: paused for recovery; #eat is available"); return; }
        if (tick - startedAt > settings.integer("timeout") * 20) { pause("Task exceeded its time budget; inspect #status and #resume"); return; }
        if (client.isPaused() || client.currentScreen != null && !(client.currentScreen instanceof ChatScreen) && !ownedScreen) {
            release(); return;
        }
        if (tick < waitUntil) { motion.release(); return; }
        try {
            if (catalog == null || catalog.recipes.isEmpty() && tick % 20 == 0) catalog = new RecipeCatalog(client);
            if (Set.of("get", "craft").contains(job.name()) && catalog.recipes.isEmpty()) { status = "Waiting for server recipes"; return; }
            if (specialJob()) return;
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
            if (jobGoal != null && !job.name().equals("look")) {
                if (navigate(jobGoal, 0)) finish("Destination reached"); return;
            }
            if (grid == null || tick - snapshotAt > 200 && target == null) {
                capture(); return;
            }
            if (Set.of("get", "craft").contains(job.name())) { get(); return; }
            if (job.name().equals("farm")) { farm(); return; }
            if (job.name().equals("find")) {
                if (target == null) chooseTarget(job.selector());
                if (target != null) pause("Found " + candidates.size() + " matching blocks; orange outlines are candidates, red is the nearest");
                return;
            }
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
            capture = new TerrainCapture(client.world, client.player.getBlockPos(), settings.integer("radius"), (pos, state) -> {
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
            boolean inspection = job.name().equals("find");
            resourceCapture = new TerrainCapture(client.world, client.player.getBlockPos(), settings.integer("radius"), (pos, state) ->
                    avoided.getOrDefault(pos, 0) <= tick && matches(state, selector) && (inspection || !state.hasBlockEntity()
                            && !workspace().protectedAt(TerrainCapture.point(pos)) && state.getHardness(client.world, pos) >= 0));
        }
        if (!resourceCapture.tick()) return;
        var sorted = resourceCapture.targets.stream().sorted(Comparator.comparingDouble(p -> p.getSquaredDistance(client.player.getPos()))).toList();
        candidates = sorted.stream().limit(128).map(TerrainCapture::point).toList();
        target = sorted.isEmpty() ? null : sorted.getFirst();
        grid = resourceCapture.finish(); snapshotAt = tick; resourceCapture = null;
        if (target == null) pause("No reachable matching resource in the captured area. Move to another area, then #resume.");
        else status = "Approaching " + Registries.BLOCK.getId(client.world.getBlockState(target).getBlock());
    }
    private void get() {
        String item = identifier(job.selector()).toString(); Map<String, Integer> inv = inventory();
        if (inv.getOrDefault(item, 0) >= job.count()) { finish("Inventory target confirmed: " + item); return; }
        while (!toolGoals.isEmpty() && inv.getOrDefault(toolGoals.peek(), 0) > 0) toolGoals.pop();
        String desired = toolGoals.isEmpty() ? item : toolGoals.peek();
        int desiredCount = toolGoals.isEmpty() ? job.count() : 1;
        if (target != null) { mineTarget(); return; }
        if (table != null && !client.world.getBlockState(table).isOf(Blocks.CRAFTING_TABLE)) table = null;
        var model = new ResourcePlanner(catalog.recipes, catalog.obtainable(seenBlocks));
        resourceStep = model.next(desired, desiredCount, inv, table != null);
        if (resourceStep == null) { pause("No supported collection/crafting chain for " + desired + " in observed terrain. Smelting and special machines are not in this mod build."); return; }
        status = resourceStep.reason() + ": " + resourceStep.item();
        switch (resourceStep.kind()) {
            case "obtain" -> {
                if (job.name().equals("craft")) { pause("Craft needs existing materials: " + resourceStep.item() + "; use #get for automatic collection"); return; }
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
            if (workspace().protectedAt(TerrainCapture.point(pos))) continue;
            if (!client.world.getBlockState(pos).isAir() || !client.world.getBlockState(support).isFullCube(client.world, support)) continue;
            motion.release(); motion.look(Vec3d.ofCenter(support));
            client.interactionManager.interactBlock(client.player, Hand.MAIN_HAND,
                    new BlockHitResult(Vec3d.ofCenter(support).add(0, .5, 0), Direction.UP, support, false));
            table = pos; waitUntil = tick + 8; return;
        }
        pause("No supported empty place for the crafting table within reach");
    }
    private void mineTarget() {
        if (workspace().protectedAt(TerrainCapture.point(target))) { rejectTarget("Target is protected"); return; }
        if (ownedScreen) { client.player.closeHandledScreen(); ownedScreen = false; waitUntil = tick + 4; return; }
        BlockState state = client.world.getBlockState(target);
        if (state.isAir() || state.getCollisionShape(client.world, target).isEmpty() && !(state.getBlock() instanceof CropBlock)) {
            // A prediction alone is not a resource completion. Pickup is checked separately.
            mined++; cancelRoute(); release(); target = null; grid = null; pickupUntil = tick + 200; return;
        }
        if (target.equals(client.player.getBlockPos().down())) { rejectTarget("Refusing to mine the block under the player"); return; }
        if (!nearAndVisible(target)) { approach(target); return; }
        if (!equip(state)) {
            if (waitUntil > tick) return;
            if (job.name().equals("get") && state.isIn(BlockTags.PICKAXE_MINEABLE)) {
                String tool = state.isIn(BlockTags.NEEDS_DIAMOND_TOOL) ? "minecraft:diamond_pickaxe"
                        : state.isIn(BlockTags.NEEDS_IRON_TOOL) ? "minecraft:iron_pickaxe"
                        : state.isIn(BlockTags.NEEDS_STONE_TOOL) ? "minecraft:stone_pickaxe" : "minecraft:wooden_pickaxe";
                if (toolGoals.contains(tool) || toolGoals.size() >= 4) { pause("Tool prerequisite cycle: " + tool); return; }
                toolGoals.push(tool); target = null; cancelRoute(); release(); resourceStep = null;
                status = "Planning prerequisite tool: " + tool; return;
            }
            rejectTarget("No suitable tool for this block"); return;
        }
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
            if (resourceCapture == null) resourceCapture = new TerrainCapture(client.world, TerrainCapture.pos(farmOrigin), job.count(),
                    (pos, state) -> avoided.getOrDefault(pos, 0) <= tick && !workspace().protectedAt(TerrainCapture.point(pos)) && state.getBlock() instanceof CropBlock crop && crop.isMature(state));
            if (!resourceCapture.tick()) return;
            target = resourceCapture.targets.stream().min(Comparator.comparingDouble(p -> p.getSquaredDistance(client.player.getPos()))).orElse(null);
            resourceCapture = null;
            if (target == null) { finish("No eligible mature crops remain; skipped crops may need seeds or a walkable approach"); return; }
        }
        if (workspace().protectedAt(TerrainCapture.point(target))) { rejectTarget("Crop is protected"); return; }
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
        if (workspace().protectedAt(TerrainCapture.point(replant))) { pause("Replanting paused because this crop is now protected"); return; }
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
            int budget = settings.integer("nodes");
            boolean allowJump = settings.enabled("jump");
            pending = worker.submit(() -> { var result = planner.plan(snapshot, start, goal, range, budget, health, allowJump);
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
        if (++failures >= 8 || jobGoal != null) pause(reason); else status = reason;
    }
    private void pause(String reason) { paused = true; cancelRoute(); release(); status = reason; YourMindClient.message(reason); }
    private void finish(String reason) { clearCurrent(reason); YourMindClient.message(reason); nextQueued(); }
    private void nextQueued() {
        Command next = queue.poll();
        if (next != null) try { submit(next); } catch (IllegalArgumentException error) { status = error.getMessage(); YourMindClient.message(status); }
    }
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
        if (selector.contains(",")) { for (String part : selector.split(",")) validateSelector(part); return; }
        if (!selector.startsWith("#") && !Registries.BLOCK.containsId(identifier(selector)))
            throw new IllegalArgumentException("Unknown block: " + selector);
    }
    private boolean matches(BlockState state, String selector) {
        if (selector.contains(",")) return Arrays.stream(selector.split(",")).anyMatch(s -> matches(state, s));
        if (selector.contains("|")) return Arrays.stream(selector.split("\\|")).anyMatch(s -> matches(state, s));
        if (selector.startsWith("#")) return state.isIn(TagKey.of(RegistryKeys.BLOCK, identifier(selector)));
        return Registries.BLOCK.getId(state.getBlock()).equals(identifier(selector));
    }
}
