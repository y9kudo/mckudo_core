package dev.y9kudo.yourmind.core;

import java.util.*;

/** Recipe dependencies are supplied by the joined server, never a hardcoded recipe list. */
public final class ResourcePlanner {
    public record Recipe(String id, String output, int count, List<List<String>> ingredients, boolean needsTable) {
        public Recipe {
            if (count < 1 || ingredients.size() > 9) throw new IllegalArgumentException("Invalid crafting recipe");
            ingredients = ingredients.stream().map(List::copyOf).toList();
        }
    }
    public record Step(String kind, String item, int count, String recipe, boolean needsTable, String reason) {}
    private final Map<String, List<Recipe>> recipes = new HashMap<>();
    private final Set<String> obtainable;
    public ResourcePlanner(Collection<Recipe> recipes, Set<String> obtainable) {
        for (Recipe r : recipes) this.recipes.computeIfAbsent(r.output(), ignored -> new ArrayList<>()).add(r);
        this.obtainable = Set.copyOf(obtainable);
    }
    public Step next(String item, int count, Map<String, Integer> inventory, boolean tableAvailable) {
        if (inventory.getOrDefault(item, 0) >= count) return new Step("done", item, count, "", false, "Inventory confirmed");
        return next(item, count, inventory, tableAvailable, new HashSet<>(), 0);
    }
    private Step next(String item, int count, Map<String, Integer> inventory, boolean table, Set<String> stack, int depth) {
        if (depth > 16 || !stack.add(item)) return null;
        try {
            // Direct collection avoids cycles such as log -> planks -> wood -> log.
            if (obtainable.contains(item)) return new Step("obtain", item, count, "", false, "Collect a known block source");
            List<Recipe> choices = new ArrayList<>(recipes.getOrDefault(item, List.of()));
            choices.sort(Comparator.comparingInt(r -> missing(r, inventory)));
            for (Recipe recipe : choices) {
                if (recipe.needsTable() && !table && !item.equals("minecraft:crafting_table")) {
                    if (inventory.getOrDefault("minecraft:crafting_table", 0) > 0)
                        return new Step("station", "minecraft:crafting_table", 1, "", false, "Place a crafting table");
                    Step station = next("minecraft:crafting_table", 1, inventory, false, stack, depth + 1);
                    if (station != null) return station;
                    continue;
                }
                Map<String, Integer> available = new HashMap<>(inventory); Step dependency = null; boolean possible = true;
                Map<String, Integer> required = new HashMap<>();
                for (List<String> alternatives : recipe.ingredients()) {
                    String choice = alternatives.stream().filter(i -> available.getOrDefault(i, 0) > 0).findFirst().orElse(null);
                    if (choice != null) { available.merge(choice, -1, Integer::sum); required.merge(choice, 1, Integer::sum); continue; }
                    Step candidate = null;
                    for (String alternative : alternatives) {
                        candidate = next(alternative, inventory.getOrDefault(alternative, 0) + 1, inventory, table, stack, depth + 1);
                        if (candidate != null) { required.merge(alternative, 1, Integer::sum); break; }
                    }
                    if (candidate == null) { possible = false; break; }
                    if (dependency == null) dependency = candidate;
                }
                if (!possible) continue;
                if (dependency != null) return dependency;
                return new Step("craft", item, recipe.count(), recipe.id(), recipe.needsTable(), "Craft one batch and await inventory confirmation");
            }
            return null;
        } finally { stack.remove(item); }
    }
    private int missing(Recipe recipe, Map<String, Integer> inventory) {
        Map<String, Integer> remaining = new HashMap<>(inventory); int n = 0;
        for (List<String> alternatives : recipe.ingredients()) {
            String choice = alternatives.stream().filter(i -> remaining.getOrDefault(i, 0) > 0).findFirst().orElse(null);
            if (choice == null) n++; else remaining.merge(choice, -1, Integer::sum);
        }
        return n + (recipe.needsTable() ? 1 : 0);
    }
}
