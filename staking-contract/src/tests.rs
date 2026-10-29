use super::*;
use near_sdk::{testing_env, test_utils::VMContextBuilder, PromiseResult};
fn id(s: &str) -> AccountId { s.parse().unwrap() }
fn context(predecessor: &str, time: u64, deposit: u128) -> near_sdk::VMContext {
    VMContextBuilder::new().current_account_id(id("staking.testnet")).predecessor_account_id(id(predecessor)).signer_account_id(id(predecessor)).block_timestamp(time).attached_deposit(NearToken::from_yoctonear(deposit)).build()
}
fn stake(c: &mut Staking, owner: &str, amount: u128) {
    testing_env!(context("usdt.testnet", 0, 0));
    assert_eq!(c.ft_on_transfer(id(owner), U128(amount), r#"{"action":"stake"}"#.into()).0, 0);
}
#[test]
fn funded_rewards_follow_stake_and_cooldown() {
    testing_env!(context("owner.testnet", 0, 0));
    let mut c = Staking::new(id("usdt.testnet"), 60);
    stake(&mut c, "alice.testnet", 100);
    stake(&mut c, "bob.testnet", 300);
    assert_eq!(c.ft_on_transfer(id("funder.testnet"), U128(40), r#"{"action":"fund_rewards"}"#.into()).0, 0);
    assert_eq!(c.get_position(id("alice.testnet"))["rewards"], "10");
    testing_env!(context("alice.testnet", 0, 1));
    c.unstake(U128(100));
    assert_eq!(c.get_position(id("alice.testnet"))["unstaked"], "110");
    assert_eq!(c.get_position(id("alice.testnet"))["withdrawable"], "0");
    testing_env!(context("alice.testnet", 60_000_000_000, 1));
    assert_eq!(c.get_position(id("alice.testnet"))["withdrawable"], "110");
    let _ = c.withdraw(U128(110));
    assert_eq!(c.get_position(id("alice.testnet"))["withdrawable"], "0");
    testing_env!(context("staking.testnet", 60_000_000_000, 0), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    assert!(!c.on_withdraw(id("alice.testnet"), U128(110)));
    assert_eq!(c.get_position(id("alice.testnet"))["withdrawable"], "110");
}
#[test]
fn unsupported_deposits_and_empty_reward_pools_refund() {
    testing_env!(context("usdt.testnet", 0, 0));
    let mut c = Staking::new(id("usdt.testnet"), 60);
    assert_eq!(c.ft_on_transfer(id("alice.testnet"), U128(50), "{}".into()).0, 50);
    assert_eq!(c.ft_on_transfer(id("alice.testnet"), U128(50), r#"{"action":"fund_rewards"}"#.into()).0, 50);
    stake(&mut c, "alice.testnet", 100);
    assert_eq!(c.get_position(id("alice.testnet"))["rewards"], "0");
}
#[test]
fn successful_nonempty_transfer_response_does_not_restore_paid_funds() {
    testing_env!(context("usdt.testnet", 0, 0));
    let mut c = Staking::new(id("usdt.testnet"), 60);
    stake(&mut c, "alice.testnet", 100);
    testing_env!(context("alice.testnet", 0, 1)); c.unstake(U128(100));
    testing_env!(context("alice.testnet", 60_000_000_000, 1)); let _ = c.withdraw(U128(100));
    testing_env!(context("staking.testnet", 60_000_000_000, 0), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(b"null".to_vec())]);
    assert!(c.on_withdraw(id("alice.testnet"), U128(100)));
    assert_eq!(c.get_position(id("alice.testnet"))["unstaked"], "0");
}
#[test]
#[should_panic(expected = "Wrong token contract")]
fn only_configured_token_can_credit_positions() {
    testing_env!(context("attacker.testnet", 0, 0));
    let mut c = Staking::new(id("usdt.testnet"), 60);
    c.ft_on_transfer(id("alice.testnet"), U128(100), r#"{"action":"stake"}"#.into());
}
#[test]
#[should_panic(expected = "Cooldown")]
fn premature_withdrawal_is_blocked() {
    testing_env!(context("usdt.testnet", 0, 0));
    let mut c = Staking::new(id("usdt.testnet"), 60);
    stake(&mut c, "alice.testnet", 100);
    testing_env!(context("alice.testnet", 0, 1)); c.unstake(U128(100)); let _ = c.withdraw(U128(100));
}
