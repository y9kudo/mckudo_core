package dev.y9kudo.yourmind.core;

import java.util.*;

/** Bounded debug geometry, independent of OpenGL and Minecraft rendering classes. */
public final class OverlayGeometry {
    public static final int CYAN = 0xff57d5ff, GREEN = 0xff74f0a7, GOLD = 0xffffd166,
            RED = 0xffff5964, ORANGE = 0xffffa94d, PURPLE = 0xffb48cff, WHITE = 0xffe8edf4;
    public record Vec(double x, double y, double z) { double distance(Vec b) { double dx=x-b.x,dy=y-b.y,dz=z-b.z; return dx*dx+dy*dy+dz*dz; } }
    public record Line(Vec first, Vec second, int color) {}
    public record Bounds(Vec min, Vec max, int color) {}
    public record Label(Vec position, String text, int color) {}
    public record Scene(List<Line> lines, List<Bounds> boxes, List<Label> labels) {
        public Scene { lines=List.copyOf(lines); boxes=List.copyOf(boxes); labels=List.copyOf(labels); }
    }
    public static Scene build(DebugFrame frame, AgentSettings settings, Vec eye) {
        var lines = new ArrayList<Line>(); var boxes = new ArrayList<Bounds>(); var labels = new ArrayList<Label>();
        if (!settings.enabled("render")) return new Scene(lines, boxes, labels);
        double radius2 = Math.pow(settings.integer("renderdistance"), 2);
        if (settings.enabled("path")) {
            int begin = Math.max(0, Math.min(frame.routeIndex(), frame.route().size()));
            for (int i=begin; i<Math.min(frame.route().size(),begin+512);i++) {
                Point p=frame.route().get(i), before=i==0?p:frame.route().get(i-1);
                Vec a=feet(before), b=feet(p);
                if (a.distance(eye)<=radius2 || b.distance(eye)<=radius2) {
                    int color=p.y()>before.y()?GREEN:p.y()<before.y()?GOLD:CYAN;
                    lines.add(new Line(a,b,color));
                    if (i==begin || i%8==0) boxes.add(new Bounds(new Vec(b.x-.11,b.y-.04,b.z-.11),new Vec(b.x+.11,b.y+.13,b.z+.11),color));
                }
            }
        }
        if (settings.enabled("targets")) {
            for (Point p:frame.candidates().stream().limit(128).toList())
                if (!p.equals(frame.miningTarget()) && center(p).distance(eye)<=radius2) boxes.add(block(p,ORANGE));
            if(frame.miningTarget()!=null && center(frame.miningTarget()).distance(eye)<=radius2) {
                boxes.add(block(frame.miningTarget(),RED)); labels.add(new Label(center(frame.miningTarget()),frame.task().startsWith("find")?"FOUND BLOCK":"NEXT BLOCK",RED));
            }
        }
        if(settings.enabled("goal") && frame.goal()!=null && center(frame.goal()).distance(eye)<=radius2) {
            Point p=frame.goal(); boxes.add(block(p,GOLD)); Vec b=center(p);
            lines.add(new Line(b,new Vec(b.x,b.y+3,b.z),GOLD)); labels.add(new Label(new Vec(b.x,b.y+3.2,b.z),"GOAL "+p.x()+" "+p.y()+" "+p.z(),GOLD));
        }
        if(settings.enabled("waypoints")) {
            frame.waypoints().entrySet().stream().filter(e->center(e.getValue()).distance(eye)<=radius2)
                    .sorted(Comparator.comparingDouble(e->center(e.getValue()).distance(eye))).limit(64).forEach(e->{
                        Vec p=center(e.getValue()); boxes.add(block(e.getValue(),PURPLE));
                        lines.add(new Line(p,new Vec(p.x,p.y+2,p.z),PURPLE));
                        if(labels.size()<14) labels.add(new Label(new Vec(p.x,p.y+2.2,p.z),e.getKey()+" ["+Math.round(Math.sqrt(p.distance(eye)))+"m]",PURPLE));
                    });
        }
        if(settings.enabled("selection") && frame.selection()!=null) { Bounds box=region(frame.selection(),WHITE); if(distance(box,eye)<=radius2) boxes.add(box); }
        if(settings.enabled("protection")) for(var entry:frame.protection().entrySet()) {
            Bounds box=region(entry.getValue(),RED);
            if(distance(box,eye)<=radius2) { boxes.add(box); if(labels.size()<16) labels.add(new Label(box.min(),"PROTECTED "+entry.getKey(),RED)); }
        }
        if(!settings.enabled("labels")) labels.clear();
        return new Scene(lines,boxes,labels);
    }
    private static Vec center(Point p) { return new Vec(p.x()+.5,p.y()+.5,p.z()+.5); }
    private static Vec feet(Point p) { return new Vec(p.x()+.5,p.y()+.12,p.z()+.5); }
    private static Bounds block(Point p,int color) { return new Bounds(new Vec(p.x()-.003,p.y()-.003,p.z()-.003),new Vec(p.x()+1.003,p.y()+1.003,p.z()+1.003),color); }
    private static Bounds region(WorldWorkspace.Region r,int color) {
        return new Bounds(new Vec(Math.min(r.first().x(),r.second().x())-.005,Math.min(r.first().y(),r.second().y())-.005,Math.min(r.first().z(),r.second().z())-.005),
                new Vec(Math.max(r.first().x(),r.second().x())+1.005,Math.max(r.first().y(),r.second().y())+1.005,Math.max(r.first().z(),r.second().z())+1.005),color);
    }
    private static double distance(Bounds b,Vec p) {
        Vec nearest=new Vec(Math.max(b.min.x,Math.min(b.max.x,p.x)),Math.max(b.min.y,Math.min(b.max.y,p.y)),Math.max(b.min.z,Math.min(b.max.z,p.z)));
        return nearest.distance(p);
    }
}
