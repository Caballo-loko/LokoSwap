# LokoSwap

A decentralized exchange (DEX) built for the Solana network. LokoSwap provides automated market making (AMM) functionality with constant product curves, allowing users to swap tokens, provide liquidity, and earn fees with Token 2022 transfer hooks and extensions.

## Features

- **Token Swapping**: Exchange tokens using automated market making 
- **Liquidity Provision**: Add liquidity to pools and earn LP tokens
- **Pool Management**: Create new trading pairs and manage existing pools
- **Security Controls**: Pool creators can lock/unlock pools for emergency situations
- **Slippage Protection**: Built-in slippage controls for safe trading

## Built With

- **Anchor Framework**: Solana program development framework
- **Rust**: Smart contract programming language
- **TypeScript**: Testing and client integration
- **Constant Product Curve**: Mathematical model for automated market making

## Getting Started

### Prerequisites

- Rust 1.88+
- Solana CLI 2.2+
- Anchor CLI 0.31+
- Node.js 18+
- Npm

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd LokoSwap
```

2. Install dependencies
```bash
npm install
```

3. Build the program
```bash
anchor build
```

4. Run tests
```bash
anchor test
```

## Usage

### Creating a Pool

Initialize a new liquidity pool with two tokens:

```typescript
await program.methods
  .initialize(seed, fee, authority)
  .accounts({
    admin: admin.publicKey,
    mintX: tokenA,
    mintY: tokenB,
    // ... other accounts
  })
  .rpc();
```

### Adding Liquidity

Provide liquidity to earn fees:

```typescript
await program.methods
  .deposit(lpAmount, maxTokenA, maxTokenB)
  .accounts({
    user: user.publicKey,
    // ... other accounts
  })
  .rpc();
```

### Swapping Tokens

Exchange one token for another:

```typescript
await program.methods
  .swap(amount, isTokenA, minimumOut)
  .accounts({
    user: user.publicKey,
    // ... other accounts
  })
  .rpc();
```

## Security

- Pool creators have exclusive authority to lock/unlock their pools
- Slippage protection prevents unfavorable trades
- All operations include proper authorization checks




## Acknowledgements

- [Solana](https://solana.com/)
- [Anchor Framework](https://book.anchor-lang.com/)
- [@solana/spl-token](https://spl.solana.com/token)

---


