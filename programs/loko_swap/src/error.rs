use anchor_lang::prelude::*;

#[error_code]
pub enum AmmError {
    #[msg("DefaultError")]
    DefaultError,
    #[msg("Offer expired.")]
    OfferExpired,
    #[msg("This pool is locked.")]
    PoolLocked,
    #[msg("Slippage exceeded.")]
    SlippageExceeded,
    #[msg("Overflow detected.")]
    Overflow,
    #[msg("Underflow detected.")]
    Underflow,
    #[msg("Invalid token.")]
    InvalidToken,
    #[msg("Actual liquidity is less than minimum.")]
    LiquidityLessThanMinimum,
    #[msg("No liquidity in pool.")]
    NoLiquidityInPool,
    #[msg("Bump error.")]
    BumpError,
    #[msg("Curve error.")]
    CurveError,
    #[msg("Fee is greater than 100%. This is not a very good deal.")]
    InvalidFee,
    #[msg("Invalid update authority.")]
    InvalidAuthority,
    #[msg("No update authority set.")]
    NoAuthoritySet,
    #[msg("Invalid amount.")]
    InvalidAmount,
    #[msg("Transfer hook extension not found.")]
    TransferHookNotFound,
    #[msg("Transfer fee extension not found.")]
    TransferFeeNotFound,
    #[msg("Identical mints not allowed")]
    IdenticalMints,
    #[msg("Invalid token program")]
    InvalidTokenProgram,
    #[msg("Unsupported token extension")]
    UnsupportedExtension,
    #[msg("Math Overflow")]
    MathOverflow,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    
}

