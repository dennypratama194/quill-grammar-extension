# Contributing to Quill

Thanks for your interest in improving Quill.

## Before submitting a change

- Search existing issues and pull requests to avoid duplicating work.
- For complex features, open an issue first to discuss the intended behavior.
- Do not include private text, credentials, API keys, or real account details in issues, tests, screenshots, or commits.

## Local development

Install Node.js 20+ and run:

```bash
npm ci
npm run verify
npx playwright install chromium
npm run test:e2e
```

The extension is intentionally framework-free. Keep changes focused and preserve keyboard interaction, text-selection safety, and HTML escaping.

For new editor integrations, please include a minimal test page or automated test where possible. AI calls are stubbed in the existing E2E suite, so no personal API key is necessary.

## Pull requests

Explain what changed, why it changed, and how you tested it. Describe any new permissions, API calls, third-party dependencies, or privacy implications.

By contributing, you agree that your contributions will be licensed under the project's MIT License.

