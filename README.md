# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/murnikak27-blip/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/murnikak27-blip/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: every protocol in the sealed DefiLlama snapshot that records no token, ranked by what a token would be worth if the protocol's record stayed exactly as it is. The value model prices each protocol from the snapshot's own figures — TVL times the median market-cap/TVL multiple of its tokenized category peers (shrunk toward the global median, ratios winsorized), adjusted for seven-day momentum, tokenless age and chain reach, with versioned children of tokenized parents discounted because their value accrues to the parent's token. Custodial records (bridges, liquid staking, exchange balances) are left off the board. The dashboard is sortable and filterable, opens a detail view per protocol showing its own arithmetic, and gives every row a concrete farm plan with capital and time. The board covers all 40 watchlist protocols and 213 rows in all.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=y32rxgm2&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
