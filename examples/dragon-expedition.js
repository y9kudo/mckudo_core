// Shared recorder; all resource, movement and combat decisions live in OvermindMC.
if(!process.argv.includes('--dragon'))process.argv.push('--dragon');
await import('./end-expedition.js');
