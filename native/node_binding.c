#define NAPI_VERSION 8
#include <node_api.h>
#include "om_kernel.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

typedef struct { unsigned pending; int closing; } addon_state;
typedef struct { napi_async_work work; napi_deferred deferred; addon_state *state; om_route_input input; om_route result; uint8_t *cells; } task;
static napi_value error(napi_env env,const char *message){napi_throw_error(env,NULL,message);return NULL;}
static int typed(napi_env env,napi_value value,napi_typedarray_type expected,void **data,size_t *length){napi_typedarray_type type;napi_value buffer;size_t offset;bool ordinary=false;if(napi_get_typedarray_info(env,value,&type,length,data,&buffer,&offset)!=napi_ok||napi_is_arraybuffer(env,buffer,&ordinary)!=napi_ok)return 0;return ordinary&&type==expected;}
static void number(napi_env env,napi_value object,const char *key,double value){napi_value n;napi_create_double(env,value,&n);napi_set_named_property(env,object,key,n);}
static void string(napi_env env,napi_value object,const char *key,const char *value){napi_value s;napi_create_string_utf8(env,value,NAPI_AUTO_LENGTH,&s);napi_set_named_property(env,object,key,s);}
static napi_value result_value(napi_env env,om_route *r){
  napi_value value,buffer,path;napi_create_object(env,&value);
  const char *codes[]={"PLANNED","NO_PATH","START_UNSUPPORTED","SEARCH_BUDGET","INVALID_INPUT","NO_MEMORY"};
  string(env,value,"code",codes[r->status]);number(env,value,"visited",r->visited);number(env,value,"cost",r->cost);
  int32_t *data=NULL;size_t bytes=(size_t)r->count*4*sizeof(int32_t);
  if(napi_create_arraybuffer(env,bytes,(void**)&data,&buffer)!=napi_ok)return NULL;
  for(uint32_t i=0;i<r->count;i++){data[i*4]=r->steps[i].position.x;data[i*4+1]=r->steps[i].position.y;data[i*4+2]=r->steps[i].position.z;data[i*4+3]=r->steps[i].kind;}
  napi_create_typedarray(env,napi_int32_array,(size_t)r->count*4,buffer,0,&path);napi_set_named_property(env,value,"path",path);return value;
}
static int parse_input(napi_env env,napi_callback_info info,task *t){
  napi_value args[5];size_t argc=5;napi_get_cb_info(env,info,&argc,args,NULL,NULL);if(argc!=5)return 0;
  uint8_t *cells;uint32_t *dims;int32_t *start,*goal;double *options;size_t length,d,s,g,o;
  if(!typed(env,args[0],napi_uint8_array,(void**)&cells,&length)||!typed(env,args[1],napi_uint32_array,(void**)&dims,&d)||!typed(env,args[2],napi_int32_array,(void**)&start,&s)||!typed(env,args[3],napi_int32_array,(void**)&goal,&g)||!typed(env,args[4],napi_float64_array,(void**)&options,&o)||d!=3||s!=3||g!=3||o!=6)return 0;
  if(!dims[0]||dims[0]>256||!dims[1]||dims[1]>512||!dims[2]||dims[2]>256||(size_t)dims[0]*dims[1]*dims[2]!=length||length>OM_MAX_VOXELS)return 0;
  for(size_t i=0;i<6;i++)if(!isfinite(options[i]))return 0;
  for(size_t i=0;i<3;i++)if(options[i]<0||options[i]>100000||floor(options[i])!=options[i])return 0;
  for(size_t i=0;i<length;i++)if(cells[i]>OM_HAZARD)return 0;
  t->cells=malloc(length);if(!t->cells)return 0;memcpy(t->cells,cells,length);
  t->input=(om_route_input){t->cells,dims[0],dims[1],dims[2],{start[0],start[1],start[2]},{goal[0],goal[1],goal[2]},(uint32_t)options[0],(uint32_t)options[1],(uint32_t)options[2],options[3],options[4],options[5]};return 1;
}
static void execute(napi_env env,void *data){(void)env;task *t=data;om_plan_route(&t->input,&t->result);}
static void complete(napi_env env,napi_status status,void *data){
  task *t=data;napi_value value=env&&status==napi_ok?result_value(env,&t->result):NULL;
  if(env){
  if(value)napi_resolve_deferred(env,t->deferred,value);else{napi_value message;napi_create_string_utf8(env,"Native route work failed.",NAPI_AUTO_LENGTH,&message);napi_reject_deferred(env,t->deferred,message);}
  napi_delete_async_work(env,t->work);}
  om_free_route(&t->result);free(t->cells);t->state->pending--;if(t->state->closing&&!t->state->pending)free(t->state);free(t);
}
static napi_value plan_sync(napi_env env,napi_callback_info info){task t={0};if(!parse_input(env,info,&t))return error(env,"Expected bounded voxel grid, dimensions, start, goal and options typed arrays.");execute(env,&t);napi_value value=result_value(env,&t.result);om_free_route(&t.result);free(t.cells);return value;}
static napi_value plan_async(napi_env env,napi_callback_info info){
  addon_state *state=NULL;napi_get_instance_data(env,(void**)&state);if(!state||state->pending>=2)return error(env,"Native route queue is full (2 jobs).");
  task *t=calloc(1,sizeof(task));if(!t)return error(env,"Native allocation failed.");
  if(!parse_input(env,info,t)){free(t);return error(env,"Invalid bounded native route input.");}
  t->state=state;napi_value promise,name;
  if(napi_create_promise(env,&t->deferred,&promise)!=napi_ok){free(t->cells);free(t);return error(env,"Cannot create native promise.");}
  napi_create_string_utf8(env,"overmind:ground-route",NAPI_AUTO_LENGTH,&name);
  if(napi_create_async_work(env,NULL,name,execute,complete,t,&t->work)!=napi_ok){free(t->cells);free(t);return error(env,"Cannot create native route work.");}
  state->pending++;
  if(napi_queue_async_work(env,t->work)!=napi_ok){state->pending--;napi_delete_async_work(env,t->work);free(t->cells);free(t);return error(env,"Cannot queue native route work.");}return promise;
}
static napi_value write_varint(napi_env env,napi_callback_info info){
  napi_value args[1];size_t argc=1;double value;napi_get_cb_info(env,info,&argc,args,NULL,NULL);
  if(argc!=1||napi_get_value_double(env,args[0],&value)!=napi_ok||!isfinite(value)||value<INT32_MIN||value>INT32_MAX||floor(value)!=value)return error(env,"VarInt requires a signed 32-bit integer.");
  uint8_t bytes[5];size_t n=om_write_varint((uint32_t)(int32_t)value,bytes);napi_value result;napi_create_buffer_copy(env,n,bytes,NULL,&result);return result;
}
static napi_value read_varint(napi_env env,napi_callback_info info){
  napi_value args[1];size_t argc=1;napi_get_cb_info(env,info,&argc,args,NULL,NULL);uint8_t *bytes;size_t length;
  if(argc!=1||!typed(env,args[0],napi_uint8_array,(void**)&bytes,&length)||length>2097152)return error(env,"VarInt input must be a bounded Uint8Array.");
  uint32_t value;size_t used;int status=om_read_varint(bytes,length,&value,&used);napi_value result;
  if(status<0)return error(env,"VarInt exceeds 32 bits or five bytes.");if(!status){napi_get_null(env,&result);return result;}
  napi_create_object(env,&result);number(env,result,"value",(int32_t)value);number(env,result,"bytes",used);return result;
}
static napi_value frame(napi_env env,napi_callback_info info){
  napi_value args[1];size_t argc=1;napi_get_cb_info(env,info,&argc,args,NULL,NULL);uint8_t *bytes;size_t length;
  if(argc!=1||!typed(env,args[0],napi_uint8_array,(void**)&bytes,&length)||!length||length>2097151)return error(env,"Packet payload requires 1–2097151 bytes.");
  uint8_t head[5];size_t n=om_write_varint((uint32_t)length,head);void *output;napi_value result;
  if(napi_create_buffer(env,n+length,&output,&result)!=napi_ok)return error(env,"Cannot allocate packet frame.");memcpy(output,head,n);memcpy((uint8_t*)output+n,bytes,length);return result;
}
static napi_value dense_forward(napi_env env,napi_callback_info info){
  napi_value args[3];size_t argc=3;napi_get_cb_info(env,info,&argc,args,NULL,NULL);float *input,*weights;uint32_t *shape;size_t ni,nw,ns;
  if(argc!=3||!typed(env,args[0],napi_float32_array,(void**)&input,&ni)||!typed(env,args[1],napi_float32_array,(void**)&weights,&nw)||!typed(env,args[2],napi_uint32_array,(void**)&shape,&ns)||ns!=3)return error(env,"Dense forward requires Float32 input/weights and a Uint32 shape.");
  uint32_t inputs=shape[0],hidden=shape[1],outputs=shape[2];
  if(!inputs||inputs>256||!hidden||hidden>256||!outputs||outputs>129||ni!=inputs||nw!=(size_t)inputs*hidden+hidden+(size_t)hidden*outputs+outputs)return error(env,"Invalid bounded dense network shape.");
  for(size_t i=0;i<ni;i++)if(!isfinite(input[i]))return error(env,"Nonfinite model input.");for(size_t i=0;i<nw;i++)if(!isfinite(weights[i]))return error(env,"Nonfinite model weight.");
  float h[256],*out;size_t bh=(size_t)inputs*hidden,wo=bh+hidden,bo=wo+(size_t)outputs*hidden;
  for(uint32_t j=0;j<hidden;j++){double sum=weights[bh+j];for(uint32_t i=0;i<inputs;i++)sum+=(double)input[i]*weights[(size_t)j*inputs+i];h[j]=(float)tanh(sum);}
  napi_value buffer,result;if(napi_create_arraybuffer(env,(size_t)outputs*sizeof(float),(void**)&out,&buffer)!=napi_ok)return error(env,"Cannot allocate model output.");
  for(uint32_t a=0;a<outputs;a++){double sum=weights[bo+a];for(uint32_t j=0;j<hidden;j++)sum+=(double)h[j]*weights[wo+(size_t)a*hidden+j];out[a]=(float)sum;if(!isfinite(out[a]))return error(env,"Nonfinite model output.");}
  napi_create_typedarray(env,napi_float32_array,outputs,buffer,0,&result);return result;
}
static void finalize(napi_env env,void *data,void *hint){(void)env;(void)hint;addon_state *state=data;state->closing=1;if(!state->pending)free(state);}
static napi_value init(napi_env env,napi_value exports){
  addon_state *state=calloc(1,sizeof(addon_state));if(!state)return error(env,"Cannot allocate native kernel state.");napi_set_instance_data(env,state,finalize,NULL);
  napi_property_descriptor methods[]={
    {"planRoute",NULL,plan_sync,NULL,NULL,NULL,napi_default,NULL},{"planRouteAsync",NULL,plan_async,NULL,NULL,NULL,napi_default,NULL},
    {"writeVarInt",NULL,write_varint,NULL,NULL,NULL,napi_default,NULL},{"readVarInt",NULL,read_varint,NULL,NULL,NULL,napi_default,NULL},
    {"framePacket",NULL,frame,NULL,NULL,NULL,napi_default,NULL},{"denseForward",NULL,dense_forward,NULL,NULL,NULL,napi_default,NULL}
  };
  napi_define_properties(env,exports,6,methods);number(env,exports,"abi",OM_KERNEL_ABI);string(env,exports,"author","y9kudo");string(env,exports,"language","C");return exports;
}
NAPI_MODULE(om_kernel,init)
