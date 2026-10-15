package dev.y9kudo.yourmind;

import dev.y9kudo.yourmind.core.*;
import net.fabricmc.fabric.api.client.rendering.v1.*;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.render.*;
import net.minecraft.client.util.BufferAllocator;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.*;
import java.util.*;

/** Own buffered render pass: no world scans, depth writes or persistent GL overrides. */
final class DebugRenderer {
    private final AgentController controller;
    private BufferAllocator allocator;
    DebugRenderer(AgentController controller) {
        this.controller=controller;
        WorldRenderEvents.LAST.register(context->{
            try { world(context); }
            catch(RuntimeException error) { controller.settings().set("render","false"); YourMindClient.message("World overlay disabled after a rendering error: "+error.getClass().getSimpleName()+"; #render on retries"); }
        });
        HudRenderCallback.EVENT.register((draw,tickCounter)->hud(draw));
        ClientLifecycleEvents.CLIENT_STOPPING.register(client->{if(allocator!=null)allocator.close();});
    }
    private void world(WorldRenderContext context) {
        var client=MinecraftClient.getInstance();
        if(client.player==null || context.world()==null || !controller.settings().enabled("render") || client.options.hudHidden)return;
        MatrixStack matrices=context.matrixStack(); if(matrices==null)return;
        Vec3d camera=context.camera().getPos();
        var scene=OverlayGeometry.build(controller.debugFrame(),controller.settings(),new OverlayGeometry.Vec(camera.x,camera.y,camera.z));
        if(allocator==null)allocator=new BufferAllocator(262144);
        var consumers=VertexConsumerProvider.immediate(allocator);
        RenderLayer layer=OverlayLayers.lines(controller.settings().enabled("xray"));
        matrices.push();
        try {
            var vertices=consumers.getBuffer(layer);
            for(var line:scene.lines())line(matrices,vertices,line,camera);
            for(var box:scene.boxes()) {
                int c=box.color();
                WorldRenderer.drawBox(matrices,vertices,new Box(box.min().x()-camera.x,box.min().y()-camera.y,box.min().z()-camera.z,box.max().x()-camera.x,box.max().y()-camera.y,box.max().z()-camera.z),
                        ((c>>16)&255)/255f,((c>>8)&255)/255f,(c&255)/255f,.85f);
            }
            consumers.draw();
            for(var label:scene.labels()) {
                matrices.push();
                try {
                    matrices.translate(label.position().x()-camera.x,label.position().y()-camera.y,label.position().z()-camera.z);
                    matrices.multiply(context.camera().getRotation()); matrices.scale(-.025f,-.025f,.025f);
                    client.textRenderer.draw(label.text(),-client.textRenderer.getWidth(label.text())/2f,0,label.color(),false,matrices.peek().getPositionMatrix(),consumers,
                            controller.settings().enabled("xray")?TextRenderer.TextLayerType.SEE_THROUGH:TextRenderer.TextLayerType.NORMAL,0x800b1018,LightmapTextureManager.MAX_LIGHT_COORDINATE);
                } finally { matrices.pop(); }
            }
            consumers.draw();
        } finally { matrices.pop(); }
    }
    private void line(MatrixStack matrices,VertexConsumer vertices,OverlayGeometry.Line line,Vec3d camera) {
        var a=line.first();var b=line.second(); float dx=(float)(b.x()-a.x()),dy=(float)(b.y()-a.y()),dz=(float)(b.z()-a.z());
        float size=(float)Math.sqrt(dx*dx+dy*dy+dz*dz);if(size<.0001)return;
        int c=line.color();int r=(c>>16)&255,g=(c>>8)&255,blue=c&255;
        vertices.vertex(matrices.peek().getPositionMatrix(),(float)(a.x()-camera.x),(float)(a.y()-camera.y),(float)(a.z()-camera.z)).color(r,g,blue,230).normal(matrices.peek(),dx/size,dy/size,dz/size);
        vertices.vertex(matrices.peek().getPositionMatrix(),(float)(b.x()-camera.x),(float)(b.y()-camera.y),(float)(b.z()-camera.z)).color(r,g,blue,230).normal(matrices.peek(),dx/size,dy/size,dz/size);
    }
    private void hud(net.minecraft.client.gui.DrawContext draw) {
        var client=MinecraftClient.getInstance();
        if(client.player==null||!controller.settings().enabled("hud")||client.options.hudHidden)return;
        var f=controller.debugFrame();var text=client.textRenderer;
        List<String> lines=List.of("YourMind "+YourMindClient.VERSION+" | y9kudo",(f.paused()?"PAUSED | ":"")+f.task(),f.status(),
                "Route "+f.routeIndex()+"/"+f.route().size()+" | queue "+f.queue().size()+" | mined "+f.mined(),
                String.format(Locale.ROOT,"Search %.2f ms | %d nodes",f.searchMs(),f.visited()),
                "Cyan: route | red: next block | orange: candidates","Gold: goal | purple: waypoints | End: stop");
        int available=Math.max(100,Math.min(440,draw.getScaledWindowWidth()-16));
        draw.fill(5,5,available+11,12+lines.size()*11,0xbd10151d);
        for(int i=0;i<lines.size();i++)draw.drawTextWithShadow(text,text.trimToWidth(lines.get(i),available),10,10+i*11,i==0?OverlayGeometry.CYAN:0xffe6edf6);
    }
    private static abstract class OverlayLayers extends RenderLayer {
        private OverlayLayers() { super("yourmind",VertexFormats.LINES,VertexFormat.DrawMode.LINES,256,false,false,()->{},()->{}); }
        private static final RenderLayer NORMAL=create(false), XRAY=create(true);
        private static RenderLayer create(boolean xray) {
            return of("yourmind_"+(xray?"xray":"lines"),VertexFormats.LINES,VertexFormat.DrawMode.LINES,262144,
                    MultiPhaseParameters.builder().program(LINES_PROGRAM).lineWidth(new LineWidth(OptionalDouble.of(2)))
                            .layering(VIEW_OFFSET_Z_LAYERING).transparency(TRANSLUCENT_TRANSPARENCY).depthTest(xray?ALWAYS_DEPTH_TEST:LEQUAL_DEPTH_TEST)
                            .writeMaskState(COLOR_MASK).cull(DISABLE_CULLING).build(false));
        }
        static RenderLayer lines(boolean xray) { return xray?XRAY:NORMAL; }
    }
}
