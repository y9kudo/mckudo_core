package dev.y9kudo.yourmind;

import dev.y9kudo.yourmind.core.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.io.IOException;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ConfigurationStoreTest {
    @TempDir Path temporary;
    @Test void savesAndLoadsSeparateWorldWorkspaces() throws Exception {
        var store=new ConfigurationStore(temporary.resolve("yourmind.json"));var s=new AgentSettings();s.set("hud","off");
        var w=new WorldWorkspace();w.waypoint("home",new Point(12,64,-3));w.first(new Point(1,64,1));w.second(new Point(3,65,3));w.protect("house");
        store.save(s,Map.of("server|overworld",w));var restored=store.load();assertFalse(restored.settings().enabled("hud"));
        assertEquals(new Point(12,64,-3),restored.worlds().get("server|overworld").waypoint("home"));assertTrue(restored.worlds().get("server|overworld").protectedAt(new Point(2,64,2)));
        assertFalse(restored.worlds().containsKey("server|the_nether"));
    }
    @Test void rejectsOversizedOrMalformedFilesWithoutAReplacement() throws Exception {
        Path file=temporary.resolve("yourmind.json");var store=new ConfigurationStore(file);
        Files.writeString(file,"x".repeat(512001));assertThrows(IOException.class,store::load);
        Files.writeString(file,"{broken");assertThrows(IOException.class,store::load);
        Files.writeString(file,"{\"schemaVersion\":1,\"settings\":{\"radius\":\"99999\"},\"worlds\":{}}");assertThrows(IOException.class,store::load);
    }
    @Test void absentFileUsesDefaultsAndDoesNotWriteImplicitly() throws Exception {
        Path file=temporary.resolve("yourmind.json");var config=new ConfigurationStore(file).load();
        assertTrue(config.settings().enabled("render"));assertTrue(config.worlds().isEmpty());assertFalse(Files.exists(file));
    }
}
