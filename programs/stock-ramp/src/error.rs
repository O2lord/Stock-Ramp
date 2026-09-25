use anchor_lang::prelude::*;

#[error_code]
pub enum StockRampError {
    #[msg("Generic custom error")]
    CustomError,

    #[msg("Insufficient funds for this operation")]
    InsufficientFunds,

    #[msg("Invalid withdraw amount")]
    InvalidWithdrawAmount,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Invalid price")]
    InvalidPrice,

    #[msg("Invalid currency code — must be exactly 3 bytes (e.g. NGN)")]
    InvalidCurrency,

    #[msg("Payment instructions exceed max length")]
    PaymentInstructionsTooLong,

    #[msg("Order has active reservations and cannot be closed")]
    ActiveReservationsExist,

    #[msg("Maker's associated token account is missing")]
    MissingMakerAta,

    #[msg("Cannot reduce order below already-reserved amount")]
    CannotReduceBelowReserved,

    #[msg("Insufficient tokens available on this order")]
    InsufficientTokens,

    #[msg("Arithmetic calculation error")]
    CalculationError,

    #[msg("Invalid reservation index")]
    InvalidReservationIndex,

    #[msg("Invalid maker for this order")]
    InvalidMaker,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Reservation is not in Pending status")]
    ReservationNotPending,

    #[msg("Invalid mint for this order")]
    InvalidMint,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Invalid taker for this reservation")]
    InvalidTaker,

    #[msg("Invalid fee destination")]
    InvalidFeeDestination,

    #[msg("Invalid program id")]
    InvalidProgramId,

    #[msg("Invalid comment")]
    InvalidComment,

    #[msg("Invalid dispute resolution")]
    InvalidResolution,

    #[msg("Order has pending reservations and cannot proceed")]
    PendingReservationsExist,

    #[msg("Cannot dispute an already-completed transaction")]
    CannotDisputeCompletedTransaction,

    #[msg("Unauthorized disputer")]
    UnauthorizedDisputer,

    #[msg("Unauthorized resolver")]
    UnauthorizedResolver,

    #[msg("Reservation is not disputed")]
    NotDisputed,

    #[msg("Invalid payment instructions")]
    InvalidPaymentInstructions,

    #[msg("Too many reservations on this order")]
    TooManyReservations,

    #[msg("Invalid stock-ramp order type")]
    InvalidStockRampType,

    #[msg("Payment has not been sent yet")]
    PaymentNotSent,

    #[msg("Order has active token deposits and cannot be closed")]
    ActiveTokenDepositsExist,

    #[msg("No unreserved tokens available")]
    NoUnreservedTokens,

    #[msg("Reservation not found")]
    ReservationNotFound,

    #[msg("Reservation has already been processed")]
    ReservationAlreadyProcessed,

    #[msg("Fee destination's associated token account is missing")]
    MissingFeeDestinationAta,

    #[msg("Taker's associated token account is missing for refund")]
    MissingTakerAtaForRefund,

    #[msg("Invalid maker ATA authority")]
    InvalidMakerAtaAuthority,

    #[msg("Invalid credential id")]
    InvalidCredentialId,

    #[msg("Reservation limit reached for this order")]
    ReservationLimitReached,

    #[msg("Invalid escrow type")]
    InvalidEscrowType,

    #[msg("Invalid taker ATA authority")]
    InvalidTakerAtaAuthority,

    #[msg("Taker's associated token account is missing")]
    MissingTakerAta,

    #[msg("Invalid payment mode")]
    InvalidPaymentMode,

    #[msg("Insufficient amount")]
    InsufficientAmount,

    #[msg("Invalid payout reference")]
    InvalidPayoutReference,

    #[msg("Buy orders are currently paused")]
    BuyOrdersPaused,

    #[msg("Sell orders are currently paused")]
    SellOrdersPaused,

    #[msg("Invalid fee percentage — exceeds max allowed basis points")]
    InvalidFeePercentage,

    #[msg("Submitted amount does not match the reserved amount for this reservation")]
    ReservationAmountMismatch,

    // -------------------- Validator errors --------------------
    #[msg("Signer is not a registered validator")]
    UnauthorizedValidator,

    #[msg("This validator has already voted")]
    AlreadyVoted,

    #[msg("This vote has already been executed")]
    VoteAlreadyExecuted,

    #[msg("This vote has expired")]
    VoteExpired,

    #[msg("This vote has not yet expired")]
    VoteNotYetExpired,

    #[msg("Validator slots are full")]
    ValidatorSlotsFull,

    #[msg("Validator not found")]
    ValidatorNotFound,

    #[msg("Validator is already registered")]
    ValidatorAlreadyRegistered,

    #[msg("Vote slots are full")]
    VoteSlotsFull,

    #[msg("Invalid vote threshold")]
    InvalidVoteThreshold,

    #[msg("Required votes threshold exceeds registered validator count")]
    ThresholdExceedsValidators,

    #[msg("Invalid validator fee pool authority")]
    InvalidPoolAuthority,

    #[msg("Nothing to claim")]
    NothingToClaim,

    #[msg("Insufficient balance in validator fee pool")]
    InsufficientPoolBalance,

    #[msg("Reference hash does not match keccak256(payout_reference)")]
    InvalidReferenceHash,

    #[msg("Cannot remove validator while votes are in progress")]
    ActiveVotesInProgress,

    #[msg("Vote has not yet been executed")]
    VoteNotYetExecuted,
}
