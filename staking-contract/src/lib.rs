//! Testnet-only Test USDT staking: real token custody, funded rewards and a cooldown.
//! Rewards are distributed only when someone deposits actual tokens as fund_rewards.
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::serde_json::json;

const SCALE: u128 = 1_000_000_000_000_000_000;

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
struct Position {
    staked: u128,
    unstaked: u128,
    rewards: u128,
    reward_index: u128,
    unlock_at: u64,
    withdrawing: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Staking {
    token_id: AccountId,
    cooldown_seconds: u32,
    total_staked: u128,
    reward_index: u128,
    positions: LookupMap<AccountId, Position>,
}

#[near]
impl Staking {
    #[init]
    pub fn new(token_id: AccountId, cooldown_seconds: u32) -> Self {
        require!(env::current_account_id().as_str().ends_with(".testnet"), "Testnet only");
        require!(token_id.as_str().ends_with(".testnet"), "Testnet token required");
        require!((1..=604800).contains(&cooldown_seconds), "Cooldown must be 1 second to 7 days");
        Self { token_id, cooldown_seconds, total_staked: 0, reward_index: 0, positions: LookupMap::new(b"p") }
    }

    fn accrued(&self, mut p: Position) -> Position {
        p.rewards = p.rewards.checked_add(p.staked.checked_mul(self.reward_index - p.reward_index).expect("Reward overflow") / SCALE).expect("Reward overflow");
        p.reward_index = self.reward_index;
        p
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        json!({"token_id": self.token_id, "cooldown_seconds": self.cooldown_seconds, "total_staked": self.total_staked.to_string(), "rewards": "funded tokens only"})
    }

    pub fn get_position(&self, account_id: AccountId) -> near_sdk::serde_json::Value {
        let p = self.accrued(self.positions.get(&account_id).cloned().unwrap_or_default());
        let ready = env::block_timestamp() >= p.unlock_at && !p.withdrawing;
        json!({"staked": p.staked.to_string(), "unstaked": p.unstaked.to_string(), "withdrawable": if ready { p.unstaked.to_string() } else { "0".into() }, "rewards": p.rewards.to_string(), "unlock_at": p.unlock_at.to_string()})
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        require!(env::predecessor_account_id() == self.token_id, "Wrong token contract");
        require!(amount.0 > 0, "Positive amount required");
        let action = near_sdk::serde_json::from_str::<near_sdk::serde_json::Value>(&msg).ok().and_then(|v| v.get("action").and_then(|a| a.as_str()).map(String::from));
        if action.as_deref() == Some("fund_rewards") {
            if self.total_staked == 0 { return amount; }
            self.reward_index = self.reward_index.checked_add(amount.0.checked_mul(SCALE).expect("Reward overflow") / self.total_staked).expect("Reward overflow");
            return U128(0);
        }
        if action.as_deref() != Some("stake") { return amount; }
        let mut p = self.accrued(self.positions.get(&sender_id).cloned().unwrap_or_default());
        require!(!p.withdrawing, "Withdrawal in progress");
        p.staked = p.staked.checked_add(amount.0).expect("Stake overflow");
        self.total_staked = self.total_staked.checked_add(amount.0).expect("Stake overflow");
        self.positions.insert(sender_id, p);
        U128(0)
    }

    #[payable]
    pub fn unstake(&mut self, amount: U128) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "Attach 1 yoctoNEAR");
        let owner = env::predecessor_account_id();
        let mut p = self.accrued(self.positions.get(&owner).cloned().unwrap_or_default());
        require!(!p.withdrawing && amount.0 > 0 && amount.0 <= p.staked, "Invalid unstake amount");
        let reward = p.rewards.checked_mul(amount.0).expect("Reward overflow") / p.staked;
        p.rewards -= reward;
        p.staked -= amount.0;
        self.total_staked -= amount.0;
        p.unstaked = p.unstaked.checked_add(amount.0).and_then(|v| v.checked_add(reward)).expect("Unstake overflow");
        p.unlock_at = env::block_timestamp() + u64::from(self.cooldown_seconds) * 1_000_000_000;
        self.positions.insert(owner, p);
    }

    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "Attach 1 yoctoNEAR");
        let owner = env::predecessor_account_id();
        let mut p = self.positions.get(&owner).cloned().unwrap_or_default();
        require!(!p.withdrawing && env::block_timestamp() >= p.unlock_at, "Cooldown or withdrawal in progress");
        require!(amount.0 > 0 && amount.0 <= p.unstaked, "Invalid withdrawal amount");
        p.unstaked -= amount.0;
        p.withdrawing = true;
        self.positions.insert(owner.clone(), p);
        Promise::new(self.token_id.clone()).function_call("ft_transfer", json!({"receiver_id": owner, "amount": amount, "memo": "Mandate unstaked Test USDT"}).to_string().into_bytes(), NearToken::from_yoctonear(1), Gas::from_tgas(30))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_withdraw(owner, amount))
    }

    #[private]
    pub fn on_withdraw(&mut self, owner: AccountId, amount: U128) -> bool {
        // A successful token transfer may return nonempty data. TooLong still means
        // success; restoring those already-transferred funds would allow double claims.
        let success = env::promise_results_count() == 1 && !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed));
        let mut p = self.positions.get(&owner).cloned().expect("Missing position");
        p.withdrawing = false;
        if !success { p.unstaked = p.unstaked.checked_add(amount.0).expect("Withdrawal overflow"); }
        self.positions.insert(owner, p);
        success
    }
}

#[cfg(test)]
mod tests;
