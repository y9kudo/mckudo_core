// The reusable kernel owns progression, portal construction and Nether exploration.
if(!process.argv.includes('--nether-visit'))process.argv.push('--nether-visit');
process.env.MC_TEST_MINUTES??='30';
process.env.MC_NAME??='ArcherNetherD3';
process.env.MC_REPORT??='data/nether-visit/report.json';
await import('./end-expedition.js');
