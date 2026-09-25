import { EventDecoder, DecodedEvent } from "./eventDecoder.js";

interface LogContext {
  signature?: string;
  programId?: string;
}

interface TransactionLogs {
  logs: string[];
  signature?: string;
}

export interface ParsedEvent {
  type: string;
  data: DecodedEvent;
  participants: { [role: string]: string };
  signature: string;
  timestamp: number;
}

/**
 * Extracts every Stock Ramp event emitted in a transaction's logs.
 *
 * Unlike the old Trust Vault/Trust Express parser, this does NOT stop at the
 * first "Program data:" log. A single submit_buy_vote / submit_sell_vote call
 * that reaches the vote threshold emits multiple events in one transaction
 * (ValidatorVoteCastEvent, then ValidatorVoteExecutedEvent, then optionally
 * OrderClosedEvent). Returning only the first would silently drop settlement
 * events — this was a live bug in the previous implementation.
 */
export class EventParser {
  private decoder = new EventDecoder();

  parseLogsForEvents(logs: TransactionLogs, context: LogContext): ParsedEvent[] {
    const events: ParsedEvent[] = [];

    for (const log of logs.logs) {
      if (!log.includes("Program data:")) continue;

      const match = log.match(/Program data: (.+)/);
      if (!match) continue;

      const decoded = this.decoder.decodeProgramData(match[1].trim());
      if (!decoded) continue;

      events.push({
        type: decoded.eventType,
        data: decoded,
        participants: decoded.participants,
        signature: context.signature || logs.signature || `temp_${Date.now()}`,
        timestamp: Date.now(),
      });
    }

    return events;
  }
}