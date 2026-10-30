const { parentPort, workerData } = require('worker_threads');
const { analyzeRaster } = require('./analysisStats');
try { parentPort.postMessage({ result: analyzeRaster(workerData) }); }
catch (error) { parentPort.postMessage({ error: error.message }); }
