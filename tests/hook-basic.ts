import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LokoSwap } from "../target/types/loko_swap";
import {
  PublicKey,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { HookProgramManager } from "./hook-manager";
import { assert } from "chai";
import { BN } from "bn.js";

describe("LokoSwap Hook Basic Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.LokoSwap as Program<LokoSwap>;
  const payer = provider.wallet as anchor.Wallet;

  describe("Hook Program Validation", () => {
    it("Should accept approved hook program in initialize", async () => {
      const seed = new BN(Date.now());
      const fee = 300;
      
      // Create simple Token-2022 mints for this test
      const whitelistToken = await HookProgramManager.createWhitelistToken(
        provider.connection,
        payer.payer,
        9
      );

      const standardToken = await HookProgramManager.createStandardToken2022(
        provider.connection,
        payer.payer,
        9
      );

      const [config] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), seed.toBuffer("be", 8)],
        program.programId
      );

      const [mintLp] = PublicKey.findProgramAddressSync(
        [Buffer.from("lp"), config.toBytes()],
        program.programId
      );

      const vaultX = getAssociatedTokenAddressSync(
        whitelistToken.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardToken.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      // This should succeed with approved hook program
      const tx = await program.methods
        .initialize(
          seed,
          fee,
          null,
          500,
          new BN(10000),
          HookProgramManager.WHITELIST_HOOK_PROGRAM_ID // approved program
        )
        .accountsStrict({
          admin: payer.publicKey,
          mintX: whitelistToken.publicKey,
          mintY: standardToken.publicKey,
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

      // Verify transaction succeeded
      assert.ok(tx);

      // Verify config has approved hook programs
      const configAccount = await program.account.config.fetch(config);
      assert.equal(configAccount.approvedHookPrograms.length, 3);
      assert.ok(configAccount.approvedHookPrograms.some(p => 
        p.equals(HookProgramManager.WHITELIST_HOOK_PROGRAM_ID)
      ));

      console.log("✅ Pool initialized with approved hook program");
    });

    it("Should reject unapproved hook program", async () => {
      const seed = new BN(Date.now() + 1);
      const fee = 300;
      const unapprovedProgram = Keypair.generate().publicKey;
      
      const standardToken = await HookProgramManager.createStandardToken2022(
        provider.connection,
        payer.payer,
        9
      );

      const standardToken2 = await HookProgramManager.createStandardToken2022(
        provider.connection,
        payer.payer,
        9
      );

      const [config] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), seed.toBuffer("be", 8)],
        program.programId
      );

      const [mintLp] = PublicKey.findProgramAddressSync(
        [Buffer.from("lp"), config.toBytes()],
        program.programId
      );

      const vaultX = getAssociatedTokenAddressSync(
        standardToken.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardToken2.publicKey,
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
            new BN(10000),
            unapprovedProgram // unapproved program
          )
          .accountsStrict({
            admin: payer.publicKey,
            mintX: standardToken.publicKey,
            mintY: standardToken2.publicKey,
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

    it("Should allow null hook program (no validation)", async () => {
      const seed = new BN(Date.now() + 2);
      const fee = 300;
      
      const standardToken = await HookProgramManager.createStandardToken2022(
        provider.connection,
        payer.payer,
        9
      );

      const standardToken2 = await HookProgramManager.createStandardToken2022(
        provider.connection,
        payer.payer,
        9
      );

      const [config] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), seed.toBuffer("be", 8)],
        program.programId
      );

      const [mintLp] = PublicKey.findProgramAddressSync(
        [Buffer.from("lp"), config.toBytes()],
        program.programId
      );

      const vaultX = getAssociatedTokenAddressSync(
        standardToken.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      const vaultY = getAssociatedTokenAddressSync(
        standardToken2.publicKey,
        config,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      // This should succeed with null hook program
      const tx = await program.methods
        .initialize(
          seed,
          fee,
          null,
          500,
          new BN(10000),
          null // no hook program validation
        )
        .accountsStrict({
          admin: payer.publicKey,
          mintX: standardToken.publicKey,
          mintY: standardToken2.publicKey,
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

      // Verify transaction succeeded
      assert.ok(tx);
      console.log("✅ Pool initialized with null hook program (no validation)");
    });
  });

  describe("Hook Program Manager Utilities", () => {
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

    it("Should create tokens with different hook programs", async () => {
      const whitelistToken = await HookProgramManager.createWhitelistToken(
        provider.connection,
        payer.payer,
        9
      );

      const counterToken = await HookProgramManager.createCounterToken(
        provider.connection,
        payer.payer,
        9
      );

      const transferCostToken = await HookProgramManager.createTransferCostToken(
        provider.connection,
        payer.payer,
        9
      );

      const standardToken = await HookProgramManager.createStandardToken2022(
        provider.connection,
        payer.payer,
        9
      );

      assert.ok(whitelistToken.publicKey);
      assert.ok(counterToken.publicKey);
      assert.ok(transferCostToken.publicKey);
      assert.ok(standardToken.publicKey);

      console.log("✅ Created tokens with different hook programs:");
      console.log("  Whitelist Token:", whitelistToken.publicKey.toString());
      console.log("  Counter Token:", counterToken.publicKey.toString());
      console.log("  Transfer Cost Token:", transferCostToken.publicKey.toString());
      console.log("  Standard Token:", standardToken.publicKey.toString());
    });
  });

  after(async () => {
    console.log("\n🎉 All hook basic tests completed successfully!");
    console.log("📋 Deployed Hook Programs:");
    console.log("✅ Whitelist Hook:", HookProgramManager.WHITELIST_HOOK_PROGRAM_ID.toString());
    console.log("✅ Counter Hook:", HookProgramManager.COUNTER_HOOK_PROGRAM_ID.toString());
    console.log("✅ Transfer Cost Hook:", HookProgramManager.TRANSFER_COST_HOOK_PROGRAM_ID.toString());
  });
});