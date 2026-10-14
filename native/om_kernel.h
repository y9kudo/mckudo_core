#ifndef OM_KERNEL_H
#define OM_KERNEL_H
#include <stddef.h>
#include <stdint.h>

/* OvermindMC native kernel. Copyright (c) y9kudo. MIT. */
#define OM_KERNEL_ABI 1
#define OM_MAX_VOXELS 8388608u
#define OM_MAX_NODES 100000u
enum om_cell { OM_UNKNOWN=0, OM_AIR=1, OM_SOLID=2, OM_HAZARD=3 };
enum om_route_status { OM_PLANNED=0, OM_NO_PATH=1, OM_START_UNSUPPORTED=2, OM_BUDGET=3, OM_INVALID=4, OM_NO_MEMORY=5 };
typedef struct { int32_t x,y,z; } om_point;
typedef struct { om_point position; int32_t kind; } om_step;
typedef struct {
  const uint8_t *cells; uint32_t width,height,depth;
  om_point start,goal; uint32_t range,max_nodes,max_drop;
  double health,min_health,max_fall_damage;
} om_route_input;
typedef struct { int status; uint32_t visited,count; double cost; om_step *steps; } om_route;
int om_plan_route(const om_route_input *input,om_route *result);
void om_free_route(om_route *result);
/* Return 1 for complete, 0 for incomplete, -1 for invalid/overflow. */
int om_read_varint(const uint8_t *data,size_t length,uint32_t *value,size_t *used);
size_t om_write_varint(uint32_t value,uint8_t out[5]);
#endif
