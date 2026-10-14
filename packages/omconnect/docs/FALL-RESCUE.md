# Fall insurance

OMConnect 0.7 includes default insurance. During the fall, the client only predicts the landing site by loaded blocks. If the support is known and the height is dangerous, He's trying to spill water and then take it away. When he threatens to be empty or to be seriously destroyed in Ende, he looks for a wide-ranging observation site and looks for a drop of the Kreya pearls. Emergency action interrupts normal navigation; resources should be in inventory.

```js
import {createOMConnect} from 'omconnect';

const client=createOMConnect({
  host:'127.0.0.1',port:25565,username:'Avery07',
  version:'1.21.1',auth:'offline',fallSafety:true
});
client.on('fallRescue',event=>console.log(event.phase,event.skill,event));
await client.connect();
```

Event `planned` means choice of action, `dispatched` — Successful dispatch and partial confirmation, `failed` — refusal. For pearls `thrown:true` Confirms the item's input by the server, but `landingConfirmed:false` means, That successful teleportation needs to be checked separately in position. Water `recovered:true` means, I think the bucket is filled again by the change of the server inventory.

Manual skills call is available through `client.execute({skill:'waterClutch'})` and `client.execute({skill:'escapePearl'})`. The plan can be tested before execution via `predictFallLanding`, `planPearlEscape` and `decideFallRescue`. With unknown cups, No wide area, too much demolition, Network delay or block ban not guaranteed rescue. Water doesn't save you from the void. If the app controls the fall itself, Automatic processor can be disabled `fallSafety:false`.
