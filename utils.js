const CardanoCli = require('cardanocli-js');
const shelleyGenesisPath = '/home/kott/cardano/config/testnet-shelley-genesis.json';
const cardanocliJs = new CardanoCli({ 
    network: "testnet-magic 1097911063",
    shelleyGenesisPath: shelleyGenesisPath,
    socketPath: '/home/kott/cardano/cardano-node/state-node-testnet/node.socket'
});

exports.transaction = function(sender, receiver, amount) {

    // create raw transaction
    let txInfo = {
      txIn: cardanocliJs.queryUtxo(sender.paymentAddr),
      txOut: [
        {
          address: sender.paymentAddr,
          amount: {
            lovelace: sender.balance().amount.lovelace - amount
          }
        },
        { address: receiver, amount: { lovelace: amount } }
      ]
    };
    console.log(txInfo);
    let raw = cardanocliJs.transactionBuildRaw(txInfo);

    //calculate fee
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
      signingKeys: [sender.payment.skey],
    });

    //broadcast transaction
    let txHash = cardanocliJs.transactionSubmit(txSigned);

    return txHash;
}

exports.createTransaction = (tx) => {
  let raw = cardanocliJs.transactionBuildRaw(tx);
  let fee = cardanocliJs.transactionCalculateMinFee({
    ...tx,
    txBody: raw
  });
  tx.txOut[0].amount.lovelace -= fee;
  return cardanocliJs.transactionBuildRaw({ ...tx, fee });
};

exports.signTransaction = (wallet, tx, script) => {
  return cardanocliJs.transactionSign({
    signingKeys: [wallet.payment.skey, wallet.payment.skey],
    scriptFile: script,
    txBody: tx,
  });
};
