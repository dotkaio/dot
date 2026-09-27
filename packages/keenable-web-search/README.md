# @dotkaio/dot-keenable-web-search

Built-in live web research for Dot, powered by [Keenable](https://keenable.ai).

The package registers two read-only tools:

- `web_search` searches the live web and returns ranked, citable sources.
- `web_fetch` reads one public page and returns its main content as citable Markdown.

Dot loads this package by default. Search and fetch work without credentials through Keenable's rate-limited public endpoints. Set `KEENABLE_API_KEY` to use authenticated endpoints with higher limits:

```bash
export KEENABLE_API_KEY="your-api-key"
dot
```

The tools support cancellation, bounded output, site and date filters, HTTPS-only API configuration, and client-side rejection of private fetch targets. Set `KEENABLE_API_URL` only when routing through a trusted compatible endpoint; HTTPS is required except for explicit loopback development URLs.

The package can also be installed into another compatible Dot distribution:

```bash
dot install npm:@dotkaio/dot-keenable-web-search
```

## License

MIT. See the repository [LICENSE](../../LICENSE).
