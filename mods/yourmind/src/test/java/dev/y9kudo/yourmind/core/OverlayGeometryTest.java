package dev.y9kudo.yourmind.core;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class OverlayGeometryTest {
    private DebugFrame frame(List<Point> route,List<Point> candidates,Map<String,Point> markers,WorldWorkspace.Region selection) {
        return new DebugFrame("Mining","mine #logs",false,new Point(4,64,4),route,0,new Point(2,64,2),candidates,markers,selection,Map.of(),List.of("get stone_pickaxe"),0,10,.5);
    }
    @Test void selectedBlockCandidatesRouteGoalAndMarkersUseDistinctVisuals() {
        var f=frame(List.of(new Point(0,64,0),new Point(1,64,1),new Point(2,65,1)),List.of(new Point(2,64,2),new Point(3,64,2)),Map.of("home",new Point(5,64,5)),null);
        var scene=OverlayGeometry.build(f,new AgentSettings(),new OverlayGeometry.Vec(0,65,0));
        assertTrue(scene.boxes().stream().anyMatch(b->b.color()==OverlayGeometry.RED));
        assertEquals(1,scene.boxes().stream().filter(b->b.color()==OverlayGeometry.ORANGE).count());
        assertTrue(scene.boxes().stream().anyMatch(b->b.color()==OverlayGeometry.PURPLE));
        assertTrue(scene.lines().stream().anyMatch(l->l.color()==OverlayGeometry.GREEN));
        assertTrue(scene.labels().stream().anyMatch(l->l.text().startsWith("GOAL")));
    }
    @Test void drawBudgetsRemainBoundedForHugeRoutes() {
        var route=new ArrayList<Point>();var candidates=new ArrayList<Point>();
        for(int i=0;i<10000;i++){route.add(new Point(i%10,64,i%9));candidates.add(new Point(i%8,64,i%7));}
        var scene=OverlayGeometry.build(frame(route,candidates,Map.of(),null),new AgentSettings(),new OverlayGeometry.Vec(0,65,0));
        assertTrue(scene.lines().size()<=513);assertTrue(scene.boxes().size()<250);assertTrue(scene.labels().size()<=16);
    }
    @Test void allOverlaySwitchesAndDistanceCullingWorkWithoutChangingTaskData() {
        var f=frame(List.of(new Point(1,64,1)),List.of(new Point(2,64,2)),Map.of("home",new Point(3,64,3)),null);
        var s=new AgentSettings();s.set("render","off");assertTrue(OverlayGeometry.build(f,s,new OverlayGeometry.Vec(0,65,0)).boxes().isEmpty());
        s.set("render","on");s.set("labels","off");assertTrue(OverlayGeometry.build(f,s,new OverlayGeometry.Vec(0,65,0)).labels().isEmpty());
        assertTrue(OverlayGeometry.build(f,s,new OverlayGeometry.Vec(10000,65,10000)).boxes().isEmpty());assertEquals(1,f.route().size());
    }
    @Test void largeSelectionIsVisibleWhenCameraIsInsideEvenIfItsCenterIsFarAway() {
        var region=new WorldWorkspace.Region(new Point(-10000,60,-10000),new Point(10000,70,10000));
        var scene=OverlayGeometry.build(frame(List.of(),List.of(),Map.of(),region),new AgentSettings(),new OverlayGeometry.Vec(9999,65,9999));
        assertTrue(scene.boxes().stream().anyMatch(b->b.color()==OverlayGeometry.WHITE));
    }
    @Test void debugFrameDetachesMutableCollections() {
        var route=new ArrayList<Point>();route.add(new Point(0,64,0));var markers=new LinkedHashMap<String,Point>();markers.put("home",new Point(1,64,1));
        var f=frame(route,List.of(),markers,null);route.clear();markers.clear();assertEquals(1,f.route().size());assertEquals(1,f.waypoints().size());
        assertThrows(UnsupportedOperationException.class,()->f.route().clear());
    }
}
