import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LokoSwap } from "../target/types/loko_swap";
import { randomBytes } from "crypto";
import { BN } from "bn.js";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { expect } from "chai";

describe("LokoSwap Simple Token-2022 Test", function () {
  this.timeout(60000);
  
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const connection = provider.connection;
  const program = anchor.workspace.LokoSwap as Program<LokoSwap>;

  // Test constants
  const seed = new BN(randomBytes(8));
  const fee = 25; // 0.25% AMM fee
  const transferFeeBasisPoints = 100; // 1% transfer fee
  const maxTransferFee = new BN(1000000); // 1 token max transfer fee

  // Test accounts
  let admin: Keypair;
  let user: Keypair;
  let mintX: PublicKey;
  let mintY: PublicKey;
  let config: PublicKey;
  let mintLp: PublicKey;
  let vaultX: PublicKey;
  let vaultY: PublicKey;
  let userX: PublicKey;
  let userY: PublicKey;
  let userLp: PublicKey;

  const confirm = async (signature: string): Promise<string> => {
    const block = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      ...block,
    });
    return signature;
  };

  const log = async (signature: string): Promise<string> => {
    console.log(`Transaction: https://explorer.solana.com/transaction/${signature}?cluster=devnet`);
    return signature;
  };

  // Helper to get token account balance
  const getTokenBalance = async (tokenAccount: PublicKey, tokenProgram: PublicKey): Promise<number> => {
    try {
      const account = await getAccount(connection, tokenAccount, undefined, tokenProgram);
      return Number(account.amount);
    } catch (error) {
      console.warn(`Failed to get balance for ${tokenAccount.toString()}:`, error);
      return 0;
    }
  };

  before(async function () {
    this.timeout(30000);
    try {
      // Setup accounts
      admin = Keypair.generate();
      user = Keypair.generate();

      // Check provider balance
      const providerBalance = await connection.getBalance(provider.publicKey);
      console.log(`Provider balance: ${providerBalance / LAMPORTS_PER_SOL} SOL`);
      
      if (providerBalance < 0.2 * LAMPORTS_PER_SOL) {
        throw new Error("Insufficient SOL in provider account. Please fund the test wallet on devnet.");
      }

      // Fund accounts
      const fundingTx = new Transaction()
        .add(SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          toPubkey: admin.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        }))
        .add(SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          toPubkey: user.publicKey,
          lamports: 0.05 * LAMPORTS_PER_SOL,
        }));

      await provider.sendAndConfirm(fundingTx);
      console.log("Test accounts funded successfully");

      // Create simple Token-2022 mints (no extensions for now)
      mintX = await createMint(
        connection,
        admin,
        admin.publicKey,
        null,
        6,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      mintY = await createMint(
        connection,
        admin,
        admin.publicKey,
        null,
        6,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      console.log("Created Token-2022 mints:", { mintX: mintX.toString(), mintY: mintY.toString() });

      // Derive PDAs
      config = PublicKey.findProgramAddressSync([
        Buffer.from("config"),
        seed.toArrayLike(Buffer, "be", 8)
      ], program.programId)[0];
      
      mintLp = PublicKey.findProgramAddressSync([
        Buffer.from("lp"),
        config.toBuffer()
      ], program.programId)[0];

      vaultX = getAssociatedTokenAddressSync(mintX, config, true, TOKEN_2022_PROGRAM_ID);
      vaultY = getAssociatedTokenAddressSync(mintY, config, true, TOKEN_2022_PROGRAM_ID);

      // Create user token accounts
      userX = (await getOrCreateAssociatedTokenAccount(
        connection, 
        user, 
        mintX, 
        user.publicKey, 
        undefined, 
        undefined, 
        undefined, 
        TOKEN_2022_PROGRAM_ID
      )).address;

      userY = (await getOrCreateAssociatedTokenAccount(
        connection, 
        user, 
        mintY, 
        user.publicKey, 
        undefined, 
        undefined, 
        undefined, 
        TOKEN_2022_PROGRAM_ID
      )).address;

      // Mint initial tokens to user
      const initialMintAmount = 1000000000; // 1000 tokens
      await mintTo(connection, admin, mintX, userX, admin.publicKey, initialMintAmount, [], undefined, TOKEN_2022_PROGRAM_ID);
      await mintTo(connection, admin, mintY, userY, admin.publicKey, initialMintAmount, [], undefined, TOKEN_2022_PROGRAM_ID);

      console.log("User token accounts created and funded");
    } catch (e) {
      console.error("Setup error:", e);
      throw e;
    }
  });

  it("initializes the pool with Token-2022 mints", async () => {
    try {
      const tx = await program.methods
        .initialize(
          seed, 
          fee, 
          admin.publicKey,
          transferFeeBasisPoints,
          maxTransferFee,
          null
        )
        .accountsStrict({
          admin: admin.publicKey,
          mintX: mintX,
          mintY: mintY,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      await confirm(tx);
      await log(tx);

      // Vault token accounts are automatically created by the initialize instruction
      console.log("Vault token accounts created by initialize instruction");

      // Verify config account
      const configAccount = await program.account.config.fetch(config);
      expect(configAccount.mintX.toString()).to.equal(mintX.toString());
      expect(configAccount.mintY.toString()).to.equal(mintY.toString());
      expect(configAccount.fee).to.equal(fee);
      
      console.log("Pool initialized successfully");
    } catch (error) {
      console.error("Initialization error:", error);
      throw error;
    }
  });

  it("deposits liquidity", async () => {
    // Derive user LP token account address (will be created by deposit instruction)
    userLp = getAssociatedTokenAddressSync(
      mintLp,
      user.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("User LP token account address derived:", userLp.toString());

    try {
      const depositAmount = new BN(10000000); // 10 tokens worth of LP
      const maxX = new BN(20000000); // 20 tokens max
      const maxY = new BN(10000000); // 10 tokens max

      // Get balances before
      const userXBalanceBefore = await getTokenBalance(userX, TOKEN_2022_PROGRAM_ID);
      const userYBalanceBefore = await getTokenBalance(userY, TOKEN_2022_PROGRAM_ID);
      const userLpBalanceBefore = await getTokenBalance(userLp, TOKEN_2022_PROGRAM_ID);

      console.log("Balances before deposit:", {
        userX: userXBalanceBefore,
        userY: userYBalanceBefore,
        userLp: userLpBalanceBefore
      });

      console.log("Account addresses:", {
        mintX: mintX.toString(),
        mintY: mintY.toString(),
        userX: userX.toString(),
        userY: userY.toString(),
        vaultX: vaultX.toString(),
        vaultY: vaultY.toString(),
        config: config.toString(),
        mintLp: mintLp.toString(),
        userLp: userLp.toString()
      });

      const tx = await program.methods
        .deposit(depositAmount, maxX, maxY)
        .accountsStrict({
          user: user.publicKey,
          mintX: mintX,
          mintY: mintY,
          userX: userX,
          userY: userY,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          mintLp: mintLp,
          userLp: userLp,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      await confirm(tx);
      await log(tx);

      // Get balances after
      const userXBalanceAfter = await getTokenBalance(userX, TOKEN_2022_PROGRAM_ID);
      const userYBalanceAfter = await getTokenBalance(userY, TOKEN_2022_PROGRAM_ID);
      const userLpBalanceAfter = await getTokenBalance(userLp, TOKEN_2022_PROGRAM_ID);

      console.log("Balances after deposit:", {
        userX: userXBalanceAfter,
        userY: userYBalanceAfter,
        userLp: userLpBalanceAfter
      });

      // Validate deposit worked
      expect(userLpBalanceAfter).to.be.greaterThan(userLpBalanceBefore);
      expect(userXBalanceAfter).to.be.lessThan(userXBalanceBefore);
      expect(userYBalanceAfter).to.be.lessThan(userYBalanceBefore);

      console.log("Deposit completed successfully");
    } catch (error) {
      console.error("Deposit error:", error);
      throw error;
    }
  });

  it("performs swap", async () => {
    try {
      const swapAmount = new BN(5000000); // 5 tokens
      const minOut = new BN(0); // Accept any amount out
      
      // Get balances before
      const userXBalanceBefore = await getTokenBalance(userX, TOKEN_2022_PROGRAM_ID);
      const userYBalanceBefore = await getTokenBalance(userY, TOKEN_2022_PROGRAM_ID);

      console.log("Balances before swap:", {
        userX: userXBalanceBefore,
        userY: userYBalanceBefore
      });

      const tx = await program.methods
        .swap(swapAmount, true, minOut)
        .accountsStrict({
          user: user.publicKey,
          mintX: mintX,
          mintY: mintY,
          userX: userX,
          userY: userY,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          mintLp: mintLp,
          userLp: userLp,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      await confirm(tx);
      await log(tx);

      // Get balances after
      const userXBalanceAfter = await getTokenBalance(userX, TOKEN_2022_PROGRAM_ID);
      const userYBalanceAfter = await getTokenBalance(userY, TOKEN_2022_PROGRAM_ID);

      console.log("Balances after swap:", {
        userX: userXBalanceAfter,
        userY: userYBalanceAfter
      });

      // Validate swap worked
      expect(userXBalanceAfter).to.be.lessThan(userXBalanceBefore);
      expect(userYBalanceAfter).to.be.greaterThan(userYBalanceBefore);

      console.log("Swap completed successfully");
    } catch (error) {
      console.error("Swap error:", error);
      throw error;
    }
  });

  it("withdraws liquidity", async () => {
    try {
      const userLpBalance = await getTokenBalance(userLp, TOKEN_2022_PROGRAM_ID);
      const withdrawAmount = new BN(Math.floor(userLpBalance / 2)); // Withdraw half
      const minX = new BN(1);
      const minY = new BN(1);

      // Get balances before
      const userXBalanceBefore = await getTokenBalance(userX, TOKEN_2022_PROGRAM_ID);
      const userYBalanceBefore = await getTokenBalance(userY, TOKEN_2022_PROGRAM_ID);
      const userLpBalanceBefore = await getTokenBalance(userLp, TOKEN_2022_PROGRAM_ID);

      console.log("Balances before withdraw:", {
        userX: userXBalanceBefore,
        userY: userYBalanceBefore,
        userLp: userLpBalanceBefore
      });

      const tx = await program.methods
        .withdraw(withdrawAmount, minX, minY)
        .accountsStrict({
          user: user.publicKey,
          mintX: mintX,
          mintY: mintY,
          userX: userX,
          userY: userY,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          mintLp: mintLp,
          userLp: userLp,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      await confirm(tx);
      await log(tx);

      // Get balances after
      const userXBalanceAfter = await getTokenBalance(userX, TOKEN_2022_PROGRAM_ID);
      const userYBalanceAfter = await getTokenBalance(userY, TOKEN_2022_PROGRAM_ID);
      const userLpBalanceAfter = await getTokenBalance(userLp, TOKEN_2022_PROGRAM_ID);

      console.log("Balances after withdraw:", {
        userX: userXBalanceAfter,
        userY: userYBalanceAfter,
        userLp: userLpBalanceAfter
      });

      // Validate withdrawal worked
      expect(userLpBalanceAfter).to.be.lessThan(userLpBalanceBefore);
      expect(userXBalanceAfter).to.be.greaterThan(userXBalanceBefore);
      expect(userYBalanceAfter).to.be.greaterThan(userYBalanceBefore);

      console.log("Withdrawal completed successfully");
    } catch (error) {
      console.error("Withdrawal error:", error);
      throw error;
    }
  });

  it("locks and unlocks the pool", async () => {
    try {
      // Lock the pool
      const lockTx = await program.methods
        .lock()
        .accountsStrict({
          user: admin.publicKey,
          config: config,
        })
        .signers([admin])
        .rpc();

      await confirm(lockTx);
      await log(lockTx);

      // Verify pool is locked
      let configAccount = await program.account.config.fetch(config);
      expect(configAccount.locked).to.be.true;
      console.log("Pool locked successfully");

      // Unlock the pool
      const unlockTx = await program.methods
        .unlock()
        .accountsStrict({
          user: admin.publicKey,
          config: config,
        })
        .signers([admin])
        .rpc();

      await confirm(unlockTx);
      await log(unlockTx);

      // Verify pool is unlocked
      configAccount = await program.account.config.fetch(config);
      expect(configAccount.locked).to.be.false;
      console.log("Pool unlocked successfully");
    } catch (error) {
      console.error("Lock/unlock error:", error);
      throw error;
    }
  });
});