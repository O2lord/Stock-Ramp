// client/types/css.d.ts
// Ambient module declaration for plain (non CSS-module) side-effect CSS
// imports, e.g. `import "@solana/wallet-adapter-react-ui/styles.css";` in
// SolanaProvider.tsx. Next.js's own next-env.d.ts only declares
// `*.module.css` (see node_modules/next/types/global.d.ts), not plain
// `*.css`, and newer TypeScript treats `noUncheckedSideEffectImports` as
// on by default — which flags any side-effect import with no matching
// module/type declaration (see TS2882). This is type-checking only; Next's
// webpack/SWC pipeline already handles the actual CSS at build/runtime
// regardless of this file.
declare module "*.css";
