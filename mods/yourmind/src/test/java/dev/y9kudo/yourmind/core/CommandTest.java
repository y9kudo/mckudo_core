package dev.y9kudo.yourmind.core;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CommandTest {
    @Test void parsesCommandsAndTags() {
        assertEquals("#logs", Command.parse("#mine #logs 16").selector());
        assertEquals(16, Command.parse("#mine #logs 16").count());
        assertEquals(new Point(-15, 64, 8), Command.parse("#goto -15 64 8").target());
        assertEquals("minecraft:stone_pickaxe", Command.parse("get minecraft:stone_pickaxe").selector());
        assertEquals(16, Command.parse("farm").count());
    }
    @Test void rejectsMalformedCommandsAndUnboundedQuantities() {
        for (String text : new String[]{"#mine", "#get stone -1", "#mine stone 99999", "#goto 1 2", "#goto 1 2 nope", "#farm 1000", "#stop extra", "#wat", "#get ../;exec"})
            assertThrows(IllegalArgumentException.class, () -> Command.parse(text), text);
    }
}
