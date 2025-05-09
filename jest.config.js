module.exports = {
  // Automatically clear mock calls and instances between tests
  clearMocks: true,

  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",

  // The test environment that will be used for testing
  testEnvironment: "node",

  // A list of paths to directories that Jest should use to search for files in
  roots: [
    "<rootDir>/test/"
  ],

  // The glob patterns Jest uses to detect test files
  testMatch: [
    "**/test/**/*.test.js"
  ],

  // Configure a setup file to run before each test
  setupFilesAfterEnv: [],

  // Default timeout (60 seconds for potentially slow API calls)
  testTimeout: 60000,

  // Verbose output
  verbose: true
};
