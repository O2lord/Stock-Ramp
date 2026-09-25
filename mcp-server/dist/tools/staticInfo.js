import fs from "node:fs";
import { SUPPORTED_CURRENCIES, SUPPORTED_PROCESSORS } from "../constants.js";
const KNOWLEDGE_BASE_PATH = process.env.STOCK_RAMP_KNOWLEDGE_PATH ?? "./knowledge/stockramp.md";
export function getProtocolOverview() {
    if (!fs.existsSync(KNOWLEDGE_BASE_PATH)) {
        return ("StockRamp is a non-custodial tokenized-equity-to-fiat settlement protocol built on Solana. " +
            "(Fallback text -- knowledge/stockramp.md not found at configured path.)");
    }
    return fs.readFileSync(KNOWLEDGE_BASE_PATH, "utf-8");
}
export function getCurrenciesAndProcessors() {
    return {
        currencies: SUPPORTED_CURRENCIES,
        processors: SUPPORTED_PROCESSORS,
    };
}
