use anchor_lang::prelude::*;

#[error_code]
pub enum AmmError {

        #[msg("DefaultError")]
        DefaultError,
        #[msg("Slippage exceeded.")]
        SlippageExceeded,
        #[msg("Invalid token.")]
        InvalidToken,
        #[msg("Bump error.")]
        BumpError,
        #[msg("Insufficient balance.")]
        InsufficientBalance,
        #[msg("The Pool is Locked Currently")]
        PoolLocked,
        #[msg("The Amount You Entered Is Invalid")]
        InvalidAmount,


}
