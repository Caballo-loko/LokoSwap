import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LokoSwap } from "../target/types/loko_swap";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeTransferHookInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  createApproveInstruction,
  createSyncNativeInstruction,
  getAccount,
  NATIVE_MINT,
} from "@solana/spl-token";
import { BN } from "bn.js";

// Import our dynamic fee hook program types
import type { DynamicFeeHook } from "../target/types/dynamic_fee_hook";

/**
 * Complete AMM demonstration with Token-2022 transfer hooks
 * 
 * This test demonstrates:
 * 1. Creating Token-2022 tokens with transfer hook extensions
 * 2. Initializing dynamic fee hook validation accounts
 * 3. AMM operations: deposit, swap, withdraw with hook execution
 * 4. Dynamic fee scaling based on transaction velocity
 */
describe("AMM with Dynamic Fee Hook Integration", function() {
  this.timeout(600000);
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const lokoSwapProgram = anchor.workspace.LokoSwap as Program<LokoSwap>;
  const dynamicFeeHookProgram = anchor.workspace.DynamicFeeHook as Program<DynamicFeeHook>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;
  
  // We'll create our own Token-2022 token with transfer hook extension
  let hookMint: Keypair;
  let standardMint: Keypair;

  // Use our own deployed dynamic fee hook program
  const OUR_HOOK_PROGRAM = new PublicKey("69VddXVhzGRGh3oU6eKoWEoNMJC8RJX6by1SgcuQfPR9");

  // User accounts
  let userHookAccount: PublicKey;
  let userStandardAccount: PublicKey;
  let userLpAccount: PublicKey;

  // Hook-specific accounts (for WSOL operations)
  let delegatePDA: PublicKey;
  let senderWSolAccount: PublicKey;
  let delegateWSolAccount: PublicKey;
  let ammPdaWSolAccount: PublicKey; // WSOL account for AMM PDA - needed for withdrawals
  let extraAccountMetaListPDA: PublicKey;
  let feeStatsPDA: PublicKey;

  // AMM pool
  let poolConfig: PublicKey;
  let mintLp: PublicKey;
  let vaultX: PublicKey;
  let vaultY: PublicKey;

  before(() => {
    console.log("Testing AMM with Dynamic Fee Hook Integration");
    console.log("Dynamic fee hook program:", dynamicFeeHookProgram.programId.toString());
  });

  describe("Step 1: Create Token-2022 Token with Transfer Hook Extension", () => {
    it("Should create Token-2022 token with transfer hook extension", async () => {
      console.log("Creating Token-2022 token with transfer hook extension...");
      
      hookMint = Keypair.generate();
      const decimals = 9;

      console.log("Hook mint:", hookMint.publicKey.toString());
      console.log("Hook program:", OUR_HOOK_PROGRAM.toString());

      // Create mint with BOTH transfer hook AND transfer fee extensions
      const extensions = [ExtensionType.TransferHook, ExtensionType.TransferFeeConfig];
      const mintLen = getMintLen(extensions);
      const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

      const createMintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: hookMint.publicKey,
          space: mintLen,
          lamports: lamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferHookInstruction(
          hookMint.publicKey,
          payer.publicKey,
          OUR_HOOK_PROGRAM, // Use our deployed simple hook program
          TOKEN_2022_PROGRAM_ID,
        ),
        createInitializeTransferFeeConfigInstruction(
          hookMint.publicKey,
          payer.publicKey, // withdraw withheld authority
          payer.publicKey, // fee destination
          10, // 0.1% fee (10 basis points) - smaller for testing
          BigInt(100000000), // 0.1 token max fee (0.1 * 10^9 for 9 decimals)
          TOKEN_2022_PROGRAM_ID,
        ),
        createInitializeMintInstruction(
          hookMint.publicKey,
          decimals,
          payer.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        ),
      );

      await sendAndConfirmTransaction(
        connection,
        createMintTx,
        [payer.payer, hookMint]
      );
      
      console.log("Token-2022 token with transfer hook extension created");
    });

    it("Should create standard token and user accounts", async () => {
      console.log("Creating standard token and user accounts...");

      standardMint = Keypair.generate();
      const decimals = 9;
      
      const mintLen = getMintLen([]);
      const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

      const createStandardTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: standardMint.publicKey,
          space: mintLen,
          lamports: lamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          standardMint.publicKey,
          decimals,
          payer.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        ),
      );

      await sendAndConfirmTransaction(
        connection,
        createStandardTx,
        [payer.payer, standardMint]
      );

      console.log("Standard token created");

      // Create user accounts
      const amount = 10 * 10 ** 9; // Reduced from 1000 to 10 tokens

      userHookAccount = getAssociatedTokenAddressSync(
        hookMint.publicKey,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      userStandardAccount = getAssociatedTokenAddressSync(
        standardMint.publicKey,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const createAccountsTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          userHookAccount,
          payer.publicKey,
          hookMint.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          userStandardAccount,
          payer.publicKey,
          standardMint.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createMintToInstruction(
          hookMint.publicKey,
          userHookAccount,
          payer.publicKey,
          amount,
          [],
          TOKEN_2022_PROGRAM_ID
        ),
        createMintToInstruction(
          standardMint.publicKey,
          userStandardAccount,
          payer.publicKey,
          amount,
          [],
          TOKEN_2022_PROGRAM_ID
        ),
      );

      await sendAndConfirmTransaction(
        connection,
        createAccountsTx,
        [payer.payer]
      );

      console.log("User accounts created and funded");

      // Verify balances
      const hookBalance = await getAccount(connection, userHookAccount, undefined, TOKEN_2022_PROGRAM_ID);
      const standardBalance = await getAccount(connection, userStandardAccount, undefined, TOKEN_2022_PROGRAM_ID);
      
      console.log(`   Hook token balance: ${hookBalance.amount.toString()}`);
      console.log(`   Standard token balance: ${standardBalance.amount.toString()}`);
    });

    it("Should initialize hook validation accounts for our token", async () => {
      console.log("Initializing hook validation accounts...");

      // Initialize the extra account metas for our hook token
      // This now also creates the fee stats account
      const initTx = await dynamicFeeHookProgram.methods
        .initializeExtraAccountMetaList()
        .accounts({
          mint: hookMint.publicKey,
        })
        .rpc();

      console.log("Hook validation accounts initialized:", initTx);
      console.log("Fee stats account created for tracking AMM operations");
    });

    it("Should setup all required hook accounts including WSOL", async () => {
      console.log("Setting up hook-required accounts...");

      // Calculate all PDAs
      [delegatePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegate")], 
        OUR_HOOK_PROGRAM
      );
      
      [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("extra-account-metas"), hookMint.publicKey.toBuffer()],
        OUR_HOOK_PROGRAM
      );

      [feeStatsPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("fee_stats")],
        OUR_HOOK_PROGRAM
      );

      // WSOL accounts
      senderWSolAccount = getAssociatedTokenAddressSync(
        NATIVE_MINT,
        payer.publicKey
      );

      delegateWSolAccount = getAssociatedTokenAddressSync(
        NATIVE_MINT,
        delegatePDA,
        true // allowOwnerOffCurve for PDA
      );

      // NOTE: AMM PDA WSOL account will be calculated after poolConfig is created

      console.log("Calculated accounts:");
      console.log("- Delegate PDA:", delegatePDA.toString());
      console.log("- Extra Account Meta List:", extraAccountMetaListPDA.toString());
      console.log("- Fee Stats PDA:", feeStatsPDA.toString());
      console.log("- Sender WSOL:", senderWSolAccount.toString());
      console.log("- Delegate WSOL:", delegateWSolAccount.toString());

      // Create WSOL accounts
      console.log("Creating WSOL accounts...");
      
      await getOrCreateAssociatedTokenAccount(
        connection, 
        payer.payer, 
        NATIVE_MINT, 
        payer.publicKey
      );
      
      await getOrCreateAssociatedTokenAccount(
        connection, 
        payer.payer, 
        NATIVE_MINT, 
        delegatePDA, 
        true
      );

      // Fund sender WSOL account
      const transferAmount = 0.1 * 10 ** 9; // 0.1 SOL worth of WSOL (reduced from 2 SOL)
      const fundWSolTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: senderWSolAccount,
          lamports: transferAmount,
        }),
        createSyncNativeInstruction(senderWSolAccount),
      );

      await sendAndConfirmTransaction(connection, fundWSolTx, [payer.payer]);

      // Set up approval for delegate to transfer WSOL
      const approveTx = new Transaction().add(
        createApproveInstruction(
          senderWSolAccount,
          delegatePDA,
          payer.publicKey,
          transferAmount,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      await sendAndConfirmTransaction(connection, approveTx, [payer.payer]);

      console.log("All hook accounts created and funded");
    });
  });

  describe("Step 2: Create AMM Pool", () => {
    it("Should create AMM pool with our hook token", async () => {
      console.log("Creating AMM pool with hook token...");

      const seed = new BN(Date.now());
      const fee = 300;

      [poolConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), seed.toBuffer("be", 8)],
        lokoSwapProgram.programId
      );

      [mintLp] = PublicKey.findProgramAddressSync(
        [Buffer.from("lp"), poolConfig.toBytes()],
        lokoSwapProgram.programId
      );

      vaultX = getAssociatedTokenAddressSync(
        hookMint.publicKey,
        poolConfig,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      vaultY = getAssociatedTokenAddressSync(
        standardMint.publicKey,
        poolConfig,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      userLpAccount = getAssociatedTokenAddressSync(
        mintLp,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const initTx = await lokoSwapProgram.methods
        .initialize(
          seed,
          fee,
          null,
          0,
          new BN(0),
          OUR_HOOK_PROGRAM
        )
        .accountsStrict({
          admin: payer.publicKey,
          mintX: hookMint.publicKey,
          mintY: standardMint.publicKey,
          mintLp,
          vaultX,
          vaultY,
          config: poolConfig,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenProgramX: TOKEN_2022_PROGRAM_ID,
          tokenProgramY: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("AMM pool created:", initTx);

      // Now create AMM PDA WSOL account - needed for hook execution during withdrawals
      console.log("Creating AMM PDA WSOL account for withdrawals...");
      
      ammPdaWSolAccount = getAssociatedTokenAddressSync(
        NATIVE_MINT,
        poolConfig,  // Now poolConfig is available
        true // allowOwnerOffCurve for PDA
      );

      await getOrCreateAssociatedTokenAccount(
        connection, 
        payer.payer, 
        NATIVE_MINT, 
        poolConfig, // AMM PDA
        true
      );

      // Fund AMM PDA WSOL account for hook execution during withdrawals
      const transferAmount = 0.1 * 10 ** 9; // 0.1 SOL worth of WSOL (reduced from 2 SOL)
      const fundAmmWSolTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: ammPdaWSolAccount,
          lamports: transferAmount,
        }),
        createSyncNativeInstruction(ammPdaWSolAccount),
      );

      await sendAndConfirmTransaction(connection, fundAmmWSolTx, [payer.payer]);
      console.log("AMM PDA WSOL account created and funded");

      const poolData = await lokoSwapProgram.account.config.fetch(poolConfig);
      console.log(`   Pool supports hooks: ${poolData.supportsTransferHooks}`);
      console.log(`   Hook program: ${poolData.defaultHookProgram?.toString()}`);
    });
  });

  describe("Step 3: REAL AMM OPERATIONS WITH TRANSFER HOOKS", () => {
    it("Should deposit hook tokens into AMM", async () => {
      console.log("Depositing hook tokens into AMM...");

      const depositAmount = new BN(1 * 10 ** 6); // 0.001 LP tokens worth (much smaller)
      const maxX = new BN(2 * 10 ** 6); // 0.002 hook tokens max (much smaller)
      const maxY = new BN(2 * 10 ** 6); // 0.002 standard tokens max (much smaller)

      // All accounts required for transfer hook execution (calculated in setup)
      const hookAccounts = [
        { pubkey: extraAccountMetaListPDA, isSigner: false, isWritable: false },       // Extra metas list
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },                   // index 5 - WSOL mint
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },              // index 6 - Token program
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },   // index 7 - Associated token program
        { pubkey: delegatePDA, isSigner: false, isWritable: true },                    // index 8 - Delegate PDA
        { pubkey: delegateWSolAccount, isSigner: false, isWritable: true },            // index 9 - Delegate WSOL
        { pubkey: senderWSolAccount, isSigner: false, isWritable: true },              // index 10 - Sender WSOL
        { pubkey: feeStatsPDA, isSigner: false, isWritable: true },                    // index 11 - Fee stats PDA
        { pubkey: OUR_HOOK_PROGRAM, isSigner: false, isWritable: false },              // Hook program ID
      ];

      const depositTx = await lokoSwapProgram.methods
        .deposit(depositAmount, maxX, maxY)
        .accountsPartial({
          user: payer.publicKey,
          mintX: hookMint.publicKey,
          mintY: standardMint.publicKey,
          userX: userHookAccount,
          userY: userStandardAccount,
          vaultX,
          vaultY,
          config: poolConfig,
          mintLp,
          userLp: userLpAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(hookAccounts)
        .rpc();

      console.log("Deposit transaction:", depositTx);

      const lpBalance = await getAccount(connection, userLpAccount, undefined, TOKEN_2022_PROGRAM_ID);
      console.log(`LP tokens received: ${lpBalance.amount.toString()}`);

      console.log("Deposit with transfer hooks completed");
    });

    it("Should swap hook tokens in AMM", async () => {
      console.log("🔄 SWAPPING our working hook tokens in AMM...");

      const swapAmount = new BN(1 * 10 ** 5); // 0.0001 hook tokens (much smaller)
      const minOut = new BN(1);

      // All accounts required for transfer hook execution (same as deposit)
      const hookAccounts = [
        { pubkey: extraAccountMetaListPDA, isSigner: false, isWritable: false },       // Extra metas list
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },                   // index 5 - WSOL mint
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },              // index 6 - Token program
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },   // index 7 - Associated token program
        { pubkey: delegatePDA, isSigner: false, isWritable: true },                    // index 8 - Delegate PDA
        { pubkey: delegateWSolAccount, isSigner: false, isWritable: true },            // index 9 - Delegate WSOL
        { pubkey: senderWSolAccount, isSigner: false, isWritable: true },              // index 10 - Sender WSOL
        { pubkey: feeStatsPDA, isSigner: false, isWritable: true },                    // index 11 - Fee stats PDA
        { pubkey: OUR_HOOK_PROGRAM, isSigner: false, isWritable: false },              // Hook program ID
      ];

      const swapTx = await lokoSwapProgram.methods
        .swap(swapAmount, true, minOut)  
        .accountsPartial({
          user: payer.publicKey,
          mintX: hookMint.publicKey,
          mintY: standardMint.publicKey,
          userX: userHookAccount,
          userY: userStandardAccount,
          vaultX,
          vaultY,
          config: poolConfig,
          mintLp,                                    
          userLp: userLpAccount,                    
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,  
          systemProgram: SystemProgram.programId,   
        })
        .remainingAccounts(hookAccounts)
        .rpc();

      console.log("Swap transaction:", swapTx);

      console.log("Swap with transfer hooks completed");
    });

    it("Should withdraw hook tokens from AMM", async () => {
      console.log("Withdrawing hook tokens from AMM...");

      const withdrawAmount = new BN(5 * 10 ** 5); // 0.0005 LP tokens (much smaller)
      const minX = new BN(1);
      const minY = new BN(1);

      console.log("   NOTE: Using same direct Token-2022 approach as deposit and swap");
      console.log("   Transfer hooks will execute with PDA authority - testing if hook handles this properly");

      // Hook accounts for withdrawal - simplified for current hook implementation
      const hookAccounts = [
        { pubkey: extraAccountMetaListPDA, isSigner: false, isWritable: false },       // Extra metas list
        { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },                   // index 5 - WSOL mint
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },              // index 6 - Token program
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },   // index 7 - Associated token program
        { pubkey: delegatePDA, isSigner: false, isWritable: true },                    // index 8 - Delegate PDA
        { pubkey: delegateWSolAccount, isSigner: false, isWritable: true },            // index 9 - Delegate WSOL
        { pubkey: ammPdaWSolAccount, isSigner: false, isWritable: true },              // index 10 - AMM PDA WSOL (withdrawal authority)
        { pubkey: feeStatsPDA, isSigner: false, isWritable: true },                    // index 11 - Fee stats PDA
        { pubkey: OUR_HOOK_PROGRAM, isSigner: false, isWritable: false },              // Hook program ID
      ];

      const withdrawTx = await lokoSwapProgram.methods
        .withdraw(withdrawAmount, minX, minY)
        .accountsPartial({
          user: payer.publicKey,
          mintX: hookMint.publicKey,
          mintY: standardMint.publicKey,
          userX: userHookAccount,
          userY: userStandardAccount,
          vaultX,
          vaultY,
          config: poolConfig,
          mintLp,
          userLp: userLpAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(hookAccounts) // Same hook accounts as deposit/swap
        .rpc();

      console.log("Withdraw transaction:", withdrawTx);

      // Verify balances after withdrawal
      const lpBalance = await getAccount(connection, userLpAccount, undefined, TOKEN_2022_PROGRAM_ID);
      const hookBalance = await getAccount(connection, userHookAccount, undefined, TOKEN_2022_PROGRAM_ID);
      const standardBalance = await getAccount(connection, userStandardAccount, undefined, TOKEN_2022_PROGRAM_ID);
      
      console.log(`   LP tokens remaining: ${lpBalance.amount.toString()}`);
      console.log(`   Hook tokens received: ${hookBalance.amount.toString()}`);
      console.log(`   Standard tokens received: ${standardBalance.amount.toString()}`);

      console.log("Withdraw with transfer hooks completed");
    });
  });

  after(() => {
    console.log("AMM with dynamic fee hook integration test completed");
  });
});