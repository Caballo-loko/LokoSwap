import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AmmDex } from "../target/types/amm_dex";
import { randomBytes } from "crypto";
import { BN } from "bn.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

describe("amm", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();

  const connection = provider.connection;

  const program = anchor.workspace.AmmDex as Program<AmmDex>;

  const tokenProgram = TOKEN_PROGRAM_ID;

  const seeds = new BN(randomBytes(8));
  const maxX = new BN(2);
  const maxY = new BN(1);
  const amount = new BN(1);
  const fee = 2;

  const confirm = async (signature: string): Promise<string> => {
    const block = await connection.getLatestBlockhash();

    await connection.confirmTransaction({
      signature,
      ...block,
    });

    return signature;
  };

  const log = async (signature: string): Promise<string> => {
    console.log(
      `Your transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}`
    );

    return signature;
  };

  const [admin, user, mintX, mintY] = Array.from({ length: 4 }, () =>
    Keypair.generate()
  );

  const [userX, userY] = [mintX, mintY].map((m) => 
    getAssociatedTokenAddressSync(
      m.publicKey,
      user.publicKey,
      false,
      tokenProgram
    )
  );

  const config = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), seeds.toArrayLike(Buffer, "le", 8)],
    program.programId
  )[0];

  const mintLP = PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), config.toBuffer()],
    program.programId
  )[0];

  const vaultX = getAssociatedTokenAddressSync(mintX.publicKey, config, true);

  const vaultY = getAssociatedTokenAddressSync(mintY.publicKey, config, true);

  const userLp = getAssociatedTokenAddressSync(mintLP, user.publicKey, true);

  const accounts = {
    admin: admin.publicKey,
    user: user.publicKey,
    mintX: mintX.publicKey, 
    mintY: mintY.publicKey,
    mintLP,
    vaultX,
    vaultY,
    userX,
    userY,
    userLp,
    config,
    tokenProgram,
  };

  it("Airdrop and create mint", async () => {
    let lamports = await getMinimumBalanceForRentExemptMint(connection);

    let tx = new Transaction();

    tx.instructions = [
      ...[admin, user].map((a) =>
        SystemProgram.transfer({
        fromPubkey: provider.publicKey,
        toPubkey: a.publicKey,
        lamports: 10 * LAMPORTS_PER_SOL,
      })),
      
      ...[mintX, mintY].map((m) =>
        SystemProgram.createAccount({
          fromPubkey: provider.publicKey,
          newAccountPubkey: m.publicKey,
          lamports,
          space: MINT_SIZE,
          programId: tokenProgram,
        })
      ),

      ...[
        {mint: mintX.publicKey, authority: user.publicKey, ata: userX},
        {mint: mintY.publicKey, authority: user.publicKey, ata: userY}
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
        )
      ]),
    ];

    await provider.sendAndConfirm(tx, [ user, mintX, mintY]).then(log);
  });

  it("Is initialized!", async () => {
    await program.methods
      .initialize(seeds, fee, admin.publicKey)
      .accounts({ ...accounts })
      .signers([admin])
      .rpc()
      .then(confirm)
      .then(log);
  });

  it("deposit!", async () => {
    await program.methods
      .deposit(amount, maxX, maxY)
      .accounts({ ...accounts })
      .signers([user])
      .rpc()
      .then(confirm)
      .then(log);
  });

  it("withdraw!", async () => {
    const w = new BN(0.1)
    await program.methods
      .withdraw(w, maxX, maxY)
      .accounts({ ...accounts })
      .signers([user])
      .rpc()
      .then(confirm)
      .then(log);
  });
  
});