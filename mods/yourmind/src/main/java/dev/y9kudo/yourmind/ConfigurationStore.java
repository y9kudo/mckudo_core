package dev.y9kudo.yourmind;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import dev.y9kudo.yourmind.core.*;
import java.nio.file.*;
import java.io.IOException;
import java.util.*;

/** Explicit bounded local config. Import validates everything before replacing live state. */
final class ConfigurationStore {
    private final Path path;
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    record SavedWorld(Map<String, Point> waypoints, Map<String, WorldWorkspace.Region> regions) {}
    record Document(int schemaVersion, Map<String, String> settings, Map<String, SavedWorld> worlds) {}
    record Restored(AgentSettings settings, Map<String, WorldWorkspace> worlds) {}
    ConfigurationStore(Path path) { this.path = path; }
    void save(AgentSettings settings, Map<String, WorldWorkspace> worlds) throws IOException {
        var saved = new LinkedHashMap<String, SavedWorld>();
        worlds.forEach((key, value) -> saved.put(key, new SavedWorld(value.waypoints(), value.regions())));
        String json = GSON.toJson(new Document(1, settings.snapshot(), saved));
        if (json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 512_000) throw new IOException("Configuration exceeds 512 KB");
        Files.createDirectories(path.getParent()); Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        Files.writeString(temporary, json); Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
    }
    Restored load() throws IOException {
        if (!Files.exists(path)) return new Restored(new AgentSettings(), new LinkedHashMap<>());
        if (Files.size(path) > 512_000) throw new IOException("Configuration exceeds 512 KB");
        try {
            Document doc = GSON.fromJson(Files.readString(path), Document.class);
            if (doc == null || doc.schemaVersion() != 1 || doc.worlds() == null || doc.worlds().size() > 64) throw new IllegalArgumentException("Invalid config schema or world limit");
            var settings = new AgentSettings(); settings.restore(doc.settings()); var worlds = new LinkedHashMap<String, WorldWorkspace>();
            doc.worlds().forEach((key, saved) -> {
                if (key == null || key.length() > 512 || saved == null) throw new IllegalArgumentException("Invalid world identity");
                var world = new WorldWorkspace(); world.restore(saved.waypoints(), saved.regions()); worlds.put(key, world);
            });
            return new Restored(settings, worlds);
        } catch (RuntimeException error) { throw new IOException("Invalid YourMind configuration: " + error.getMessage(), error); }
    }
}
