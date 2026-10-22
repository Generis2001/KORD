use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult};

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}
fn ctx(predecessor: &str, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("escrow.testnet"))
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(deposit)
        .build());
}
fn callback_ctx(result: PromiseResult) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acc("escrow.testnet"))
            .predecessor_account_id(acc("escrow.testnet"))
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

/// 10 NEAR budget, 4 NEAR per-agent cap, agents agent1 and agent2, verifier verifier.testnet.
fn setup() -> MandateEscrow {
    ctx("owner.testnet", near(10));
    let mut c = MandateEscrow::new();
    c.create_mandate(
        "m1".into(),
        acc("verifier.testnet"),
        near(4),
        vec![acc("agent1.testnet"), acc("agent2.testnet")],
    );
    c
}
fn pay(c: &mut MandateEscrow, who: &str, task: &str, agent: &str, amt: NearToken) {
    ctx(who, NearToken::from_yoctonear(0));
    let _ = c.approve_payment("m1".into(), task.into(), acc(agent), amt, "hash".into());
}

#[test]
fn creates_mandate_with_deposit_as_budget() {
    let c = setup();
    let v = c.get_mandate("m1".into()).unwrap();
    assert_eq!(v.budget.0, near(10).as_yoctonear());
    assert_eq!(v.remaining.0, near(10).as_yoctonear());
    assert_eq!(v.status, Status::Active);
}

#[test]
#[should_panic(expected = "Attach a deposit")]
fn rejects_zero_budget() {
    ctx("owner.testnet", NearToken::from_yoctonear(0));
    let mut c = MandateEscrow::new();
    c.create_mandate("m1".into(), acc("v.testnet"), near(1), vec![acc("a.testnet")]);
}

#[test]
#[should_panic(expected = "Mandate id already exists")]
fn rejects_duplicate_mandate_id() {
    let mut c = setup();
    ctx("owner.testnet", near(1));
    c.create_mandate("m1".into(), acc("verifier.testnet"), near(1), vec![acc("agent1.testnet")]);
}

#[test]
#[should_panic(expected = "Verifier cannot also be a paid agent")]
fn verifier_cannot_be_an_agent() {
    ctx("owner.testnet", near(1));
    let mut c = MandateEscrow::new();
    c.create_mandate("m1".into(), acc("v.testnet"), near(1), vec![acc("v.testnet")]);
}

#[test]
#[should_panic(expected = "Duplicate agent")]
fn rejects_duplicate_agents() {
    ctx("owner.testnet", near(1));
    let mut c = MandateEscrow::new();
    c.create_mandate("m1".into(), acc("v.testnet"), near(1), vec![acc("a.testnet"), acc("a.testnet")]);
}

#[test]
#[should_panic(expected = "Invalid mandate_id")]
fn rejects_bad_mandate_id() {
    ctx("owner.testnet", near(1));
    let mut c = MandateEscrow::new();
    c.create_mandate("bad|id".into(), acc("v.testnet"), near(1), vec![acc("a.testnet")]);
}

#[test]
fn verifier_can_pay_within_limits_and_state_updates() {
    let mut c = setup();
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", near(3));
    let v = c.get_mandate("m1".into()).unwrap();
    assert_eq!(v.spent.0, near(3).as_yoctonear());
    assert_eq!(v.remaining.0, near(7).as_yoctonear());
    assert_eq!(c.agent_spent("m1".into(), acc("agent1.testnet")).0, near(3).as_yoctonear());
    assert!(c.is_task_paid("m1".into(), "t1".into()));
}

#[test]
#[should_panic(expected = "Only the verifier can approve payments")]
fn owner_cannot_approve() {
    let mut c = setup();
    pay(&mut c, "owner.testnet", "t1", "agent1.testnet", near(1));
}

#[test]
#[should_panic(expected = "Only the verifier can approve payments")]
fn agent_cannot_self_approve() {
    let mut c = setup();
    pay(&mut c, "agent1.testnet", "t1", "agent1.testnet", near(1));
}

#[test]
#[should_panic(expected = "per-agent cap")]
fn per_agent_cap_is_enforced() {
    let mut c = setup();
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", near(5));
}

#[test]
#[should_panic(expected = "per-agent cap")]
fn cap_counts_cumulative_spend() {
    let mut c = setup();
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", near(3));
    pay(&mut c, "verifier.testnet", "t2", "agent1.testnet", near(2));
}

#[test]
#[should_panic(expected = "remaining budget")]
fn total_budget_is_enforced() {
    // 10 NEAR budget, per-agent cap raised to 100 so only the total budget can stop it.
    ctx("owner.testnet", near(10));
    let mut c = MandateEscrow::new();
    c.create_mandate("m1".into(), acc("verifier.testnet"), near(100), vec![acc("agent1.testnet")]);
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", near(6));
    pay(&mut c, "verifier.testnet", "t2", "agent1.testnet", near(5));
}

#[test]
#[should_panic(expected = "not on the allowlist")]
fn non_allowlisted_agent_is_rejected() {
    let mut c = setup();
    pay(&mut c, "verifier.testnet", "t1", "attacker.testnet", near(1));
}

#[test]
#[should_panic(expected = "Task already paid")]
fn a_task_cannot_be_paid_twice() {
    let mut c = setup();
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", near(1));
    pay(&mut c, "verifier.testnet", "t1", "agent2.testnet", near(1));
}

#[test]
#[should_panic(expected = "Amount must be positive")]
fn zero_amount_is_rejected() {
    let mut c = setup();
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", NearToken::from_yoctonear(0));
}

#[test]
#[should_panic(expected = "Mandate is closed")]
fn closed_mandate_rejects_payments() {
    let mut c = setup();
    ctx("owner.testnet", NearToken::from_yoctonear(0));
    c.close_mandate("m1".into());
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", near(1));
}

#[test]
fn failed_transfer_rolls_back_reservation() {
    let mut c = setup();
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", near(3));
    callback_ctx(PromiseResult::Failed);
    let ok = c.on_payout("m1".into(), "t1".into(), acc("agent1.testnet"), U128(near(3).as_yoctonear()));
    assert!(!ok);
    let v = c.get_mandate("m1".into()).unwrap();
    assert_eq!(v.spent.0, 0);
    assert_eq!(c.agent_spent("m1".into(), acc("agent1.testnet")).0, 0);
    assert!(!c.is_task_paid("m1".into(), "t1".into()));
}

#[test]
fn successful_transfer_keeps_state() {
    let mut c = setup();
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", near(3));
    callback_ctx(PromiseResult::Successful(vec![]));
    assert!(c.on_payout("m1".into(), "t1".into(), acc("agent1.testnet"), U128(near(3).as_yoctonear())));
    assert_eq!(c.get_mandate("m1".into()).unwrap().spent.0, near(3).as_yoctonear());
    assert!(c.is_task_paid("m1".into(), "t1".into()));
}

#[test]
#[should_panic(expected = "Only the owner can close")]
fn only_owner_can_close() {
    let mut c = setup();
    ctx("verifier.testnet", NearToken::from_yoctonear(0));
    c.close_mandate("m1".into());
}

#[test]
#[should_panic(expected = "Close the mandate before refunding")]
fn refund_requires_closed_mandate() {
    let mut c = setup();
    ctx("owner.testnet", NearToken::from_yoctonear(0));
    let _ = c.refund_remaining("m1".into());
}

#[test]
fn refund_returns_only_unspent_funds_and_cannot_repeat() {
    let mut c = setup();
    pay(&mut c, "verifier.testnet", "t1", "agent1.testnet", near(3));
    ctx("owner.testnet", NearToken::from_yoctonear(0));
    c.close_mandate("m1".into());
    let _ = c.refund_remaining("m1".into());
    let v = c.get_mandate("m1".into()).unwrap();
    assert_eq!(v.refunded.0, near(7).as_yoctonear());
    assert_eq!(v.remaining.0, 0);
}

#[test]
#[should_panic(expected = "Nothing to refund")]
fn second_refund_is_rejected() {
    let mut c = setup();
    ctx("owner.testnet", NearToken::from_yoctonear(0));
    c.close_mandate("m1".into());
    let _ = c.refund_remaining("m1".into());
    let _ = c.refund_remaining("m1".into());
}

#[test]
fn failed_refund_is_restored() {
    let mut c = setup();
    ctx("owner.testnet", NearToken::from_yoctonear(0));
    c.close_mandate("m1".into());
    let _ = c.refund_remaining("m1".into());
    callback_ctx(PromiseResult::Failed);
    assert!(!c.on_refund("m1".into(), U128(near(10).as_yoctonear())));
    assert_eq!(c.get_mandate("m1".into()).unwrap().refunded.0, 0);
}
