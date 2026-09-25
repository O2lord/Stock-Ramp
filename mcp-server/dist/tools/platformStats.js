import { PublicKey } from "@solana/web3.js";
import { getProgram } from "../program.js";
import { PROGRAM_ID, FEE_SPLIT } from "../constants.js";
/** get_platform_stats -- GlobalState PDA, seeds=[b"global-state"]. */
export async function getPlatformStats() {
    const program = getProgram();
    const [globalStatePda] = PublicKey.findProgramAddressSync([Buffer.from("global-state")], PROGRAM_ID);
    const acc = await program.account.globalState.fetch(globalStatePda);
    return {
        totalOrdersCreated: Number(acc.totalStockRampCreated),
        totalOrdersClosed: Number(acc.totalStockRampClosed),
        totalConfirmations: Number(acc.totalConfirmations),
        totalVolumeRaw: acc.totalVolume.toString(), // divide by 10^decimals to display
        totalFeesCollectedRaw: acc.totalFeesCollected.toString(),
        totalDisputes: Number(acc.totalDisputes), // always 0 in this build — no dispute flow implemented yet
        buyOrdersPaused: acc.buyOrdersPaused,
        sellOrdersPaused: acc.sellOrdersPaused,
        validatorCount: acc.validatorCount,
        requiredVotes: acc.requiredVotes,
        activeVoteCount: Number(acc.activeVoteCount),
    };
}
/**
 * get_fee_structure -- combines the live on-chain fee_percentage (basis
 * points, GlobalState) with the fee SPLIT, which is hardcoded in the Rust
 * program's split_fee() (submit_vote.rs: 20% platform / 60% maker / 20%
 * validator pool) rather than stored in any account. Both are surfaced
 * together since a caller asking "what's the fee" almost always also wants
 * to know where it goes.
 */
export async function getFeeStructure() {
    const program = getProgram();
    const [globalStatePda] = PublicKey.findProgramAddressSync([Buffer.from("global-state")], PROGRAM_ID);
    const acc = await program.account.globalState.fetch(globalStatePda);
    const feeBasisPoints = acc.feePercentage;
    if (feeBasisPoints === undefined) {
        throw new Error("GlobalState account has no feePercentage field. Either the IDL is " +
            "stale relative to the deployed program, or the account layout has " +
            "changed since this was written.");
    }
    const basisPoints = Number(feeBasisPoints);
    if (basisPoints > 1000) {
        // update_fee_percentage() rejects anything above 1000 (10%) on-chain —
        // a value over that means we're almost certainly reading the wrong field.
        throw new Error(`feePercentage read as ${basisPoints}, which exceeds the program's own ` +
            `10% (1000 bps) cap. This value is not trustworthy.`);
    }
    return {
        feeBasisPoints: basisPoints,
        feePercent: basisPoints / 100,
        split: FEE_SPLIT,
        source: "feePercentage: live on-chain GlobalState account. split: hardcoded in the program's " +
            "split_fee() logic, not an on-chain config value.",
    };
}
