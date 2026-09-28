// electron-vite bundles `?modulePath` imports as separate entry chunks and yields their path.
declare module '*?modulePath' {
  const path: string
  export default path
}
