package dev.y9kudo.yourmind.core;

import java.util.*;

/** Validated commands shared by chat, client commands and the bounded task queue. */
public record Command(String name, String selector, int count, Point target, List<String> arguments) {
    public Command { arguments = List.copyOf(arguments); }
    public Command(String name, String selector, int count, Point target) { this(name, selector, count, target, List.of()); }
    private static final Set<String> JOBS = Set.of("goto", "offset", "forward", "back", "left", "right", "up", "down",
            "come", "follow", "explore", "patrol", "home", "path", "mine", "get", "craft", "farm", "collect", "find", "look", "equip", "eat", "drop");
    public static boolean isJob(String name) { return JOBS.contains(name); }
    public static final Map<String, String> HELP;
    static {
        var help = new LinkedHashMap<String, String>();
        String definitions = """
                help|[page] - show help
                version|- show version and author
                status|- inspect current task
                pos|- show position and dimension
                inventory|[filter] - list inventory
                recipes|[item] - inspect server crafting recipes
                blocks|[filter] - search block identifiers
                settings|- list settings
                goto|<x y z|waypoint> - walk to destination
                offset|<dx dy dz> - move relative to position
                forward|[distance] - route ahead
                back|[distance] - route behind
                left|[distance] - route left
                right|[distance] - route right
                up|[distance] - route to higher ground
                down|[distance] - route to lower ground
                come|<player> - approach a visible player
                follow|<player> [distance] - follow a visible player
                explore|[distance] - explore along current heading
                patrol|<waypoint...> - cycle named waypoints
                sethome|- save current location as home
                home|- walk to this world's home
                goal|[here|clear|x y z|waypoint] - inspect/set a goal marker
                path|- walk to the configured goal
                mine|<block|#tag|comma-list> [count] - mine matching blocks
                get|<item> [total] - collect/craft an inventory target
                craft|<item> [amount] - craft from existing materials
                farm|[radius] - harvest and replant mature crops
                collect|[item|all] [amount] - collect dropped items
                find|<block|#tag> - highlight matching observed blocks
                look|<x y z|player> - look smoothly at a target
                equip|<item> - equip an inventory item
                eat|- eat available food
                drop|<item> [amount] - drop requested items
                stop|- stop and clear queue
                pause|- release controls and pause
                resume|- continue current task
                retry|- clear failures and retry
                repath|- refresh terrain and route
                tasks|- inspect current and waiting tasks
                queue|<command> - append a task
                repeat|<1..16> <command> - queue repeated tasks
                skip|- skip to next queued task
                clearqueue|- clear waiting tasks
                waypoint|<add|remove|goto|list|clear> [name] [x y z]
                pos1|[x y z] - first selection corner
                pos2|[x y z] - second selection corner
                selection|[clear] - inspect/reset selection
                protect|<name> - protect selected blocks from changes
                unprotect|<name|all> - remove block protection
                set|<setting> <value> - change a validated setting
                resetsettings|- restore default settings
                render|[on|off] - toggle world overlays
                hud|[on|off] - toggle status HUD
                save|- save settings and world markers/protection
                load|- reload saved configuration
                """;
        for (String line : definitions.strip().split("\n")) { int at = line.indexOf('|'); help.put(line.substring(0, at), line.substring(at + 1)); }
        HELP = Collections.unmodifiableMap(help);
    }
    public static Command parse(String text) {
        if (text == null || text.length() > 512 || text.isBlank()) throw new IllegalArgumentException("Command must contain 1..512 characters");
        String[] args = text.trim().split("\\s+"); String name = args[0].replaceFirst("^#", "").toLowerCase(Locale.ROOT);
        name = switch (name) { case "cancel" -> "stop"; case "continue" -> "resume"; case "wp" -> "waypoint"; case "inv" -> "inventory"; default -> name; };
        if (!HELP.containsKey(name)) throw new IllegalArgumentException("Unknown YourMind command. Use #help.");
        var tail = List.of(args).subList(1, args.length); String selector = ""; int count = 0; Point target = null;
        switch (name) {
            case "version", "status", "pos", "settings", "sethome", "home", "path", "stop", "pause", "resume", "retry", "repath", "tasks", "skip", "clearqueue", "resetsettings", "save", "load", "eat" -> require(tail.isEmpty(), name);
            case "help" -> { require(tail.size() <= 1, name); count = tail.isEmpty() ? 1 : number(tail.getFirst(), 1, 20); }
            case "inventory", "blocks", "recipes" -> { require(tail.size() <= 1, name); selector = tail.isEmpty() ? "" : tail.getFirst().toLowerCase(Locale.ROOT); }
            case "mine", "get", "craft", "drop", "find", "equip" -> {
                require(tail.size() >= 1 && tail.size() <= (Set.of("find", "equip").contains(name) ? 1 : 2), name);
                selector = tail.getFirst().toLowerCase(Locale.ROOT);
                for (String id : selector.split(",", -1)) resource(id, name.equals("mine") || name.equals("find"));
                require(selector.split(",").length <= 16 && (Set.of("mine", "find").contains(name) || !selector.contains(",")), name);
                count = tail.size() == 2 ? number(tail.get(1), 1, name.equals("drop") ? 64 : 4096) : 1;
            }
            case "farm" -> { require(tail.size() <= 1, name); count = tail.isEmpty() ? 16 : number(tail.getFirst(), 2, 48); }
            case "explore" -> { require(tail.size() <= 1, name); count = tail.isEmpty() ? 64 : number(tail.getFirst(), 8, 256); }
            case "collect" -> { require(tail.size() <= 2, name); selector = tail.isEmpty() ? "all" : tail.getFirst().toLowerCase(Locale.ROOT); if (!selector.equals("all")) resource(selector, false); count = tail.size() < 2 ? 1 : number(tail.get(1), 1, 4096); }
            case "goto", "look", "goal" -> { require(tail.size() == 3 || tail.size() == 1 || name.equals("goal") && tail.isEmpty(), name); if (tail.size() == 3) target = point(tail, false); else selector = tail.isEmpty() ? "" : tail.getFirst(); }
            case "offset" -> { require(tail.size() == 3, name); target = point(tail, true); }
            case "forward", "back", "left", "right", "up", "down" -> { require(tail.size() <= 1, name); count = tail.isEmpty() ? 5 : number(tail.getFirst(), 1, 256); }
            case "come", "follow" -> { require(tail.size() >= 1 && tail.size() <= (name.equals("follow") ? 2 : 1), name); selector = tail.getFirst(); count = tail.size() == 2 ? number(tail.get(1), 2, 16) : 3; }
            case "patrol" -> { require(tail.size() >= 1 && tail.size() <= 8, name); tail.forEach(Command::markerName); }
            case "queue", "repeat" -> {
                int offset = name.equals("repeat") ? 1 : 0; require(tail.size() > offset, name);
                count = offset == 1 ? number(tail.getFirst(), 1, 16) : 1;
                require(isJob(tail.get(offset).replaceFirst("^#", "").toLowerCase(Locale.ROOT)), name);
                selector = String.join(" ", tail.subList(offset, tail.size())); parse(selector);
            }
            case "waypoint" -> {
                require(!tail.isEmpty(), name);
                switch (tail.getFirst().toLowerCase(Locale.ROOT)) {
                    case "list", "clear" -> require(tail.size() == 1, name);
                    case "remove", "goto" -> { require(tail.size() == 2, name); markerName(tail.get(1)); }
                    case "add" -> { require(tail.size() == 2 || tail.size() == 5, name); markerName(tail.get(1)); if (tail.size() == 5) target = point(tail.subList(2, 5), false); }
                    default -> require(false, name);
                }
            }
            case "pos1", "pos2" -> { require(tail.isEmpty() || tail.size() == 3, name); if (!tail.isEmpty()) target = point(tail, false); }
            case "selection" -> require(tail.isEmpty() || tail.size() == 1 && tail.getFirst().equalsIgnoreCase("clear"), name);
            case "protect", "unprotect" -> { require(tail.size() == 1, name); markerName(tail.getFirst()); selector = tail.getFirst(); }
            case "set" -> { require(tail.size() == 2, name); selector = tail.getFirst(); }
            case "render", "hud" -> { require(tail.size() <= 1 && (tail.isEmpty() || Set.of("on", "off").contains(tail.getFirst())), name); selector = tail.isEmpty() ? "toggle" : tail.getFirst(); }
            default -> throw new IllegalArgumentException("No parser for " + name);
        }
        return new Command(name, selector, count, target, tail);
    }
    private static void resource(String text, boolean tag) { if (!text.matches((tag ? "#?" : "") + "(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+")) throw new IllegalArgumentException("Invalid resource identifier"); }
    public static void markerName(String name) { if (!name.matches("[a-zA-Z0-9_-]{1,32}")) throw new IllegalArgumentException("Marker names use 1..32 letters, numbers, _ or -"); }
    private static Point point(List<String> a, boolean relative) { return new Point(number(a.get(0), relative ? -256 : -29_999_984, relative ? 256 : 29_999_984), number(a.get(1), -64, relative ? 64 : 319), number(a.get(2), relative ? -256 : -29_999_984, relative ? 256 : 29_999_984)); }
    private static int number(String text, int min, int max) {
        try { int value = Integer.parseInt(text); if (value >= min && value <= max) return value; } catch (NumberFormatException ignored) { }
        throw new IllegalArgumentException("Expected an integer from " + min + " to " + max);
    }
    private static void require(boolean valid, String name) { if (!valid) throw new IllegalArgumentException("Usage: #" + name + " " + HELP.get(name)); }
}
