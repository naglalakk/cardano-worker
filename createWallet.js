const CardanoCli = require("cardanocli-js");
require('dotenv').config()

const cardanocliJs = new CardanoCli({ 
    network: process.env.NETWORK,
    shelleyGenesisPath: process.env.SHELLEY_GENESIS_PATH,
    socketPath: process.env.CARDANO_NODE_SOCKET_PATH
});

const createWallet = (account) => {
  const payment = cardanocliJs.addressKeyGen(account);
  const stake = cardanocliJs.stakeAddressKeyGen(account);
  cardanocliJs.stakeAddressBuild(account);
  cardanocliJs.addressBuild(account, {
    paymentVkey: payment.vkey,
    stakeVkey: stake.vkey,
  });
  return cardanocliJs.wallet(account);
};

const createPool = (name) => {
  cardanocliJs.nodeKeyGenKES(name);
  cardanocliJs.nodeKeyGen(name);
  cardanocliJs.nodeIssueOpCert(name);
  cardanocliJs.nodeKeyGenVRF(name);
  return cardanocliJs.pool(name);
};

const sender  = createWallet("TestSender");
const receiver = createWallet("TestReceiver");

console.log(sender.paymentAddr);
console.log(receiver.paymentAddr);
