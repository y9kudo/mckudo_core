import {createMachineGraph,planMachineResources} from '../mckudo_core.js';
import {readFile} from 'node:fs/promises';

const graph=createMachineGraph(JSON.parse(await readFile(new URL('machine-recipes.json',import.meta.url),'utf8')));
console.log(JSON.stringify(planMachineResources({graph,targets:[{id:'example:iron_plate',amount:3}],inventory:[{id:'minecraft:raw_iron',amount:3}]}),null,2));
// This prints dependencies and missing executors. It does not invent an installed mod or a working machine.
