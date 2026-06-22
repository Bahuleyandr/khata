// Side-effect CSS imports (e.g. `import "./globals.css"` in app/layout). TypeScript
// 6 requires a type declaration for side-effect imports of non-code modules; Next
// processes the actual CSS at build time.
declare module "*.css";
