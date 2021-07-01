const cardanoWorker = require('./cardanoWorker.js');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers')
const argv = yargs(hideBin(process.argv))
    .command('[work|query] --wallet [name]', 'Run a worker command')
    .demandCommand(1)
    .argv;

const runCommand = argv._[0]
const worker = new cardanoWorker.CardanoWorker(argv.wallet);


if(runCommand === 'work') {
    worker.work();
} else if(runCommand === 'query') {
    console.log(worker.queryUTxO());
} 
