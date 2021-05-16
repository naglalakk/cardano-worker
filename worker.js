const cardanoWorker = require('./cardanoWorker.js');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers')
const argv = yargs(hideBin(process.argv))
    .command('[command] --wallet [name]', 'Run a worker command')
    .demandCommand(1)
    .argv;

const runCommand = argv._[0]
const worker = new cardanoWorker.CardanoWorker(argv.wallet);


if(runCommand === 'work') {
    worker.work();
} else if(runCommand === 'query') {
    worker.queryUTxO();
} else if(runCommand === 'createWallet') {
    if(argv.name === undefined) {
        console.log('ERROR: Wallet name needs to be specified with --wallet <name>');
        return;
    }

    worker.createWallet(argv.name);
}
