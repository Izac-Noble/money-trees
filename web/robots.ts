import type { Plugin } from "vite";

export const NOINDEX_META = '<meta name="robots" content="noindex, nofollow" />';

/** Only a production build may be indexed; every other build gets noindex. */
export function shouldNoindex(appEnv: string | undefined): boolean {
  return (appEnv ?? "").trim() !== "production";
}

export function robotsMeta(appEnv: string | undefined): Plugin {
  return {
    name: "money-trees-robots-meta",
    transformIndexHtml(html) {
      return shouldNoindex(appEnv) ? html.replace("</head>", `    ${NOINDEX_META}\n  </head>`) : html;
    },
  };
}
