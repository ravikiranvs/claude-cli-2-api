# SQLite as sole storage backend

Gateway API Keys and Traces are stored in a single SQLite file inside the container. The expected load is low (a handful of keys, a week's worth of traces, 2–3 concurrent requests), and SQLite eliminates any external service dependency — the container is self-contained. The trade-off is that horizontal scaling requires migrating to an external database; that cost is acceptable given the single-instance deployment model.
