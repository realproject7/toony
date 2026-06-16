# Security Policy

## Reporting A Vulnerability

Please report security issues privately to the maintainer instead of opening a
public issue with exploit details.

Do not include API keys, access tokens, private project files, provider
credentials, wallet keys, or other secrets in GitHub issues, pull requests,
comments, commits, logs, screenshots, or test fixtures.

## Public Repository Rules

This repository is public. All issues, pull requests, review comments, logs, and
documentation must be safe to publish.

Never commit:

- API keys or provider credentials
- OAuth tokens
- wallet keys or seed phrases
- private customer or creator files
- paid provider account details
- local machine secrets
- unredacted logs containing credentials

If a secret is accidentally committed, rotate it immediately and rewrite history
only after coordinating with the maintainer.
