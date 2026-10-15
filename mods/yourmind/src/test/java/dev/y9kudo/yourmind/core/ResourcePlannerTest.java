package dev.y9kudo.yourmind.core;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ResourcePlannerTest {
    private ResourcePlanner.Recipe recipe(String result, int count, boolean table, String... ingredients) {
        return new ResourcePlanner.Recipe(result, result, count, Arrays.stream(ingredients).map(List::of).toList(), table);
    }
    @Test void choosesAvailableWoodSpeciesAndPlansDependencies() {
        var planner = new ResourcePlanner(List.of(recipe("oak_planks", 4, false, "oak_log"),
                recipe("spruce_planks", 4, false, "spruce_log"),
                new ResourcePlanner.Recipe("table", "minecraft:crafting_table", 1,
                        Collections.nCopies(4, List.of("oak_planks", "spruce_planks")), false)), Set.of("spruce_log"));
        assertEquals("spruce_log", planner.next("minecraft:crafting_table", 1, Map.of(), false).item());
        assertEquals("spruce_planks", planner.next("minecraft:crafting_table", 1, Map.of("spruce_log", 1), false).item());
        assertEquals("table", planner.next("minecraft:crafting_table", 1, Map.of("spruce_planks", 4), false).recipe());
    }
    @Test void aSingleIngredientCannotBeSpentTwice() {
        var planner = new ResourcePlanner(List.of(recipe("sticks", 4, false, "planks", "planks")), Set.of("planks"));
        var step = planner.next("sticks", 4, Map.of("planks", 1), false);
        assertEquals("obtain", step.kind()); assertEquals("planks", step.item()); assertEquals(2, step.count());
        assertEquals("craft", planner.next("sticks", 4, Map.of("planks", 2), false).kind());
    }
    @Test void missingStationIsCraftedAndExistingStationIsPlaced() {
        var planner = new ResourcePlanner(List.of(recipe("pickaxe", 1, true, "cobblestone"),
                recipe("minecraft:crafting_table", 1, false, "planks")), Set.of("planks", "cobblestone"));
        assertEquals("minecraft:crafting_table", planner.next("pickaxe", 1, Map.of("planks", 1, "cobblestone", 1), false).item());
        assertEquals("station", planner.next("pickaxe", 1, Map.of("minecraft:crafting_table", 1, "cobblestone", 1), false).kind());
        assertEquals("craft", planner.next("pickaxe", 1, Map.of("cobblestone", 1), true).kind());
    }
    @Test void cyclicAndUnsupportedRecipesDoNotLoop() {
        var planner = new ResourcePlanner(List.of(recipe("a", 1, false, "b"), recipe("b", 1, false, "a")), Set.of());
        assertNull(planner.next("a", 1, Map.of(), false)); assertNull(planner.next("iron_ingot", 1, Map.of(), false));
    }
    @Test void inventoryConfirmationEndsAResourceGoal() {
        var planner = new ResourcePlanner(List.of(), Set.of("stone"));
        assertEquals("done", planner.next("stone", 8, Map.of("stone", 8), false).kind());
        assertEquals("obtain", planner.next("stone", 8, Map.of("stone", 7), false).kind());
    }
    @Test void recipeAlternativesAreImmutable() {
        var ingredients = new ArrayList<String>(); ingredients.add("log");
        var recipe = new ResourcePlanner.Recipe("planks", "planks", 4, List.of(ingredients), false);
        ingredients.clear(); assertEquals(List.of("log"), recipe.ingredients().getFirst());
    }
}
