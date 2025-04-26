import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AmmDex } from "../target/types/amm_dex";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccount,
  // TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptAccount,
  getMinimumBalanceForRentExemptMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { Stats } from "fs";
import { token } from "@coral-xyz/anchor/dist/cjs/utils";

describe("anchor-amm-dex", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider();
  const connection = provider.connection;

  const program = anchor.workspace.ammDex as Program<AmmDex>;
  const progrmaId = program.programId;
  const tokenProgram = TOKEN_2022_PROGRAM_ID;

  // const confirm = async (signature: string): Promise<string> =>

  async function confirm(signature: string): Promise<string> {
    const block = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      ...block,
    });
    return signature;
  }

  //const log = async (signature: string): Promise<string>

  async function log(signature: string): Promise<string> {
    console.log(
      ` Your transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}`
    );

    return signature;
  }

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
