const execa = require('execa')
const path = require('path')
const fs = require('fs')

const cliPath = path.join(__dirname, '../run.js')

// Helper to check if the shops config exists (for conditional testing)
const shopsConfigExists = fs.existsSync(path.join(__dirname, '../.shops.json'))

describe('metasync CLI tool', () => {
  // Set a longer timeout for all tests
  jest.setTimeout(30000)

  it('shows help text', async () => {
    const { stdout } = await execa('node', [cliPath, '--help'])
    expect(stdout).toContain('Metasync - A CLI tool for synchronizing Shopify resources')
    expect(stdout).toContain('metasync define metafields')
    expect(stdout).toContain('metasync define metaobject')
    expect(stdout).toContain('metasync data')
  })

  it('shows help text for define metafields command', async () => {
    const { stdout } = await execa('node', [cliPath, 'define', 'metafields', '--help'])
    expect(stdout).toContain('Sync metafield definitions')
    expect(stdout).toContain('--resource <type>')
    expect(stdout).toContain('--namespace <namespace>')
  })

  it('shows error for unknown command', async () => {
    try {
      await execa('node', [cliPath, 'unknown-command'])
      // If the command doesn't throw, the test should fail
      expect(true).toBe(false)
    } catch (err) {
      expect(err.stderr).toContain('Error: unknown command')
    }
  })

  it('shows error for missing required resource parameter', async () => {
    try {
      await execa('node', [cliPath, 'define', 'metafields', '--namespace', 'custom'])
      // If the command doesn't throw, the test should fail
      expect(true).toBe(false)
    } catch (err) {
      // Check if the error indicates missing required parameter
      expect(err.stderr).toMatch(/Error: (Source shop|resource type)/i)
    }
  })

  // Only run these tests if .shops.json exists
  if (shopsConfigExists) {
    describe('Live API tests', () => {
      it('runs define metafields command for products', async () => {
        try {
          // Run the command
          await execa('node', [
            cliPath,
            'define',
            'metafields',
            '--resource', 'product',
            '--source', 'metasync-demo',
            '--target', 'kalen-test-store',
            '--namespace', 'custom'
          ])

          // If it gets here, the command executed without throwing an error
          expect(true).toBe(true)
        } catch (error) {
          // Re-throw the error to fail the test
          throw error
        }
      })
    })
  } else {
    it('skips live API tests when .shops.json does not exist', () => {
      console.log('Skipping live API tests: .shops.json not found')
      expect(true).toBe(true)
    })
  }
})
