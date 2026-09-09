# TM-131 — the Kimi quota pattern, fired against live panes

Captured 2026-09-09 on this machine, against the real tmux server (46 panes), using the shipped
`providers/kimi.json` entry and `topology/lib/census.mjs`'s `classify`. Read-only throughout:
`list-panes`, `capture-pane -S -20`, `display-message`. No keys were sent to any pane.

This is the failure that **killed two implementers mid-task** during the swarm that produced this
epic, recovered only by a human authorising a manual Codex takeover. It was previously indetectable
as anything more specific than "a failure".

## Four panes, matched

| pane | session | adapter | census state |
|---|---|---|---|
| `%113` | `ao-marketplace-kimi-tm127-20260909` | kimi | `quota-blocked` |
| `%24` | `bytedesk-emote-gateway-kimi-GZmJdqJxa6Kg` | kimi | `quota-blocked` |
| `%40` | `bytedesk-emote-gateway-kimi-GoOTqFEbtq0R` | kimi | `quota-blocked` |
| `%14` | `bytedesk-emote-gateway-kimi-Jiw-R3UM7OEy` | kimi | `quota-blocked` |

## The lines that matched

Two different renderings, which is the whole argument for anchoring on the fragment.

```
%24  Error: [provider.auth_error] 403 You've reached your 5-hour usage limit.
%40  Error: [provider.auth_error] 403 You've reached your 5-hour usage limit. Your
%14  Error: [provider.auth_error] 403 You've reached your 5-hour usage limit.
%113 │      Error: 403 You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends. To continue now, purchase extra usage or upgrade your plan:
```

`%113` has **no `[provider.auth_error]` prefix at all** and is wrapped in a box-drawing frame. A
pattern anchored on the full observed string from the brief would have matched three of these four
panes and missed the fourth — and the fourth is the one in this repo's own TM-127 session.

The shipped pattern is `reached your \\d+-hour usage limit`:

- **no `/`** — survives `withoutPaths`, which blanks every whitespace-delimited token containing a
  slash before matching. `5-hour` has none.
- **no `{`, `}` or `:`** — survives `tmuxFailureTrigger`, which drops any pattern tmux's format
  parser cannot read. `[provider.auth_error]`'s colon would have got the whole entry dropped, and a
  dropped pattern never fires on the subscription path **at all**, silently.
- **`\\d+`** rather than a literal `5` — the window length is an account/plan property, not a
  constant.

Verified mechanically in `tests/unit/topology-census.test.mjs` →
*"the kimi quota pattern survives withoutPaths AND tmuxFailureTrigger"*.

## The behaviour change, demonstrated

Against the real adapter and the real string:

```
failureOnScreen   -> "usage limit"          <- the generic failure list matches too
attentionOnScreen -> "quota-blocked"        <- and so does the new entry
evaluateScreen    -> { ready:false, failed:true, attention:true,
                       reason:"Kimi has hit its rolling usage limit for this account. …" }
tmuxFailureTrigger contains the pattern -> true
```

`attentionOnScreen` is checked **before** `failureOnScreen` in both `evaluateScreen` and the
subscription path, so the attention entry wins. Before this change the same screen produced a bare
`screen matched failure pattern /usage limit/` and triggered failover to the next candidate.

That is a **launch behaviour change, not only a census one**, and it is in the CHANGELOG as such: a
run that relied on failover to move off an exhausted Kimi will now hold with an operator message
instead. It is the right ordering — "wait for the window" is not "this provider is down" — but it is
a change, and `failover` remains the explicit way to move.

## Performance, same run

One census over all 46 live panes: **248 ms**, 40 captures (budget lifted for the probe; the
shipped default is 8). Six panes were decided by pane title alone and cost no capture at all. The
number is published as `tickMs` in every census document so a regression shows up instead of being
felt.

Three panes exceeded the probe's capture budget and were reported `unknown`
("pane title was inconclusive and no capture was taken") rather than `idle` — the rationing path
behaving as specified, observed rather than only asserted.
