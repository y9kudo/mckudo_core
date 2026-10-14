#include "om_kernel.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

typedef struct { om_point p; double g,f; int32_t parent,kind; double damage; } node;
typedef struct { uint32_t *values,size,capacity; node *nodes; } heap;
static const int dirs[8][2]={{1,0},{-1,0},{0,1},{0,-1},{1,1},{1,-1},{-1,1},{-1,-1}};
static int inside(const om_route_input *in,om_point p){return p.x>=0&&p.y>=0&&p.z>=0&&(uint32_t)p.x<in->width&&(uint32_t)p.y<in->height&&(uint32_t)p.z<in->depth;}
static size_t index_of(const om_route_input *in,om_point p){return ((size_t)p.y*in->depth+(uint32_t)p.z)*in->width+(uint32_t)p.x;}
static uint8_t cell_at(const om_route_input *in,om_point p){return inside(in,p)?in->cells[index_of(in,p)]:OM_UNKNOWN;}
static int standing(const om_route_input *in,om_point p){om_point h=p,b=p;h.y++;b.y--;return cell_at(in,p)==OM_AIR&&cell_at(in,h)==OM_AIR&&cell_at(in,b)==OM_SOLID;}
static double heuristic(const om_route_input *in,om_point p){
  double x=fmax(0,abs(p.x-in->goal.x)-(double)in->range),z=fmax(0,abs(p.z-in->goal.z)-(double)in->range);
  return fmax(x,z)+(sqrt(2.0)-1)*fmin(x,z)+fmax(0,abs(p.y-in->goal.y)-(double)in->range)*.3;
}
static int goal_reached(const om_route_input *in,om_point p){return abs(p.x-in->goal.x)<=(int)in->range&&abs(p.y-in->goal.y)<=(int)in->range&&abs(p.z-in->goal.z)<=(int)in->range;}
static void push(heap *h,uint32_t value){uint32_t i=h->size++;while(i){uint32_t parent=(i-1)/2;if(h->nodes[h->values[parent]].f<=h->nodes[value].f)break;h->values[i]=h->values[parent];i=parent;}h->values[i]=value;}
static uint32_t pop(heap *h){uint32_t result=h->values[0],value=h->values[--h->size],i=0;while(i*2+1<h->size){uint32_t c=i*2+1;if(c+1<h->size&&h->nodes[h->values[c+1]].f<h->nodes[h->values[c]].f)c++;if(h->nodes[h->values[c]].f>=h->nodes[value].f)break;h->values[i]=h->values[c];i=c;}if(h->size)h->values[i]=value;return result;}
static int make_path(node *nodes,uint32_t last,om_route *out){
  uint32_t count=0;for(int32_t n=(int32_t)last;nodes[n].parent>=0;n=nodes[n].parent)count++;
  if(count>4096){out->status=OM_BUDGET;return out->status;}
  out->steps=count?malloc((size_t)count*sizeof(om_step)):NULL;if(count&&!out->steps){out->status=OM_NO_MEMORY;return out->status;}
  out->count=count;out->cost=nodes[last].g;
  for(int32_t n=(int32_t)last;nodes[n].parent>=0;n=nodes[n].parent)out->steps[--count]=(om_step){nodes[n].p,nodes[n].kind};
  return out->status=OM_PLANNED;
}
int om_plan_route(const om_route_input *in,om_route *out){
  if(!out)return OM_INVALID;memset(out,0,sizeof(*out));out->status=OM_INVALID;
  if(!in||!in->cells||!in->width||!in->height||!in->depth||in->width>256||in->height>512||in->depth>256||in->range>16||!in->max_nodes||in->max_nodes>OM_MAX_NODES||!in->max_drop||in->max_drop>16||!isfinite(in->health)||!isfinite(in->min_health)||!isfinite(in->max_fall_damage)||in->health<=0||in->min_health<0||in->max_fall_damage<0||!inside(in,in->start)||!inside(in,in->goal))return out->status;
  size_t volume=(size_t)in->width*in->height*in->depth;if(volume>OM_MAX_VOXELS)return out->status;
  if(!standing(in,in->start))return out->status=OM_START_UNSUPPORTED;
  /* State includes accumulated fall damage: the cheapest unsafe path cannot
     discard a more expensive route that retains enough health. */
  uint32_t damage_states=17,capacity=in->max_nodes*9u;
  if(volume>OM_MAX_VOXELS/damage_states)return out->status=OM_BUDGET;
  double *best=malloc(volume*damage_states*sizeof(double));node *nodes=malloc((size_t)capacity*sizeof(node));uint32_t *queue=malloc((size_t)capacity*sizeof(uint32_t));
  if(!best||!nodes||!queue){free(best);free(nodes);free(queue);return out->status=OM_NO_MEMORY;}
  for(size_t i=0;i<volume*damage_states;i++)best[i]=INFINITY;
  heap open={queue,0,capacity,nodes};uint32_t allocated=1;
  nodes[0]=(node){in->start,0,heuristic(in,in->start),-1,0,0};best[index_of(in,in->start)*damage_states]=0;push(&open,0);out->status=OM_NO_PATH;
  while(open.size&&out->visited<in->max_nodes){
    uint32_t id=pop(&open);node current=nodes[id];
    size_t state=index_of(in,current.p)*damage_states+(uint32_t)current.damage;
    if(current.g>best[state]+1e-9)continue;
    out->visited++;
    if(goal_reached(in,current.p)){make_path(nodes,id,out);break;}
    for(int dir=0;dir<8;dir++)for(int dy=1;dy>=-(int)in->max_drop;dy--){
      int dx=dirs[dir][0],dz=dirs[dir][1],diagonal=dx&&dz;
      om_point p={current.p.x+dx,current.p.y+dy,current.p.z+dz};
      if(!standing(in,p)||diagonal&&dy)continue;
      if(diagonal){om_point a={current.p.x+dx,current.p.y,current.p.z},b={current.p.x,current.p.y,current.p.z+dz};if(!standing(in,a)||!standing(in,b))continue;}
      if(dy==1){om_point head=current.p;head.y+=2;if(cell_at(in,head)!=OM_AIR)continue;}
      int clear=1;for(int y=p.y;y<=current.p.y+1;y++){om_point shaft=p;shaft.y=y;if(cell_at(in,shaft)!=OM_AIR){clear=0;break;}}if(!clear)continue;
      double fall=dy<0?fmax(0,-dy-3):0,damage=current.damage+fall;
      if(damage>=damage_states||fall>in->max_fall_damage||in->health-damage<in->min_health)continue;
      double cost=(diagonal?sqrt(2.0):1)+abs(dy)*.3+fall*4,g=current.g+cost;
      size_t next=index_of(in,p)*damage_states+(uint32_t)damage;if(g>=best[next])continue;
      if(allocated>=capacity){out->status=OM_BUDGET;goto done;}
      best[next]=g;nodes[allocated]=(node){p,g,g+heuristic(in,p),(int32_t)id,dy>0?2:dy<0?3:1,damage};push(&open,allocated++);
    }
  }
  if(out->status==OM_NO_PATH&&out->visited>=in->max_nodes)out->status=OM_BUDGET;
done: free(best);free(nodes);free(queue);return out->status;
}
void om_free_route(om_route *out){if(out){free(out->steps);out->steps=NULL;out->count=0;}}
int om_read_varint(const uint8_t *data,size_t length,uint32_t *value,size_t *used){
  if(!data||!value||!used)return -1;uint32_t result=0;*used=0;
  for(size_t i=0;i<length&&i<5;i++){uint8_t b=data[i];if(i==4&&(b&0xf0))return -1;result|=(uint32_t)(b&127)<<(7*i);if(!(b&128)){*value=result;*used=i+1;return 1;}}
  return length>=5?-1:0;
}
size_t om_write_varint(uint32_t value,uint8_t out[5]){size_t i=0;do{uint8_t byte=value&127;value>>=7;out[i++]=byte|(value?128:0);}while(value);return i;}
