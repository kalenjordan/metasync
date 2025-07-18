const execa = require('execa')
const path = require('path')
const fs = require('fs')
const os = require('os')

const cliPath = path.join(__dirname, '../cli.js')

// Helper to check if the shops config exists (for conditional testing)
const shopsConfigExists = fs.existsSync(path.join(os.homedir(), 'metasync.yaml'))

// Skip all tests if ~/metasync.yaml doesn't exist
if (!shopsConfigExists) {
  describe.skip('Define Metafields Command Tests (skipped - missing ~/metasync.yaml)', () => {
    it('dummy test', () => {
      expect(true).toBe(true)
    })
  })
} else {
  describe('Define Metafields Command', () => {
    beforeAll(() => {
      // Set longer timeout for API calls
      jest.setTimeout(60000)
    })

    it('executes the exact command from the user example', async () => {
      try {
        // Run the exact command from the user example
        await execa('node', [
          cliPath,
          'definitions',
          'metafields',
          '--resource', 'products',
          '--namespace', 'custom',
          '--source', 'demo',
          '--target', 'test'
        ])

        // If it gets here, the command executed without throwing an error
        expect(true).toBe(true)
      } catch (error) {
        // Re-throw the error to fail the test
        throw error
      }
    })
  })
}
