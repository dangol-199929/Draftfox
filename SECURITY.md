# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Email **contact.sandeepdangol@gmail.com** with what you found, how to reproduce it and what it could affect. You'll get a reply as soon as possible, and a fix will be released before the details are made public.

## How Draftfox handles your data

- Draftfox is meant to run on your own computer (`localhost`). Don't expose it to the internet: it has no login, so anyone who can reach it could read your drafts and post as you.
- Your LinkedIn access token is stored in `data/linkedin.json` (readable only by your user) and is never sent to the browser or written to logs.
- Your LinkedIn app's Client ID and secret live in `.env`, which is ignored by git. Never commit it.
- `data/` (drafts, images, database, token) is ignored by git too.
