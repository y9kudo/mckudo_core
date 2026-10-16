// OMConnect — standalone Minecraft agent client. Created by y9kudo, MIT.
export { OMConnect, createOMConnect, OMCONNECT } from './src/client.js';
export { OMWorld } from './src/world.js';
export { OMInventory } from './src/inventory.js';
export { stepPhysics } from './src/physics.js';
export { environmentAt, fluidAt } from './src/environment.js';
export { OM_SKILLS, miningTime, chooseMiningTool } from './src/actions.js';
export { OMContainers, findStorages, storageIdentity, isStorageBlock } from './src/containers.js';
export { OMPeer } from './src/peers.js';
export { createFleet, DEFAULT_AGENT_NAMES } from './src/fleet.js';
export { projectileProfile, traceProjectile, solveAim } from './src/projectiles.js';
export {predictFallLanding,planPearlEscape,decideFallRescue} from './src/fall-safety.js';
export {perchedDragonHead} from './src/dragon-melee.js';
export { OMPlayers, gazeAngles, gazeError } from './src/players.js';
export { rotateToward, bridgeMaterials, travelControl, combatControl } from './src/movement.js';
export { craftingRecipes, chooseCraftingRecipe, smeltingRecipe, fuelItems } from './src/crafting.js';
export {assessFall} from './src/fall.js';
export {planRoute, planRouteAsync,planRouteToAny,planRouteToAnyAsync} from './src/navigation.js';
export {createWorkScheduler} from './src/scheduler.js';
export {WorldRecipeBook} from './src/recipes.js';
export {traceVisibility} from './src/visibility.js';
export {OMProtection, isStructureBlock} from './src/protection.js';
export {versionSupport,listVersionSupport,discoverOfficialJavaVersions,inspectOfficialJavaVersion,OFFICIAL_VERSION_MANIFEST,NATIVE_VERSIONS} from './src/versions.js';
export {createVersionAPI,registerVersionProfile,resolveVersionProfile,detectServerVersion,normalizeSlot} from './src/version-api.js';
export {createVanillaCompatibilityProfile} from './src/vanilla-profile.js';
export {createJava263Profile} from './src/java263.js';
export {OMActionError, ACTION_FAILURE_CODES, blockEvidenceValue} from './src/failures.js';
export {OMVECTORIZE,OMVectorize,volumeClearance,traceVolume,planSwimRoute,planSwimRouteAsync,predictElytraTick,planElytraFlight,elytraControl} from './src/vectorize.js';
export {findSigns,readSign} from './src/signs.js';
export {observeMenu,findMenuSlot,menuText} from './src/menus.js';

// Deprecated symbol aliases for applications migrating from the old client.
export {OMConnect as KudoConnect,createOMConnect as createKudoConnect,OMCONNECT as KUDOCONNECT} from './src/client.js';
export {OMVectorize as KudoVectorize,OMVECTORIZE as KUDOVECTORIZE} from './src/vectorize.js';
