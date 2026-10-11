// Shared recorder; all resource, movement and combat decisions live in MCKudo.
if(!process.argv.includes('--dragon'))process.argv.push('--dragon');
await import('./end-expedition.js');
