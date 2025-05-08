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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
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

  const seed = new BN(randomBytes(8));
  const maxX = new BN(2);
  const maxY = new BN(1);
  const amount = new BN(1);
  const fee = 2;

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
    console.log(
      `Your transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}`
    );
    return signature;
  };

  before(async () => {
    admin = Keypair.generate();
    const transferTx = SystemProgram.transfer({
      fromPubkey: provider.publicKey,
      toPubkey: admin.publicKey,
      lamports: 10 * LAMPORTS_PER_SOL
    });
    const tx = new Transaction().add(transferTx);
    await provider.sendAndConfirm(tx);

    user = Keypair.generate();
    const transferTx2 = SystemProgram.transfer({
      fromPubkey: provider.publicKey,
      toPubkey: user.publicKey,
      lamports: 10 * LAMPORTS_PER_SOL
    });
    const tx2 = new Transaction().add(transferTx2);
    await provider.sendAndConfirm(tx2);

    mintX = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

    mintY = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

    config = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

    mintLp = PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), config.toBuffer()],
      program.programId
    )[0];

    vaultX = getAssociatedTokenAddressSync(mintX, config, true);
    vaultY = getAssociatedTokenAddressSync(mintY, config, true);

    const userXAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      mintX,
      user.publicKey
    );
    userX = userXAccount.address;

    const userYAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      mintY,
      user.publicKey
    );
    userY = userYAccount.address;

    await mintTo(
      provider.connection,
      admin,
      mintX,
      userX,
      admin.publicKey,
      1000000000
    );

    await mintTo(
      provider.connection,
      admin,
      mintY,
      userY,
      admin.publicKey,
      1000000000
    );
  });

  it("Is initialized!", async () => {
    try {
      await program.methods
        .initialize(seed, fee, null)
        .accountsStrict({
          admin: admin.publicKey,
          mintX: mintX,
          mintY: mintY,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          tokenProgram: tokenProgram,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId
        })
        .signers([admin])
        .rpc()
        .then(confirm)
        .then(log);
        
      const userLpAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user,
        mintLp,
        user.publicKey
      );
      userLp = userLpAccount.address;
    }
    catch (error) {
      console.log("Initialization error:", error);
      throw error;
    }
  });
 
  it("lets deposit!", async() => {
    try {
      await program.methods
        .deposit(amount, maxX, maxY)
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
          tokenProgram: tokenProgram,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId
        })
        .signers([user])
        .rpc()
        .then(confirm)
        .then(log);
    }
    catch (error) {
      console.log("Deposit error:", error);
      throw error;
    }
  });
 
  it("lets withdraw!", async() => {
    try {
      await program.methods
        .withdraw(amount, maxX, maxY)
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
          tokenProgram: tokenProgram,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId
        })
        .signers([user])
        .rpc()
        .then(confirm)
        .then(log);
    }
    catch (error) {
      console.log("Withdraw error:", error);
      throw error;
    }
  });

  /*
  it("lets swap!", async() => {
    try {
      await program.methods
        .swap(amount, maxX, maxY)
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
          tokenProgram: tokenProgram,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId
        })
        .signers([user])
        .rpc()
        .then(confirm)
        .then(log);
    }
    catch (error) {
      console.log("Swap error:", error);
      throw error;
    }
  });
  */
});
