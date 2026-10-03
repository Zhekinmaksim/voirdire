# Original development/comparison data

The compressed file expands byte-for-byte to the old dataset pinned in the v3 manifest. It contains generic probe responses, provider receipts and cost metadata; credentials are excluded. It is development data, not fresh confirmation.

SHA-256 after decompression: `1562a7e25234adec12971b9b9b0d88a69d6705cc9d4253a04c39f78ff543d466`.

```sh
gzip -dc chain-and-site/calibration/data/openrouter-groq-merged.jsonl.gz > /tmp/voirdire-old.jsonl
```

Pass `/tmp/voirdire-old.jsonl` as the fresh confirmation gate's `--old-source`. This permits independent freshness and scoring audits without access to ignored local runs.
