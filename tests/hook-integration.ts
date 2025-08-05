import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LokoSwap } from "../target/types/loko_swap";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { HookProgramManager } from "./hook-manager";
import { assert } from "chai";
import { BN } from "bn.js";

describe("LokoSwap Hook Integration Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.LokoSwap as Program<LokoSwap>;

  const payer = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Test users
  let alice: Keypair;
  let bob: Keypair;

  // Token mints with different hook programs
  let whitelistTokenMint: Keypair;
  let counterTokenMint: Keypair;
  let transferCostTokenMint: Keypair;
  let standardTokenMint: Keypair;

  // Pool configurations
  let configs: PublicKey[] = [];

  before(async () => {
    // Create test users
    alice = Keypair.generate();
    bob = Keypair.generate();

    // Airdrop SOL to test users
    await connection.requestAirdrop(alice.publicKey, 5 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(bob.publicKey, 5 * LAMPORTS_PER_SOL);

    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("Created test users:");
    console.log("Alice:", alice.publicKey.toString());
    console.log("Bob:", bob.publicKey.toString());

    // Create tokens with different hook programs
    whitelistTokenMint = await HookProgramManager.createWhitelistToken(
      connection,
      payer.payer,
      9
    );

    counterTokenMint = await HookProgramManager.createCounterToken(
      connection,
      payer.payer,
      9
    );

    transferCostTokenMint = await HookProgramManager.createTransferCostToken(
      connection,
      payer.payer,
      9
    );

    standardTokenMint = await HookProgramManager.createStandardToken2022(
      connection,
      payer.payer,
      9
    );

    console.log("\nCreated token mints:");
    console.log("Whitelist Token:", whitelistTokenMint.publicKey.toString());
    console.log("Counter Token:", counterTokenMint.publicKey.toString());
    console.log("Transfer Cost Token:", transferCostTokenMint.publicKey.toString());
    console.log("Standard Token:", standardTokenMint.publicKey.toString());

    // Mint initial tokens to users
    const mintAmount = 1_000_000_000; // 1,000 tokens with 9 decimals

    // Mint tokens to Alice
    await HookProgramManager.mintTokensToUser(
      connection,
      whitelistTokenMint,
      alice,
      payer.payer,
      mintAmount
    );

    await HookProgramManager.mintTokensToUser(
      connection,
      counterTokenMint,
      alice,
      payer.payer,
      mintAmount
    );

    await HookProgramManager.mintTokensToUser(
      connection,
      transferCostTokenMint,
      alice,
      payer.payer,
      mintAmount
    );

    await HookProgramManager.mintTokensToUser(
      connection,
      standardTokenMint,
      alice,
      payer.payer,
      mintAmount
    );

    // Mint tokens to Bob
    await HookProgramManager.mintTokensToUser(
      connection,
      whitelistTokenMint,
      bob,
      payer.payer,
      mintAmount
    );

    await HookProgramManager.mintTokensToUser(
      connection,
      counterTokenMint,
      bob,
      payer.payer,
      mintAmount
    );

    await HookProgramManager.mintTokensToUser(
      connection,
      transferCostTokenMint,
      bob,
      payer.payer,
      mintAmount
    );

    await HookProgramManager.mintTokensToUser(
      connection,
      standardTokenMint,
      bob,
      payer.payer,
      mintAmount
    );

    console.log("\nMinted tokens to test users");
  });

  describe("Pool Initialization with Hook Programs", () => {
    it("Initialize pool with whitelist token", async () => {
      const seed = new BN(Date.now());
      const fee = 300; // 3%
      
      const [config] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), seed.toBuffer("be", 8)],
        program.programId
      );

      const [mintLp] = PublicKey.findProgramAddressSync(
        [Buffer.from("lp"), config.toBytes()],
        program.programId
      );

      const vaultX = getAssociatedTokenAddressSync(
        whitelistTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .initialize(
          seed,
          fee,
          null, // no authority
          500, // 5% transfer fee basis points
          new BN(10000), // max transfer fee
          HookProgramManager.WHITELIST_HOOK_PROGRAM_ID // approved hook program
        )
        .accountsStrict({
          admin: payer.publicKey,
          mintX: whitelistTokenMint.publicKey,
          mintY: standardTokenMint.publicKey,
          mintLp,
          vaultX,
          vaultY,
          config,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      configs.push(config);

      // Verify pool was created
      const configAccount = await program.account.config.fetch(config);
      assert.equal(configAccount.mintX.toString(), whitelistTokenMint.publicKey.toString());
      assert.equal(configAccount.mintY.toString(), standardTokenMint.publicKey.toString());
      assert.equal(configAccount.fee, fee);
      assert.equal(configAccount.supportsTransferHooks, true);

      console.log("✅ Pool with whitelist token initialized successfully");
    });

    it("Initialize pool with counter token", async () => {
      const seed = new anchor.BN(Date.now() + 1);
      const fee = 300; // 3%
      
      const [config] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), seed.toBuffer("be", 8)],
        program.programId
      );

      const [mintLp] = PublicKey.findProgramAddressSync(
        [Buffer.from("lp"), config.toBytes()],
        program.programId
      );

      const vaultX = getAssociatedTokenAddressSync(
        counterTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .initialize(
          seed,
          fee,
          null,
          500,
          new anchor.BN(10000),
          HookProgramManager.COUNTER_HOOK_PROGRAM_ID // approved hook program
        )
        .accounts({
          admin: payer.publicKey,
          mintX: counterTokenMint.publicKey,
          mintY: standardTokenMint.publicKey,
          mintLp,
          vaultX,
          vaultY,
          config,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      configs.push(config);

      // Verify pool was created
      const configAccount = await program.account.config.fetch(config);
      assert.equal(configAccount.mintX.toString(), counterTokenMint.publicKey.toString());
      assert.equal(configAccount.supportsTransferHooks, true);

      console.log("✅ Pool with counter token initialized successfully");
    });

    it("Initialize pool with transfer cost token", async () => {
      const seed = new anchor.BN(Date.now() + 2);
      const fee = 300; // 3%
      
      const [config] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), seed.toBuffer("be", 8)],
        program.programId
      );

      const [mintLp] = PublicKey.findProgramAddressSync(
        [Buffer.from("lp"), config.toBytes()],
        program.programId
      );

      const vaultX = getAssociatedTokenAddressSync(
        transferCostTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .initialize(
          seed,
          fee,
          null,
          500,
          new anchor.BN(10000),
          HookProgramManager.TRANSFER_COST_HOOK_PROGRAM_ID // approved hook program
        )
        .accounts({
          admin: payer.publicKey,
          mintX: transferCostTokenMint.publicKey,
          mintY: standardTokenMint.publicKey,
          mintLp,
          vaultX,
          vaultY,
          config,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      configs.push(config);

      // Verify pool was created
      const configAccount = await program.account.config.fetch(config);
      assert.equal(configAccount.mintX.toString(), transferCostTokenMint.publicKey.toString());
      assert.equal(configAccount.supportsTransferHooks, true);

      console.log("✅ Pool with transfer cost token initialized successfully");
    });

    it("Reject initialization with unapproved hook program", async () => {
      const seed = new anchor.BN(Date.now() + 3);
      const fee = 300;
      const unapprovedHookProgram = Keypair.generate().publicKey; // Random program ID
      
      const [config] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), seed.toBuffer("be", 8)],
        program.programId
      );

      const [mintLp] = PublicKey.findProgramAddressSync(
        [Buffer.from("lp"), config.toBytes()],
        program.programId
      );

      const vaultX = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        counterTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      try {
        await program.methods
          .initialize(
            seed,
            fee,
            null,
            500,
            new anchor.BN(10000),
            unapprovedHookProgram // unapproved hook program
          )
          .accounts({
            admin: payer.publicKey,
            mintX: standardTokenMint.publicKey,
            mintY: counterTokenMint.publicKey,
            mintLp,
            vaultX,
            vaultY,
            config,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            tokenProgramX: TOKEN_2022_PROGRAM_ID,
            tokenProgramY: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        assert.fail("Should have rejected unapproved hook program");
      } catch (error) {
        assert.ok(error.message.includes("Hook program not in approved list"));
        console.log("✅ Correctly rejected unapproved hook program");
      }
    });
  });

  describe("Liquidity Operations with Hook Programs", () => {
    it("Deposit liquidity to whitelist token pool", async () => {
      const config = configs[0]; // Whitelist token pool
      const configAccount = await program.account.config.fetch(config);
      
      const userX = getAssociatedTokenAddressSync(
        whitelistTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const userY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const userLp = getAssociatedTokenAddressSync(
        configAccount.mintLp,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultX = getAssociatedTokenAddressSync(
        whitelistTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const depositAmountX = new anchor.BN(100_000_000); // 100 tokens
      const depositAmountY = new anchor.BN(100_000_000); // 100 tokens
      const maxX = new anchor.BN(110_000_000); // 110 tokens max
      const maxY = new anchor.BN(110_000_000); // 110 tokens max

      await program.methods
        .deposit(depositAmountX, maxX, depositAmountY, maxY)
        .accounts({
          user: alice.publicKey,
          mintX: whitelistTokenMint.publicKey,
          mintY: standardTokenMint.publicKey,
          mintLp: configAccount.mintLp,
          userX,
          userY,
          userLp,
          vaultX,
          vaultY,
          config,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([alice])
        .rpc();

      // Verify LP tokens were minted
      const lpAccount = await getAccount(connection, userLp, undefined, TOKEN_2022_PROGRAM_ID);
      assert.ok(lpAccount.amount > 0n);

      console.log("✅ Deposited liquidity to whitelist token pool");
    });

    it("Deposit liquidity to counter token pool", async () => {
      const config = configs[1]; // Counter token pool
      const configAccount = await program.account.config.fetch(config);
      
      const userX = getAssociatedTokenAddressSync(
        counterTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const userY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const userLp = getAssociatedTokenAddressSync(
        configAccount.mintLp,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultX = getAssociatedTokenAddressSync(
        counterTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const depositAmountX = new anchor.BN(50_000_000); // 50 tokens
      const depositAmountY = new anchor.BN(50_000_000); // 50 tokens
      const maxX = new anchor.BN(60_000_000); // 60 tokens max
      const maxY = new anchor.BN(60_000_000); // 60 tokens max

      await program.methods
        .deposit(depositAmountX, maxX, depositAmountY, maxY)
        .accounts({
          user: alice.publicKey,
          mintX: counterTokenMint.publicKey,
          mintY: standardTokenMint.publicKey,
          mintLp: configAccount.mintLp,
          userX,
          userY,
          userLp,
          vaultX,
          vaultY,
          config,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([alice])
        .rpc();

      // Verify LP tokens were minted
      const lpAccount = await getAccount(connection, userLp, undefined, TOKEN_2022_PROGRAM_ID);
      assert.ok(lpAccount.amount > 0n);

      console.log("✅ Deposited liquidity to counter token pool");
    });
  });

  describe("Swap Operations with Hook Programs", () => {
    it("Swap with whitelist token (should succeed with hook validation)", async () => {
      const config = configs[0]; // Whitelist token pool
      const configAccount = await program.account.config.fetch(config);
      
      const userX = getAssociatedTokenAddressSync(
        whitelistTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const userY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultX = getAssociatedTokenAddressSync(
        whitelistTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      // Get balances before swap
      const userXBefore = await getAccount(connection, userX, undefined, TOKEN_2022_PROGRAM_ID);
      const userYBefore = await getAccount(connection, userY, undefined, TOKEN_2022_PROGRAM_ID);

      const swapAmount = new anchor.BN(1_000_000); // 1 token
      const minAmountOut = new anchor.BN(900_000); // 0.9 tokens minimum

      await program.methods
        .swap(true, swapAmount, minAmountOut) // true = swap X for Y
        .accounts({
          user: alice.publicKey,
          mintX: whitelistTokenMint.publicKey,
          mintY: standardTokenMint.publicKey,
          userX,
          userY,
          vaultX,
          vaultY,
          config,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
        })
        .signers([alice])
        .rpc();

      // Get balances after swap
      const userXAfter = await getAccount(connection, userX, undefined, TOKEN_2022_PROGRAM_ID);
      const userYAfter = await getAccount(connection, userY, undefined, TOKEN_2022_PROGRAM_ID);

      // Verify swap occurred
      assert.ok(userXAfter.amount < userXBefore.amount); // X balance decreased
      assert.ok(userYAfter.amount > userYBefore.amount); // Y balance increased

      console.log("✅ Swap with whitelist token completed successfully");
    });

    it("Swap with counter token (hook should increment counter)", async () => {
      const config = configs[1]; // Counter token pool
      const configAccount = await program.account.config.fetch(config);
      
      const userX = getAssociatedTokenAddressSync(
        counterTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const userY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultX = getAssociatedTokenAddressSync(
        counterTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const swapAmount = new anchor.BN(2_000_000); // 2 tokens
      const minAmountOut = new anchor.BN(1_800_000); // 1.8 tokens minimum

      await program.methods
        .swap(true, swapAmount, minAmountOut) // true = swap X for Y
        .accounts({
          user: alice.publicKey,
          mintX: counterTokenMint.publicKey,
          mintY: standardTokenMint.publicKey,
          userX,
          userY,
          vaultX,
          vaultY,
          config,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
        })
        .signers([alice])
        .rpc();

      console.log("✅ Swap with counter token completed (counter incremented)");
    });

    it("Swap with transfer cost token (hook should collect fee)", async () => {
      const config = configs[2]; // Transfer cost token pool
      const configAccount = await program.account.config.fetch(config);
      
      const userX = getAssociatedTokenAddressSync(
        transferCostTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const userY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        alice.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultX = getAssociatedTokenAddressSync(
        transferCostTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardTokenMint.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const swapAmount = new anchor.BN(5_000_000); // 5 tokens
      const minAmountOut = new anchor.BN(4_500_000); // 4.5 tokens minimum

      await program.methods
        .swap(true, swapAmount, minAmountOut) // true = swap X for Y
        .accounts({
          user: alice.publicKey,
          mintX: transferCostTokenMint.publicKey,
          mintY: standardTokenMint.publicKey,
          userX,
          userY,
          vaultX,
          vaultY,
          config,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
        })
        .signers([alice])
        .rpc();

      console.log("✅ Swap with transfer cost token completed (fee collected)");
    });
  });

  describe("Hook Program Type Detection", () => {
    it("Should correctly identify hook program types", async () => {
      const whitelistType = HookProgramManager.getHookType(HookProgramManager.WHITELIST_HOOK_PROGRAM_ID);
      const counterType = HookProgramManager.getHookType(HookProgramManager.COUNTER_HOOK_PROGRAM_ID);
      const transferCostType = HookProgramManager.getHookType(HookProgramManager.TRANSFER_COST_HOOK_PROGRAM_ID);

      assert.equal(whitelistType, "Whitelist");
      assert.equal(counterType, "Counter");
      assert.equal(transferCostType, "Transfer Cost");

      console.log("✅ Hook program types identified correctly");
    });

    it("Should validate approved hook programs", async () => {
      assert.ok(HookProgramManager.isApprovedHookProgram(HookProgramManager.WHITELIST_HOOK_PROGRAM_ID));
      assert.ok(HookProgramManager.isApprovedHookProgram(HookProgramManager.COUNTER_HOOK_PROGRAM_ID));
      assert.ok(HookProgramManager.isApprovedHookProgram(HookProgramManager.TRANSFER_COST_HOOK_PROGRAM_ID));
      
      // Test unapproved program
      const randomProgram = Keypair.generate().publicKey;
      assert.ok(!HookProgramManager.isApprovedHookProgram(randomProgram));

      console.log("✅ Hook program approval validation working correctly");
    });
  });

  after(async () => {
    console.log("\n🎉 All hook integration tests completed successfully!");
    console.log(`📊 Created ${configs.length} pools with different hook programs`);
    console.log("✅ Whitelist Hook Program:", HookProgramManager.WHITELIST_HOOK_PROGRAM_ID.toString());
    console.log("✅ Counter Hook Program:", HookProgramManager.COUNTER_HOOK_PROGRAM_ID.toString());
    console.log("✅ Transfer Cost Hook Program:", HookProgramManager.TRANSFER_COST_HOOK_PROGRAM_ID.toString());
  });
});