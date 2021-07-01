cardano-worker
===

Cardano nodejs worker to monitor UTxO for a wallet and detect requests 

### Installation

    yarn install

### Running

Run worker
    
    node worker.js work

Query UTxO for a specific wallet
    
    node worker.js query --wallet TestWallet


This worker uses the Token API of
[landscape-service](https://github.com/naglalakk/landscape-service) and
[blockfrost.io](https://blockfrost.io) for transaction info


