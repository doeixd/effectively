export default {
  test: {
    // environment: 'jsdom', // or 'happy-dom'
    // Mock node modules in browser environment
    server: {
      deps: {
        external: ['node:async_hooks']
      }
    }
  }
}