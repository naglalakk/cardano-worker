const CardanoCli = require('cardanocli-js');
const axios = require('axios').default;
const utils = require('./utils.js');
const logger = require('./utils/logger').logger;
const fs = require('fs');
require('dotenv').config()

// config
var addr = "";

const cardanocliJs = new CardanoCli({ 
    network: process.env.NETWORK,
    shelleyGenesisPath: process.env.SHELLEY_GENESIS_PATH,
    socketPath: process.env.CARDANO_NODE_SOCKET_PATH
});

// Token request reservation lookup
const TOKEN_API_URL = process.env.TOKEN_API_URL;
const TOKEN_API_KEY = process.env.TOKEN_API_KEY;
const tokenAPI = axios.create({
    baseURL: TOKEN_API_URL,
    headers: { 'Authorization' : `Basic ${TOKEN_API_KEY}` }
});

// We need this for looking up addresses in transactions
const TX_API_URL = process.env.TX_API_URL;
const TX_API_KEY = process.env.TX_API_KEY;
const txAPI = axios.create({
    baseURL: TX_API_URL,
    headers: { 'project_id': TX_API_KEY }
});

const RECV_WALLET = process.env.RECV_WALLET;


class CardanoWorker {
    LOOP_INTERVAL = 5000 * 60;
    DEFAULT_FEE = cardanocliJs.toLovelace(3);
    SEND_AMOUNT = 10000000
    sender = undefined;
    mintScript = undefined;
    intervalId = 0;
    policy = '';
    coinName = 'AnA';
    tokenKey = '';
 
    constructor(sender) {
        if(sender != undefined) {
            this.sender = cardanocliJs.wallet(sender);
            // The all mighty mint script
            var self = this;
            fs.readFile('policy/policy.json', 'utf8', function(err, data) {
                self.mintScript = JSON.parse(data);
                self.policy = cardanocliJs.transactionPolicyid(self.mintScript);
                self.tokenKey  = `${self.policy}.${self.coinName}`;
            })
        }
    }

    broadcast(op, txHash, tokenTx, status) {
        return new Promise((resolve,reject) => {
            let clone = JSON.parse(JSON.stringify(tokenTx));
            clone.txHash = txHash;
            clone.token = tokenTx.token.id;
            clone.status = status;

            tokenAPI.post('/tokens/transactions/update', clone)
                    .then((data) => {
                        logger.info(`Broadcast completed for op: ${op}, txHash: ${txHash}, status: ${status}`);
                        resolve(data)
                    }) 
                    .catch((err) => { reject(err); });
        });
    }

    mint(utxo, transaction) {
        return new Promise((resolve, reject) => {
            const self = this;
            const metadata = JSON.parse(transaction.token.metadata.replace(/\\"/g, '"'));
            const amount   = 1; // TODO: should be included in TokenTransaction


            // update transaction status
            this.broadcast('mint', '', transaction, 'minting').then((response) => {
                // start minting
                const tx = {
                    txIn: [utxo],
                    txOut: [{
                        address: self.sender.paymentAddr,
                        amount: {
                            lovelace: utxo.amount.lovelace
                        }
                    }],
                    mint: [{ 
                        action: 'mint', 
                        amount: 1, 
                        token: self.tokenKey 
                    }],
                    invalidBefore: self.mintScript.scripts.filter(x => x.type == 'after')[0].slot,
                    invalidHereAfter: self.mintScript.scripts.filter(x => x.type == 'before')[0].slot,

                    witnessCount: 2,
                    metadata: metadata
                }
                tx.txOut[0].amount[self.tokenKey] = amount;

                const raw = utils.createTransaction(tx);
                const signed = utils.signTransaction(self.sender, raw, self.mintScript);
                const txHash = cardanocliJs.transactionSubmit(signed);
                this.broadcast('minting', txHash, transaction, 'minted').then((resp) => {
                    resolve(txHash);
                });
            }).catch((err) => { reject(err); });
        });
    }

    refund(utxo, recvAddr) {
        const txInfo = {
            txIn: [utxo],
            txOut: [
                { address: recvAddr
                , amount: utxo.amount
                }
            ]
        };

        let raw = cardanocliJs.transactionBuildRaw(txInfo);
        let fee = cardanocliJs.transactionCalculateMinFee({
            ...txInfo,
            txBody: raw,
            witnessCount: 1,
        });
        //pay the fee by subtracting it from the sender utxo
        txInfo.txOut[0].amount.lovelace -= fee;

        //create final transaction
        let tx = cardanocliJs.transactionBuildRaw({ ...txInfo, fee });

        //sign the transaction
        let txSigned = cardanocliJs.transactionSign({
            txBody: tx,
            signingKeys: [this.sender.payment.skey],
        });
                
        return cardanocliJs.transactionSubmit(txSigned);
    }

    send(utxo, transaction, recvAddr) {
        return new Promise((resolve, reject) => {
            logger.info('Sending token');
            const amount = 1;

            const txInfo = {
                txIn: [utxo],
                txOut: [
                    { address: recvAddr
                    , amount: 
                        { lovelace: this.SEND_AMOUNT
                        }
                    },
                    { address: RECV_WALLET
                    , amount: 
                        { lovelace: utxo.amount.lovelace - this.SEND_AMOUNT
                        }
                    }
                ]
            }

            txInfo.txOut[0].amount[this.tokenKey] = amount;

            let raw = cardanocliJs.transactionBuildRaw(txInfo);
            let fee = cardanocliJs.transactionCalculateMinFee({
                ...txInfo,
                txBody: raw,
                witnessCount: 1,
            });
            //pay the fee by subtracting it from the sender utxo
            txInfo.txOut[0].amount.lovelace -= fee;

            //create final transaction
            let tx = cardanocliJs.transactionBuildRaw({ ...txInfo, fee });

            //sign the transaction
            let txSigned = cardanocliJs.transactionSign({
                txBody: tx,
                signingKeys: [this.sender.payment.skey],
            });

            //broadcast transaction
            this.broadcast(
                'send', 
                cardanocliJs.transactionSubmit(txSigned), 
                transaction, 
                'completed'
            ).then((data) => resolve(data));
        });
    }


    processUtxo(utxo, transactions) {
        logger.info(`processing utxo: ${utxo.txHash}`);
        const self = this;
        txAPI.get(`/txs/${utxo.txHash}/utxos`).then((utxos) => {
            var recvAddr = utxos.data.inputs[0].address;
            var amount = utxo.amount.lovelace;
            var hit = transactions.filter(x => x.token.amount === amount)
            if(hit.length) {
                const transaction = hit[0];
                self.mint(utxo, transaction).then((txHash) => {
                    const intervalId = setInterval(() => {
                        logger.info('waiting for txHash: ' + txHash);
                        var filt = self.sender.balance().utxo.filter(x => x.txHash === txHash)
                        if(filt.length) {
                            clearInterval(intervalId);
                            self.send(filt[0], transaction, recvAddr).then((data) => {});
                        }
                    }, 3000);
                });
            } else {
                this.refund(utxo, recvAddr);
            }
        });
    }

    loop() {
        logger.info('New worker loop started');
        const self = this;
        const utxos = this.sender.balance().utxo;
        tokenAPI.get('/tokens/transactions/?status=request').then((response) => {
            const txs = response.data;

            utxos.forEach(function(utxo) {
                self.processUtxo(utxo, txs);
            });
        });
    }

    queryUTxO() {
        return this.sender.balance().utxo;
    }

    work() {
        logger.info('cardano-worker running...');
        this.loop();
        this.intervalId = setInterval(this.loop.bind(this), this.LOOP_INTERVAL)
    }
}

exports.CardanoWorker = CardanoWorker;
