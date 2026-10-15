package dev.y9kudo.yourmind.core;

import java.util.Locale;

/** The same validated command object can also be created by another Java mod. */
public record Command(String name, String selector, int count, Point target) {
    public static Command parse(String text) {
        String[] args = text.trim().toLowerCase(Locale.ROOT).split("\\s+");
        String name = args[0].replaceFirst("^#", "");
        return switch (name) {
            case "help", "status", "stop", "pause", "resume" -> {
                require(args.length == 1, "Usage: #" + name); yield new Command(name, "", 0, null);
            }
            case "mine", "get" -> {
                require(args.length >= 2 && args.length <= 3, "Usage: #" + name + " <id|#tag> [count]");
                String selector = args[1];
                require(selector.matches("#?(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+"), "Invalid resource identifier");
                int count = args.length == 3 ? number(args[2], 1, 4096) : 1;
                yield new Command(name, selector, count, null);
            }
            case "farm" -> {
                require(args.length <= 2, "Usage: #farm [radius]");
                yield new Command(name, "", args.length == 2 ? number(args[1], 2, 24) : 16, null);
            }
            case "goto" -> {
                require(args.length == 4, "Usage: #goto <x> <y> <z>");
                yield new Command(name, "", 0, new Point(number(args[1], -29_999_984, 29_999_984),
                        number(args[2], -64, 319), number(args[3], -29_999_984, 29_999_984)));
            }
            default -> throw new IllegalArgumentException("Unknown YourMind command. Use #help.");
        };
    }
    private static int number(String text, int min, int max) {
        try { int value = Integer.parseInt(text); if (value >= min && value <= max) return value; }
        catch (NumberFormatException ignored) { }
        throw new IllegalArgumentException("Expected an integer from " + min + " to " + max);
    }
    private static void require(boolean valid, String message) { if (!valid) throw new IllegalArgumentException(message); }
}
