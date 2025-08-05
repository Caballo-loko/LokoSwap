import * as anchor from "@coral-xyz/anchor";
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  Transaction,
  sendAndConfirmTransaction 
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

/**
 * Manager for deployed Transfer Hook programs
 * These are battle-tested programs deployed from Solana program examples
 */
export class HookProgramManager {
  // Deployed program IDs from devnet
  static readonly WHITELIST_HOOK_PROGRAM_ID = new PublicKey("2XRSVCMWbgLUJGFRdKv3TpCoMk72fPJGTb6xd2atz6NP");
  static readonly COUNTER_HOOK_PROGRAM_ID = new PublicKey("7V4o2273MtNWDtJSuPW3UEXgumVLHgewVmQYZpLd2bGt");
  static readonly TRANSFER_COST_HOOK_PROGRAM_ID = new PublicKey("CrPqWjYKACWxozfTjbq2fC9UtCFd1DuSR9zkvhVDY4fE");

  /**
   * List of approved hook programs for LokoSwap AMM
   */
  static readonly APPROVED_HOOK_PROGRAMS = [
    HookProgramManager.WHITELIST_HOOK_PROGRAM_ID,
    HookProgramManager.COUNTER_HOOK_PROGRAM_ID, 
    HookProgramManager.TRANSFER_COST_HOOK_PROGRAM_ID,
  ];

  /**
   * Check if a program ID is an approved hook program
   */
  static isApprovedHookProgram(programId: PublicKey): boolean {
    return HookProgramManager.APPROVED_HOOK_PROGRAMS.some(approved => 
      approved.equals(programId)
    );
  }

  /**
   * Create a Token-2022 mint with whitelist transfer hook
   */
  static async createWhitelistToken(
    connection: Connection,
    payer: Keypair,
    decimals: number = 9
  ): Promise<Keypair> {
    const mint = Keypair.generate();
    
    const extensions = [ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    
    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports: await connection.getMinimumBalanceForRentExemption(mintLen),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint.publicKey,
        payer.publicKey,
        HookProgramManager.WHITELIST_HOOK_PROGRAM_ID,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, transaction, [payer, mint]);
    
    console.log(`Created whitelist token: ${mint.publicKey.toString()}`);
    return mint;
  }

  /**
   * Create a Token-2022 mint with counter transfer hook
   */
  static async createCounterToken(
    connection: Connection,
    payer: Keypair,
    decimals: number = 9
  ): Promise<Keypair> {
    const mint = Keypair.generate();
    
    const extensions = [ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    
    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports: await connection.getMinimumBalanceForRentExemption(mintLen),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint.publicKey,
        payer.publicKey,
        HookProgramManager.COUNTER_HOOK_PROGRAM_ID,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, transaction, [payer, mint]);
    
    console.log(`Created counter token: ${mint.publicKey.toString()}`);
    return mint;
  }

  /**
   * Create a Token-2022 mint with transfer cost hook (fee collection)
   */
  static async createTransferCostToken(
    connection: Connection,
    payer: Keypair,
    decimals: number = 9
  ): Promise<Keypair> {
    const mint = Keypair.generate();
    
    const extensions = [ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    
    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports: await connection.getMinimumBalanceForRentExemption(mintLen),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint.publicKey,
        payer.publicKey,
        HookProgramManager.TRANSFER_COST_HOOK_PROGRAM_ID,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, transaction, [payer, mint]);
    
    console.log(`Created transfer cost token: ${mint.publicKey.toString()}`);
    return mint;
  }

  /**
   * Create standard Token-2022 mint (no hooks) for comparison
   */
  static async createStandardToken2022(
    connection: Connection,
    payer: Keypair,
    decimals: number = 9
  ): Promise<Keypair> {
    const mint = Keypair.generate();
    
    const mintLen = getMintLen([]);
    
    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports: await connection.getMinimumBalanceForRentExemption(mintLen),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, transaction, [payer, mint]);
    
    console.log(`Created standard Token-2022: ${mint.publicKey.toString()}`);
    return mint;
  }

  /**
   * Mint tokens to a user account
   */
  static async mintTokensToUser(
    connection: Connection,
    mint: Keypair,
    user: Keypair,
    payer: Keypair,
    amount: number
  ): Promise<PublicKey> {
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint.publicKey,
      user.publicKey,
      undefined,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await mintTo(
      connection,
      payer,
      mint.publicKey,
      userTokenAccount.address,
      payer.publicKey,
      amount,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log(`Minted ${amount} tokens to ${userTokenAccount.address.toString()}`);
    return userTokenAccount.address;
  }

  /**
   * Get hook program type from program ID
   */
  static getHookType(programId: PublicKey): string {
    if (programId.equals(HookProgramManager.WHITELIST_HOOK_PROGRAM_ID)) {
      return "Whitelist";
    } else if (programId.equals(HookProgramManager.COUNTER_HOOK_PROGRAM_ID)) {
      return "Counter";
    } else if (programId.equals(HookProgramManager.TRANSFER_COST_HOOK_PROGRAM_ID)) {
      return "Transfer Cost";
    } else {
      return "Unknown";
    }
  }
}