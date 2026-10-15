package dev.y9kudo.yourmind;

import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.message.v1.ClientSendMessageEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import net.fabricmc.loader.api.FabricLoader;
import org.lwjgl.glfw.GLFW;
import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.*;

public final class YourMindClient implements ClientModInitializer {
    public static final String VERSION=FabricLoader.getInstance().getModContainer("yourmind").orElseThrow().getMetadata().getVersion().getFriendlyString();
    private static AgentController controller;
    public static AgentController controller() { return controller; }
    @Override public void onInitializeClient() {
        var client = MinecraftClient.getInstance(); controller = new AgentController(client);
        new DebugRenderer(controller);
        var stopKey = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.yourmind.stop",
                InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_END, "category.yourmind"));
        ClientSendMessageEvents.ALLOW_CHAT.register(message -> {
            if (!message.startsWith("#")) return true;
            run(message); return false; // Local control strings are never sent as public chat.
        });
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, access) -> dispatcher.register(literal("yourmind")
                .executes(context -> { run("#help"); return 1; })
                .then(argument("command", StringArgumentType.greedyString()).suggests((context,builder)->{
                    String remaining=builder.getRemaining().toLowerCase(java.util.Locale.ROOT);
                    dev.y9kudo.yourmind.core.Command.HELP.keySet().stream().filter(name->name.startsWith(remaining)).forEach(builder::suggest);
                    return builder.buildFuture();
                }).executes(context -> {
                    run("#" + StringArgumentType.getString(context, "command")); return 1;
                }))));
        ClientTickEvents.END_CLIENT_TICK.register(c -> {
            while (stopKey.wasPressed()) controller.stop("Stopped with End key");
            controller.tick();
        });
        ClientPlayConnectionEvents.DISCONNECT.register((handler, c) -> controller.disconnect());
    }
    private static void run(String text) {
        try { controller.submit(dev.y9kudo.yourmind.core.Command.parse(text)); }
        catch (IllegalArgumentException error) { message(error.getMessage()); }
    }
    static void message(String text) {
        var player = MinecraftClient.getInstance().player;
        if (player != null) player.sendMessage(Text.literal("[YourMind] " + text), false);
    }
}
