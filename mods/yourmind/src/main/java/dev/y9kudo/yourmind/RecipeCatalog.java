package dev.y9kudo.yourmind;

import dev.y9kudo.yourmind.core.ResourcePlanner;
import net.minecraft.client.MinecraftClient;
import net.minecraft.item.*;
import net.minecraft.recipe.*;
import net.minecraft.registry.Registries;
import java.util.*;

/** The server supplies recipes after login; no world is read by the route worker. */
final class RecipeCatalog {
    final List<ResourcePlanner.Recipe> recipes = new ArrayList<>();
    final Map<String, RecipeEntry<?>> entries = new HashMap<>();
    final Map<String, List<String>> sources = new HashMap<>();
    final Set<String> naturalBlocks = new HashSet<>();
    RecipeCatalog(MinecraftClient client) {
        for (RecipeEntry<?> entry : client.getNetworkHandler().getRecipeManager().values()) {
            if (!(entry.value() instanceof CraftingRecipe recipe)) continue;
            ItemStack result = recipe.getResult(client.world.getRegistryManager());
            if (result.isEmpty()) continue;
            List<List<String>> ingredients = new ArrayList<>();
            for (Ingredient ingredient : recipe.getIngredients()) {
                if (ingredient.isEmpty()) continue;
                ingredients.add(Arrays.stream(ingredient.getMatchingStacks()).map(s -> id(s.getItem())).distinct().toList());
            }
            if (ingredients.isEmpty()) continue;
            String key = entry.id().toString(); entries.put(key, entry);
            recipes.add(new ResourcePlanner.Recipe(key, id(result.getItem()), result.getCount(), ingredients, !recipe.fits(2, 2)));
        }
        for (var block : Registries.BLOCK) {
            String name = Registries.BLOCK.getId(block).getPath();
            if (name.endsWith("_log") || name.endsWith("_stem") || name.equals("bamboo_block")
                    || Set.of("dirt", "sand", "gravel", "cobblestone", "netherrack", "end_stone", "obsidian").contains(name)) {
                String item = id(block.asItem());
                if (!item.equals("minecraft:air")) sources.computeIfAbsent(item, ignored -> new ArrayList<>())
                        .add(Registries.BLOCK.getId(block).toString());
            }
        }
        sources.put("minecraft:cobblestone", List.of("minecraft:stone", "minecraft:cobblestone"));
        sources.put("minecraft:cobbled_deepslate", List.of("minecraft:deepslate", "minecraft:cobbled_deepslate"));
        sources.put("minecraft:raw_iron", List.of("minecraft:iron_ore", "minecraft:deepslate_iron_ore"));
        sources.put("minecraft:raw_gold", List.of("minecraft:gold_ore", "minecraft:deepslate_gold_ore"));
        sources.put("minecraft:coal", List.of("minecraft:coal_ore", "minecraft:deepslate_coal_ore"));
        sources.put("minecraft:diamond", List.of("minecraft:diamond_ore", "minecraft:deepslate_diamond_ore"));
        sources.put("minecraft:redstone", List.of("minecraft:redstone_ore", "minecraft:deepslate_redstone_ore"));
        sources.put("minecraft:lapis_lazuli", List.of("minecraft:lapis_ore", "minecraft:deepslate_lapis_ore"));
        sources.values().forEach(naturalBlocks::addAll);
    }
    Set<String> obtainable(Set<String> seenBlocks) {
        var result = new HashSet<String>();
        sources.forEach((item, blocks) -> { if (blocks.stream().anyMatch(seenBlocks::contains)) result.add(item); });
        return result;
    }
    boolean natural(String block) { return naturalBlocks.contains(block); }
    static String id(Item item) { return Registries.ITEM.getId(item).toString(); }
}
