const CardanoCli = require('cardanocli-js');
const axios = require('axios').default;
const utils = require('./utils.js');
require('dotenv').config()

// config
var addr = "";

const cardanocliJs = new CardanoCli({ 
    network: process.env.NETWORK,
    shelleyGenesisPath: process.env.SHELLEY_GENESIS_PATH,
    socketPath: process.env.CARDANO_NODE_SOCKET_PATH
});

// Token request reservation lookup
const TOKEN_API_URL = process.env.TOKEN_API_URL
const TOKEN_API_KEY = process.env.TOKEN_API_KEY
const tokenAPI = axios.create({
    baseURL: TOKEN_API_URL,
    headers: { 'Authorization' : `Basic ${TOKEN_API_KEY}` }
});

// We need this for looking up addresses in transactions
const TX_API_URL = process.env.TX_API_URL
const TX_API_KEY = process.env.TX_API_KEY
const txAPI = axios.create({
    baseURL: TX_API_URL,
    headers: { 'project_id': TX_API_KEY }
});


class CardanoWorker {
    LOOP_INTERVAL = 1000 * 60;
    DEFAULT_FEE = cardanocliJs.toLovelace(3);
    sender = undefined;
    mintScript = undefined;
    reservations = [];
    intervalId = 0;
    policy = '';
    coinName = 'AnA';
    tokenKey = '';
    receiverAddr = '';
    receivers = [];
 
    constructor(sender) {
        if(sender != undefined) {
            this.sender = cardanocliJs.wallet(sender);
            this.mintScript = {
                keyHash: cardanocliJs.addressKeyHash(this.sender.name),
                type: 'sig'
            };
            this.policy = cardanocliJs.transactionPolicyid(this.mintScript);
            this.tokenKey  = `${this.policy}.${this.coinName}`;
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
                        console.log(`Broadcast completed for op: ${op}, txHash: ${txHash}, status: ${status}`);
                        resolve(data)
                    }) 
                    .catch((err) => { reject(err); });
        });
    }

    createWallet(name) {
        cardanocliJs.addressKeyGen(name);
        cardanocliJs.stakeAddressKeyGen(name);
        cardanocliJs.stakeAddressBuild(name);
        cardanocliJs.addressBuild(name);
        return cardanocliJs.wallet(name);
    }

    merge(id) {

        if(this.sender.balance().utxo.length === 1) {
            return this.sender.balance().utxo.map(x => {
                return {
                    address: this.sender.paymentAddr,
                    amount: x.amount
                }
            });
        }

        const self = this;
        const otherReservations = this.reservations.filter(x => x !== id)

        // Collect other reserved transactions if present
        // We don't want to alter their amounts
        const otherReservedTxs = 
            this.sender.balance().utxo
                .filter(x => otherReservations.includes(x.amount.lovelace ))
                .map(x => {
                    return {
                        address: this.sender.paymentAddr,
                        amount: x.amount
                    }
                });

        // Merge the rest of the UTxO set into 
        // a single transaction
        const mergedTxs = [this.sender.balance().utxo.filter(x => !otherReservations.includes(x.amount.lovelace)).reduce((acc, currVal) => {
            let tx = {
                address: self.sender.paymentAddr,
                amount: {
                    lovelace: acc.amount.lovelace + currVal.amount.lovelace,

                }
            };
            const tknAmount = (acc[self.tokenKey] || 0) + (currVal[self.tokenKey] || 0)
            if(tknAmount) {
                tx.amount[self.tokenKey] = tknAmount;
            }
            return tx;
        })];
        const merged = mergedTxs.concat(otherReservedTxs);
        return merged;
    }

    mint(tokenTx) {
        return new Promise((resolve, reject) => {
            const id = tokenTx.token.amount;
            
            const metadata = JSON.parse(tokenTx.token.metadata);
            const amount   = 1; // TODO: should be included in TokenTransaction

            const self = this;

            // update transaction status
            this.broadcast('mint', '', tokenTx, 'minting').then((response) => {
                // start minting
                const txOut = self.merge(id);
                      txOut[0].amount[self.tokenKey] = amount;
                const tx = {
                    txIn: self.sender.balance().utxo,
                    txOut: txOut,
                    mint: [{ 
                        action: 'mint', 
                        amount: amount, 
                        token: self.tokenKey 
                    }],
                    witnessCount: 2,
                    metadata: metadata
                }
                const raw = utils.createTransaction(tx);
                const signed = utils.signTransaction(self.sender, raw, self.mintScript);
                const txHash = cardanocliJs.transactionSubmit(signed);
                this.broadcast(
                    'minting', 
                    txHash, 
                    tokenTx,
                    'minted');
                resolve(txHash);
            }).catch((err) => { reject(err); });
        });
    }

    refund(id) {

    }

    send(tokenTx) {
        return new Promise((resolve, reject) => {
            console.log('Sending token');
            const self = this;
            const amount = 1;
            const receiver = this.receivers.filter(x => x.amount === tokenTx.token.amount);
            const receiverAddr = receiver.length ? receiver[0].address : '';

            let txOut = this.sender.balance().utxo.map(x => {
                if(self.tokenKey in x.amount) {
                    x.amount.lovelace -= this.DEFAULT_FEE;
                    delete x.amount[this.tokenKey]
                }

                return {
                    address: self.sender.paymentAddr,
                    amount: x.amount
                }
            }).filter(x => x.amount.lovelace !== 0);

            let reiceverTx = {
                address: receiverAddr,
                amount: {
                    lovelace: this.DEFAULT_FEE,
                }
            };

            reiceverTx.amount[this.tokenKey] = amount;
            txOut.push(reiceverTx);

            const txInfo = {
                txIn: this.sender.balance().utxo,
                txOut: txOut
            }

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
                tokenTx, 
                'completed'
            ).then((data) => resolve(data));
        });
    }

    loop() {
        console.log('New worker loop started');
        const self = this;
        const utxo = this.sender.balance().utxo;
        const utxoAmounts = utxo.map(x => x.amount.lovelace);
        tokenAPI.get('/tokens/transactions/?status=request').then((response) => {
            // Store/Update reservations list
            self.reservations  = response.data.map(x => x.token.amount)

            // Build receivers Map
            const hashes = utxo.filter(x => utxoAmounts.includes(x.amount.lovelace)).map(x => {
                return {
                    txHash: x.txHash,
                    amount: x.amount.lovelace
                }
            });
            const lookups = hashes.map(x => {
                return new Promise((resolve, reject) => { 
                    txAPI.get(`/txs/${x.txHash}/utxos`).then((utxos) => {
                        resolve({ 
                            amount: x.amount,
                            address: utxos.data.inputs[0].address
                        });
                    }).catch((err) => reject(err));
                });
            });

            Promise.all(lookups).then((receivers) => {
                self.receivers = receivers;

                // Scan UTxO for refunds

                for(var tokenTx of response.data) {
                    if(utxoAmounts.includes(tokenTx.token.amount)) {
                        const tokenAmount = tokenTx.token.amount;

                        /*
                        self.send(tokenTx, tokenAmount)
                            .then((data) => {})
                            .catch((err) => { 
                                console.log(err) 
                            });*/

                        self.mint(tokenTx).then((data) => { 
                            const intervalId = setInterval(() => {
                                if(self.sender.balance().utxo.filter(x => x.amount[self.tokenKey] !== undefined).length) {
                                    console.log('Token detected');
                                    clearInterval(intervalId);

                                    self.broadcast('minted', data, tokenTx, 'minted').then((response) => {
                                        self.send(tokenTx)
                                            .then((data) => {
                                            })
                                            .catch((err) => { 
                                                console.log(err) 
                                            });
                                    }).catch((err) => { console.log(err); 
                                    });
                                } else {
                                    console.log('Token not yet detected');
                                }
                            }, 3000);
                        }).catch((err) => { console.log(err); });
                    }
                }
            });
        });
    }

    queryUTxO() {
        console.log(this.sender.balance().utxo);
        return this.sender.balance().utxo;
    }

    work() {
        console.log('cardano-worker running...');
        this.loop();
        this.intervalId = setInterval(this.loop.bind(this), this.LOOP_INTERVAL)

    }
}

exports.CardanoWorker = CardanoWorker;
