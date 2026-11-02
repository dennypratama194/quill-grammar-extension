# Security policy

## Reporting a vulnerability

Please report security issues privately through the repository's **Security** tab using GitHub's private vulnerability reporting feature, if enabled.

Do **not** post working exploits, credentials, API keys, sensitive user text, or security findings with active risk in a public GitHub issue.

If private vulnerability reporting is not available, open a public issue requesting a private contact channel **without including vulnerability details**.

## Security and privacy considerations

Quill is a local Chrome extension that sends **only text selected and submitted by the user** to Anthropic's API. API credentials are stored in Chrome's local extension storage and used by its background worker.

Using a personal API key can incur usage charges. Keep your API key private and configure billing controls in your Anthropic account.

Quill works on many websites via its content script. Only use it with text you are permitted to send to an external AI provider.

