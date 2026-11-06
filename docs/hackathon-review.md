# KORD: NEAR Hackathon review

Reviewed November 5–6, 2026. Repository: [Generis2001/KORD](https://github.com/Generis2001/KORD). Demo: [kord-generis2001.vercel.app](https://kord-generis2001.vercel.app).

KORD fits three tracks. The published rules permit testnet-only projects and do not require NEAR AI Cloud, NEAR Intents, Chain Signatures or confidential inference. A working NEAR contract relevant to the track is sufficient. Track fit supports entering; human judges decide the outcome.

| Track | Implemented connection |
| --- | --- |
| AI Security & Defense (`security`) | Owner signatures, separate agent accounts, recipient allowlists, spending limits, durable transaction recovery and contract-enforced research escrow. This is the strongest match. |
| Autonomous Business (`business`) | Public business research, source comparisons, local model analysis and a treasury controlled by explicit user directives. Purchases and unpublished commercial terms are not invented. |
| Agent Economy (`agents`) | An exact user-authorized research fee can pay the configured researcher through verified NEAR escrow. Research without a fee remains free; a budget alone does not create a fee. |

## Sources reviewed

- [Official announcement on X](https://x.com/NEARProtocol/status/2112257967818997891), October 19; read through the public embed.
- [Founder project-ideas post](https://x.com/ilblackdragon/status/2106269343881519444), linked by the official article. Its public embed was truncated, so it was treated as inspiration rather than a complete rules source.
- [NEAR article: Build Beyond Boundaries](https://www.near.org/blog/near-hackathon-build-beyond-boundaries), October 19; full article reviewed. The separate X article required login.
- [Hackathon website and submission form](https://nearhackathon.com/).
- [Published rules and FAQ](https://nearhackathon.com/HACKATHON.md), including Q-001 (build window), Q-010 (testnet), Q-011 (optional integrations), Q-014 (license) and Q-017 (AI screening and human judging).
- Public GitHub repository metadata and commit history, local source and tests, hosted demo, public Ref Finance data and read-only NEAR RPC.

## Repository and commit dates

The repository was created October 22, 2026 at 07:10:52 UTC. All 33 commits at the reviewed baseline have author and committer timestamps inside the allowed October 19–November 14 build window.

| Commit | Author and committer time (UTC) |
| --- | --- |
| First: `4bfbce483562e39b90069827acd2915db9f77bd4` | October 22, 2026, 14:51:52 |
| Baseline: `00dad2952fa2f68a23d5633f77b7b53f4643aa96` | November 3, 2026, 22:46:33 |

Local HEAD matched public main before the changes in this review. GitHub repository creation metadata corroborates the reported history; Git timestamps do not independently prove every file's original authorship. The rename retains the same GitHub repository and history. New work keeps its actual commit date.

## Changes made during the review

- Renamed the app, repository, documentation and package branding to KORD, with “Programmable control for autonomous agents” and an Instrument Serif Italic K outline.
- Added the root MIT [LICENSE](../LICENSE), fixing the missing license file.
- Added local Qwen3 inference through Ollama for planning, evidence-based analysis and a separate verification pass. There is no NEAR AI Cloud or other paid inference call.
- Model citations select bounded source passages by ID; KORD attaches their exact original text. Invalid citations, unsupported numbers, failed stages and failed source checks block research settlement. Wallet state and fee authorization do not enter model requests.
- Bound private conversations to signed wallet ownership proofs. Long research admits a fresh signed directive and rechecks its installed key before settling, so expiry during research does not alter the fee and key revocation still blocks payment.

The live wallet derivation namespace, installed authentication method, deployed account IDs, contract ABI, event standard, DEX configuration and staking providers remain compatible. Existing on-chain addresses can still contain the former name: changing them would create different recipients or contracts. No funds were moved or contracts redeployed for this review.

## Verification and limits

At baseline, 217 tests across 20 files passed. After the changes, all 246 tests across 23 files, TypeScript checking and the Meteor wallet build passed. New cases cover exact optional fees, invalid source citations, unsupported numbers, shipping and arrival distinctions, model failures, revoked keys and private conversations. The hosted baseline demo completed free Ref Finance research with two sources and no requested payout. Read-only RPC confirmed deployed escrow code. Tests use fictional evidence or mocked providers and do not spend funds.

Rust tests could not run because no Rust toolchain was installed. The app walkthrough uses existing deployed contracts. A historical payout receipt in the README could not be independently verified through the explorer API; it is not claimed as a new verified payout.

Local inference requires the computer, Ollama and authenticated tunnel to remain running. A restarted free tunnel changes the URL; update Vercel's model endpoint and deploy afterward. The small CPU model can miss nuance; source provenance and a model review do not independently certify a publisher's claims.

## Submission status and deadline

The directory entry linked to `@PostcardCrypto` belongs to someone else, as confirmed by the project owner. It is not KORD's submission. No X post or hackathon submission was sent during this work.

Development and submission close **November 14, 2026 at 23:59 UTC**, which is **November 15 at 00:59 in Lagos**. The owner needs their own public X demo post stating that KORD was built at NEAR HACKATHON, tagging `@NEARProtocol` and `#NEARHackathon`, with a demo video or screenshots. Submit once through the official form with the public KORD repository, that post, the three track IDs and the owner's actual mainnet prize account. Recheck the live rules before submitting, and keep the demo and model server available through judging.
