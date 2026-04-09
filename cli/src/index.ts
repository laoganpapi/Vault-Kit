import { Command } from "commander";
import { deposit } from "./deposit.js";
import { withdraw } from "./withdraw.js";
import { status } from "./status.js";

const program = new Command();

program
  .name("vault")
  .description("CLI for the Yield Vault on Arbitrum")
  .version("1.0.0");

program
  .command("deposit")
  .description("Deposit USDC into the vault")
  .argument("<amount>", "USDC amount to deposit (e.g. 1000)")
  .action(async (amount: string) => {
    try {
      await deposit(amount);
    } catch (err: any) {
      console.error(`\nError: ${err.message || err}`);
      process.exit(1);
    }
  });

program
  .command("withdraw")
  .description("Withdraw USDC from the vault")
  .argument("<amount>", 'USDC amount to withdraw, or "all" for full exit')
  .action(async (amount: string) => {
    try {
      await withdraw(amount);
    } catch (err: any) {
      console.error(`\nError: ${err.message || err}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show vault TVL, share price, strategy health, and your position")
  .action(async () => {
    try {
      await status();
    } catch (err: any) {
      console.error(`\nError: ${err.message || err}`);
      process.exit(1);
    }
  });

program.parse();
