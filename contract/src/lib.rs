//! KORD escrow.
//!
//! An owner funds a mandate with NEAR. Only a designated verifier account can release
//! payments, and the contract itself enforces: total budget, per-agent cap, recipient
//! allowlist, one payment per task, and that the verifier is never a paid agent.
//! Models and agents never hold a key that can move these funds.
//!
//! Amounts are in yoctoNEAR (`NearToken`). State is updated before any transfer
//! (checks-effects-interactions) and rolled back in a callback if the transfer fails.

use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};

const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const MAX_AGENTS: usize = 20;
const MAX_ID_LEN: usize = 64;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Active,
    Closed,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Mandate {
    pub owner: AccountId,
    pub verifier: AccountId,
    pub budget: u128,
    pub per_agent_cap: u128,
    /// Total reserved or paid out (includes in-flight transfers).
    pub spent: u128,
    /// Total reserved or sent back to the owner.
    pub refunded: u128,
    pub allowed_agents: Vec<AccountId>,
    pub status: Status,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MandateView {
    pub owner: AccountId,
    pub verifier: AccountId,
    pub budget: U128,
    pub per_agent_cap: U128,
    pub spent: U128,
    pub refunded: U128,
    pub remaining: U128,
    pub allowed_agents: Vec<AccountId>,
    pub status: Status,
}

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum Key {
    Mandates,
    AgentSpent,
    PaidTasks,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MandateEscrow {
    mandates: LookupMap<String, Mandate>,
    agent_spent: LookupMap<String, u128>,
    paid_tasks: LookupSet<String>,
}

fn composite(a: &str, b: &str) -> String {
    format!("{a}|{b}")
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_ID_LEN && !s.contains('|')
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "mandate_escrow", "version": "1.0.0", "event": event, "data": data })
    ));
}

#[near]
impl MandateEscrow {
    #[init]
    pub fn new() -> Self {
        Self {
            mandates: LookupMap::new(Key::Mandates),
            agent_spent: LookupMap::new(Key::AgentSpent),
            paid_tasks: LookupSet::new(Key::PaidTasks),
        }
    }

    /// Create and fund a mandate. The attached deposit becomes the budget. The caller is the owner.
    #[payable]
    pub fn create_mandate(
        &mut self,
        mandate_id: String,
        verifier: AccountId,
        per_agent_cap: NearToken,
        allowed_agents: Vec<AccountId>,
    ) {
        require!(valid_id(&mandate_id), "Invalid mandate_id (1-64 chars, no '|')");
        require!(!self.mandates.contains_key(&mandate_id), "Mandate id already exists");
        let budget = env::attached_deposit().as_yoctonear();
        require!(budget > 0, "Attach a deposit: it becomes the mandate budget");
        require!(per_agent_cap.as_yoctonear() > 0, "per_agent_cap must be positive");
        require!(
            !allowed_agents.is_empty() && allowed_agents.len() <= MAX_AGENTS,
            "Provide 1 to 20 allowed agents"
        );
        let mut seen: Vec<&AccountId> = Vec::new();
        for a in &allowed_agents {
            require!(!seen.contains(&a), "Duplicate agent in allowlist");
            require!(*a != verifier, "Verifier cannot also be a paid agent");
            seen.push(a);
        }
        let owner = env::predecessor_account_id();
        self.mandates.insert(
            mandate_id.clone(),
            Mandate {
                owner: owner.clone(),
                verifier: verifier.clone(),
                budget,
                per_agent_cap: per_agent_cap.as_yoctonear(),
                spent: 0,
                refunded: 0,
                allowed_agents: allowed_agents.clone(),
                status: Status::Active,
            },
        );
        emit(
            "mandate_created",
            json!({ "mandate_id": mandate_id, "owner": owner, "verifier": verifier,
                    "budget": budget.to_string(), "per_agent_cap": per_agent_cap.as_yoctonear().to_string(),
                    "allowed_agents": allowed_agents }),
        );
    }

    /// Release a payment for a verified task. Callable only by the mandate's verifier.
    /// `evidence_hash` is recorded in the event log for the audit trail.
    pub fn approve_payment(
        &mut self,
        mandate_id: String,
        task_id: String,
        agent: AccountId,
        amount: NearToken,
        evidence_hash: String,
    ) -> Promise {
        require!(valid_id(&task_id), "Invalid task_id (1-64 chars, no '|')");
        let mut m = self.mandates.get(&mandate_id).cloned().unwrap_or_else(|| env::panic_str("Unknown mandate"));
        require!(env::predecessor_account_id() == m.verifier, "Only the verifier can approve payments");
        require!(m.status == Status::Active, "Mandate is closed");
        require!(m.allowed_agents.contains(&agent), "Agent is not on the allowlist");
        let amt = amount.as_yoctonear();
        require!(amt > 0, "Amount must be positive");

        let task_key = composite(&mandate_id, &task_id);
        require!(!self.paid_tasks.contains(&task_key), "Task already paid");

        let new_spent = m.spent.checked_add(amt).unwrap_or_else(|| env::panic_str("overflow"));
        require!(
            new_spent + m.refunded <= m.budget,
            "Payment exceeds the remaining budget"
        );
        let agent_key = composite(&mandate_id, agent.as_str());
        let agent_total = self.agent_spent.get(&agent_key).copied().unwrap_or(0);
        let new_agent_total = agent_total.checked_add(amt).unwrap_or_else(|| env::panic_str("overflow"));
        require!(new_agent_total <= m.per_agent_cap, "Payment exceeds the per-agent cap");

        // Effects first: reserve the budget and mark the task paid before the transfer.
        m.spent = new_spent;
        self.mandates.insert(mandate_id.clone(), m);
        self.agent_spent.insert(agent_key, new_agent_total);
        self.paid_tasks.insert(task_key);

        emit(
            "payment_authorized",
            json!({ "mandate_id": mandate_id, "task_id": task_id, "agent": agent,
                    "amount": amt.to_string(), "evidence_hash": evidence_hash }),
        );

        Promise::new(agent.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_payout(mandate_id, task_id, agent, U128(amt)),
        )
    }

    /// Roll back the reservation if the transfer failed.
    #[private]
    pub fn on_payout(&mut self, mandate_id: String, task_id: String, agent: AccountId, amount: U128) -> bool {
        let ok = env::promise_results_count() == 1 && env::promise_result_checked(0, 0).is_ok();
        if ok {
            emit("payment_confirmed", json!({ "mandate_id": mandate_id, "task_id": task_id, "agent": agent, "amount": amount.0.to_string() }));
            return true;
        }
        if let Some(mut m) = self.mandates.get(&mandate_id).cloned() {
            m.spent = m.spent.saturating_sub(amount.0);
            self.mandates.insert(mandate_id.clone(), m);
        }
        let agent_key = composite(&mandate_id, agent.as_str());
        let cur = self.agent_spent.get(&agent_key).copied().unwrap_or(0);
        self.agent_spent.insert(agent_key, cur.saturating_sub(amount.0));
        self.paid_tasks.remove(&composite(&mandate_id, &task_id));
        emit("payment_failed", json!({ "mandate_id": mandate_id, "task_id": task_id, "agent": agent, "amount": amount.0.to_string() }));
        false
    }

    /// Stop all further payments. Owner only. In-flight payments still settle.
    pub fn close_mandate(&mut self, mandate_id: String) {
        let mut m = self.mandates.get(&mandate_id).cloned().unwrap_or_else(|| env::panic_str("Unknown mandate"));
        require!(env::predecessor_account_id() == m.owner, "Only the owner can close the mandate");
        require!(m.status == Status::Active, "Mandate already closed");
        m.status = Status::Closed;
        self.mandates.insert(mandate_id.clone(), m);
        emit("mandate_closed", json!({ "mandate_id": mandate_id }));
    }

    /// Return unspent funds to the owner. Owner only, and only after the mandate is closed.
    pub fn refund_remaining(&mut self, mandate_id: String) -> Promise {
        let mut m = self.mandates.get(&mandate_id).cloned().unwrap_or_else(|| env::panic_str("Unknown mandate"));
        require!(env::predecessor_account_id() == m.owner, "Only the owner can refund");
        require!(m.status == Status::Closed, "Close the mandate before refunding");
        let amt = m.budget - m.spent - m.refunded;
        require!(amt > 0, "Nothing to refund");
        m.refunded += amt;
        let owner = m.owner.clone();
        self.mandates.insert(mandate_id.clone(), m);
        emit("refund_authorized", json!({ "mandate_id": mandate_id, "amount": amt.to_string() }));
        Promise::new(owner).transfer(NearToken::from_yoctonear(amt)).then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_refund(mandate_id, U128(amt)),
        )
    }

    #[private]
    pub fn on_refund(&mut self, mandate_id: String, amount: U128) -> bool {
        let ok = env::promise_results_count() == 1 && env::promise_result_checked(0, 0).is_ok();
        if !ok {
            if let Some(mut m) = self.mandates.get(&mandate_id).cloned() {
                m.refunded = m.refunded.saturating_sub(amount.0);
                self.mandates.insert(mandate_id.clone(), m);
            }
            emit("refund_failed", json!({ "mandate_id": mandate_id, "amount": amount.0.to_string() }));
        }
        ok
    }

    // ---- Views ----

    pub fn get_mandate(&self, mandate_id: String) -> Option<MandateView> {
        self.mandates.get(&mandate_id).map(|m| MandateView {
            owner: m.owner.clone(),
            verifier: m.verifier.clone(),
            budget: U128(m.budget),
            per_agent_cap: U128(m.per_agent_cap),
            spent: U128(m.spent),
            refunded: U128(m.refunded),
            remaining: U128(m.budget - m.spent - m.refunded),
            allowed_agents: m.allowed_agents.clone(),
            status: m.status,
        })
    }

    pub fn agent_spent(&self, mandate_id: String, agent: AccountId) -> U128 {
        U128(self.agent_spent.get(&composite(&mandate_id, agent.as_str())).copied().unwrap_or(0))
    }

    pub fn is_task_paid(&self, mandate_id: String, task_id: String) -> bool {
        self.paid_tasks.contains(&composite(&mandate_id, &task_id))
    }
}

#[cfg(test)]
mod tests;
