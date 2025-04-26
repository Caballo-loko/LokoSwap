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
  // TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
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
  const tokenProgram = TOKEN_PROGRAM_ID;

  const seed = new BN(randomBytes(8));

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

  const [admin, user, mintX, mintY] = Array.from({ length: 4 }, () => {
    Keypair.generate();
  });

  const mintLp = Keypair.generate();

  const [vaultX, vaultY] = [admin].map((a) => {
    getAssociatedTokenAddressSync(
      mintX.publicKey,
      config.publicKey,
      true,
      tokenProgram
    ),
      getAssociatedTokenAddressSync(
        mintY.publicKey,
        config.publicKey,
        true,
        tokenProgram
      );
  });

  const config = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
    program.programId
  )[0];

  const account = {
    admin: admin.publicKey,
    user: user.publicKey,
    mintX: mintX.publicKey,
    mintY: mintY.publicKey,
    mintLp: mintLp.publicKey,
    vaultX,
    vaultY,
    config,
    tokenProgram,
  };

  it("Aidrop and create Mints", async () => {
    let lamports = await getMinimumBalanceForRentExemptAccount(connection);
    let tx = new Transaction();
    tx.instructions = [
      ...[admin, user].map((account) =>
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          toPubkey: account.publicKey,
          lamports: 10 * LAMPORTS_PER_SOL,
        })
      ),
      ...[mintX, mintY, mintLp].map((mint) =>
        SystemProgram.createAccount({
          fromPubkey: provider.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports,
          space: MINT_SIZE,
          programId: tokenProgram,
        })
      ),
      ...[
        { mint: mintX.publicKey, authority: maker.publicKey, ata: makerAtaA },
        { mint: mintY.publicKey, authority: taker.publicKey, ata: takerAtaB },
      ].flatMap((x) => [
        createInitializeMint2Instruction(
          x.mint,
          6,
          x.authority,
          null,
          tokenProgram
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          x.ata,
          x.authority,
          x.mint,
          tokenProgram
        ),
        createMintToInstruction(
          x.mint,
          x.ata,
          x.authority,
          1e9,
          undefined,
          tokenProgram
        ),
      ]),
    ];
    await provider.sendAndConfirm(tx, [mintA, mintB, maker, taker]).then(log);
  });

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
