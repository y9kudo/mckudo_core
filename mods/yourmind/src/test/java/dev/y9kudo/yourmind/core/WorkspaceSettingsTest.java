package dev.y9kudo.yourmind.core;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkspaceSettingsTest {
    @Test void booleanAndNumericSettingsHaveExplicitLimits() {
        var s=new AgentSettings();s.set("sprint","off");assertFalse(s.enabled("sprint"));s.set("RADIUS","48");assertEquals(48,s.integer("radius"));
        for(String[] pair:List.of(new String[]{"radius","49"},new String[]{"nodes","999999"},new String[]{"renderdistance","9999"},new String[]{"jump","maybe"},new String[]{"unknown","on"},new String[]{"timeout","-1"}))
            assertThrows(IllegalArgumentException.class,()->s.set(pair[0],pair[1]));
        assertFalse(s.enabled("sprint"));assertEquals(48,s.integer("radius"));
    }
    @Test void invalidSettingsImportDoesNotPartiallyReplaceLiveSettings() {
        var s=new AgentSettings();s.set("sprint","off");
        var invalid=new LinkedHashMap<String,String>();invalid.put("sprint","on");invalid.put("radius","1000");
        assertThrows(IllegalArgumentException.class,()->s.restore(invalid));assertFalse(s.enabled("sprint"));assertEquals(24,s.integer("radius"));
        s.reset();assertTrue(s.enabled("sprint"));
    }
    @Test void selectionsNormalizeCornersAndProtectionIncludesTheBoundary() {
        var w=new WorldWorkspace();w.first(new Point(4,65,8));w.second(new Point(2,64,6));
        assertEquals(18,w.selection().volume());w.protect("house");
        assertTrue(w.protectedAt(new Point(2,64,6)));assertTrue(w.protectedAt(new Point(4,65,8)));assertFalse(w.protectedAt(new Point(5,65,8)));
        w.clearSelection();assertTrue(w.protectedAt(new Point(3,64,7)));w.unprotect("house");assertFalse(w.protectedAt(new Point(3,64,7)));
    }
    @Test void separateWorldsDoNotShareHomeOrProtection() {
        var a=new WorldWorkspace();var b=new WorldWorkspace();a.waypoint("home",new Point(10,64,20));
        assertThrows(IllegalArgumentException.class,()->b.waypoint("home"));assertEquals(new Point(10,64,20),a.waypoint("home"));
        a.first(new Point(0,64,0));a.second(new Point(2,65,2));a.protect("a");assertFalse(b.protectedAt(new Point(1,64,1)));
    }
    @Test void markerLimitsAndInvalidCoordinatesAreRejected() {
        var w=new WorldWorkspace();for(int i=0;i<64;i++)w.waypoint("p"+i,new Point(i,64,0));
        assertThrows(IllegalArgumentException.class,()->w.waypoint("extra",new Point(1,64,0)));
        assertThrows(IllegalArgumentException.class,()->w.waypoint("../file",new Point(0,64,0)));
        assertThrows(IllegalArgumentException.class,()->w.goal(new Point(Integer.MIN_VALUE,64,0)));
        assertThrows(IllegalArgumentException.class,()->w.protect("missingSelection"));
    }
    @Test void workspaceImportAndSnapshotsAreAtomic() {
        var w=new WorldWorkspace();w.waypoint("home",new Point(1,64,1));var snapshot=w.waypoints();w.clearWaypoints();assertEquals(1,snapshot.size());
        w.waypoint("keep",new Point(0,64,0));
        assertThrows(IllegalArgumentException.class,()->w.restore(Map.of("invalid/name",new Point(2,64,2)),Map.of()));
        assertEquals(new Point(0,64,0),w.waypoint("keep"));
    }
}
