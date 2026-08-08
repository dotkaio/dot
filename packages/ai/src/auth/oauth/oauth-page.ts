const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" aria-hidden="true"><path fill="#fff" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/><path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/></svg>`;

const SUCCESS_BACKGROUNDS = [
	"radial-gradient(circle at 20% 20%, #2dd4bf 0, transparent 28%), radial-gradient(circle at 80% 30%, #6366f1 0, transparent 30%), linear-gradient(135deg, #020617, #111827 58%, #0f172a)",
	"radial-gradient(circle at 75% 18%, #fb7185 0, transparent 26%), radial-gradient(circle at 18% 80%, #38bdf8 0, transparent 32%), linear-gradient(135deg, #111827, #312e81)",
	"radial-gradient(circle at 50% 10%, #f59e0b 0, transparent 24%), radial-gradient(circle at 15% 70%, #a855f7 0, transparent 30%), linear-gradient(135deg, #0c0a09, #1f2937)",
	"radial-gradient(circle at 85% 80%, #22c55e 0, transparent 28%), radial-gradient(circle at 20% 25%, #e879f9 0, transparent 26%), linear-gradient(135deg, #020617, #18181b)",
] as const;

function randomSuccessBackground(): string {
	return SUCCESS_BACKGROUNDS[Math.floor(Math.random() * SUCCESS_BACKGROUNDS.length)];
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function renderPage(options: {
	title: string;
	message: string;
	heading?: string;
	details?: string;
	showLogo?: boolean;
	background?: string;
	watermark?: string;
}): string {
	const title = escapeHtml(options.title);
	const heading = options.heading ? escapeHtml(options.heading) : undefined;
	const message = escapeHtml(options.message);
	const details = options.details ? escapeHtml(options.details) : undefined;
	const showLogo = options.showLogo ?? true;
	const background = options.background ?? "var(--page-bg)";
	const watermark = options.watermark ? escapeHtml(options.watermark) : undefined;

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      --text: #fafafa;
      --text-dim: #a1a1aa;
      --page-bg: #09090b;
      --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: ${background};
      color: var(--text);
      font-family: var(--font-sans);
      text-align: center;
    }
    main {
      width: 100%;
      max-width: 560px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .logo {
      width: 72px;
      height: 72px;
      display: block;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 650;
      color: var(--text);
    }
    p {
      margin: 0;
      line-height: 1.7;
      color: var(--text-dim);
      font-size: 15px;
    }
    .message-only {
      color: var(--text);
      font-size: clamp(20px, 3vw, 34px);
      font-weight: 650;
      line-height: 1.25;
      text-shadow: 0 2px 24px rgba(0, 0, 0, 0.35);
    }
    .details {
      margin-top: 16px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .watermark {
      position: fixed;
      right: 20px;
      bottom: 18px;
      color: rgba(255, 255, 255, 0.72);
      font-size: 13px;
      letter-spacing: 0.01em;
      text-shadow: 0 1px 12px rgba(0, 0, 0, 0.45);
    }
  </style>
</head>
<body>
  <main>
    ${showLogo ? `<div class="logo">${LOGO_SVG}</div>` : ""}
    ${heading ? `<h1>${heading}</h1>` : ""}
    <p class="${heading ? "" : "message-only"}">${message}</p>
    ${details ? `<div class="details">${details}</div>` : ""}
  </main>
  ${watermark ? `<div class="watermark">${watermark}</div>` : ""}
</body>
</html>`;
}

export function oauthSuccessHtml(message: string): string {
	return renderPage({
		title: "Authentication successful",
		message,
		showLogo: false,
		background: randomSuccessBackground(),
		watermark: "with \u2764\uFE0F by kaio",
	});
}

export function oauthErrorHtml(message: string, details?: string): string {
	return renderPage({
		title: "Authentication failed",
		heading: "Authentication failed",
		message,
		details,
	});
}
