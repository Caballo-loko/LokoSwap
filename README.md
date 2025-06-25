# amm-dex

> **Automated Market Maker (AMM) Decentralized Exchange written in Rust and TypeScript (Anchor Framework)**

---

## Overview

This repository implements an Automated Market Maker (AMM) Decentralized Exchange (DEX) using the [Anchor](https://book.anchor-lang.com/) framework for Solana smart contracts. The project is primarily written in Rust (on-chain program) and TypeScript (off-chain client and test suite).

The AMM DEX allows users to:
- Create and manage liquidity pools
- Trade between token pairs with no order book
- Provide and withdraw liquidity
- Mint and redeem LP (liquidity provider) tokens

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

---

## Tech Stack

- **Rust**: On-chain Solana program (smart contract)
- **TypeScript**: Off-chain client, test scripts, interaction layer
- **Anchor**: Solana smart contract framework
- **Solana Web3.js**: Blockchain interaction
- **@solana/spl-token**: Token utilities

---

## Project Structure

```
amm-dex/
├── programs/amm_dex/      # Rust source code for the on-chain program
│   └── src/
├── tests/                # TypeScript test scripts (via Anchor)
│   └── amm_dex.ts
├── migrations/           # Anchor migrations
├── Anchor.toml           # Anchor configuration
├── package.json          # Node.js project config
├── tsconfig.json         # TypeScript config
├── README.md             # Project documentation
└── ...                   # Additional files and folders
```

---

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/)
- [Yarn](https://yarnpkg.com/)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor CLI](https://book.anchor-lang.com/chapter_2/installation.html)

### Installation

1. **Clone the repository**
   ```sh
   git clone https://github.com/raunit-dev/amm-dex.git
   cd amm-dex
   ```

2. **Install dependencies**
   ```sh
   yarn install
   ```

3. **Build the program**
   ```sh
   anchor build
   ```

4. **Deploy to localnet**
   ```sh
   anchor localnet
   anchor deploy
   ```

---

## Testing

Automated testing is implemented using TypeScript and Mocha. The test suite can be found in the `tests/` directory, primarily in `tests/amm_dex.ts`. Tests cover various aspects of initialization, pool creation, token minting, trading, and liquidity provision.

**To run the tests:**
```sh
anchor test
# or (as defined in Anchor.toml)
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

> **Status:**  
> Testing is implemented and available. Additional tests and coverage improvements may be added in future updates.

---

## Contributing

Contributions are welcome! Please open issues or pull requests for suggestions, bugs, or improvements.

1. Fork the repository
2. Create a new branch
3. Commit your changes
4. Open a pull request

---

## License

No license has been specified for this project. Please contact the repository owner for details on usage and licensing.

---

## Acknowledgements

- [Solana](https://solana.com/)
- [Anchor Framework](https://book.anchor-lang.com/)
- [@solana/spl-token](https://spl.solana.com/token)

---

> *This README was generated based on repository code and configuration. [View more details and the full codebase on GitHub.](https://github.com/raunit-dev/amm-dex)*
