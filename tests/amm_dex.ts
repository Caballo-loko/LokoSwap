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
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { randomBytes } from "crypto";

describe("anchor-amm-dex", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;

  const program = anchor.workspace.ammDex as Program<AmmDex>;
  const programId = program.programId;
  const tokenProgram = TOKEN_PROGRAM_ID;
  
  // Generate a random seed
  const seed = new anchor.BN(randomBytes(8));

  async function confirm(signature: string): Promise<string> {
    const block = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      ...block,
    });
    return signature;
  }

  async function log(signature: string): Promise<string> {
    console.log(
      `Your transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}`
    );
    return signature;
  }

  // Create keypairs for admin and mints
  const admin = Keypair.generate();
  const mintX = Keypair.generate();
  const mintY = Keypair.generate();

  // Config PDA
  const [config, configBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  // LP mint PDA
  const [mintLp, lpBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), config.toBuffer()],
    program.programId
  );

  // Associated token accounts for vaults
  const vaultX = getAssociatedTokenAddressSync(
    mintX.publicKey,
    config,
    true
  );

  const vaultY = getAssociatedTokenAddressSync(
    mintY.publicKey,
    config,
    true
  );

  // Accounts object for easy reference
  const accounts = {
    admin: admin.publicKey,
    mintX: mintX.publicKey,
    mintY: mintY.publicKey,
    mintLp,
    vaultX,
    vaultY,
    config,
    tokenProgram,
  };

  it("Airdrop and create Mints", async () => {
    // Airdrop to admin
    const airdropSig = await connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
    await confirm(airdropSig);

    // Create and initialize mints
    let tx = new Transaction();
    
    // Only create mintX and mintY as regular accounts
    // mintLp will be created by the program as a PDA
    for (const mint of [mintX, mintY]) {
      const mintLamports = await getMinimumBalanceForRentExemptMint(connection);
      
      tx.add(
        SystemProgram.createAccount({
          fromPubkey: provider.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: mintLamports,
          space: MINT_SIZE,
          programId: tokenProgram,
        }),
        createInitializeMint2Instruction(
          mint.publicKey,
          6,  // 6 decimals
          provider.publicKey,
          null,
          tokenProgram
        )
      );
    }

    // For testing, create token accounts and mint tokens to admin
    const adminAtaX = getAssociatedTokenAddressSync(
      mintX.publicKey,
      admin.publicKey,
      false,
      tokenProgram
    );

    const adminAtaY = getAssociatedTokenAddressSync(
      mintY.publicKey,
      admin.publicKey,
      false,
      tokenProgram
    );

    // Create token accounts and mint initial tokens to admin
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        provider.publicKey,
        adminAtaX,
        admin.publicKey,
        mintX.publicKey,
        tokenProgram
      ),
      createMintToInstruction(
        mintX.publicKey,
        adminAtaX,
        provider.publicKey,
        1e9,  // 1,000 tokens
        undefined,
        tokenProgram
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        provider.publicKey,
        adminAtaY,
        admin.publicKey,
        mintY.publicKey,
        tokenProgram
      ),
      createMintToInstruction(
        mintY.publicKey,
        adminAtaY,
        provider.publicKey,
        1e9,  // 1,000 tokens
        undefined,
        tokenProgram
      )
    );

    await provider.sendAndConfirm(tx, [mintX, mintY]).then(log);
  });

  it("Initializes the AMM", async () => {
    // Initialize the AMM with the correct parameters
    const fee = 30; // 0.3% fee (assuming fee is in basis points)
  
    
    const tx = await program.methods
      .initialize(
        seed,
        fee,
        provider.publicKey
      )
      .accountsPartial({...accounts})
      .signers([admin])
      .rpc();
    
    await log(tx);
    
    // Verify initialization by fetching the config account
    const configAccount = await program.account.config.fetch(config);
    console.log("Config Account:", configAccount);
    
  });



});