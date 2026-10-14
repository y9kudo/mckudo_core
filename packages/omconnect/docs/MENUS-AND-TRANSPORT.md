# server menu and transportation

## Reading GUI

The server can open the menu itself. OMConnect Saves this window instead of immediate closure. `client.menu()` Returns the title, Type, Ready status, Audit and upper slots: ID item, Number, name and lore. Fields of text and NBT processed as data.

```js
import {findMenuSlot} from 'omconnect';

await client.waitFor(()=>client.menu()?.ready,{event:'container',timeoutMs:10000});
const choice=findMenuSlot(client.menu(),{contains:"Survival"});
const result=await client.execute({skill:'menuClick',args:{
  windowId:choice.windowId,revision:choice.revision,slot:choice.slot
}});
console.log(result.responseObserved,result.menuChanged);
```

`findMenuSlot` It requires the only coincidence. Can be used `item`, Exact `name`, substrate `contains` or number `slot`; Several fields applied jointly. An empty or mixed request is denied. Transfer components retain the translation key, if the server has not sent the literal text.

Clyde checks, I'm sure the window and audit were still the same and the radius was empty. New window data or window closure confirms **server response**. `menuChanged: false` means, I'm sure it was just the sync: This is not proof of entry into the chosen mode. The result of the mode is checked by individual game observation. Without answer for 4 second action ends with error.

Unknown types with compatible top slot structure + 36 player slots can be read. They don't get the crafting table properties/Boilers. The menu, Full-made in client fashion without bags of container, requires a separate adapter.

## Landing and exit

```js
await client.execute({skill:'mount',args:{entityId:'42'}});
console.log(client.vehicle());
await client.execute({skill:'dismount'});
```

Transport shall be a real-life vessel or passenger wagon within 3 blocks. Landing is considered to have been completed after server `set_passengers`, and exit — after the removal of the passenger. While the player is sitting, Normal pedestrian physics not applicable; the situation follows the nature of transport observed. Destruction of transport, Regeneration and change of measurement cleans the reference. The foot and the fighting require first withdrawal.

B 0.7-dev It's a landing mechanism/Monitoring/exit. Automatic steering of a boat, No track search and acceleration of transport has been carried out yet. Checked by protocol tests; A separate boat and wagon test is still needed.
