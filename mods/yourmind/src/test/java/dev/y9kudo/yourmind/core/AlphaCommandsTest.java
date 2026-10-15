package dev.y9kudo.yourmind.core;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AlphaCommandsTest {
    @Test void everyAdvertisedCommandHasAWorkingParserExample() {
        var examples = new LinkedHashMap<String,String>();
        for(String name:List.of("version","status","pos","settings","sethome","home","path","stop","pause","resume","retry","repath","tasks","skip","clearqueue","resetsettings","save","load","eat"))examples.put(name,name);
        for(String name:List.of("forward","back","left","right","up","down","farm","explore"))examples.put(name,name+" 8");
        examples.putAll(Map.of("help","help 2","inventory","inventory log","recipes","recipes pickaxe","blocks","blocks ore","goto","goto 1 64 2","offset","offset -2 0 3","come","come Alex","follow","follow Alex 4","patrol","patrol home cave","goal","goal here"));
        examples.putAll(Map.of("mine","mine #logs 8","get","get stone_pickaxe 1","craft","craft stick 4","collect","collect all","find","find iron_ore,deepslate_iron_ore","look","look Alex","equip","equip stone_sword","drop","drop dirt 2","queue","queue mine #logs 2","repeat","repeat 3 goto home"));
        examples.putAll(Map.of("waypoint","waypoint add cave 12 64 -8","pos1","pos1","pos2","pos2 2 65 2","selection","selection clear","protect","protect house","unprotect","unprotect house","set","set sprint off","render","render on","hud","hud off"));
        assertEquals(Command.HELP.keySet(),examples.keySet()); assertTrue(examples.size()>=50);
        examples.forEach((name,text)->assertEquals(name,Command.parse(text).name(),text));
    }
    @Test void queuesCannotNestOrExceedTheirInputBounds() {
        for(String text:List.of("queue queue goto 1 64 1","repeat 2 repeat 2 mine stone","queue stop","repeat 17 farm","queue","repeat 2","mine stone, 2","get #logs","farm 49","collect dirt -2","waypoint add ../escape","goto 1 320 1"))
            assertThrows(IllegalArgumentException.class,()->Command.parse(text),text);
        assertThrows(IllegalArgumentException.class,()->Command.parse("x".repeat(513)));
    }
    @Test void namesKeepCaseAndAliasesAreNotExtraCommands() {
        assertEquals("AlexTheMiner",Command.parse("#FOLLOW AlexTheMiner 3").selector());
        assertEquals("waypoint",Command.parse("#wp list").name());
        assertEquals("stop",Command.parse("#cancel").name());
        assertEquals(List.of("add","MyHome"),Command.parse("waypoint add MyHome").arguments());
        assertThrows(UnsupportedOperationException.class,()->Command.parse("patrol a b").arguments().add("c"));
    }
    @Test void repeatedEnqueueIsAtomicAndCompletionKeepsFifoOrder() {
        var queue=new TaskQueue();var a=Command.parse("mine #logs 2");var b=Command.parse("goto 4 64 8");
        queue.add(a,15);assertThrows(IllegalArgumentException.class,()->queue.add(b,2));assertEquals(15,queue.size());
        queue.add(b,1);assertEquals(a,queue.poll());for(int i=0;i<14;i++)assertEquals(a,queue.poll());assertEquals(b,queue.poll());assertNull(queue.poll());
    }
    @Test void controlCommandsCannotBecomeQueuedJobs() {
        var queue=new TaskQueue();assertThrows(IllegalArgumentException.class,()->queue.add(Command.parse("stop"),1));
        queue.add(Command.parse("farm"),3);var saved=queue.snapshot();queue.clear();assertEquals(3,saved.size());assertEquals(0,queue.size());
        assertThrows(UnsupportedOperationException.class,()->saved.clear());
    }
}
