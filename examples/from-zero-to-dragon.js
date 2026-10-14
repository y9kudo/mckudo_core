// Thin entry point: decisions, Nether logistics and combat are implemented in the library.
if(!process.argv.includes('--dragon'))process.argv.push('--dragon');
if(!process.argv.includes('--full'))process.argv.push('--full');
process.env.MC_TEST_MINUTES??='0';
process.env.MC_NAME??='RowanJourney';
process.env.MC_REPORT??='data/full-expedition/report.json';
await import('./end-expedition.js');
